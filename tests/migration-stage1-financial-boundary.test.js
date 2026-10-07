import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('financial columns and historical projections are server-enforced across raw, paged, legacy and edit APIs', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon,service_role;`);
  const root = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(root)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(name, root), 'utf8'));
  const migration = (await readdir(root)).find((n) => n.endsWith('_stage1_financial_boundary.sql'));
  await db.exec(await readFile(new URL(migration, root), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','staff@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
 insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
 insert into candidates(id,workspace_id,name,email,current,expected)values('${id(21)}','${id(11)}','Person','one@e.com',17,23),('${id(22)}','${id(12)}','Other','other@e.com',100,120);
 insert into "compensationHistory"(workspace_id,"candidateId",kind,amount)values('${id(11)}','${id(21)}','current',17);
 update candidates set title='Engineer' where id='${id(21)}';`);
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))
      .rows[0].value;
  await act(2);
  await assert.rejects(db.query('select * from candidates'), /permission denied/);
  await assert.rejects(db.query('select current,expected from candidates'), /permission denied/);
  await assert.rejects(
    db.query('select id from candidates where expected<30'),
    /permission denied/,
  );
  await assert.rejects(db.query('select snapshot from history'), /permission denied/);
  assert.equal((await db.query('select id,name from candidates')).rows.length, 1);
  assert.equal((await db.query('select * from "compensationHistory"')).rows.length, 0);
  await assert.rejects(
    db.query('select * from ecod_access_private.token_secret'),
    /permission denied/,
  );
  const profile = (await rpc('api_candidate_section', [id(21), 'profile'])).candidate;
  assert.equal(profile.current, undefined);
  assert.equal(profile.expected, undefined);
  const legacy = (await rpc('api_legacy_rows', ['candidates'])).rows;
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].current, undefined);
  const history = (await rpc('api_legacy_rows', ['history'])).rows;
  assert.ok(history.some((h) => h.snapshot?.name === 'Person'));
  assert.ok(history.every((h) => !h.snapshot || h.snapshot.current === undefined));
  await assert.rejects(
    rpc('api_candidate_section', [id(21), 'compensationHistory']),
    /Administrator/,
  );
  await assert.rejects(
    rpc('ecod_access_private.api_candidate_section_stage1_core', [id(21), 'profile', 0]),
    /permission denied/,
  );
  await assert.rejects(
    rpc('api_save_candidates', [[{ id: id(21), expected: 1 }]]),
    /administrator/,
  );
  const saved = await rpc('api_save_candidates', [[{ id: id(21), title: 'Updated' }]]);
  assert.equal(saved.rows[0].title, 'Updated');
  assert.equal(saved.rows[0].expected, undefined);
  const facts = await rpc('api_candidate_profile_context', [id(21)]);
  const edited = await rpc('api_candidate_profile_edit', [
    id(21),
    facts.token,
    { ...facts.fields, company: 'Employer' },
  ]);
  assert.equal(edited.fields.company, 'Employer');
  const availability = await rpc('api_candidate_availability', [id(21)]);
  assert.equal(availability.current.mode, 'Flexible');
  assert.ok(availability.current.token);
  await act(3);
  await assert.rejects(rpc('api_save_candidates', [[{ id: id(21), title: 'Wrong' }]]), /Editor/);
  await act(4);
  await assert.rejects(rpc('api_candidate_section', [id(21), 'profile']), /not found/);
  await act(1);
  const admin = (await rpc('api_legacy_rows', ['candidates'])).rows;
  assert.equal(admin[0].current, 17);
  assert.equal(admin[0].expected, 23);
  assert.equal(
    (await rpc('api_candidate_section', [id(21), 'compensationHistory'])).rows.length,
    1,
  );
  const financial = await rpc('api_save_candidates', [[{ id: id(21), expected: 25 }]]);
  assert.equal(financial.rows[0].expected, 25);
  assert.equal((await rpc('api_repository_page', [{ maxExpected: '30' }])).rows.length, 1);
  await assert.rejects(
    rpc('api_save_candidates', [[{ id: id(22), title: 'Intrusion' }]]),
    /not found/,
  );
});
