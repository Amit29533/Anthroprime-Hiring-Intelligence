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
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const reportA = '00000000-0000-4000-8000-000000000021';

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
  return { db, act };
}

const CONFIG = `'{"groupBy":"client","measure":"sum","measureField":"positions","filters":[]}'`;

test('Batch-20: saved reports are tenant-scoped, audited and carried by the sync feed', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.reports(id,name,entity,config,owner) values('${reportA}','Open roles by client','demands',${CONFIG},'a@e.com');`,
  );

  // A colleague in the same workspace sees it; another tenant does not.
  await act(recruiter);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.reports`)).rows[0].c,
    1,
    'a saved report is shared across the workspace',
  );
  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.reports`)).rows[0].c,
    0,
    'and never leaks to another tenant',
  );

  await act(admin);
  const feed = (await db.query(`select public.api_changes_since(current_date - 1) as f`)).rows[0].f;
  assert.equal(feed.reports.length, 1, 'reports travel in the incremental feed');
  assert.equal(feed.reports[0].name, 'Open roles by client');
  assert.equal(feed.reports[0].config.measure, 'sum', 'the definition survives the round trip');
  assert.equal(feed.reports[0].workspace_id, undefined, 'workspace_id is stripped');
  const page = (await db.query(`select public.api_changes_page(current_date - 1, 0, 50) as f`))
    .rows[0].f;
  assert.equal(page.reports.length, 1);

  assert.deepEqual(
    (await db.query(`select action from public.history where "entityType"='reports'`)).rows.map(
      (r) => r.action,
    ),
    ['reports created'],
    'saving a report is recorded in history like any other write',
  );
  await db.close();
});

test('Batch-20: a report stores a definition, never a cached result', async () => {
  const { db } = await boot();
  const columns = (
    await db.query(
      `select column_name from information_schema.columns where table_schema='public' and table_name='reports'`,
    )
  ).rows.map((r) => r.column_name);
  assert.deepEqual(
    columns.sort(),
    [
      'config',
      'created',
      'description',
      'entity',
      'id',
      'name',
      'owner',
      'shared',
      'updated',
      'workspace_id',
    ],
    'there is nowhere to cache rows or totals, so a report can never be stale',
  );
  await db.close();
});

test('Batch-20: report names are unique per workspace but not across them', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.reports(name,entity,config) values('Weekly','demands',${CONFIG});`,
  );
  await assert.rejects(
    db.exec(
      `insert into public.reports(name,entity,config) values('  weekly ','demands',${CONFIG});`,
    ),
    /reports_name_unique|duplicate key/i,
  );
  await assert.rejects(
    db.exec(`insert into public.reports(name,entity,config) values('  ','demands',${CONFIG});`),
    /check/i,
  );
  // The other workspace may use the same name.
  await act(outsider);
  await db.exec(
    `insert into public.reports(name,entity,config) values('Weekly','demands',${CONFIG});`,
  );
  assert.equal((await db.query(`select count(*)::int as c from public.reports`)).rows[0].c, 1);
  await db.close();
});

test('Batch-20: editors may delete a report; viewers may not write at all', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.reports(id,name,entity,config) values('${reportA}','Weekly','demands',${CONFIG});`,
  );

  // A recruiter is an editor: they can refine and delete a shared report.
  await act(recruiter);
  await db.exec(`update public.reports set description='Refined' where id='${reportA}';`);
  await db.exec(`delete from public.reports where id='${reportA}';`);
  assert.equal((await db.query(`select count(*)::int as c from public.reports`)).rows[0].c, 0);

  // A viewer cannot create one.
  await db.exec(
    `reset role;update public.memberships set role='viewer' where user_id='${recruiter}';`,
  );
  await act(recruiter);
  await assert.rejects(
    db.exec(`insert into public.reports(name,entity,config) values('Nope','demands',${CONFIG});`),
    /row-level security|permission denied/i,
  );
  await db.close();
});

test('Batch-20: deleting a report leaves the records it reported on untouched', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.demands (id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
     values('00000000-0000-4000-8000-000000000041','Role','M','{"SQL"}',3,30,20,'Pune','Remote',1,'Low','Open',current_date+30,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`,
  );
  await db.exec(
    `insert into public.reports(id,name,entity,config) values('${reportA}','Weekly','demands',${CONFIG});`,
  );
  await db.exec(`delete from public.reports where id='${reportA}';`);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.demands`)).rows[0].c,
    1,
    'a report is metadata — deleting it destroys no repository data',
  );
  await db.close();
});
