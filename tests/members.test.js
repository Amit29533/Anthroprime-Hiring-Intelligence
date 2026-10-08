import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  ROLE_GUIDE,
  roleLabel,
  validateInvite,
  blockedReason,
  removalBlockedReason,
  orderMembers,
  memberSummary,
} from '../src/members.js';

const member = (over = {}) => ({
  userId: 'u1',
  email: 'person@anthroprime.example',
  role: 'recruiter',
  isSelf: false,
  ...over,
});

test('the role guide covers every role the database accepts', () => {
  assert.deepEqual(ROLES, ['admin', 'recruiter', 'viewer', 'assessor', 'sales']);
  for (const role of ROLES) {
    assert.ok(ROLE_GUIDE[role]?.label, `${role} has a label`);
    assert.ok(ROLE_GUIDE[role]?.summary, `${role} explains what it can do`);
  }
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('nonsense'), 'nonsense', 'an unknown role is shown, not hidden');
  assert.match(
    ROLE_GUIDE.viewer.detail,
    /not a confidentiality control/i,
    'the viewer seat is described honestly — a read-only UI is not DLP',
  );
});

test('invitations are validated the way the database validates them', () => {
  const members = [member({ email: 'Existing@Anthroprime.example' })];
  assert.equal(validateInvite('new@anthroprime.example', 'recruiter', members), '');
  assert.match(validateInvite('', 'recruiter', members), /Enter the email/);
  assert.match(validateInvite('   ', 'recruiter', members), /Enter the email/);
  assert.match(validateInvite('not-an-email', 'recruiter', members), /valid email/);
  assert.match(validateInvite('a b@c.example', 'recruiter', members), /valid email/);
  assert.match(validateInvite('new@anthroprime.example', 'owner', members), /Choose a role/);
  assert.match(
    validateInvite('  EXISTING@anthroprime.example  ', 'viewer', members),
    /already a member/,
    'duplicate detection is case- and whitespace-insensitive, like the RPC',
  );
});

test('the last-administrator guard mirrors the database rule', () => {
  const onlyAdmin = member({ role: 'admin' });
  assert.match(blockedReason(onlyAdmin, 'viewer', 1), /last administrator/);
  assert.match(blockedReason(onlyAdmin, 'recruiter', 1), /last administrator/);
  assert.equal(blockedReason(onlyAdmin, 'admin', 1), '', 'no change is never blocked');
  assert.equal(blockedReason(onlyAdmin, 'viewer', 2), '', 'a second admin lifts the guard');
  assert.equal(blockedReason(member(), 'viewer', 1), '', 'demoting a recruiter is always fine');
  assert.match(blockedReason(null, 'viewer', 2), /no longer a member/);

  assert.match(removalBlockedReason(onlyAdmin, 1), /last administrator/);
  assert.equal(removalBlockedReason(onlyAdmin, 2), '');
  assert.equal(removalBlockedReason(member(), 1), '', 'removing a recruiter is always fine');
});

test('members are ordered with yourself first, then admins, then alphabetically', () => {
  const list = [
    member({ userId: 'v', email: 'zoe@x.example', role: 'viewer' }),
    member({ userId: 'a', email: 'amit@x.example', role: 'admin' }),
    member({ userId: 'r', email: 'bob@x.example', role: 'recruiter', isSelf: true }),
    member({ userId: 'a2', email: 'anita@x.example', role: 'admin' }),
  ];
  assert.deepEqual(
    orderMembers(list).map((m) => m.email),
    ['bob@x.example', 'amit@x.example', 'anita@x.example', 'zoe@x.example'],
  );
  assert.deepEqual(orderMembers([]), [], 'an empty workspace does not throw');
  const original = [...list];
  orderMembers(list);
  assert.deepEqual(list, original, 'the input array is not mutated');
});

test('the member summary counts each role', () => {
  const list = [
    member({ role: 'admin' }),
    member({ role: 'admin' }),
    member({ role: 'recruiter' }),
    member({ role: 'viewer' }),
    member({ role: 'something-else' }),
  ];
  assert.deepEqual(memberSummary(list), {
    total: 5,
    admin: 2,
    recruiter: 1,
    viewer: 1,
    assessor: 0,
    sales: 0,
  });
  assert.deepEqual(memberSummary([]), {
    total: 0,
    admin: 0,
    recruiter: 0,
    viewer: 0,
    assessor: 0,
    sales: 0,
  });
});

test('assignment roles appear in membership totals', () => {
  assert.equal(memberSummary([member({ role: 'assessor' }), member({ role: 'sales' })]).total, 2);
  assert.equal(memberSummary([member({ role: 'assessor' })]).assessor, 1);
  assert.equal(memberSummary([member({ role: 'sales' })]).sales, 1);
});
