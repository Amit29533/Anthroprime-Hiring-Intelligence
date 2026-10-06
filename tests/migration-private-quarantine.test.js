import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('quarantine RPCs enforce leases, editor isolation, infected blocking and immutable retained proofs', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  const migration = await readFile(
    new URL(
      files.find((n) => n.endsWith('_private_cv_quarantine.sql')),
      path,
    ),
    'utf8',
  );
  await db.exec(migration);
  await db.exec(`insert into auth.users values('${id(1)}','a@e.com'),('${id(2)}','v@e.com'),('${id(3)}','b@e.com');
  insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
  insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');
  insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"durableCvImports":true}');
  insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Jane','jane@example.com');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const manifest = [{ name: 'cv.txt', ext: 'txt', size: 10, hash: 'a'.repeat(64) }];
  await act(1);
  await rpc('api_create_cv_import', [id(40), manifest]);
  await rpc('api_cv_uploaded', [id(40), 1]);
  await assert.rejects(rpc('worker_claim_cv_scan'), /permission denied/);
  await assert.rejects(
    db.exec(`update "importFiles" set scan_status='clean'`),
    /permission denied/,
  );
  await act(2);
  await assert.rejects(rpc('api_retry_cv_scan', [id(40), 1]), /Editor access/);
  await act(3);
  await assert.rejects(rpc('api_retry_cv_scan', [id(40), 1]), /editable/);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_claim_cv'), null);
  const first = await rpc('worker_claim_cv_scan');
  assert.equal(await rpc('worker_claim_cv_scan'), null);
  assert.equal(
    await rpc('worker_finish_cv_scan', [first.id, id(99), 'clean', 'etag', 'engine']),
    false,
  );
  await db.exec(
    `reset role;update "importFiles" set scan_until=now()-interval '1 second' where id='${first.id}';set role service_role;`,
  );
  const second = await rpc('worker_claim_cv_scan');
  assert.notEqual(first.scan_lease, second.scan_lease);
  assert.equal(
    await rpc('worker_finish_cv_scan', [first.id, first.scan_lease, 'clean', 'etag', 'engine']),
    false,
  );
  assert.equal(await rpc('worker_finish_cv_scan', [second.id, second.scan_lease, 'error']), true);
  assert.equal(await rpc('worker_claim_cv'), null);
  assert.equal(await rpc('worker_claim_cv_scan'), null, 'error retry has backoff');
  await act(1);
  await rpc('api_retry_cv_scan', [id(40), 1]);
  await act(0, 'service_role');
  const infected = await rpc('worker_claim_cv_scan');
  assert.equal(infected.scan_attempts, 1);
  await rpc('worker_finish_cv_scan', [infected.id, infected.scan_lease, 'infected']);
  await act(1);
  await rpc('api_retry_cv_scan', [id(40), 1]);
  assert.equal((await rpc('api_cv_files', [id(40)]))[0].scan_status, 'infected');
  await act(0, 'service_role');
  assert.equal(await rpc('worker_claim_cv'), null);
  assert.equal(await rpc('worker_claim_cv_scan'), null);
  await db.exec('reset role');
  await assert.rejects(
    db.exec(`update "importFiles" set state='ready' where id='${first.id}'`),
    /quarantined/,
  );
  await act(1);
  await rpc('api_create_cv_import', [id(41), manifest]);
  await rpc('api_cv_uploaded', [id(41), 1]);
  await act(0, 'service_role');
  const clean = await rpc('worker_claim_cv_scan');
  await assert.rejects(
    rpc('worker_finish_cv_scan', [clean.id, clean.scan_lease, 'clean']),
    /provenance/,
  );
  await rpc('worker_finish_cv_scan', [
    clean.id,
    clean.scan_lease,
    'clean',
    '"etag"',
    'ClamAV/version',
  ]);
  assert.equal(
    await rpc('worker_finish_cv_scan', [
      clean.id,
      clean.scan_lease,
      'clean',
      '"etag"',
      'ClamAV/version',
    ]),
    false,
  );
  const extracting = await rpc('worker_claim_cv');
  assert.equal(extracting.id, clean.id);
  assert.equal(extracting.scan_etag, '"etag"');
  await rpc('worker_finish_cv', [clean.id, extracting.lease, 'ready', 'Jane', { name: 'Jane' }]);
  await act(1);
  const insert = (hash) =>
    db.query(
      `insert into documents(id,workspace_id,"candidateId",kind,name,size,hash,"storagePath","storageProvider",stored,"scanRequired") values($1,$2,$3,'CV','cv.txt',10,$4,$5,'r2',true,false)`,
      [clean.id, id(11), id(50), hash, clean.storage_path],
    );
  await assert.rejects(insert('b'.repeat(64)), /quarantined/);
  await insert('a'.repeat(64));
  await db.query(`update documents set "scanRequired"=false where id=$1`, [clean.id]);
  assert.equal(
    (await db.query(`select "scanRequired" from documents where id=$1`, [clean.id])).rows[0]
      .scanRequired,
    true,
  );
  await assert.rejects(
    db.query('update documents set hash=$1 where id=$2', ['b'.repeat(64), clean.id]),
    /immutable/,
  );
  await act(2);
  assert.equal((await rpc('api_document_scan', [clean.id])).status, 'clean');
  await act(3);
  assert.equal(await rpc('api_document_scan', [clean.id]), null);
  await db.exec(`reset role;delete from "importBatches" where id='${id(41)}';`);
  await db.exec(migration);
  await act(2);
  assert.equal(
    (await rpc('api_document_scan', [clean.id])).etag,
    '"etag"',
    'proof survives batch deletion',
  );
  await act(1);
  await assert.rejects(
    db.query(
      `insert into documents(id,workspace_id,"candidateId",kind,name,size,hash,"storagePath","storageProvider",stored) values($1,$2,$3,'CV','copy.txt',10,$4,$5,'r2',true)`,
      [id(98), id(11), id(50), 'a'.repeat(64), clean.storage_path],
    ),
    /quarantined/,
  );
  await db.exec(`reset role;delete from ecod_private.cv_scan_verdicts where id='${clean.id}';`);
  await act(1);
  assert.equal((await rpc('api_document_scan', [clean.id])).status, 'unverified');
  await db.query('update documents set removed=true where id=$1', [clean.id]);
  assert.equal(
    await rpc('api_document_scan', [clean.id]),
    null,
    'unverified originals remain archivable',
  );
});
