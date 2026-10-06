import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('private attachments reserve originals, enforce quarantine, isolate client agreements and gate extraction', async (t) => {
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
      files.find((n) => n.endsWith('_private_attachment_quarantine.sql')),
      path,
    ),
    'utf8',
  );
  await db.exec(migration);
  await db.exec(`insert into auth.users values('${id(1)}','a@e.com'),('${id(2)}','r@e.com'),('${id(3)}','v@e.com'),('${id(4)}','other@e.com');
  insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
  insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
  insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Jane','jane@example.com');
  insert into clients(id,workspace_id,name) values('${id(70)}','${id(11)}','Client');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const args = [id(40), id(50), null, 'cv.txt', 'txt', 10, 'a'.repeat(64), 'CV'];
  await act(1);
  assert.deepEqual(await rpc('api_prepare_attachment', args), { required: false });
  await db.exec(
    `reset role;insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"privateDocuments":true}');`,
  );
  await act(2);
  assert.equal(await rpc('api_attachment_mode'), true);
  await rpc('api_create_cv_import', [
    id(80),
    [{ name: 'cv.txt', ext: 'txt', size: 10, hash: 'a'.repeat(64) }],
  ]);
  const reserved = await rpc('api_prepare_attachment', args);
  assert.equal(reserved.required, true);
  assert.equal(reserved.storagePath, `${id(11)}/candidates/${id(50)}/${id(40)}/original.txt`);
  assert.deepEqual(await rpc('api_prepare_attachment', args), reserved);
  await assert.rejects(
    rpc('api_prepare_attachment', [...args.slice(0, 6), 'b'.repeat(64), 'CV']),
    /conflict/,
  );
  await assert.rejects(
    db.exec(
      `insert into documents(id,"candidateId",name) values('${id(99)}','${id(50)}','Bypass')`,
    ),
    /Reserve/,
  );
  let doc = (await db.query('select * from documents where id=$1', [id(40)])).rows[0];
  assert.equal(doc.scanRequired, true);
  assert.equal(doc.extracted, '');
  assert.equal(doc.stored, false);
  await db.query(
    `update documents set extracted='Forged text',"dataUrl"='data:bad',"parserStatus"='parsed',"scanRequired"=false where id=$1`,
    [id(40)],
  );
  doc = (await db.query('select * from documents where id=$1', [id(40)])).rows[0];
  assert.equal(doc.scanRequired, true);
  assert.equal(doc.extracted, '');
  assert.equal(doc.parserStatus, 'quarantined');
  assert.equal(doc.dataUrl, '');
  await assert.rejects(
    db.query(`update documents set "storagePath"='other' where id=$1`, [id(40)]),
    /immutable/,
  );
  await assert.rejects(db.query('select * from "documentJobs"'), /permission denied/);
  await assert.rejects(rpc('worker_claim_attachment_scan'), /permission denied/);
  await act(3);
  await assert.rejects(rpc('api_attachment_uploaded', [id(40)]), /Editor/);
  assert.equal((await rpc('api_attachment_status', [[id(40)]]))[0].uploaded, false);
  await act(4);
  assert.deepEqual(await rpc('api_attachment_status', [[id(40)]]), []);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_claim_attachment_scan'), null);
  assert.equal(await rpc('worker_claim_attachment_extract'), null);
  await act(2);
  await rpc('api_attachment_uploaded', [id(40)]);
  await act(0, 'service_role');
  const scanning = await rpc('worker_claim_attachment_scan');
  assert.equal(await rpc('worker_claim_attachment_extract'), null);
  assert.equal(
    await rpc('worker_finish_attachment_scan', [id(40), id(99), 'clean', 'etag', 'engine']),
    false,
  );
  await assert.rejects(
    rpc('worker_finish_attachment_scan', [id(40), scanning.scan_lease, 'clean']),
    /provenance/,
  );
  await rpc('worker_finish_attachment_scan', [
    id(40),
    scanning.scan_lease,
    'clean',
    'etag',
    'ClamAV/test',
  ]);
  const extracting = await rpc('worker_claim_attachment_extract');
  assert.equal(extracting.scan_etag, 'etag');
  assert.equal(
    await rpc('worker_finish_attachment_extract', [id(40), id(99), 'ready', 'Forged']),
    false,
  );
  await rpc('worker_finish_attachment_extract', [
    id(40),
    extracting.lease,
    'failed',
    'Discard this',
  ]);
  await act(2);
  doc = (await db.query('select * from documents where id=$1', [id(40)])).rows[0];
  assert.equal(doc.extracted, '');
  assert.equal(doc.parserStatus, 'failed');
  await rpc('api_retry_attachment', [id(40)]);
  await act(0, 'service_role');
  const retry = await rpc('worker_claim_attachment_extract');
  await rpc('worker_finish_attachment_extract', [
    id(40),
    retry.lease,
    'ready',
    'Jane verified text',
  ]);
  await act(2);
  await db.query(`update documents set extracted='Forged text' where id=$1`, [id(40)]);
  assert.equal(
    (await db.query('select extracted from documents where id=$1', [id(40)])).rows[0].extracted,
    'Jane verified text',
  );
  await act(3);
  assert.equal((await rpc('api_document_scan', [id(40)])).status, 'clean');
  await act(2);
  await assert.rejects(
    rpc('api_prepare_attachment', [
      id(41),
      null,
      id(70),
      'nda.pdf',
      'pdf',
      10,
      'b'.repeat(64),
      'NDA',
    ]),
    /not permitted/,
  );
  await act(1);
  await rpc('api_prepare_attachment', [
    id(41),
    null,
    id(70),
    'nda.pdf',
    'pdf',
    10,
    'b'.repeat(64),
    'NDA',
  ]);
  await rpc('api_attachment_uploaded', [id(41)]);
  await act(2);
  assert.deepEqual(await rpc('api_attachment_status', [[id(41)]]), []);
  await assert.rejects(rpc('api_retry_attachment', [id(41)]), /not found/);
  await act(0, 'service_role');
  const blocked = await rpc('worker_claim_attachment_scan');
  await rpc('worker_finish_attachment_scan', [id(41), blocked.scan_lease, 'infected']);
  await act(1);
  await rpc('api_retry_attachment', [id(41)]);
  assert.equal((await rpc('api_attachment_status', [[id(41)]]))[0].scan, 'infected');
  assert.equal(
    (await db.query('select "parserStatus" from documents where id=$1', [id(41)])).rows[0]
      .parserStatus,
    'blocked',
  );
  await db.exec('reset role');
  await db.exec(migration);
});
