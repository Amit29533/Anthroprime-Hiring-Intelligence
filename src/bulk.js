// Bulk operations (Phase B).
//
// Every list operation in this product used to be one record at a time, apart from a bulk status
// change and export. Reassigning a desk, tagging a shortlist or putting twenty people forward for
// a role meant twenty round trips.
//
// The design rule here is: NOTHING HAPPENS UNTIL THE USER HAS SEEN WHAT WILL HAPPEN. `planBulk()`
// is pure — it returns the exact rows that would be written and, just as importantly, the rows
// that would be SKIPPED and why. A bulk action that silently does nothing to nine of twenty
// selected records is worse than one that refuses, because the user believes it worked.
//
// The plan also carries an `undo` payload: the previous version of every row it would change, so
// a mistake costs one click rather than a support conversation.
import { uid, today, STAGES } from './domain.js';
import { canWriteForRole } from './repository.js';

export const CANDIDATE_STATUSES = ['Ready', 'Near-ready', 'Assessing', 'Unavailable'];

export const BULK_ACTIONS = {
  owner: { label: 'Assign owner', needs: 'text', placeholder: 'Recruiter name' },
  tag: { label: 'Add tag', needs: 'text', placeholder: 'Tag' },
  untag: { label: 'Remove tag', needs: 'text', placeholder: 'Tag' },
  status: { label: 'Set readiness', needs: 'choice', options: CANDIDATE_STATUSES },
  shortlist: { label: 'Shortlist to demand', needs: 'demand' },
};

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();

/**
 * Work out exactly what a bulk action would do.
 * Returns `{ action, value, changes, skipped, writes, undo, blocked }`.
 * Never mutates anything.
 */
export function planBulk(data, { action, ids = [], value = '', role = 'admin' } = {}) {
  const empty = { action, value, changes: [], skipped: [], writes: {}, undo: {}, blocked: '' };
  if (!BULK_ACTIONS[action]) return { ...empty, blocked: 'Choose an action.' };
  if (!canWriteForRole(role))
    return { ...empty, blocked: 'Your viewer role cannot change records.' };
  if (!ids.length) return { ...empty, blocked: 'Select at least one record.' };

  const spec = BULK_ACTIONS[action];
  if (spec.needs !== 'demand' && !clean(value))
    return { ...empty, blocked: `Enter a value for “${spec.label}”.` };
  if (spec.needs === 'choice' && !spec.options.includes(value))
    return { ...empty, blocked: 'Choose a valid option.' };

  const candidates = (data?.candidates || []).filter((c) => ids.includes(c.id));
  const missing = ids.filter((id) => !candidates.some((c) => c.id === id));
  const changes = [];
  const skipped = missing.map((id) => ({ id, name: 'Unknown record', reason: 'No longer exists' }));
  const rows = [];

  if (action === 'shortlist') {
    const demand = (data?.demands || []).find((d) => d.id === value);
    if (!demand) return { ...empty, blocked: 'Choose a demand to shortlist to.' };
    if (demand.status !== 'Open')
      return { ...empty, blocked: `${demand.title} is ${demand.status} — reopen it first.` };
    const considerations = [];
    for (const c of candidates) {
      const already = (data?.considerations || []).find(
        (k) => k.candidateId === c.id && k.demandId === demand.id,
      );
      if (already) {
        skipped.push({
          id: c.id,
          name: c.name,
          reason: `Already in the pipeline (${already.stage})`,
        });
        continue;
      }
      considerations.push({
        id: uid(),
        candidateId: c.id,
        demandId: demand.id,
        stage: STAGES[0],
        created: today(),
        updated: today(),
        reason: 'Added in bulk',
      });
      changes.push({ id: c.id, name: c.name, summary: `Shortlisted to ${demand.title}` });
    }
    return {
      action,
      value,
      changes,
      skipped,
      writes: considerations.length ? { considerations } : {},
      // Shortlisting creates rows rather than editing them; undoing would mean deleting from a
      // table the product deliberately never deletes from, so it is not offered.
      undo: {},
      undoable: false,
      blocked: '',
      demand,
    };
  }

  const before = [];
  for (const c of candidates) {
    let next = null;
    let summary = '';
    if (action === 'owner') {
      if (lower(c.owner) === lower(value)) {
        skipped.push({ id: c.id, name: c.name, reason: 'Already owned by that person' });
        continue;
      }
      next = { ...c, owner: clean(value) };
      summary = c.owner ? `Owner ${c.owner} → ${clean(value)}` : `Owner set to ${clean(value)}`;
    } else if (action === 'tag') {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tags.some((t) => lower(t) === lower(value))) {
        skipped.push({ id: c.id, name: c.name, reason: 'Already tagged' });
        continue;
      }
      next = { ...c, tags: [...tags, clean(value)] };
      summary = `Tagged “${clean(value)}”`;
    } else if (action === 'untag') {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (!tags.some((t) => lower(t) === lower(value))) {
        skipped.push({ id: c.id, name: c.name, reason: 'Does not have that tag' });
        continue;
      }
      next = { ...c, tags: tags.filter((t) => lower(t) !== lower(value)) };
      summary = `Removed tag “${clean(value)}”`;
    } else if (action === 'status') {
      if (c.status === value) {
        skipped.push({ id: c.id, name: c.name, reason: 'Already has that readiness' });
        continue;
      }
      next = { ...c, status: value };
      summary = `Readiness ${c.status} → ${value}`;
    }
    if (!next) continue;
    rows.push(next);
    before.push(c);
    changes.push({ id: c.id, name: c.name, summary });
  }

  return {
    action,
    value,
    changes,
    skipped,
    writes: rows.length ? { candidates: rows } : {},
    undo: before.length ? { candidates: before } : {},
    undoable: before.length > 0,
    blocked: '',
  };
}

/** One line a human can read before committing. */
export function describePlan(plan) {
  if (plan.blocked) return plan.blocked;
  const n = plan.changes.length;
  const s = plan.skipped.length;
  if (!n && !s) return 'Nothing to do.';
  if (!n) return `No changes — all ${s} selected record${s === 1 ? '' : 's'} already match.`;
  const head = `${n} record${n === 1 ? '' : 's'} will change`;
  return s ? `${head}; ${s} skipped.` : `${head}.`;
}

/** Group skip reasons so the UI shows "12 already tagged" rather than twelve lines. */
export function skipSummary(plan) {
  const counts = new Map();
  for (const row of plan.skipped || []) counts.set(row.reason, (counts.get(row.reason) || 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
