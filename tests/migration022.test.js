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
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const deptA = '00000000-0000-4000-8000-000000000021';
const demandA = '00000000-0000-4000-8000-000000000031';

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
    `insert into auth.users values('${admin}','admin@e.com'),('${recruiter}','rec@e.com'),('${outsider}','out@e.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  const demand = (id, over = {}) => {
    const f = {
      title: `'Data Engineer'`,
      client: `'Meridian'`,
      positions: 2,
      budget: 42,
      location: `'Bengaluru'`,
      mode: `'Hybrid'`,
      minExperience: 7,
      ...over,
    };
    return db.exec(
      `insert into public.demands (id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
       values('${id}',${f.title},${f.client},'{"Databricks"}',${f.minExperience},30,${f.budget},${f.location},${f.mode},${f.positions},'High','Open',current_date+30,${WEIGHTS});`,
    );
  };
  const gateOn = async (on = true) => {
    await db.exec(`reset role;`);
    await db.exec(
      `insert into public."settings"(id,workspace_id,custom) values('workspace','${w1}','{"requisitionApprovals":${on}}')
       on conflict (workspace_id,id) do update set custom='{"requisitionApprovals":${on}}';`,
    );
  };
  const status = async (id = demandA) =>
    (
      await db.query(
        `select "approvalStatus" as s, "approvedBy" as by, "approvedAt" as at, "approvedTerms" as terms, "careersVisible" as vis, "approvalNote" as note from public.demands where id='${id}'`,
      )
    ).rows[0];
  return { db, act, demand, gateOn, status };
}

test('Batch-18: departments are tenant-scoped, audited and carried by the sync feed', async () => {
  const { db, act } = await boot();
  await act(admin);
  await db.exec(
    `insert into public.departments(id,name,head,"costCentre") values('${deptA}','Data Platform','Priya Raman','CC-2201');`,
  );

  // Tenant isolation.
  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.departments`)).rows[0].c,
    0,
    'another workspace sees no departments',
  );
  // RLS makes another tenant's row invisible rather than raising: the update matches nothing.
  await db.exec(`update public.departments set name='Stolen' where id='${deptA}';`);
  await act(admin);
  assert.equal(
    (await db.query(`select name from public.departments where id='${deptA}'`)).rows[0].name,
    'Data Platform',
    'a foreign workspace cannot rename the department',
  );

  const feed = (await db.query(`select public.api_changes_since(current_date - 1) as f`)).rows[0].f;
  assert.ok(Array.isArray(feed.departments), 'departments are part of the incremental feed');
  assert.equal(feed.departments.length, 1);
  assert.equal(feed.departments[0].name, 'Data Platform');
  assert.equal(
    feed.departments[0].workspace_id,
    undefined,
    'workspace_id is stripped, as elsewhere',
  );
  assert.equal(feed.block, undefined, 'api_changes_since still hides the pagination keys');

  const page = (await db.query(`select public.api_changes_page(current_date - 1, 0, 50) as f`))
    .rows[0].f;
  assert.equal(page.departments.length, 1, 'the paginated feed carries them too');

  const history = await db.query(
    `select action from public.history where "entityType"='departments'`,
  );
  assert.deepEqual(
    history.rows.map((r) => r.action),
    ['departments created'],
  );

  // Duplicate names are refused case- and whitespace-insensitively.
  await assert.rejects(
    db.exec(`insert into public.departments(name) values('  data PLATFORM ');`),
    /departments_name_unique|duplicate key/i,
  );
  await assert.rejects(db.exec(`insert into public.departments(name) values('   ');`), /check/i);
  // Deletion is revoked outright, like most repository tables.
  await assert.rejects(
    db.exec(`delete from public.departments where id='${deptA}';`),
    /permission denied/i,
  );
  await db.close();
});

test('Batch-18: linking a demand to a department never crosses a workspace boundary', async () => {
  const { db, act, demand } = await boot();
  await act(admin);
  await db.exec(`insert into public.departments(id,name) values('${deptA}','Data Platform');`);
  await demand(demandA);
  await db.exec(`update public.demands set "departmentId"='${deptA}' where id='${demandA}';`);
  assert.equal(
    (await db.query(`select "departmentId" as d from public.demands where id='${demandA}'`)).rows[0]
      .d,
    deptA,
  );

  // A department belonging to another workspace cannot be referenced.
  await act(outsider);
  const foreign = '00000000-0000-4000-8000-000000000099';
  await db.exec(`insert into public.departments(id,name) values('${foreign}','Other Dept');`);
  await act(admin);
  await assert.rejects(
    db.exec(`update public.demands set "departmentId"='${foreign}' where id='${demandA}';`),
    /demands_department_fk|violates foreign key/i,
    'the composite foreign key blocks a cross-tenant link',
  );
  await db.close();
});

test('Batch-18: deleting a department clears the link without orphaning the demand', async () => {
  const { db, act, demand } = await boot();
  await act(admin);
  await db.exec(`insert into public.departments(id,name) values('${deptA}','Data Platform');`);
  await demand(demandA);
  await db.exec(`update public.demands set "departmentId"='${deptA}' where id='${demandA}';`);

  // Deletion is revoked for clients, so this is the ops path (superuser / SQL editor).
  await db.exec(`reset role;delete from public.departments where id='${deptA}';`);
  const row = (
    await db.query(
      `select "departmentId" as d, workspace_id as ws, title from public.demands where id='${demandA}'`,
    )
  ).rows[0];
  assert.equal(row.d, null, 'the link is cleared');
  assert.equal(row.ws, w1, 'and crucially the demand keeps its workspace — SET NULL is scoped');
  assert.equal(row.title, 'Data Engineer', 'the requisition itself survives');
  await db.close();
});

test('Batch-18: a recruiter cannot approve their own requisition', async () => {
  const { db, act, demand, status } = await boot();
  await act(recruiter);
  await demand(demandA);
  assert.equal((await status()).s, 'Draft', 'requisitions start as drafts');

  // Requesting approval is a recruiter's job and is stamped.
  await db.exec(
    `update public.demands set "approvalStatus"='Pending approval' where id='${demandA}';`,
  );
  const pending = await status();
  assert.equal(pending.s, 'Pending approval');
  assert.ok(
    (
      await db.query(
        `select "submittedForApprovalAt" as t from public.demands where id='${demandA}'`,
      )
    ).rows[0].t,
    'the submission moment is recorded',
  );

  // Deciding it is not.
  await assert.rejects(
    db.exec(`update public.demands set "approvalStatus"='Approved' where id='${demandA}';`),
    /Only a workspace admin can approve or reject a requisition/,
  );
  await assert.rejects(
    db.exec(`update public.demands set "approvalStatus"='Rejected' where id='${demandA}';`),
    /Only a workspace admin can approve or reject a requisition/,
  );
  await assert.rejects(
    db.exec(`update public.demands set "approvedAt"=now() where id='${demandA}';`),
    /Only a workspace admin can set requisition approval fields/,
    'a recruiter cannot forge the stamp without touching the status',
  );
  assert.equal((await status()).s, 'Pending approval', 'nothing slipped through');

  // Nor by creating a pre-approved requisition outright.
  await assert.rejects(
    db.exec(
      `insert into public.demands (id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights,"approvalStatus")
       values('00000000-0000-4000-8000-000000000032','Sneaky','X','{"SQL"}',3,30,10,'Pune','Remote',1,'Low','Open',current_date+30,${WEIGHTS},'Approved');`,
    ),
    /Only a workspace admin can approve or reject a requisition/,
  );
  await db.close();
});

test('Batch-18: an admin approval is stamped by the server and bound to the exact terms', async () => {
  const { db, act, demand, status } = await boot();
  await act(recruiter);
  await demand(demandA);
  await act(admin);
  await db.exec(
    `update public.demands set "approvalStatus"='Approved', "approvedBy"='Somebody Else', "approvedAt"='2000-01-01', "approvalNote"='Budget confirmed' where id='${demandA}';`,
  );
  const approved = await status();
  assert.equal(approved.s, 'Approved');
  assert.equal(
    approved.by,
    'admin@e.com',
    'the approver comes from the session, not from what the client sent',
  );
  assert.equal(approved.note, 'Budget confirmed', 'the reviewer note is kept');
  assert.equal(approved.terms.positions, 2, 'the approved headcount is snapshotted');
  assert.equal(approved.terms.budget, 42);
  assert.equal(approved.terms.title, 'Data Engineer');
  assert.equal(
    approved.terms.weights,
    undefined,
    'only material terms are snapshotted, not scoring weights',
  );
  await db.close();
});

test('Batch-18: changing a material term withdraws the approval; cosmetic edits do not', async () => {
  const { db, act, demand, status } = await boot();
  await act(admin);
  await demand(demandA);
  await db.exec(`update public.demands set "approvalStatus"='Approved' where id='${demandA}';`);
  assert.equal((await status()).s, 'Approved');

  // A cosmetic edit keeps the approval.
  await db.exec(`update public.demands set priority='Low' where id='${demandA}';`);
  assert.equal((await status()).s, 'Approved', 'changing priority is not a material change');
  await db.exec(`update public.demands set "maxNotice"=60 where id='${demandA}';`);
  assert.equal((await status()).s, 'Approved');

  // Raising the headcount is material: the approval is withdrawn, not silently carried over.
  await db.exec(`update public.demands set positions=5 where id='${demandA}';`);
  const withdrawn = await status();
  assert.equal(withdrawn.s, 'Draft', 'the requisition goes back to draft');
  assert.equal(withdrawn.at, null, 'the stamp is cleared');
  assert.equal(withdrawn.by, '');
  assert.equal(withdrawn.terms, null, 'the stale snapshot is cleared');
  assert.match(withdrawn.note, /terms changed/i, 'and the reason is recorded');

  // Same for the budget.
  await db.exec(`update public.demands set "approvalStatus"='Approved' where id='${demandA}';`);
  await db.exec(`update public.demands set budget=99 where id='${demandA}';`);
  assert.equal((await status()).s, 'Draft', 'a budget change withdraws approval too');
  await db.close();
});

test('Batch-18: the publishing gate is opt-in and enforced in the database', async () => {
  const { db, act, demand, gateOn, status } = await boot();
  await act(recruiter);
  await demand(demandA);

  // Off by default: nothing changes for a workspace that does not run an approval process.
  await db.exec(`update public.demands set "careersVisible"=true where id='${demandA}';`);
  assert.equal((await status()).vis, true, 'publishing is unaffected until the gate is turned on');

  await gateOn(true);
  await act(recruiter);
  await db.exec(`update public.demands set "careersVisible"=false where id='${demandA}';`);
  await assert.rejects(
    db.exec(`update public.demands set "careersVisible"=true where id='${demandA}';`),
    /requires requisition approval before a role can be published/,
    'an unapproved requisition cannot be published once the gate is on',
  );

  await act(admin);
  await db.exec(`update public.demands set "approvalStatus"='Approved' where id='${demandA}';`);
  await act(recruiter);
  await db.exec(`update public.demands set "careersVisible"=true where id='${demandA}';`);
  assert.equal((await status()).vis, true, 'an approved requisition publishes normally');

  // Withdrawing the approval by editing a term also unpublishes the role.
  await db.exec(`update public.demands set positions=9 where id='${demandA}';`);
  const after = await status();
  assert.equal(after.s, 'Draft');
  assert.equal(
    after.vis,
    false,
    'the role is pulled from the public careers page when its approval lapses',
  );
  await db.close();
});

test('Batch-18: a rejection is recorded and keeps the role off the careers page', async () => {
  const { db, act, demand, gateOn, status } = await boot();
  await act(recruiter);
  await demand(demandA);
  await gateOn(true);
  await act(admin);
  await db.exec(
    `update public.demands set "approvalStatus"='Rejected', "approvalNote"='No budget this quarter' where id='${demandA}';`,
  );
  const rejected = await status();
  assert.equal(rejected.s, 'Rejected');
  assert.equal(rejected.note, 'No budget this quarter', 'the reason survives for the recruiter');
  assert.equal(rejected.at, null, 'a rejection is not an approval stamp');
  assert.equal(rejected.terms, null);

  await act(recruiter);
  await assert.rejects(
    db.exec(`update public.demands set "careersVisible"=true where id='${demandA}';`),
    /requires requisition approval/,
  );
  // The recruiter can revise and resubmit.
  await db.exec(
    `update public.demands set budget=30, "approvalStatus"='Pending approval' where id='${demandA}';`,
  );
  assert.equal((await status()).s, 'Pending approval');
  await db.close();
});

test('Batch-18: the approval status is constrained to known values', async () => {
  const { db, act, demand } = await boot();
  await act(admin);
  await demand(demandA);
  await assert.rejects(
    db.exec(`update public.demands set "approvalStatus"='Maybe' where id='${demandA}';`),
    /demands_approval_status_check|check constraint/i,
  );
  await db.close();
});
