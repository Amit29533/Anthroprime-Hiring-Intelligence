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
];

const admin = '00000000-0000-4000-8000-000000000001';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const other = '00000000-0000-4000-8000-000000000002';
const shown = '00000000-0000-4000-8000-000000000031';
const hidden = '00000000-0000-4000-8000-000000000032';
const closed = '00000000-0000-4000-8000-000000000033';
const foreign = '00000000-0000-4000-8000-000000000034';

const WEIGHTS = `'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}'`;

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
    `insert into auth.users values('${admin}','admin@e.com'),('${other}','other@e.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${other}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  const seed = (id, { visible = true, status = 'Open', title = 'Public Role' } = {}) =>
    db.exec(
      `insert into public.demands (id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights,"careersVisible",description,owner,"businessUnit",tags,created)
       values('${id}','${title}','Meridian','{"Databricks"}',7,30,42,'Bengaluru','Hybrid',2,'High','${status}',date '2026-12-01',${WEIGHTS},${visible},'Own the lakehouse platform.','Amit Singh','Data & AI','{"Confidential"}',date '2026-09-01');`,
    );
  return { db, act, seed };
}

test('Batch-19: the public listing gains the dates Google Jobs needs and nothing else', async () => {
  const { db, act, seed } = await boot();
  await act(admin);
  await seed(shown);
  await seed(hidden, { visible: false, title: 'Unpublished Role' });
  await seed(closed, { status: 'Closed', title: 'Closed Role' });
  await act(other);
  await seed(foreign, { title: 'Other Tenant Role' });

  await db.exec(`reset role;set role anon;`);
  const rows = (await db.query(`select * from public.api_public_open_roles('${w1}')`)).rows;
  assert.equal(rows.length, 1, 'only the published, still-open role of this workspace is listed');
  const role = rows[0];
  assert.equal(role.id, shown);

  // The two new columns, which become datePosted and validThrough.
  // PGlite returns Date objects for `date` columns; the app narrows them with isoDate().
  const iso = (v) => new Date(v).toISOString().slice(0, 10);
  assert.equal(iso(role.created), '2026-09-01', 'datePosted is available');
  assert.equal(iso(role.target), '2026-12-01', 'validThrough is available');

  // The projection is still exactly the safe field set — this is the security boundary.
  assert.deepEqual(
    Object.keys(role).sort(),
    [
      'client',
      'created',
      'description',
      'engagementType',
      'id',
      'location',
      'mode',
      'positions',
      'skills',
      'target',
      'title',
    ],
    'widening the projection must not have let an internal column through',
  );
  for (const secret of [
    'budget',
    'owner',
    'businessUnit',
    'tags',
    'weights',
    'workspace_id',
    'careersVisible',
    'approvalStatus',
    'approvedBy',
    'clientId',
    'departmentId',
  ])
    assert.ok(!(secret in role), `${secret} is not exposed to anonymous callers`);
  await db.close();
});

test('Batch-19: anonymous callers still cannot reach the demands table directly', async () => {
  const { db, act, seed } = await boot();
  await act(admin);
  await seed(shown);
  await db.exec(`reset role;set role anon;`);
  await assert.rejects(
    db.query(`select * from public.demands`),
    /permission denied/i,
    'the RPC remains the only anonymous route to role data',
  );
  // And the RPC cannot be pointed at another tenant to enumerate their roles.
  assert.equal(
    (await db.query(`select count(*)::int as c from public.api_public_open_roles('${w2}')`)).rows[0]
      .c,
    0,
  );
  await db.close();
});
