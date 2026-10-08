import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { parseCVText } from '../src/cvParser.js';
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('structured CV import binds citations, requires review and atomically retains evidence with Anthro-ID', async (t) => {
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
        files.find((n) => n.endsWith('_structured_cv_evidence.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','a@e.com'),('${id(2)}','v@e.com'),('${id(3)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"durableCvImports":true}');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  await rpc('api_create_cv_import', [
    id(40),
    [{ name: 'cv.txt', ext: 'txt', mime: 'text/plain', size: 100, hash: 'a'.repeat(64) }],
  ]);
  await rpc('api_cv_uploaded', [id(40), 1]);
  await act(0, 'service_role');
  const scan = await rpc('worker_claim_cv_scan');
  await rpc('worker_finish_cv_scan', [scan.id, scan.scan_lease, 'clean', 'etag', 'ClamAV/test']);
  const file = await rpc('worker_claim_cv');
  const text =
    'Jane Smith\njane@example.com\nEmployment History\nDeveloper, Example 2021–2024\nEducation\nBSc Example';
  await rpc('worker_finish_cv', [file.id, file.lease, 'ready', text, parseCVText(text)]);
  await act(1);
  const page = await rpc('api_import_page', [id(40)]);
  const candidate = page.rows[0].candidate;
  assert.equal(candidate.cvEvidence.items.length, 2);
  const stage = (value) =>
    rpc('api_stage_import', [id(40), page.batch.version, [{ row: 1, candidate: value }]]);
  await assert.rejects(stage(candidate), /Confirm or remove/);
  candidate.cvEvidence.items = candidate.cvEvidence.items.map((i) => ({ ...i, reviewed: true }));
  await assert.rejects(
    stage({
      ...candidate,
      cvEvidence: {
        ...candidate.cvEvidence,
        items: [{ ...candidate.cvEvidence.items[0], evidence: 'Invented employer' }],
      },
    }),
    /citation/,
  );
  await act(2);
  await assert.rejects(stage(candidate), /Editor/);
  await act(3);
  await assert.rejects(stage(candidate), /not found|editable|version/i);
  await act(1);
  const saved = await stage(candidate);
  await rpc('api_import_action', [id(40), saved.version, 'approve']);
  await act(0, 'service_role');
  const result = await rpc('worker_run_imports');
  assert.equal(result.completed, 1);
  assert.equal((await rpc('worker_run_imports')).completed, 0);
  await act(1);
  const c = (await db.query('select id,"cvEvidence","anthroId"from candidates')).rows[0];
  assert.deepEqual(c.cvEvidence, candidate.cvEvidence);
  assert.match(c.anthroId, /^ANTHRO-\d{5}$/);
  assert.equal(
    (await db.query('select * from documents where "candidateId"=$1', [c.id])).rows.length,
    1,
  );
  await assert.rejects(
    db.query('update candidates set "cvEvidence"=$1 where id=$2', [
      { ...c.cvEvidence, items: [{ ...c.cvEvidence.items[0], reviewed: false }] },
      c.id,
    ]),
    /explicit review/,
  );
  await act(2);
  assert.equal((await db.query('select "cvEvidence" from candidates')).rows.length, 1);
  await act(3);
  assert.equal((await db.query('select "cvEvidence" from candidates')).rows.length, 0);
});
