import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identityFor,
  isMine,
  ownerLooksUnmatched,
  myQueue,
  notifications,
  notificationCount,
} from '../src/worklist.js';
import { normalizeData, emptyData } from '../src/schema.js';

const NOW = new Date('2026-09-28T09:00:00Z').getTime();
const day = (offset) => new Date(NOW + offset * 86400000).toISOString().slice(0, 10);

const me = identityFor({ name: 'Amit Singh', email: 'amit.singh@anthroprime.example' });

test('tasks completed by the Activities UI leave the personal queue', () => {
  const data = world({
    tasks: [
      { id: 'completed', owner: 'Amit Singh', due: day(-2), done: true },
      { id: 'open', owner: 'Amit Singh', due: day(-2), done: false },
    ],
  });
  assert.deepEqual(
    myQueue(data, me, { now: NOW }).overdueTasks.map((task) => task.id),
    ['open'],
  );
});

const world = (over = {}) =>
  normalizeData({
    ...emptyData(),
    tasks: [
      { id: 't1', title: 'Chase reference', owner: 'Amit Singh', due: day(-3), status: 'Open' },
      { id: 't2', title: 'Call candidate', owner: 'Amit Singh', due: day(0), status: 'Open' },
      { id: 't3', title: 'Later', owner: 'Amit Singh', due: day(5), status: 'Open' },
      { id: 't4', title: 'Done already', owner: 'Amit Singh', due: day(-9), status: 'Done' },
      { id: 't5', title: 'Someone else’s', owner: 'Neha Kulkarni', due: day(-2), status: 'Open' },
    ],
    interviews: [
      { id: 'i1', candidateId: 'c1', scheduledAt: `${day(0)}T14:00:00Z`, status: 'Scheduled' },
      { id: 'i2', candidateId: 'c1', scheduledAt: `${day(1)}T14:00:00Z`, status: 'Scheduled' },
      { id: 'i3', candidateId: 'c1', scheduledAt: `${day(0)}T09:30:00Z`, status: 'Cancelled' },
    ],
    demands: [
      {
        id: 'd1',
        title: 'Open role',
        owner: 'Amit Singh',
        status: 'Open',
        approvalStatus: 'Pending approval',
      },
      {
        id: 'd2',
        title: 'Closed role',
        owner: 'Amit Singh',
        status: 'Closed',
        approvalStatus: 'Approved',
      },
    ],
    candidates: [{ id: 'c1', name: 'Aarav', owner: 'Amit Singh', skills: [] }],
    referrals: [
      { id: 'r1', refereeName: 'Devika', status: 'New', candidateId: null },
      { id: 'r2', refereeName: 'Converted', status: 'In pipeline', candidateId: 'c1' },
    ],
    submissions: [
      { id: 's1', candidateId: 'c1', demandId: 'd1', clientStatus: 'Pending' },
      { id: 's2', candidateId: 'c1', demandId: 'd1', clientStatus: 'Shortlisted' },
    ],
    ...over,
  });

test('identity matching copes with how owners are actually written', () => {
  assert.ok(me.has('amit singh'), 'the display name');
  assert.ok(me.has('amit.singh@anthroprime.example'), 'the email');
  assert.ok(me.has('amit.singh'), 'the email prefix');
  assert.ok(me.has('amit singh'), 'and the prefix with separators normalised');
  assert.ok(isMine({ owner: 'Amit Singh' }, me));
  assert.ok(isMine({ owner: '  amit singh  ' }, me), 'case and padding are ignored');
  assert.ok(!isMine({ owner: 'Neha Kulkarni' }, me));
  assert.ok(!isMine({ owner: '' }, me), 'unowned is not mine');
  assert.ok(!isMine({ owner: 'Amit Singh' }, identityFor({})), 'an unknown user owns nothing');
});

test('a user whose name matches no owner is detected, so the UI can explain an empty queue', () => {
  const data = world();
  assert.equal(ownerLooksUnmatched(data, me), false, 'Amit owns things');
  assert.equal(
    ownerLooksUnmatched(data, identityFor({ name: 'Nobody At All' })),
    true,
    'an empty queue here means "your name matches nothing", not "no work"',
  );
  assert.equal(
    ownerLooksUnmatched(normalizeData(emptyData()), me),
    false,
    'an empty workspace is not a name-matching problem',
  );
});

test('the queue separates overdue from due-today and ignores finished work', () => {
  const q = myQueue(world(), me, { now: NOW });
  assert.deepEqual(
    q.overdueTasks.map((t) => t.id),
    ['t1'],
  );
  assert.deepEqual(
    q.tasksToday.map((t) => t.id),
    ['t2'],
  );
  assert.ok(!q.overdueTasks.concat(q.tasksToday).some((t) => t.id === 't3'), 'future work waits');
  assert.ok(!q.overdueTasks.some((t) => t.id === 't4'), 'a completed task is never overdue');
  assert.ok(!q.overdueTasks.some((t) => t.id === 't5'), 'someone else’s task is not mine');
});

test('only today’s live interviews count, in the viewer’s own day', () => {
  const q = myQueue(world(), me, { now: NOW });
  assert.deepEqual(
    q.interviewsToday.map((i) => i.id),
    ['i1'],
    'tomorrow and cancelled are out',
  );
});

test('approvals are only shown to someone who can actually clear them', () => {
  const asRecruiter = myQueue(world(), me, { now: NOW, isAdmin: false });
  assert.deepEqual(asRecruiter.pendingApprovals, [], 'nagging a recruiter about this is noise');
  const asAdmin = myQueue(world(), me, { now: NOW, isAdmin: true });
  assert.deepEqual(
    asAdmin.pendingApprovals.map((d) => d.id),
    ['d1'],
  );
});

test('mineOnly false gives the whole desk', () => {
  const all = myQueue(world(), me, { now: NOW, mineOnly: false });
  assert.deepEqual(all.overdueTasks.map((t) => t.id).sort(), ['t1', 't5']);
  const mine = myQueue(world(), me, { now: NOW, mineOnly: true });
  assert.deepEqual(
    mine.overdueTasks.map((t) => t.id),
    ['t1'],
  );
});

test('open work is surfaced and finished work is not', () => {
  const q = myQueue(world(), me, { now: NOW });
  assert.deepEqual(
    q.myDemands.map((d) => d.id),
    ['d1'],
    'closed roles are not open work',
  );
  assert.deepEqual(
    q.myCandidates.map((c) => c.id),
    ['c1'],
  );
  assert.deepEqual(
    q.unconvertedReferrals.map((r) => r.id),
    ['r1'],
    'converted referrals drop off',
  );
  assert.deepEqual(
    q.submissionsAwaiting.map((s) => s.id),
    ['s1'],
    'decided submissions drop off',
  );
});

test('a task with no due date is never silently treated as overdue', () => {
  const data = world({ tasks: [{ id: 't1', owner: 'Amit Singh', due: '', status: 'Open' }] });
  const q = myQueue(data, me, { now: NOW });
  assert.deepEqual(q.overdueTasks, [], 'no date means no deadline, not a missed one');
  assert.deepEqual(q.tasksToday, []);
  const bad = world({
    tasks: [{ id: 't1', owner: 'Amit Singh', due: 'not a date', status: 'Open' }],
  });
  assert.deepEqual(myQueue(bad, me, { now: NOW }).overdueTasks, [], 'nor does an unparseable one');
});

test('the bell counts only what is actionable now', () => {
  const q = myQueue(world(), me, { now: NOW, isAdmin: true });
  const items = notifications(q);
  const keys = items.map((i) => i.key);
  assert.deepEqual(keys, ['overdue', 'today', 'interviews', 'approvals', 'referrals']);
  assert.equal(notificationCount(q), 1 + 1 + 1 + 1 + 1);
  for (const item of items) {
    assert.ok(item.label && item.page, 'every notification says what it is and where to go');
    assert.ok(item.count > 0, 'a zero is never listed');
  }
  assert.equal(
    items.find((i) => i.key === 'overdue').label,
    '1 overdue task',
    'singular and plural read correctly',
  );
});

test('a clear desk produces an empty bell, not a zero badge', () => {
  const q = myQueue(normalizeData(emptyData()), me, { now: NOW });
  assert.deepEqual(notifications(q), []);
  assert.equal(notificationCount(q), 0);
});
