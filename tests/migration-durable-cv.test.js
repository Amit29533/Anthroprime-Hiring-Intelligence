import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('durable CVs isolate editors, lease extraction and atomically link reviewed originals', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_durable_cv_staging.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_private_cv_quarantine.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','a@e.com'),('${id(2)}','v@e.com'),('${id(3)}','b@e.com');
  insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
  insert into memberships values('${id(1)}','${id(11)}','recruiter'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const manifest = [
    { name: 'One.txt', ext: 'txt', size: 10, hash: 'a'.repeat(64) },
    { name: 'Two.pdf', ext: 'pdf', size: 20, hash: 'b'.repeat(64) },
  ];
  await act(1);
  await assert.rejects(rpc('api_create_cv_import', [id(40), manifest]), /not enabled/);
  await db.exec(
    `reset role;insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"durableCvImports":true}');`,
  );
  await act(1);
  await rpc('api_create_cv_import', [id(40), manifest]);
  await rpc('api_create_cv_import', [id(40), manifest]);
  await assert.rejects(
    rpc('api_create_cv_import', [id(40), [{ ...manifest[0], hash: 'c'.repeat(64) }, manifest[1]]]),
    /conflict/,
  );
  let page = await rpc('api_import_page', [id(40)]);
  assert.equal(page.saved, 2);
  assert.equal(page.rows[0].status, 'excluded');
  await assert.rejects(rpc('api_import_action', [id(40), page.batch.version, 'approve']), /review/);
  await assert.rejects(rpc('worker_claim_cv'), /permission denied/);
  const ownFiles = await rpc('api_cv_files', [id(40)]);
  assert.equal(ownFiles.length, 2);
  assert.equal(ownFiles[0].lease, undefined);
  assert.equal(ownFiles[0].storage_path, undefined);
  await act(2);
  await assert.rejects(rpc('api_cv_files', [id(40)]), /Editor access/);
  assert.equal((await db.query('select * from "importFiles"')).rows.length, 0);
  await act(3);
  assert.deepEqual(await rpc('api_cv_files', [id(40)]), []);
  await assert.rejects(rpc('api_cv_uploaded', [id(40), 1]), /editable/);
  await act(1);
  await rpc('api_cv_uploaded', [id(40), 1]);
  await rpc('api_cv_uploaded', [id(40), 2]);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_claim_cv'), null, 'unscanned originals never enter extraction');
  const scanOne = await rpc('worker_claim_cv_scan');
  const scanTwo = await rpc('worker_claim_cv_scan');
  assert.equal(await rpc('worker_claim_cv_scan'), null);
  assert.equal(
    await rpc('worker_finish_cv_scan', [scanOne.id, id(99), 'clean', 'etag', 'ClamAV/test']),
    false,
  );
  await rpc('worker_finish_cv_scan', [
    scanOne.id,
    scanOne.scan_lease,
    'clean',
    'etag-one',
    'ClamAV/test',
  ]);
  await rpc('worker_finish_cv_scan', [
    scanTwo.id,
    scanTwo.scan_lease,
    'clean',
    'etag-two',
    'ClamAV/test',
  ]);
  const first = await rpc('worker_claim_cv');
  assert.equal(first.row_no, 1);
  const second = await rpc('worker_claim_cv');
  assert.equal(second.row_no, 2);
  assert.equal(await rpc('worker_claim_cv'), null, 'active leases are not reclaimed');
  assert.equal(
    await rpc('worker_finish_cv', [first.id, id(99), 'ready', 'text', {}]),
    false,
    'stale token cannot write',
  );
  await db.exec(
    `reset role;update "importFiles" set lease_until=now()-interval '1 second' where id='${first.id}';set role service_role;`,
  );
  const reclaimed = await rpc('worker_claim_cv');
  assert.notEqual(reclaimed.lease, first.lease);
  assert.equal(await rpc('worker_finish_cv', [first.id, first.lease, 'ready', 'text', {}]), false);
  assert.equal(
    await rpc('worker_finish_cv', [
      first.id,
      reclaimed.lease,
      'ready',
      'Jane Smith\njane@e.com',
      { name: 'Jane Smith', email: 'jane@e.com', skills: ['React'] },
    ]),
    true,
  );
  assert.equal(
    await rpc('worker_finish_cv', [
      second.id,
      second.lease,
      'manual',
      '',
      { name: '', email: '', skills: [] },
    ]),
    true,
  );
  assert.equal(
    await rpc('worker_finish_cv', [first.id, reclaimed.lease, 'ready', 'again', {}]),
    false,
    'receipt replay is idempotent',
  );
  await act(1);
  page = await rpc('api_import_page', [id(40)]);
  assert.equal(page.rows[0].candidate.name, 'Jane Smith');
  assert.equal(page.rows[0].status, 'excluded', 'draft suggestions require explicit review');
  const staged = await rpc('api_stage_import', [
    id(40),
    page.batch.version,
    [
      { row: 1, candidate: page.rows[0].candidate },
      { row: 2, candidate: {}, error: 'Excluded by reviewer.' },
    ],
  ]);
  await rpc('api_import_action', [id(40), staged.version, 'approve']);
  // Force the document insert to fail: candidate and completion receipt must roll back too.
  await db.exec(
    `reset role;alter table documents add constraint test_document_failure check(name<>'One.txt');set role service_role;`,
  );
  assert.equal((await rpc('worker_run_imports')).failed, 1);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*) n from candidates')).rows[0].n, 0);
  assert.equal((await db.query('select count(*) n from documents')).rows[0].n, 0);
  await db.exec('alter table documents drop constraint test_document_failure');
  await act(1);
  page = await rpc('api_import_page', [id(40)]);
  await rpc('api_import_action', [id(40), page.batch.version, 'reopen']);
  page = await rpc('api_import_page', [id(40)]);
  await rpc('api_import_action', [id(40), page.batch.version, 'approve']);
  await act(0, 'service_role');
  assert.equal((await rpc('worker_run_imports')).completed, 1);
  assert.equal((await rpc('worker_run_imports')).completed, 0);
  await db.exec('reset role');
  const docs = (await db.query('select * from documents')).rows;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, first.id);
  assert.equal(docs[0].stored, true);
  assert.equal(docs[0].hash, 'a'.repeat(64));
  const candidates = (await db.query('select id,"anthroId" from candidates')).rows;
  assert.equal(docs[0].candidateId, candidates[0].id);
  assert.match(candidates[0].anthroId, /^ANTHRO-\d{5}$/);
  // Cancellation while extraction runs makes its late receipt harmless.
  await act(1);
  await rpc('api_create_cv_import', [id(41), [manifest[0]]]);
  await rpc('api_cv_uploaded', [id(41), 1]);
  await act(0, 'service_role');
  const scanCancelled = await rpc('worker_claim_cv_scan');
  await rpc('worker_finish_cv_scan', [
    scanCancelled.id,
    scanCancelled.scan_lease,
    'clean',
    'etag-cancel',
    'ClamAV/test',
  ]);
  const cancelled = await rpc('worker_claim_cv');
  await act(1);
  page = await rpc('api_import_page', [id(41)]);
  await rpc('api_import_action', [id(41), page.batch.version, 'cancel']);
  await act(0, 'service_role');
  assert.equal(
    await rpc('worker_finish_cv', [
      cancelled.id,
      cancelled.lease,
      'ready',
      'text',
      { name: 'Late' },
    ]),
    false,
  );
});
