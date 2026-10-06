import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('legacy adoption preserves identity, quarantines current evidence and enforces tenant/admin retention holds', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_legacy_document_review.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Existing','existing@example.com');
    insert into documents(id,workspace_id,"candidateId",name,size,hash,"storagePath","storageProvider",stored,extracted,"dataUrl") values
    ('${id(40)}','${id(11)}','${id(50)}','old.txt',10,'${'a'.repeat(64)}','${id(11)}/candidates/${id(50)}/${id(90)}/old.txt','r2',true,'Legacy unverified text','data:text/plain;base64,YQ=='),
    ('${id(41)}','${id(11)}','${id(50)}','supabase.pdf',10,'${'b'.repeat(64)}','old/key','supabase',true,'Old text','');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  assert.equal((await rpc('api_document_review_queue')).total, 2);
  await assert.rejects(rpc('api_adopt_legacy_document', [id(40)]), /Enable private/);
  await db.exec(
    `reset role;update settings set custom='{"privateDocuments":true}' where workspace_id='${id(11)}';`,
  );
  await act(1);
  const page = await rpc('api_document_review_queue');
  assert.equal(page.rows.find((r) => r.id === id(40)).eligible, true);
  assert.equal(page.rows.find((r) => r.id === id(41)).eligible, false);
  await assert.rejects(rpc('api_adopt_legacy_document', [id(41)]), /Re-upload/);
  for (const n of [2, 3]) {
    await act(n);
    await assert.rejects(rpc('api_adopt_legacy_document', [id(40)]), /Administrator/);
    await assert.rejects(rpc('api_document_review_queue'), /Administrator/);
  }
  await act(4);
  assert.equal((await rpc('api_document_review_queue')).total, 0);
  await assert.rejects(
    rpc('api_adopt_legacy_document', [id(40)]),
    /Document not found|Enable private/,
  );
  await act(1);
  await rpc('api_adopt_legacy_document', [id(40)]);
  await rpc('api_adopt_legacy_document', [id(40)]);
  let doc = (await db.query('select * from documents where id=$1', [id(40)])).rows[0];
  assert.equal(doc.storagePath, `${id(11)}/candidates/${id(50)}/${id(90)}/old.txt`);
  assert.equal(doc.scanRequired, true);
  assert.equal(doc.extracted, '');
  assert.equal(doc.dataUrl, '');
  assert.equal((await rpc('api_document_scan', [id(40)])).status, 'unverified');
  assert.equal((await rpc('api_document_scan', [id(40)])).required, true);
  await assert.rejects(
    db.query('update documents set "scanRequired"=false,hash=$1 where id=$2', [
      'b'.repeat(64),
      id(40),
    ]),
    /immutable/,
  );
  await act(0, 'service_role');
  const scan = await rpc('worker_claim_attachment_scan');
  assert.equal(scan.legacy, true);
  await rpc('worker_finish_attachment_scan', [
    scan.id,
    scan.scan_lease,
    'clean',
    'etag',
    'ClamAV/test',
  ]);
  const parse = await rpc('worker_claim_attachment_extract');
  assert.equal(parse.legacy, true);
  await rpc('worker_finish_attachment_extract', [parse.id, parse.lease, 'ready', 'Verified text']);
  await act(1);
  doc = (await db.query('select * from documents where id=$1', [id(40)])).rows[0];
  assert.equal(doc.extracted, 'Verified text');
  const hold = [id(100), id(40), 'hold', 'Pending retention assessment', 30];
  await rpc('api_review_document_retention', hold);
  await rpc('api_review_document_retention', hold);
  await assert.rejects(
    rpc('api_review_document_retention', [id(100), id(40), 'keep', 'Changed request', 30]),
    /conflict/,
  );
  await act(2);
  await assert.rejects(
    db.query('update documents set removed=true where id=$1', [id(40)]),
    /retention hold/,
  );
  await assert.rejects(
    rpc('api_review_document_retention', [id(101), id(40), 'keep', 'Release', 30]),
    /Administrator/,
  );
  await act(1);
  await assert.rejects(
    rpc('api_review_document_retention', [id(101), id(40), 'archive', 'Archive', 30]),
    /Release hold/,
  );
  await db.exec(
    `reset role;update ecod_private.document_retention_reviews set review_after=now()-interval '1 day' where id='${id(100)}';`,
  );
  await act(1);
  assert.equal(
    (await rpc('api_document_review_queue')).rows.find((r) => r.id === id(40)).decision,
    'hold',
  );
  await assert.rejects(
    db.query('delete from documents where id=$1', [id(40)]),
    /retention hold|permission denied/,
  );
  await rpc('api_review_document_retention', [
    id(101),
    id(40),
    'keep',
    'Hold explicitly released',
    30,
  ]);
  await rpc('api_review_document_retention', [
    id(102),
    id(40),
    'archive',
    'Reversible archive',
    30,
  ]);
  assert.equal(
    (await db.query('select removed from documents where id=$1', [id(40)])).rows[0].removed,
    true,
  );
  assert.equal((await rpc('api_document_review_queue')).total, 1);
  await assert.rejects(
    db.query('select * from ecod_private.document_retention_reviews'),
    /permission denied/,
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select count(*)::integer n from ecod_private.document_retention_reviews'))
      .rows[0].n,
    3,
  );
});
