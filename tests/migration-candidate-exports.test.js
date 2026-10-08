import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('candidate exports bind live tenant data, project roles, own receipts and share quotas', async (t) => {
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
        files.find((n) => n.endsWith('_audited_candidate_exports.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,current,expected) values('${id(50)}','${id(11)}','=Formula','a@example.com',10,20),('${id(51)}','${id(12)}','Other','b@example.com',30,40);
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  assert.equal(await rpc('api_candidate_export_mode'), false);
  await db.exec(`reset role;update settings set custom='{"auditedCandidateExports":true}';`);
  await act(1);
  assert.equal(await rpc('api_candidate_export_mode'), true);
  const admin = await rpc('api_prepare_candidate_export', [[id(50)]]);
  assert.equal(admin.rows[0].current, 10);
  assert.equal(admin.rows[0].expected, 20);
  assert.match(admin.rows[0].anthroId, /^ANTHRO-\d{5}$/);
  assert.match(admin.sha256, /^[a-f0-9]{64}$/);
  assert.equal(admin.rows[0].summary, undefined);
  assert.equal(admin.rows[0].workspace_id, undefined);
  await assert.rejects(
    rpc('api_prepare_candidate_export', [[id(50), id(51)]]),
    /selection is unavailable/,
  );
  for (const ids of [[], [id(50), id(50)], [null], Array(501).fill(id(50))])
    await assert.rejects(rpc('api_prepare_candidate_export', [ids]), /1 to 500/);
  await act(2);
  const recruiter = await rpc('api_prepare_candidate_export', [[id(50)]]);
  assert.equal('current' in recruiter.rows[0], false);
  assert.equal('expected' in recruiter.rows[0], false);
  await assert.rejects(rpc('api_candidate_export_page'), /Administrator/);
  await assert.rejects(
    db.query('select * from ecod_private.candidate_export_events'),
    /permission denied/,
  );
  await act(3);
  await assert.rejects(rpc('api_prepare_candidate_export', [[id(50)]]), /Export permission/);
  await act(4);
  await assert.rejects(rpc('api_prepare_candidate_export', [[id(50)]]), /selection is unavailable/);
  assert.equal((await rpc('api_candidate_export_page')).total, 0);
  await act(0, 'anon');
  await assert.rejects(rpc('api_prepare_candidate_export', [[id(50)]]), /permission denied/);
  await act(1);
  for (let n = 1; n < 6; n++)
    assert.equal((await rpc('api_prepare_candidate_export', [[id(50)]])).allowed, true);
  for (let n = 0; n < 3; n++) {
    const blocked = await rpc('api_prepare_candidate_export', [[id(50)]]);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  }
  const page = await rpc('api_candidate_export_page');
  assert.equal(page.total, 8);
  assert.equal(page.volume, 7);
  assert.equal(page.throttled, 1);
  assert.equal(JSON.stringify(page).includes('a@example.com'), false);
  assert.equal(JSON.stringify(page).includes('candidate_ids'), false);
  await db.exec(
    `reset role;update ecod_private.candidate_export_limits set started_at=now()-interval '2 minutes';update candidates set name='Updated' where id='${id(50)}';`,
  );
  await act(1);
  assert.equal((await rpc('api_prepare_candidate_export', [[id(50)]])).rows[0].name, 'Updated');
  await db.exec(
    `reset role;update candidates set summary='private note',source=repeat('x',1100000) where id='${id(50)}';`,
  );
  await act(1);
  const before = (await rpc('api_candidate_export_page')).total;
  await assert.rejects(rpc('api_prepare_candidate_export', [[id(50)]]), /too large/);
  assert.equal((await rpc('api_candidate_export_page')).total, before);
});
