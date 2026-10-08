import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('quality review bounds overlapping findings, evidence dates and cursor traversal while protecting identity telemetry', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(name, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL('20261007120440_repository_quality_and_identity_capacity.sql', path),
      'utf8',
    ),
  );
  for (let n = 1; n <= 5; n++)
    await db.query('insert into auth.users values($1,$2)', [id(n), `user${n}@e.com`]);
  await db.exec(`insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,phone,notice,current,verified) select ('76000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(11)}','Review','','9876543'||n::text,null,12345,(statement_timestamp() at time zone 'UTC')::date-121 from generate_series(1001,1035)n;
    update candidates set email='private@e.com',phone='9876543210',notice=0,verified=(statement_timestamp() at time zone 'UTC')::date where id='${id(1001)}';
    update candidates set verified=(statement_timestamp() at time zone 'UTC')::date+1 where id='${id(1005)}';
    update candidates set email='second@e.com',phone='' where id='${id(1002)}';
    insert into candidates(id,workspace_id,name,email,"mergedInto")values('${id(1036)}','${id(11)}','Retired identity','','${id(1006)}'),('${id(1037)}','${id(12)}','Other workspace','other@e.com',null);
    insert into skills(id,workspace_id,name)values('${id(21)}','${id(11)}','SQL');
    insert into "personSkills"(id,workspace_id,"candidateId","skillId")values('${id(501)}','${id(11)}','${id(1001)}','${id(21)}'),('${id(502)}','${id(11)}','${id(1002)}','${id(21)}'),('${id(503)}','${id(11)}','${id(1003)}','${id(21)}'),('${id(504)}','${id(11)}','${id(1004)}','${id(21)}'),('${id(505)}','${id(11)}','${id(1036)}','${id(21)}');
    insert into "skillEvidence"(workspace_id,"personSkillId","evidenceType",date)values('${id(11)}','${id(501)}','Recruiter-verified',now()-interval '400 days'),('${id(11)}','${id(501)}','Self-declared',now()),('${id(11)}','${id(502)}','Recruiter-verified',((statement_timestamp() at time zone 'UTC')::date-365)::timestamp at time zone 'UTC'),('${id(11)}','${id(503)}','Assessment',now()+interval '1 day'),('${id(11)}','${id(504)}','Certification',now()),('${id(11)}','${id(505)}','Recruiter-verified',now());`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args))
      .rows[0].value;
  const read = (kind = 'missing-current-skill-evidence', cursor = null) =>
    rpc('api_repository_quality', [kind, cursor]);
  await act(3);
  let page = await read();
  assert.equal(page.rows.length, 25);
  assert.ok(page.nextCursor);
  assert.equal(page.counts['missing-current-skill-evidence'], 32);
  assert.equal(page.counts['missing-email'], 33);
  assert.equal(page.counts['missing-phone'], 1);
  assert.equal(page.counts['missing-availability'], 34);
  assert.equal(page.counts['stale-profile'], 33);
  assert.equal(page.counts['future-profile-date'], 1);
  assert.equal(page.affectedCandidates, 35);
  assert.ok(page.rows.some((r) => r.id === id(1001)));
  assert.ok(page.rows.some((r) => r.id === id(1003)));
  assert.ok(!page.rows.some((r) => r.id === id(1002)));
  assert.ok(!page.rows.some((r) => r.id === id(1006)));
  assert.ok(!JSON.stringify(page).includes('private@e.com'));
  assert.ok(
    page.rows.every(
      (r) =>
        !('current' in r) &&
        !('expected' in r) &&
        !('phone' in r) &&
        !('email' in r) &&
        !('skillsDetail' in r),
    ),
  );
  const second = await read('missing-current-skill-evidence', page.nextCursor);
  assert.equal(second.rows.length, 7);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...page.rows, ...second.rows].map((r) => r.id)).size, 32);
  await assert.rejects(read('missing-email', page.nextCursor), /cursor changed/);
  await assert.rejects(
    read('missing-current-skill-evidence', { ...page.nextCursor, day: '2000-01-01' }),
    /cursor changed/,
  );
  await assert.rejects(
    read('missing-current-skill-evidence', { ...page.nextCursor, extra: true }),
    /cursor changed/,
  );
  await assert.rejects(read('invalid'), /Unknown quality/);
  await assert.rejects(rpc('api_anthro_id_capacity'), /Administrator access/);
  await act(2);
  await assert.rejects(rpc('api_anthro_id_capacity'), /Administrator access/);
  await act(4);
  assert.equal((await read()).affectedCandidates, 1);
  await act(1);
  const before = await rpc('api_anthro_id_capacity'),
    again = await rpc('api_anthro_id_capacity');
  assert.deepEqual(before, again);
  assert.equal(before.consumed, 37);
  assert.equal(before.remaining, 99962);
  assert.equal(before.scope, 'global');
  assert.equal(before.reusable, false);
  await act(1, 'postgres');
  await db.exec(`begin;select nextval('public.candidate_anthro_number_seq');rollback;`);
  await act(1);
  assert.equal((await rpc('api_anthro_id_capacity')).consumed, 38);
  for (const [value, called, remaining, level] of [
    [90000, true, 9999, 'warning'],
    [95000, true, 4999, 'critical'],
    [99999, false, 1, 'critical'],
    [99999, true, 0, 'exhausted'],
  ]) {
    await act(1, 'postgres');
    await db.query("select setval('public.candidate_anthro_number_seq',$1,$2)", [value, called]);
    await act(1);
    const capacity = await rpc('api_anthro_id_capacity');
    assert.equal(capacity.remaining, remaining);
    assert.equal(capacity.level, level);
  }
  await act(1, 'postgres');
  await db.exec(`delete from memberships where user_id='${id(1)}'`);
  await act(1);
  await assert.rejects(rpc('api_anthro_id_capacity'), /Administrator access/);
  await assert.rejects(read(), /membership/);
  await act(5);
  await assert.rejects(read(), /membership/);
  await act(null, 'anon');
  await assert.rejects(read(), /permission denied/);
  await assert.rejects(rpc('api_anthro_id_capacity'), /permission denied/);
});
