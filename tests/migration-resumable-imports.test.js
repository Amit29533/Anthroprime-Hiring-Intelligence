import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('saved imports require review, commit atomically, recover failed rows and isolate editors', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  const sql = await readFile(
    new URL(
      files.find((n) => n.endsWith('_resumable_imports.sql')),
      path,
    ),
    'utf8',
  );
  await db.exec(sql);
  await db.exec(`insert into auth.users values('${id(1)}','editor@e.com'),('${id(2)}','viewer@e.com'),('${id(3)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','recruiter'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const candidate = (email, name = 'Imported') => ({
    name,
    email,
    phone: '',
    skills: ['React'],
    status: 'Assessing',
    mode: 'Flexible',
    experience: 5,
  });
  await act(1);
  const manifest = [id(40), 'Sheet', 3, { name: 'Name' }];
  assert.equal((await rpc('api_create_import', manifest)).version, 1);
  assert.equal((await rpc('api_create_import', manifest)).version, 1);
  await assert.rejects(rpc('api_create_import', [id(40), 'Wrong', 3, {}]), /conflict/);
  await assert.rejects(rpc('api_import_action', [id(40), 1, 'approve']), /all rows/);
  const rows = [
    {
      row: 1,
      sourceLine: 2,
      candidate: {
        ...candidate('first@e.com'),
        anthroId: 'ANTHRO-88888',
        linkedin: 'https://linkedin.com/in/person/',
        id: id(99),
        workspace_id: id(12),
      },
    },
    { row: 2, sourceLine: 3, candidate: candidate('first@e.com', 'Duplicate') },
    { row: 3, sourceLine: 4, candidate: candidate('not-an-email', 'Bad') },
  ];
  const stage = await rpc('api_stage_import', [id(40), 1, rows]);
  assert.equal(stage.version, 2);
  await assert.rejects(rpc('api_stage_import', [id(40), 1, rows]), /refresh/);
  await assert.rejects(rpc('worker_run_imports'), /permission denied/);
  await act(0, 'service_role');
  assert.equal((await rpc('worker_run_imports')).completed, 0, 'unapproved draft cannot execute');
  await act(1);
  await rpc('api_import_action', [id(40), 2, 'approve']);
  await act(0, 'service_role');
  await db.exec('begin');
  assert.equal((await rpc('worker_run_imports', [1])).completed, 1);
  await db.exec('rollback');
  assert.deepEqual(await rpc('worker_run_imports', [3]), { completed: 1, skipped: 1, failed: 1 });
  assert.equal((await rpc('worker_run_imports')).completed, 0, 'completed replay has no effects');
  await act(1);
  let page = await rpc('api_import_page', [id(40), 0]);
  assert.equal(page.batch.status, 'completed');
  assert.deepEqual(
    page.rows.map((r) => r.status),
    ['completed', 'duplicate', 'failed'],
  );
  const inserted = (await db.query('select id,"anthroId" from candidates')).rows;
  assert.equal(inserted.length, 1);
  assert.notEqual(inserted[0].id, id(99));
  assert.equal(
    inserted[0].anthroId,
    'ANTHRO-00002',
    'rolled-back sequence values are deliberately not reused',
  );
  await assert.rejects(db.exec('delete from "importRows"'), /permission denied/);
  await rpc('api_import_action', [id(40), page.batch.version, 'reopen']);
  page = await rpc('api_import_page', [id(40), 0]);
  await rpc('api_stage_import', [
    id(40),
    page.batch.version,
    [{ row: 3, sourceLine: 4, candidate: candidate('fixed@e.com') }],
  ]);
  page = await rpc('api_import_page', [id(40), 0]);
  await rpc('api_import_action', [id(40), page.batch.version, 'approve']);
  await act(0, 'service_role');
  assert.equal((await rpc('worker_run_imports')).completed, 1);
  await act(1);
  assert.equal((await db.query('select count(*) n from candidates')).rows[0].n, 2);
  await rpc('api_create_import', [id(41), 'Revoked', 1, {}]);
  await rpc('api_stage_import', [
    id(41),
    1,
    [{ row: 1, sourceLine: 2, candidate: candidate('revoked@e.com') }],
  ]);
  await rpc('api_import_action', [id(41), 2, 'approve']);
  await db.exec(`reset role;update memberships set role='viewer' where user_id='${id(1)}';`);
  await act(0, 'service_role');
  assert.equal((await rpc('worker_run_imports')).paused, true);
  await act(2);
  assert.equal((await db.query('select count(*) n from "importRows"')).rows[0].n, 0);
  await assert.rejects(rpc('api_import_page'), /Editor access/);
  await act(3);
  assert.equal((await rpc('api_import_page')).total, 0);
  await assert.rejects(rpc('api_import_page', [id(40), 0]), /not found/);
  await act(0, 'anon');
  await assert.rejects(rpc('api_import_page'), /permission denied/);
  await db.exec(`reset role;update memberships set role='recruiter' where user_id='${id(1)}';`);
  await act(1);
  await assert.rejects(
    db.query('insert into candidates(name,email,linkedin) values($1,$2,$3)', [
      'Duplicate link',
      'link@e.com',
      'HTTPS://LINKEDIN.COM/IN/PERSON',
    ]),
    /Duplicate LinkedIn/,
  );
  await rpc('api_create_import', [id(50), '200-row acceptance', 200, {}]);
  let version = 1;
  for (let start = 0; start < 200; start += 50) {
    const staged = await rpc('api_stage_import', [
      id(50),
      version,
      Array.from({ length: 50 }, (_, i) => ({
        row: start + i + 1,
        sourceLine: start + i + 2,
        candidate: candidate(`bulk${start + i}@e.com`),
      })),
    ]);
    version = staged.version;
  }
  await rpc('api_import_action', [id(50), version, 'approve']);
  await act(0, 'service_role');
  for (let n = 0; n < 10; n++) assert.equal((await rpc('worker_run_imports', [20])).completed, 20);
  assert.equal((await rpc('worker_run_imports', [20])).completed, 0);
  await act(1);
  const bulk = await rpc('api_import_page', [id(50), 150]);
  assert.equal(bulk.rows.length, 50);
  assert.equal(bulk.counts.completed, 200);
  assert.equal(bulk.batch.status, 'completed');
});
