import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('private OCR owns dedicated longer leases and binds parser provenance to imported originals and text', async (t) => {
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
      files.find((n) => n.endsWith('_private_ocr_pipeline.sql')),
      path,
    ),
    'utf8',
  );
  await db.exec(migration);
  await db.exec(`insert into auth.users values('${id(1)}','a@e.com');insert into workspaces(id,name) values('${id(11)}','One');insert into memberships values('${id(1)}','${id(11)}','admin');
 insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"privateDocuments":true,"ocrDocuments":true}');insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Existing','existing@example.com');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const manifest = [{ name: 'cv.pdf', ext: 'pdf', size: 10, hash: 'a'.repeat(64) }];
  await act(1);
  await rpc('api_create_cv_import', [id(40), manifest]);
  await rpc('api_cv_uploaded', [id(40), 1]);
  await assert.rejects(rpc('worker_claim_ocr_cv'), /permission denied/);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_claim_ocr_cv'), null);
  const scanned = await rpc('worker_claim_cv_scan');
  await rpc('worker_finish_cv_scan', [
    scanned.id,
    scanned.scan_lease,
    'clean',
    'etag',
    'ClamAV/test',
  ]);
  assert.equal(
    await rpc('worker_claim_cv'),
    null,
    'Netlify text worker cannot consume OCR-enabled CVs',
  );
  const claimed = await rpc('worker_claim_ocr_cv');
  assert.equal(claimed.id, scanned.id);
  await db.exec('reset role');
  assert.ok(
    (
      await db.query(
        'select extract(epoch from (lease_until-now())) remaining from "importFiles" where id=$1',
        [claimed.id],
      )
    ).rows[0].remaining > 170,
  );
  await act(0, 'service_role');
  assert.equal(
    await rpc('worker_finish_ocr_cv', [
      claimed.id,
      id(99),
      'ready',
      'Jane',
      { name: 'Jane' },
      'ocr',
      'tesseract/test',
    ]),
    false,
  );
  await assert.rejects(
    rpc('worker_finish_ocr_cv', [claimed.id, claimed.lease, 'ready', 'Jane', {}, 'ocr', '']),
    /provenance/,
  );
  await rpc('worker_finish_ocr_cv', [
    claimed.id,
    claimed.lease,
    'ready',
    'Jane OCR text',
    { name: 'Jane', email: 'jane@example.com', skills: ['React'] },
    'ocr',
    'tesseract/test',
  ]);
  await act(1);
  const shown = await rpc('api_cv_files', [id(40)]);
  assert.equal(shown[0].parserMethod, 'ocr');
  assert.equal(shown[0].scan_lease, undefined);
  assert.equal(shown[0].extracted, undefined);
  const page = await rpc('api_import_page', [id(40)]);
  const staged = await rpc('api_stage_import', [
    id(40),
    page.batch.version,
    [{ row: 1, candidate: page.rows[0].candidate }],
  ]);
  await rpc('api_import_action', [id(40), staged.version, 'approve']);
  await act(0, 'service_role');
  const outcome = await rpc('worker_run_imports');
  await db.exec('reset role');
  const errors = (await db.query('select status,error from "importRows"')).rows;
  assert.equal(outcome.completed, 1, JSON.stringify(errors));
  await act(1);
  let doc = (await db.query('select * from documents where id=$1', [claimed.id])).rows[0];
  assert.equal(doc.parserMethod, 'ocr');
  assert.equal(doc.parserEngine, 'tesseract/test');
  await db.query(`update documents set "parserMethod"='fake',"parserEngine"='fake' where id=$1`, [
    claimed.id,
  ]);
  doc = (await db.query('select * from documents where id=$1', [claimed.id])).rows[0];
  assert.equal(doc.parserMethod, 'ocr');
  assert.equal(doc.parserEngine, 'tesseract/test');
  await db.query(`update documents set extracted='Edited text' where id=$1`, [claimed.id]);
  assert.equal(
    (await db.query('select "parserMethod" from documents where id=$1', [claimed.id])).rows[0]
      .parserMethod,
    'none',
    'edited text cannot claim original OCR provenance',
  );
  await rpc('api_prepare_attachment', [
    id(41),
    id(50),
    null,
    'profile.pdf',
    'pdf',
    10,
    'b'.repeat(64),
    'Other',
  ]);
  await rpc('api_attachment_uploaded', [id(41)]);
  await act(0, 'service_role');
  const attachment = await rpc('worker_claim_attachment_scan');
  await rpc('worker_finish_attachment_scan', [
    attachment.id,
    attachment.scan_lease,
    'clean',
    'etag-two',
    'ClamAV/test',
  ]);
  assert.equal(await rpc('worker_claim_attachment_extract'), null);
  const generic = await rpc('worker_claim_ocr_attachment');
  assert.equal(generic.id, id(41));
  await rpc('worker_finish_ocr_attachment', [
    generic.id,
    generic.lease,
    'ready',
    'OCR attachment text',
    'ocr',
    'tesseract/test',
  ]);
  await act(1);
  doc = (await db.query('select * from documents where id=$1', [id(41)])).rows[0];
  assert.equal(doc.extracted, 'OCR attachment text');
  assert.equal(doc.parserMethod, 'ocr');
  await db.exec('reset role');
  await db.exec(migration);
});
