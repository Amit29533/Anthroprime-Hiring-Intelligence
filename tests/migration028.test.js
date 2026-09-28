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
  '026_referrals.sql',
  '027_interview_slots.sql',
  '028_assignment_rules.sql',
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const ruleId = '00000000-0000-4000-8000-000000000021';

async function boot() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of MIGRATIONS)
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.exec(
    `insert into auth.users values('${admin}','a@e.com'),('${recruiter}','r@e.com'),('${outsider}','o@e.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  const addRule = (id = ruleId, over = {}) =>
    db.exec(
      `insert into public."assignmentRules"(id,name,entity,field,op,value,"assignTo",priority)
       values('${id}','${over.name || 'Referrals'}','${over.entity || 'candidates'}','${over.field || 'source'}','${over.op || 'eq'}','${over.value || 'Referral'}','${over.assignTo || 'Amit Singh'}',${over.priority || 100});`,
    );
  return { db, act, addRule };
}

test('Batch-26: only an administrator can decide who work is routed to', async () => {
  const { db, act, addRule } = await boot();
  await act(admin);
  await addRule();

  await act(recruiter);
  assert.equal(
    (await db.query(`select count(*)::int as c from public."assignmentRules"`)).rows[0].c,
    1,
    'a recruiter can read the rules that govern their queue',
  );
  await assert.rejects(
    db.exec(
      `insert into public."assignmentRules"(name,entity,field,op,value,"assignTo") values('Mine','candidates','source','eq','Referral','Sneaky Recruiter');`,
    ),
    /row-level security|permission denied/i,
    'but cannot route every incoming candidate to themselves',
  );
  await db.exec(`update public."assignmentRules" set "assignTo"='Sneaky Recruiter';`);
  await db.exec('reset role;');
  assert.equal(
    (await db.query(`select "assignTo" as a from public."assignmentRules"`)).rows[0].a,
    'Amit Singh',
    'nor quietly repoint an existing rule',
  );
  await act(recruiter);
  await db.exec(`delete from public."assignmentRules";`);
  await db.exec('reset role;');
  assert.equal(
    (await db.query(`select count(*)::int as c from public."assignmentRules"`)).rows[0].c,
    1,
    'nor delete one',
  );
  await db.close();
});

test('Batch-26: an admin can create, edit and remove rules', async () => {
  const { db, act, addRule } = await boot();
  await act(admin);
  await addRule();
  await db.exec(
    `update public."assignmentRules" set "assignTo"='Neha Kulkarni' where id='${ruleId}';`,
  );
  assert.equal(
    (await db.query(`select "assignTo" as a from public."assignmentRules"`)).rows[0].a,
    'Neha Kulkarni',
  );
  await db.exec(`delete from public."assignmentRules" where id='${ruleId}';`);
  assert.equal(
    (await db.query(`select count(*)::int as c from public."assignmentRules"`)).rows[0].c,
    0,
    'a rule is configuration — removing one destroys no repository data',
  );
  await db.close();
});

test('Batch-26: rules are constrained to fields and comparisons that exist', async () => {
  const { db, act } = await boot();
  await act(admin);
  await assert.rejects(
    db.exec(
      `insert into public."assignmentRules"(name,entity,field,op,value,"assignTo") values('X','unicorns','source','eq','a','B');`,
    ),
    /check constraint/i,
  );
  await assert.rejects(
    db.exec(
      `insert into public."assignmentRules"(name,entity,field,op,value,"assignTo") values('X','candidates','source','sounds-like','a','B');`,
    ),
    /check constraint/i,
  );
  await assert.rejects(
    db.exec(
      `insert into public."assignmentRules"(name,entity,field,op,value,"assignTo") values('  ','candidates','source','eq','a','B');`,
    ),
    /check constraint/i,
  );
  await assert.rejects(
    db.exec(
      `insert into public."assignmentRules"(name,entity,field,op,value,"assignTo") values('X','candidates','source','eq','a','  ');`,
    ),
    /check constraint/i,
    'a rule that assigns to nobody is not a rule',
  );
  await db.close();
});

test('Batch-26: rules are tenant-scoped, audited and in the sync feed', async () => {
  const { db, act, addRule } = await boot();
  await act(admin);
  await addRule();

  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public."assignmentRules"`)).rows[0].c,
    0,
    'another workspace cannot see how this desk is routed',
  );

  await act(admin);
  const feed = (await db.query(`select public.api_changes_since(current_date - 1) as f`)).rows[0].f;
  assert.equal(feed.assignmentRules.length, 1);
  assert.equal(feed.assignmentRules[0].workspace_id, undefined, 'workspace_id stripped');
  assert.equal(feed.assignmentRules[0].assignTo, 'Amit Singh');
  const page = (await db.query(`select public.api_changes_page(current_date - 1,0,50) as f`))
    .rows[0].f;
  assert.equal(page.assignmentRules.length, 1);
  assert.deepEqual(
    (
      await db.query(`select action from public.history where "entityType"='assignmentRules'`)
    ).rows.map((r) => r.action),
    ['assignmentRules created'],
    'changing who work goes to is auditable',
  );
  await db.close();
});
