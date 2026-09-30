// Personal work queue and notifications (Phase A).
//
// Ownership in this product is a TEXT field (`owner: 'Amit Singh'`), not a user id. That was a
// reasonable choice when there was no user administration, but it means "assigned to me" can
// only ever be a best-effort string match. This module is explicit about that rather than
// pretending otherwise: `identityFor()` returns every string that plausibly identifies the
// signed-in person, and `ownerLooksUnmatched()` lets the UI say "nothing is assigned to a name
// matching yours" instead of silently showing an empty list — which would read as "no work".
//
// Everything here is derived. Nothing is stored, so a queue can never be stale or disagree with
// the records it came from.

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();

/** Every string that plausibly names the signed-in person. */
export function identityFor({ name = '', email = '' } = {}) {
  const set = new Set();
  if (clean(name)) set.add(lower(name));
  if (clean(email)) {
    set.add(lower(email));
    const prefix = lower(email).split('@')[0];
    if (prefix) {
      set.add(prefix);
      // "amit.singh" and "amit_singh" both commonly stand in for "Amit Singh".
      set.add(prefix.replace(/[._-]+/g, ' '));
    }
  }
  return set;
}

export const isMine = (record, identity, field = 'owner') =>
  identity instanceof Set && identity.size > 0 && identity.has(lower(record?.[field]));

/** True when the workspace has owners recorded, but none of them look like this user. */
export function ownerLooksUnmatched(data, identity) {
  const owners = new Set();
  for (const table of ['candidates', 'demands', 'tasks', 'enrichment'])
    for (const row of data?.[table] || []) if (clean(row.owner)) owners.add(lower(row.owner));
  if (!owners.size) return false;
  for (const name of owners) if (identity.has(name)) return false;
  return true;
}

const dayStart = (now) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayEnd = (now) => dayStart(now) + 86400000 - 1;
const asTime = (value) => {
  if (!value) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * The work in front of one person right now. `mineOnly` false gives the whole desk, which is
 * what a small team or an admin usually wants.
 */
export function myQueue(
  data,
  identity,
  { now = Date.now(), mineOnly = true, isAdmin = false } = {},
) {
  const mine = (row, field = 'owner') => (mineOnly ? isMine(row, identity, field) : true);
  const today = dayEnd(now);
  const startOfToday = dayStart(now);

  const openTasks = (data?.tasks || []).filter((t) => !t.done && t.status !== 'Done' && mine(t));
  const overdueTasks = openTasks.filter((t) => {
    const due = asTime(t.due);
    return due !== null && due < startOfToday;
  });
  const tasksToday = openTasks.filter((t) => {
    const due = asTime(t.due);
    return due !== null && due >= startOfToday && due <= today;
  });

  const interviewsToday = (data?.interviews || []).filter((i) => {
    if (i.status === 'Cancelled' || i.status === 'Completed') return false;
    const at = asTime(i.scheduledAt);
    return at !== null && at >= startOfToday && at <= today;
  });

  // Requisitions waiting on an administrator. Only an admin can clear these, so only an admin
  // is nagged about them.
  const pendingApprovals = isAdmin
    ? (data?.demands || []).filter((d) => d.approvalStatus === 'Pending approval')
    : [];

  const submissionsAwaiting = (data?.submissions || []).filter(
    (s) => !s.clientStatus || s.clientStatus === 'Pending',
  );

  const unconvertedReferrals = (data?.referrals || []).filter(
    (r) => !r.candidateId && ['New', 'Contacted'].includes(r.status),
  );

  const myCandidates = (data?.candidates || []).filter((c) => mine(c));
  const myDemands = (data?.demands || []).filter((d) => d.status === 'Open' && mine(d));

  return {
    overdueTasks,
    tasksToday,
    interviewsToday,
    pendingApprovals,
    submissionsAwaiting,
    unconvertedReferrals,
    myCandidates,
    myDemands,
  };
}

/**
 * What the bell should show. Only things that are actionable *now* — a count that includes
 * things nobody needs to do today trains people to ignore the bell.
 */
export function notifications(queue) {
  const items = [];
  if (queue.overdueTasks.length)
    items.push({
      key: 'overdue',
      tone: 'red',
      count: queue.overdueTasks.length,
      label: `${queue.overdueTasks.length} overdue task${queue.overdueTasks.length === 1 ? '' : 's'}`,
      page: 'Activities',
    });
  if (queue.tasksToday.length)
    items.push({
      key: 'today',
      tone: 'amber',
      count: queue.tasksToday.length,
      label: `${queue.tasksToday.length} task${queue.tasksToday.length === 1 ? '' : 's'} due today`,
      page: 'Activities',
    });
  if (queue.interviewsToday.length)
    items.push({
      key: 'interviews',
      tone: 'blue',
      count: queue.interviewsToday.length,
      label: `${queue.interviewsToday.length} interview${queue.interviewsToday.length === 1 ? '' : 's'} today`,
      page: 'Interviews',
    });
  if (queue.pendingApprovals.length)
    items.push({
      key: 'approvals',
      tone: 'amber',
      count: queue.pendingApprovals.length,
      label: `${queue.pendingApprovals.length} requisition${queue.pendingApprovals.length === 1 ? '' : 's'} awaiting your approval`,
      page: 'Demands',
    });
  if (queue.unconvertedReferrals.length)
    items.push({
      key: 'referrals',
      tone: 'teal',
      count: queue.unconvertedReferrals.length,
      label: `${queue.unconvertedReferrals.length} referral${queue.unconvertedReferrals.length === 1 ? '' : 's'} not yet contacted`,
      page: 'Referrals',
    });
  return items;
}

/** One number for the bell badge. */
export const notificationCount = (queue) =>
  notifications(queue).reduce((n, item) => n + item.count, 0);
