// Drives the Users & roles panel with a stubbed RPC layer, so the component's behaviour — what an
// admin sees versus a recruiter, what is refused before the round trip, and that the database's
// own refusal text is shown rather than an invented one — is verified without a live Supabase.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle } from './ui-harness.js';
import { press, type, choose, submitVia, allText, withWindow } from './ui-drivers.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const ADMIN = { userId: 'u-admin', email: 'amit@anthroprime.example', role: 'admin', isSelf: true };
const REC = { userId: 'u-rec', email: 'rec@anthroprime.example', role: 'recruiter', isSelf: false };
const VIEW = { userId: 'u-view', email: 'view@anthroprime.example', role: 'viewer', isSelf: false };

/** A stub of the members RPC surface that records calls and can be told to fail. */
function stubApi({ members = [ADMIN, REC, VIEW], isAdmin = true, invites = [], fail = {} } = {}) {
  const calls = [];
  const api = {
    fetchMembers: async () => {
      calls.push(['fetchMembers']);
      if (fail.fetchMembers) return { error: fail.fetchMembers };
      return { members, isAdmin, adminCount: members.filter((m) => m.role === 'admin').length };
    },
    fetchInvites: async () => {
      calls.push(['fetchInvites']);
      return invites;
    },
    inviteMember: async (email, role) => {
      calls.push(['inviteMember', email, role]);
      return fail.inviteMember ? { error: fail.inviteMember } : { ok: true };
    },
    revokeInvite: async (id) => {
      calls.push(['revokeInvite', id]);
      return { ok: true };
    },
    setMemberRole: async (userId, role) => {
      calls.push(['setMemberRole', userId, role]);
      return fail.setMemberRole ? { error: fail.setMemberRole } : { ok: true };
    },
    removeMember: async (userId) => {
      calls.push(['removeMember', userId]);
      return fail.removeMember ? { error: fail.removeMember } : { ok: true };
    },
  };
  return { api, calls };
}

async function panel(options = {}, props = {}) {
  const { api, calls } = stubApi(options);
  const toasts = [];
  await mount(M.Members, {
    api,
    available: true,
    notify: (m) => toasts.push(m),
    ...props,
  });
  await settle(4);
  return { api, calls, toasts };
}

test('an administrator sees every member, their role and the invitation form', async () => {
  const { calls } = await panel({
    invites: [{ id: 'i1', email: 'new@x.example', role: 'viewer' }],
  });
  assert.ok(screen.getByText('Users & roles'), 'the panel rendered');
  assert.ok(screen.getByText(/amit@anthroprime.example/), 'members are listed');
  assert.ok(screen.getByText('You'), 'the signed-in user is marked');
  assert.ok(screen.getByText(/3 people have access/), 'the headline counts access');
  assert.ok(screen.getByLabelText(/Role for rec@anthroprime.example/), 'roles are editable');
  assert.ok(screen.getByLabelText(/Invite by email/), 'the invite form is available');
  assert.ok(screen.getByText('Pending invitations'), 'outstanding invitations are shown');
  assert.ok(screen.getByText('new@x.example'));
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['fetchMembers', 'fetchInvites'],
    'the panel loads members then invitations',
  );
  cleanup();
});

test('a recruiter sees the roster read-only and is told who can change it', async () => {
  const { calls } = await panel({ isAdmin: false });
  assert.ok(screen.getByText(/rec@anthroprime.example/), 'the roster is still visible');
  assert.equal(
    screen.queryByLabelText(/Invite by email/),
    null,
    'a non-admin gets no invitation form',
  );
  assert.equal(
    screen.queryByLabelText(/Role for rec@anthroprime.example/),
    null,
    'a non-admin cannot change roles',
  );
  assert.ok(
    allText(/Only an administrator can invite people or change roles/).length,
    'the panel explains why the controls are missing',
  );
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['fetchMembers'],
    'invitations are never even requested by a non-admin',
  );
  cleanup();
});

test('changing a role calls the RPC and reports the change', async () => {
  const { calls, toasts } = await panel();
  await choose('Role for rec@anthroprime.example', 'viewer');
  await settle(4);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'setMemberRole'),
    [['setMemberRole', 'u-rec', 'viewer']],
    'the RPC is called with the target and the new role',
  );
  assert.ok(
    toasts.some((t) => /rec@anthroprime.example is now Viewer/.test(t)),
    'the change is confirmed to the user',
  );
  assert.ok(
    calls.filter((c) => c[0] === 'fetchMembers').length > 1,
    'the roster is reloaded from the database rather than patched locally',
  );
  cleanup();
});

test('demoting the last administrator is refused before the round trip', async () => {
  const { calls, toasts } = await panel({ members: [ADMIN, REC], isAdmin: true });
  await choose('Role for amit@anthroprime.example', 'viewer');
  await settle(4);
  assert.equal(
    calls.filter((c) => c[0] === 'setMemberRole').length,
    0,
    'the client does not even attempt a change the database would refuse',
  );
  assert.ok(
    toasts.some((t) => /last administrator/i.test(t)),
    'the reason is explained',
  );
  cleanup();
});

test('removing a member asks for confirmation and can be cancelled', async () => {
  const { calls } = await panel();
  await withWindow(
    'confirm',
    () => false,
    async () => {
      await press('Remove', 1);
    },
  );
  assert.equal(
    calls.filter((c) => c[0] === 'removeMember').length,
    0,
    'declining the confirmation removes nobody',
  );
  await withWindow(
    'confirm',
    () => true,
    async () => {
      await press('Remove', 1);
    },
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === 'removeMember'),
    [['removeMember', 'u-rec']],
    'confirming calls the RPC for that member',
  );
  cleanup();
});

test('the database refusal is shown verbatim rather than being reinterpreted', async () => {
  const { toasts } = await panel({
    fail: { setMemberRole: 'administrator access required' },
  });
  await choose('Role for rec@anthroprime.example', 'viewer');
  await settle(4);
  assert.ok(
    toasts.some((t) => t === 'administrator access required'),
    'the authoritative message from the database is what the user sees',
  );
  cleanup();
});

test('invitations are validated locally and sent normalised', async () => {
  const { calls, toasts } = await panel();
  await type('Invite by email', 'not-an-email');
  await submitVia('Send invitation');
  await settle(2);
  assert.ok(allText(/valid email address/i).length, 'an invalid address is refused in the form');
  assert.equal(calls.filter((c) => c[0] === 'inviteMember').length, 0, 'nothing was sent');

  await type('Invite by email', '  NewJoiner@Anthroprime.Example ');
  await choose('Invitation role', 'viewer');
  await submitVia('Send invitation');
  await settle(4);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'inviteMember'),
    [['inviteMember', 'newjoiner@anthroprime.example', 'viewer']],
    'the address is trimmed and lowercased before it reaches the database',
  );
  assert.ok(toasts.some((t) => /Invited newjoiner@anthroprime.example as Viewer/.test(t)));
  cleanup();
});

test('inviting somebody who already has access is refused in the form', async () => {
  const { calls } = await panel();
  await type('Invite by email', 'REC@anthroprime.example');
  await submitVia('Send invitation');
  await settle(2);
  assert.ok(allText(/already a member/i).length);
  assert.equal(calls.filter((c) => c[0] === 'inviteMember').length, 0);
  cleanup();
});

test('a pending invitation can be revoked', async () => {
  const { calls, toasts } = await panel({
    invites: [{ id: 'i1', email: 'new@x.example', role: 'viewer', invitedBy: 'amit@x.example' }],
  });
  assert.ok(screen.getByText(/Invited as Viewer by amit@x.example/), 'the inviter is shown');
  await press('Revoke');
  await settle(4);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'revokeInvite'),
    [['revokeInvite', 'i1']],
  );
  assert.ok(toasts.some((t) => /invitation for new@x.example was revoked/i.test(t)));
  cleanup();
});

test('a failed load is reported instead of showing an empty roster', async () => {
  await panel({ fail: { fetchMembers: 'no workspace membership' } });
  assert.ok(screen.getByText('no workspace membership'), 'the error is surfaced');
  assert.equal(screen.queryByLabelText(/Invite by email/), null, 'no controls over unknown state');
  cleanup();
});

test('the demo workspace explains that user administration needs the team workspace', async () => {
  await mount(M.Members, { available: false, notify: () => {} });
  await settle(2);
  assert.ok(allText(/needs the shared team workspace/i).length);
  assert.ok(screen.getByText('Admin'), 'the role reference is still useful in the demo');
  assert.ok(screen.getByText('Recruiter'));
  assert.ok(screen.getByText('Viewer'));
  cleanup();
});
