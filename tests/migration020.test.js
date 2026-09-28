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
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const clientA = '00000000-0000-4000-8000-000000000031';
const contactA = '00000000-0000-4000-8000-000000000041';

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
    `insert into auth.users values('${admin}','admin@example.com'),('${recruiter}','rec@example.com'),('${outsider}','out@example.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  return { db, act };
}

test('Batch-16 migration: client accounts and contacts are tenant-scoped, audited and synced', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.clients(id,name,industry,location,owner,status,tier)
     values('${clientA}','Meridian Technologies','Technology','Bengaluru','Amit Singh','Active','Strategic');`,
  );
  await db.exec(
    `insert into public."clientContacts"(id,"clientId",name,title,email,"isPrimary")
     values('${contactA}','${clientA}','Rohit Nair','Head of Data','rohit@meridian.example',true);`,
  );

  // A demand links to the account and keeps its display name.
  await db.exec(
    `insert into public.demands(id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
     values('00000000-0000-4000-8000-000000000051','Databricks Architect','Meridian Technologies','${clientA}','{"Databricks"}',7,30,42,'Bengaluru','Hybrid',2,'High','Open',current_date+30,
     '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`,
  );
  const linked = await db.query(`select "clientId" from public.demands limit 1`);
  assert.equal(linked.rows[0].clientId, clientA, 'demand links to the client account');

  // A submission can point at a real contact record.
  await db.exec(
    `insert into public.candidates(id,name,email) values('00000000-0000-4000-8000-000000000061','Aarav','aarav@example.com');
     insert into public.submissions("candidateId","demandId","contactId","clientContact")
     values('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000051','${contactA}','rohit@meridian.example');`,
  );
  assert.equal(
    (await db.query(`select "contactId" from public.submissions limit 1`)).rows[0].contactId,
    contactA,
    'submission stores the contact record it went to',
  );

  // Audit trail: record_change fires for both new tables.
  const hist = await db.query(
    `select "entityType", count(*)::int as count from public.history
      where "entityType" in ('clients','clientContacts') group by 1 order by 1`,
  );
  assert.deepEqual(
    hist.rows.map((r) => r.entityType),
    ['clientContacts', 'clients'],
    'client and contact writes are recorded in history',
  );

  // Both new tables travel in the incremental sync feed.
  const feed = (await db.query(`select public.api_changes_since('2000-01-01') as feed`)).rows[0]
    .feed;
  assert.equal(feed.clients.length, 1, 'clients travel in api_changes_since');
  assert.equal(feed.clientContacts.length, 1, 'contacts travel in api_changes_since');
  assert.equal(feed.clients[0].workspace_id, undefined, 'workspace_id is stripped from the feed');
  assert.equal(feed.demands[0].clientId, clientA, 'the demand link is visible to sync consumers');
  assert.ok(feed.candidates, 'the pre-existing feed tables are still present');
  assert.equal(feed.block, undefined, 'api_changes_since does not leak pagination keys');

  const page = (await db.query(`select public.api_changes_page('2000-01-01',0,200) as feed`))
    .rows[0].feed;
  assert.equal(page.clients.length, 1, 'clients travel in the paginated feed too');
  assert.equal(page.clientContacts.length, 1, 'contacts travel in the paginated feed too');

  // Tenant isolation: a member of another workspace sees nothing at all.
  await act(outsider);
  assert.equal(
    (await db.query('select count(*)::int as count from public.clients')).rows[0].count,
    0,
    'client accounts never cross a workspace boundary',
  );
  assert.equal(
    (await db.query('select count(*)::int as count from public."clientContacts"')).rows[0].count,
    0,
    'client contacts never cross a workspace boundary',
  );
  const outsiderFeed = (await db.query(`select public.api_changes_since('2000-01-01') as feed`))
    .rows[0].feed;
  assert.equal(outsiderFeed.clients.length, 0, 'the sync feed is workspace-scoped for clients');
  assert.equal(
    outsiderFeed.clientContacts.length,
    0,
    'the sync feed is workspace-scoped for contacts',
  );
  await db.close();
});

test('Batch-16 migration: constraints protect account integrity', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.clients(id,name) values('${clientA}','Meridian Technologies');`,
  );

  await assert.rejects(
    db.exec(`insert into public.clients(name) values('  meridian technologies ');`),
    /clients_name_unique|duplicate key/i,
    'the same account cannot be created twice under a different casing',
  );
  await assert.rejects(
    db.exec(`insert into public.clients(name) values('   ');`),
    /clients_name_check|violates check/i,
    'a client must have a name',
  );
  await assert.rejects(
    db.exec(`insert into public.clients(name,status) values('Nope','Archived');`),
    /clients_status_check|violates check/i,
    'client status is constrained to the known set',
  );

  await db.exec(
    `insert into public."clientContacts"(id,"clientId",name,email,"isPrimary") values('${contactA}','${clientA}','Rohit','r@example.com',true);`,
  );
  await assert.rejects(
    db.exec(
      `insert into public."clientContacts"("clientId",name,email,"isPrimary") values('${clientA}','Second','s@example.com',true);`,
    ),
    /client_contacts_one_primary|duplicate key/i,
    'only one primary contact is allowed per client',
  );
  await assert.rejects(
    db.exec(
      `insert into public."clientContacts"("clientId",name) values('${clientA}','No contact');`,
    ),
    /violates check/i,
    'a contact needs an email address or a phone number',
  );
  // A non-primary second contact is fine. (A failed statement rolls back PGlite's implicit
  // transaction, which discards the session role, so re-establish the actor first.)
  await act(admin);
  await db.exec(
    `insert into public."clientContacts"("clientId",name,email) values('${clientA}','Sneha','sneha@example.com');`,
  );
  assert.equal(
    (await db.query(`select count(*)::int as count from public."clientContacts"`)).rows[0].count,
    2,
  );

  // Deleting an account is admin-only, and it cascades to contacts without deleting demands.
  await act(admin);
  await db.exec(
    `insert into public.demands(id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
     values('00000000-0000-4000-8000-000000000051','Role','Meridian Technologies','${clientA}','{"Databricks"}',7,30,42,'Bengaluru','Hybrid',1,'High','Open',current_date+30,
     '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`,
  );
  await act(recruiter);
  await db.exec(`delete from public.clients where id='${clientA}';`);
  assert.equal(
    (await db.query('select count(*)::int as count from public.clients')).rows[0].count,
    1,
    'a recruiter cannot delete a client account',
  );
  await act(admin);
  await db.exec(`delete from public.clients where id='${clientA}';`);
  assert.equal(
    (await db.query('select count(*)::int as count from public.clients')).rows[0].count,
    0,
    'an admin can delete a client account',
  );
  assert.equal(
    (await db.query(`select count(*)::int as count from public."clientContacts"`)).rows[0].count,
    0,
    'contacts cascade with their account',
  );
  const demand = await db.query(`select "clientId" from public.demands limit 1`);
  assert.equal(demand.rows.length, 1, 'the demand survives the account deletion');
  assert.equal(
    demand.rows[0].clientId,
    null,
    'the demand link is cleared rather than the demand lost',
  );
  await db.close();
});
