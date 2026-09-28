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
  '029_placements.sql',
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const candidate = '00000000-0000-4000-8000-000000000021';
const demand = '00000000-0000-4000-8000-000000000022';
const client = '00000000-0000-4000-8000-000000000023';
const placement = '00000000-0000-4000-8000-000000000024';

async function boot() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of MIGRATIONS)
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.exec(`insert into auth.users values('${admin}','a@e.com'),('${recruiter}','r@e.com'),('${outsider}','o@e.com');
    insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
    insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`);
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  return { db, act };
}

async function addCore(db) {
  await db.exec(`insert into public.clients(id,name) values('${client}','Meridian');
    insert into public.candidates(id,name,email) values('${candidate}','Aarav','aarav@example.com');
    insert into public.demands(id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
    values('${demand}','Architect','Meridian','${client}','{"Databricks"}',7,30,42,'Bengaluru','Hybrid',1,'High','Open',current_date+30,
    '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
}

test('Phase 1: placements are tenant-scoped, auditable and synced', async () => {
  const { db, act } = await boot();
  await act(admin);
  await addCore(db);
  await db.exec(`insert into public.placements(id,"candidateId","demandId","clientId",status,"startDate")
    values('${placement}','${candidate}','${demand}','${client}','Active',current_date);`);
  await db.exec(`insert into public."placementCommercials"("placementId","billRate","costRate",currency,basis,"billedAmount")
    values('${placement}',100,70,'INR','Annual',50);`);

  const feed = (await db.query(`select public.api_changes_since(current_date-1) as f`)).rows[0].f;
  assert.equal(feed.placements.length, 1);
  assert.equal(feed.placementCommercials.length, 1);
  assert.equal(feed.placements[0].workspace_id, undefined);
  assert.deepEqual(
    (
      await db.query(
        `select "entityType" from public.history where "entityType" like 'placement%' order by 1`,
      )
    ).rows.map((r) => r.entityType),
    ['placementCommercials', 'placements'],
  );

  await act(outsider);
  assert.equal((await db.query('select count(*)::int as c from public.placements')).rows[0].c, 0);
  assert.equal(
    (await db.query('select public.api_changes_since(current_date-1) as f')).rows[0].f.placements
      .length,
    0,
  );
  await db.close();
});

test('Phase 1: recruiters manage deployment facts but cannot read or write commercials', async () => {
  const { db, act } = await boot();
  await act(admin);
  await addCore(db);

  await act(recruiter);
  await db.exec(`insert into public.placements(id,"candidateId","demandId","clientId",status,"startDate")
    values('${placement}','${candidate}','${demand}','${client}','Planned',current_date+7);`);
  assert.equal((await db.query('select count(*)::int as c from public.placements')).rows[0].c, 1);
  assert.equal(
    (await db.query('select count(*)::int as c from public."placementCommercials"')).rows[0].c,
    0,
  );
  await assert.rejects(
    db.exec(
      `insert into public."placementCommercials"("placementId","billRate") values('${placement}',100);`,
    ),
    /row-level security|permission denied/i,
  );
  const feed = (await db.query(`select public.api_changes_since(current_date-1) as f`)).rows[0].f;
  assert.equal(feed.placements.length, 1);
  assert.deepEqual(feed.placementCommercials, []);
  await db.close();
});

test('Phase 1: placement integrity prevents cross-client and invalid date records', async () => {
  const { db, act } = await boot();
  await act(admin);
  await addCore(db);
  const otherClient = '00000000-0000-4000-8000-000000000025';
  await db.exec(`insert into public.clients(id,name) values('${otherClient}','Other');`);
  await assert.rejects(
    db.exec(`insert into public.placements("candidateId","demandId","clientId",status,"startDate")
      values('${candidate}','${demand}','${otherClient}','Active',current_date);`),
    /foreign key|constraint/i,
  );
  await assert.rejects(
    db.exec(`insert into public.placements("candidateId","demandId","clientId",status,"startDate","endDate")
      values('${candidate}','${demand}','${client}','Active',current_date,current_date-1);`),
    /check constraint/i,
  );
  const otherCandidate = '00000000-0000-4000-8000-000000000026';
  const otherConsideration = '00000000-0000-4000-8000-000000000027';
  await db.exec(`insert into public.candidates(id,name,email) values('${otherCandidate}','Maya','maya@example.com');
    insert into public.considerations(id,"candidateId","demandId",stage)
    values('${otherConsideration}','${otherCandidate}','${demand}','Identified');`);
  await assert.rejects(
    db.exec(`insert into public.placements("candidateId","demandId","clientId","considerationId",status,"startDate")
      values('${candidate}','${demand}','${client}','${otherConsideration}','Active',current_date);`),
    /foreign key|constraint/i,
  );
  await db.close();
});
