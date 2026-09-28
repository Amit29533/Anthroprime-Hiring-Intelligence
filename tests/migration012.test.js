import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('Batch-11 migration: the candidate portal exposes only curated data and writes only whitelisted fields', async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const f of [
    '001_ecod.sql',
    '002_blueprint_r1.sql',
    '003_documents_taxonomy.sql',
    '004_admin_settings.sql',
    '005_consents_sync.sql',
    '006_interviews.sql',
    '007_offers_tasks_custom.sql',
    '008_submissions_demand_fields.sql',
    '009_careers_portal.sql',
    '010_sync_pagination.sql',
    '011_automation_portal.sql',
    '012_candidate_portal.sql',
  ])
    await db.exec(await readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  const admin = '00000000-0000-4000-8000-000000000001';
  const cand = '00000000-0000-4000-8000-0000000000aa';
  await db.exec(
    `insert into auth.users values('${admin}','admin@example.com'),('${cand}','priya@example.com');insert into public.workspaces(id,name) values('00000000-0000-4000-8000-000000000011','A');insert into public.memberships values('${admin}','00000000-0000-4000-8000-000000000011','admin');`,
  );
  await db.exec(
    `select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`,
  );
  await db.exec(
    `insert into public.candidates(id,name,email,title,notice) values ('${cand}','Priya Sharma','priya@example.com','Data Engineer',45);`,
  );
  await db.exec(
    `insert into public.demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values ('00000000-0000-4000-8000-0000000000d1','Analytics Engineer','Northstar Financial','{SQL}',0,30,30,'Bengaluru','Hybrid',1,'Medium',current_date+30,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}'::jsonb);`,
  );
  await db.exec(
    `insert into public.considerations(id,"candidateId","demandId",stage) values ('00000000-0000-4000-8000-0000000000c1','${cand}','00000000-0000-4000-8000-0000000000d1','Submitted');`,
  );
  await db.exec(
    `insert into public.notes(id,"candidateId",text,date,"followUp",completed,author) values ('00000000-0000-4000-8000-0000000000b1','${cand}','internal: handle with care',now(),now()+interval '7 days',false,'Recruiter');`,
  );
  // portal user = the candidate's own email
  await db.exec(`select set_config('request.jwt.claim.sub','${cand}',false);`);
  const ov = (await db.query(`select api_portal_overview() as o`)).rows[0].o;
  assert.equal(ov.profile.name, 'Priya Sharma');
  assert.deepEqual(ov.applications.length, 1);
  assert.equal(ov.applications[0].demand, 'Analytics Engineer');
  assert.ok(!('notes' in ov), 'notes table never projected');
  assert.ok(!('owner' in ov.profile) && !('current' in ov.profile), 'internal fields absent');
  assert.ok(!JSON.stringify(ov).includes('handle with care'), 'internal note text never leaks');
  // self-service update writes the whitelist only
  const upd = (
    await db.query(
      `select api_portal_update('{"notice":"21","stage":"Ready","expected":"38"}'::jsonb) as u`,
    )
  ).rows[0].u;
  assert.equal(upd.ok, true);
  const after = (await db.query(`select api_portal_overview() as o`)).rows[0].o;
  assert.equal(after.profile.notice, 21, 'notice updated via portal');
  assert.equal(Number(after.profile.expected), 38, 'expected updated via portal');
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
  const audits = (
    await db.query(`select detail,actor from public."auditEvents" where "entityId"='${cand}'`)
  ).rows;
  assert.ok(
    audits.some((a) => a.actor === 'Candidate (portal)'),
    'self-service change audited',
  );
  // consent revoke is scoped to own rows
  await db.exec(
    `insert into public."consents"("candidateId",purpose,status) values ('${cand}','marketing','granted');`,
  );
  const cid = (
    await db.query(`select id from public."consents" where "candidateId"='${cand}' limit 1`)
  ).rows[0].id;
  await db.exec(`select set_config('request.jwt.claim.sub','${cand}',false);`);
  const rv = (await db.query(`select api_portal_revoke_consent('${cid}') as r`)).rows[0].r;
  assert.equal(rv.ok, true);
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
  assert.equal(
    (await db.query(`select status from public."consents" where "candidateId"='${cand}'`)).rows[0]
      .status,
    'revoked',
  );
  // unlinked account gets a clean error, anon is denied
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
  const none = (await db.query(`select api_portal_overview() as o`)).rows[0].o;
  assert.match(none.error, /no candidate profile is linked/);
  await db.exec('reset role;set role anon;');
  await assert.rejects(() => db.exec(`select api_portal_overview();`), /permission/i);
  await assert.rejects(
    () => db.exec(`select api_portal_update('{"notice":"1"}'::jsonb);`),
    /permission/i,
  );
  // offer approval state is now legal
  await db.exec('reset role;set role authenticated;');
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
  await db.exec(
    `insert into public.offers("candidateId",role,status) values ('${cand}','Analytics Engineer','Pending approval');`,
  );
  const offers = (await db.query(`select status from public.offers where "candidateId"='${cand}'`))
    .rows;
  assert.equal(offers[0].status, 'Pending approval');
  await db.close();
});
