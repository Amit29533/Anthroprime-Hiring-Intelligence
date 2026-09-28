import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = [
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
  '013_offer_approvals.sql',
  '014_offer_approval_integrity.sql',
  '015_sync_offer_approval_fields.sql',
  '016_portal_clearable_preferences.sql',
  '017_complete_incremental_feed.sql',
  '018_public_careers_isolation.sql',
  '019_private_application_status.sql',
  '020_clients_contacts.sql',
  '021_user_administration.sql',
  '022_requisitions_departments.sql',
  '023_careers_seo.sql',
  '024_saved_reports.sql',
  '025_skills_model.sql',
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const aarav = '00000000-0000-4000-8000-000000000021';

/** Boot with a candidate whose skills exist only in the old text[] + jsonb shape. */
async function boot({ legacy = true } = {}) {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  const files = [...MIGRATIONS];
  const last = files.pop();
  for (const file of files)
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.exec(
    `insert into auth.users values('${admin}','a@e.com'),('${recruiter}','r@e.com'),('${outsider}','o@e.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  if (legacy)
    await db.exec(
      `insert into public.candidates (id,workspace_id,name,title,email,experience,skills,"skillsDetail",verified,status,location,source)
       values('${aarav}','${w1}','Aarav','Data Engineer','aarav@e.com',8,
              '{"Databricks","Apache Spark"}',
              '[{"skill":"Databricks","proficiency":"Advanced","years":6,"lastUsed":"2026-08-01","evidence":"Assessment","validated":true},
                {"skill":"Apache Spark","proficiency":"Working","evidence":"Unverified"}]'::jsonb,
              date '2026-09-01','Ready','Bengaluru','Referral');`,
    );
  // Now apply the migration under test, so the back-fill runs against real legacy data.
  await db.exec(await readFile(new URL(`../supabase/migrations/${last}`, import.meta.url), 'utf8'));
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  return { db, act };
}

const skillOf = async (db, name) =>
  (await db.query(`select id from public.skills where lower(name)=lower('${name}')`)).rows[0]?.id;
const psOf = async (db, skillId) =>
  (await db.query(`select * from public."personSkills" where "skillId"='${skillId}'`)).rows[0];

test('Batch-21: the migration back-fills the skills model from the legacy fields', async () => {
  const { db, act } = await boot();
  await act(admin);

  const skills = (await db.query(`select name from public.skills order by name`)).rows.map(
    (r) => r.name,
  );
  assert.deepEqual(skills, ['Apache Spark', 'Databricks'], 'canonical skills were created');

  const databricks = await skillOf(db, 'Databricks');
  const ps = await psOf(db, databricks);
  assert.equal(ps.proficiency, 'Advanced', 'the recorded proficiency carried across');
  assert.equal(Number(ps.years), 6);
  assert.equal(ps.validated, true, 'an assessment counts as validated');
  assert.equal(ps.confidence, 100, 'confidence is derived from the evidence, not copied');
  assert.equal(ps.evidenceCount, 1);

  const evidence = (
    await db.query(`select e.* from public."skillEvidence" e where e."personSkillId"='${ps.id}'`)
  ).rows;
  assert.equal(evidence.length, 1, 'the prior claim became evidence rather than being discarded');
  assert.equal(evidence[0].evidenceType, 'Assessment');
  assert.match(evidence[0].note, /Migrated/);

  // 'Unverified' in the old blob meant nobody had stood behind the claim.
  const spark = await psOf(db, await skillOf(db, 'Apache Spark'));
  assert.equal(spark.validated, false);
  assert.equal(
    (
      await db.query(
        `select "evidenceType" as t from public."skillEvidence" where "personSkillId"='${spark.id}'`,
      )
    ).rows[0].t,
    'Self-declared',
  );

  // The legacy fields are untouched, so matching and every existing screen keep working.
  const legacy = (
    await db.query(`select skills, "skillsDetail" from public.candidates where id='${aarav}'`)
  ).rows[0];
  assert.deepEqual(legacy.skills, ['Databricks', 'Apache Spark']);
  assert.equal(legacy.skillsDetail.length, 2);
  await db.close();
});

test('Batch-21: evidence is append-only — an assessment can never be silently replaced', async () => {
  const { db, act } = await boot();
  await act(recruiter);
  const ps = await psOf(db, await skillOf(db, 'Databricks'));
  const evidenceId = (
    await db.query(`select id from public."skillEvidence" where "personSkillId"='${ps.id}'`)
  ).rows[0].id;

  await assert.rejects(
    db.exec(`update public."skillEvidence" set proficiency='Exposure' where id='${evidenceId}';`),
    /permission denied/i,
    'blueprint §7: never silently replace an assessment',
  );
  await assert.rejects(
    db.exec(`delete from public."skillEvidence" where id='${evidenceId}';`),
    /permission denied/i,
  );
  assert.equal(
    (await db.query(`select proficiency from public."skillEvidence" where id='${evidenceId}'`))
      .rows[0].proficiency,
    'Advanced',
    'the original observation is intact',
  );
  await db.close();
});

test('Batch-21: stronger evidence updates the derived view; weaker evidence does not erase it', async () => {
  const { db, act } = await boot();
  await act(recruiter);
  const ps = await psOf(db, await skillOf(db, 'Databricks'));

  // A newer, weaker self-declared claim must not beat last month's assessment.
  await db.exec(
    `insert into public."skillEvidence"("personSkillId","evidenceType",proficiency,note)
     values('${ps.id}','Self-declared','Expert','I am an expert');`,
  );
  let after = await psOf(db, await skillOf(db, 'Databricks'));
  assert.equal(
    after.proficiency,
    'Advanced',
    'a fresh self-declared claim does not outrank an assessment',
  );
  assert.equal(after.evidenceCount, 2, 'but it is still recorded');
  assert.equal(after.confidence, 100);

  // A certification is strong evidence and does move the needle.
  await db.exec(
    `insert into public."skillEvidence"("personSkillId","evidenceType",proficiency,years,"lastUsed",assessor)
     values('${ps.id}','Certification','Expert',7,date '2026-09-20','Databricks');`,
  );
  after = await psOf(db, await skillOf(db, 'Databricks'));
  assert.equal(after.proficiency, 'Advanced', 'the assessment still carries the most weight');
  assert.equal(Number(after.years), 7, 'but corroborating facts are taken from all evidence');
  assert.equal(new Date(after.lastUsed).toISOString().slice(0, 10), '2026-09-20');
  assert.equal(after.evidenceCount, 3);
  await db.close();
});

test('Batch-21: the derived view is computed by the database, not asserted by the client', async () => {
  const { db, act } = await boot();
  await act(recruiter);
  const skill = await skillOf(db, 'Apache Spark');
  const ps = await psOf(db, skill);
  assert.equal(ps.proficiency, 'Working');
  assert.equal(ps.confidence, 10, 'a self-declared claim is worth little');

  // A client trying to assert an unearned proficiency is overwritten the moment evidence lands.
  await db.exec(
    `update public."personSkills" set proficiency='Expert', confidence=100, validated=true where id='${ps.id}';`,
  );
  await db.exec(
    `insert into public."skillEvidence"("personSkillId","evidenceType",proficiency)
     values('${ps.id}','Recruiter-verified','Proficient');`,
  );
  const after = await psOf(db, skill);
  assert.equal(after.proficiency, 'Proficient', 'the evidence decides, not the client');
  assert.equal(after.confidence, 75, 'recruiter-verified is 70, +5 for a second corroboration');
  assert.equal(after.validated, true);
  await db.close();
});

test('Batch-21: the skills model is tenant-scoped and cannot be cross-linked', async () => {
  const { db, act } = await boot();
  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.skills`)).rows[0].c,
    0,
    'another tenant sees no skills',
  );
  assert.equal(
    (await db.query(`select count(*)::int as c from public."skillEvidence"`)).rows[0].c,
    0,
    'and no evidence',
  );

  // A foreign skill cannot be attached to our candidate.
  await db.exec(
    `insert into public.skills(id,name) values('00000000-0000-4000-8000-0000000000aa','Foreign Skill');`,
  );
  await act(admin);
  await assert.rejects(
    db.exec(
      `insert into public."personSkills"("candidateId","skillId") values('${aarav}','00000000-0000-4000-8000-0000000000aa');`,
    ),
    /violates foreign key/i,
    'the composite foreign key blocks a cross-tenant link',
  );
  await db.close();
});

test('Batch-21: canonical skill names are unique per workspace, case-insensitively', async () => {
  const { db, act } = await boot();
  await act(admin);
  await assert.rejects(
    db.exec(`insert into public.skills(name) values('  databricks ');`),
    /skills_name_unique|duplicate key/i,
  );
  await assert.rejects(db.exec(`insert into public.skills(name) values('   ');`), /check/i);
  await db.exec(
    `insert into public.skills(name,domain,aliases) values('Snowflake','Data',array['snow']);`,
  );
  assert.equal(
    (await db.query(`select count(*)::int as c from public.skills`)).rows[0].c,
    3,
    'a genuinely new skill is accepted',
  );
  await db.close();
});

test('Batch-21: the skills model travels in the incremental sync feed', async () => {
  const { db, act } = await boot();
  await act(admin);
  const feed = (await db.query(`select public.api_changes_since(current_date - 400) as f`)).rows[0]
    .f;
  for (const table of ['skills', 'personSkills', 'skillEvidence']) {
    assert.ok(Array.isArray(feed[table]), `${table} is in the feed`);
    assert.ok(feed[table].length > 0, `${table} carries rows`);
    assert.equal(feed[table][0].workspace_id, undefined, `${table} strips workspace_id`);
  }
  const page = (await db.query(`select public.api_changes_page(current_date - 400, 0, 50) as f`))
    .rows[0].f;
  assert.ok(page.personSkills.length > 0, 'the paginated feed carries them too');
  assert.deepEqual(
    (
      await db.query(
        `select distinct "entityType" as t from public.history where "entityType" like '%kill%' order by 1`,
      )
    ).rows.map((r) => r.t),
    ['personSkills', 'skillEvidence', 'skills'],
    'every skills table is audited into history',
  );
  await db.close();
});

test('Batch-21: a workspace with no legacy skills migrates to an empty, working model', async () => {
  const { db, act } = await boot({ legacy: false });
  await act(admin);
  assert.equal((await db.query(`select count(*)::int as c from public.skills`)).rows[0].c, 0);
  // And the model still works from scratch.
  await db.exec(
    `insert into public.candidates (id,name,title,email,experience,status,location,source)
     values('${aarav}','New Person','Engineer','new@e.com',3,'Assessing','Pune','Referral');
     insert into public.skills(id,name,domain) values('00000000-0000-4000-8000-0000000000bb','Kubernetes','Cloud');
     insert into public."personSkills"(id,"candidateId","skillId") values('00000000-0000-4000-8000-0000000000cc','${aarav}','00000000-0000-4000-8000-0000000000bb');
     insert into public."skillEvidence"("personSkillId","evidenceType",proficiency) values('00000000-0000-4000-8000-0000000000cc','Assessment','Proficient');`,
  );
  const ps = await psOf(db, '00000000-0000-4000-8000-0000000000bb');
  assert.equal(ps.proficiency, 'Proficient');
  assert.equal(ps.confidence, 100);
  await db.close();
});
