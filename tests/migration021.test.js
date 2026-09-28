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
];

const admin = '00000000-0000-4000-8000-000000000001';
const admin2 = '00000000-0000-4000-8000-000000000002';
const recruiter = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
const newcomer = '00000000-0000-4000-8000-000000000005';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';

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
    `insert into auth.users values('${admin}','admin@anthroprime.example'),('${admin2}','second.admin@anthroprime.example'),('${recruiter}','rec@anthroprime.example'),('${outsider}','out@other.example');
     insert into public.workspaces(id,name) values('${w1}','AnthroPrime'),('${w2}','Other');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  const call = async (sql) => (await db.query(`select ${sql} as result`)).rows[0].result;
  return { db, act, call };
}

test('Batch-17: every member can see who has access; only admins see invitations', async () => {
  const { db, act, call } = await boot();
  await act(recruiter);
  const view = await call('public.api_workspace_members()');
  assert.equal(view.members.length, 2, 'the recruiter sees both colleagues');
  assert.equal(view.isAdmin, false, 'the recruiter is correctly not an admin');
  assert.equal(view.adminCount, 1);
  assert.deepEqual(
    view.members.map((m) => m.role),
    ['admin', 'recruiter'],
    'members are returned admin-first',
  );
  assert.equal(
    view.members.find((m) => m.role === 'recruiter').isSelf,
    true,
    'the caller is flagged so the UI can stop them editing themselves by accident',
  );
  assert.ok(
    view.members.every((m) => Object.keys(m).sort().join() === 'email,isSelf,role,userId'),
    'only identity and role are exposed — no tokens, no metadata',
  );

  // Invitations are administrative.
  const denied = await call('public.api_workspace_invites()');
  assert.match(denied.error, /administrator access required/);
  assert.match(
    (await call(`public.api_invite_member('someone@x.example','admin')`)).error,
    /administrator access required/,
    'a recruiter cannot invite anybody, let alone an admin',
  );
  assert.match(
    (await call(`public.api_set_member_role('${admin}','viewer')`)).error,
    /administrator access required/,
    'a recruiter cannot demote an administrator',
  );
  assert.match(
    (await call(`public.api_remove_member('${admin}')`)).error,
    /administrator access required/,
    'a recruiter cannot remove anybody',
  );
  // Read back as superuser: RLS deliberately stops a recruiter reading anyone else's membership
  // row directly, which is itself part of the protection being asserted.
  await db.exec('reset role;');
  assert.equal(
    (await db.query(`select role from public.memberships where user_id='${admin}'`)).rows[0].role,
    'admin',
    'no privilege change slipped through',
  );
  await db.close();
});

test('Batch-17: memberships stay unwritable directly, so the RPCs are the only route', async () => {
  const { db, act } = await boot();
  await act(recruiter);
  for (const sql of [
    `insert into public.memberships values('${newcomer}','${w1}','admin');`,
    `update public.memberships set role='admin' where user_id='${recruiter}';`,
    `delete from public.memberships where user_id='${admin}';`,
    `insert into public."workspaceInvites"(workspace_id,email) values('${w1}','x@y.example');`,
    `select * from public."workspaceInvites";`,
  ])
    await assert.rejects(db.exec(sql), /permission denied|denied/i, `blocked: ${sql.slice(0, 40)}`);
  await db.close();
});

test('Batch-17: an admin can invite, and signing up redeems the invitation', async () => {
  const { db, act, call } = await boot();
  await act(admin);
  const invited = await call(
    `public.api_invite_member('  NewPerson@Anthroprime.Example ','viewer')`,
  );
  assert.equal(invited.ok, true);
  assert.equal(invited.email, 'newperson@anthroprime.example', 'the address is normalised');

  const pending = await call('public.api_workspace_invites()');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].role, 'viewer');
  assert.equal(pending[0].invitedBy, 'admin@anthroprime.example', 'the inviter is recorded');

  // Re-inviting the same address updates the role rather than creating a second invitation.
  await call(`public.api_invite_member('newperson@anthroprime.example','recruiter')`);
  const still = await call('public.api_workspace_invites()');
  assert.equal(still.length, 1, 'no duplicate invitation');
  assert.equal(still[0].role, 'recruiter', 'the role was corrected');

  // The person signs up: the trigger on auth.users grants access.
  await db.exec(`reset role;`);
  await db.exec(`insert into auth.users values('${newcomer}','NewPerson@anthroprime.example');`);
  const membership = await db.query(
    `select workspace_id, role from public.memberships where user_id='${newcomer}'`,
  );
  assert.equal(membership.rows.length, 1, 'signing up redeemed the invitation');
  assert.equal(membership.rows[0].workspace_id, w1);
  assert.equal(membership.rows[0].role, 'recruiter', 'they joined with the invited role');

  await act(admin);
  assert.equal(
    (await call('public.api_workspace_invites()')).length,
    0,
    'a redeemed invitation is no longer pending',
  );
  assert.equal(
    (await call('public.api_workspace_members()')).members.length,
    3,
    'the new joiner shows up in the member list',
  );
  const audit = await db.query(
    `select action, detail from public."auditEvents" where "entityType"='membership' order by date`,
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ['invited', 'invited', 'invite accepted'],
    'the whole invitation lifecycle is audited',
  );
  assert.match(audit.rows.at(-1).detail, /joined as recruiter/);
  await db.close();
});

test('Batch-17: inviting somebody who already has an account grants access immediately', async () => {
  const { db, act, call } = await boot();
  await act(admin);
  // `newcomer` has an account but no membership yet.
  await db.exec(
    `reset role;insert into auth.users values('${newcomer}','later@anthroprime.example');`,
  );
  await act(admin);
  const res = await call(`public.api_invite_member('later@anthroprime.example','viewer')`);
  assert.equal(res.ok, true);
  await db.exec('reset role;');
  const membership = await db.query(
    `select role from public.memberships where user_id='${newcomer}'`,
  );
  assert.equal(membership.rows.length, 1, 'an existing account does not have to sign up again');
  assert.equal(membership.rows[0].role, 'viewer');
  await act(admin);
  assert.equal(
    (await call('public.api_workspace_invites()')).length,
    0,
    'the invitation was consumed on the spot',
  );
  await db.close();
});

test('Batch-17: invitations are validated and never cross a workspace boundary', async () => {
  const { db, act, call } = await boot();
  await act(admin);
  assert.match(
    (await call(`public.api_invite_member('not-an-email','viewer')`)).error,
    /valid email/,
  );
  assert.match(
    (await call(`public.api_invite_member('a b@c.example','viewer')`)).error,
    /valid email/,
  );
  assert.match(
    (await call(`public.api_invite_member('ok@c.example','superuser')`)).error,
    /unknown role/,
  );
  assert.match(
    (await call(`public.api_invite_member('rec@anthroprime.example','viewer')`)).error,
    /already a member/,
    'existing members are not re-invited',
  );
  await call(`public.api_invite_member('shared@anthroprime.example','viewer')`);

  // The other workspace's admin sees none of it, and can invite the same address independently.
  await act(outsider);
  assert.equal(
    (await call('public.api_workspace_invites()')).length,
    0,
    'invites are tenant-scoped',
  );
  assert.equal(
    (await call('public.api_workspace_members()')).members.length,
    1,
    'member lists are tenant-scoped',
  );
  assert.equal(
    (await call(`public.api_invite_member('shared@anthroprime.example','admin')`)).ok,
    true,
  );

  // The address is now invited to both workspaces; sign-up joins only the older invitation.
  await db.exec(
    `reset role;insert into auth.users values('${newcomer}','shared@anthroprime.example');`,
  );
  const rows = await db.query(
    `select workspace_id from public.memberships where user_id='${newcomer}'`,
  );
  assert.equal(rows.rows.length, 1, 'a user belongs to exactly one workspace');
  assert.equal(rows.rows[0].workspace_id, w1, 'the earliest invitation wins');
  await db.close();
});

test('Batch-17: role changes are audited and the last administrator is protected', async () => {
  const { db, act, call } = await boot();
  await act(admin);

  // The only admin cannot demote or remove themselves.
  assert.match(
    (await call(`public.api_set_member_role('${admin}','viewer')`)).error,
    /without an administrator/,
    'the workspace cannot be left unmanaged',
  );
  assert.match(
    (await call(`public.api_remove_member('${admin}')`)).error,
    /without an administrator/,
  );
  assert.equal(
    (await db.query(`select role from public.memberships where user_id='${admin}'`)).rows[0].role,
    'admin',
  );

  // Promote a colleague, and the guard lifts.
  const promoted = await call(`public.api_set_member_role('${recruiter}','admin')`);
  assert.equal(promoted.ok, true);
  assert.equal(promoted.from, 'recruiter');
  assert.equal(promoted.to, 'admin');
  assert.equal((await call('public.api_workspace_members()')).adminCount, 2);
  const stepDown = await call(`public.api_set_member_role('${admin}','viewer')`);
  assert.equal(stepDown.ok, true, 'with a second admin in place, stepping down is allowed');

  // Having demoted themselves, the former admin has lost admin powers immediately.
  assert.match(
    (await call(`public.api_set_member_role('${recruiter}','viewer')`)).error,
    /administrator access required/,
  );

  await act(recruiter);
  const removed = await call(`public.api_remove_member('${admin}')`);
  assert.equal(removed.ok, true);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.memberships where workspace_id='${w1}'`))
      .rows[0].c,
    1,
    'access was actually revoked',
  );

  const audit = await db.query(
    `select action, detail from public."auditEvents" where "entityType"='membership' order by date`,
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ['role changed', 'role changed', 'access removed'],
    'every privilege change left an audit trail',
  );
  assert.match(audit.rows[0].detail, /rec@anthroprime.example changed from recruiter to admin/);
  assert.match(audit.rows.at(-1).detail, /Removed admin@anthroprime.example/);
  await db.close();
});

test('Batch-17: role and membership errors are reported, not silently ignored', async () => {
  const { db, act, call } = await boot();
  await act(admin);
  assert.match(
    (await call(`public.api_set_member_role('${outsider}','viewer')`)).error,
    /not a member of this workspace/,
    'a member of another workspace cannot be touched',
  );
  assert.match(
    (await call(`public.api_remove_member('${outsider}')`)).error,
    /not a member of this workspace/,
  );
  assert.match(
    (await call(`public.api_set_member_role('${recruiter}','owner')`)).error,
    /unknown role/,
  );
  assert.equal(
    (await call(`public.api_set_member_role('${recruiter}','recruiter')`)).unchanged,
    true,
    'setting the role it already has is a no-op, not an error',
  );
  assert.match(
    (await call(`public.api_revoke_invite('${w2}')`)).error,
    /invitation not found/,
    'revoking an unknown invitation is reported',
  );

  const invited = await call(`public.api_invite_member('temp@anthroprime.example','viewer')`);
  const revoked = await call(`public.api_revoke_invite('${invited.id}')`);
  assert.equal(revoked.ok, true);
  assert.equal((await call('public.api_workspace_invites()')).length, 0);
  // A revoked invitation grants nothing at sign-up.
  await db.exec(
    `reset role;insert into auth.users values('${newcomer}','temp@anthroprime.example');`,
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int as c from public.memberships where user_id='${newcomer}'`,
      )
    ).rows[0].c,
    0,
    'signing up after a revoked invitation grants no access',
  );
  await db.close();
});
