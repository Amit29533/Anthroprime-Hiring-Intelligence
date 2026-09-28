// Assignment rules (Zoho Recruit I5, Phase D).
//
// New candidates and demands arrive unowned, so nothing reaches anyone's queue until a person
// notices. These rules fill that gap.
//
// Two rules the whole module is built around, and which the database also enforces:
//
//   1. A rule may only ever fill an EMPTY owner. It never reassigns work somebody already holds.
//      Silently moving a colleague's candidate is worse than leaving one unassigned.
//   2. Rules are ordered and the FIRST match wins. Without a defined order, two overlapping
//      rules would make assignment depend on row order, which is not a rule at all.
//
// Evaluation is pure so the "what would this do?" dry run and the live path are the same code.
// It runs in the client, like the existing workflow rules — a record created through the API
// rather than the app is not assigned. That limit is documented, not hidden.

export const ASSIGNABLE = {
  candidates: {
    label: 'Candidates',
    fields: [
      { key: 'source', label: 'Source' },
      { key: 'location', label: 'Location' },
      { key: 'status', label: 'Readiness' },
      { key: 'skills', label: 'Skills', list: true },
      { key: 'tags', label: 'Tags', list: true },
      { key: 'title', label: 'Current title' },
    ],
  },
  demands: {
    label: 'Demands',
    fields: [
      { key: 'client', label: 'Client' },
      { key: 'businessUnit', label: 'Business unit' },
      { key: 'location', label: 'Location' },
      { key: 'priority', label: 'Priority' },
      { key: 'mode', label: 'Work mode' },
      { key: 'skills', label: 'Must-have skills', list: true },
    ],
  },
};

export const OPS = {
  eq: 'is exactly',
  contains: 'contains',
  any: 'is any of',
};

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();

export const blankRule = (entity = 'candidates') => ({
  name: '',
  entity,
  field: ASSIGNABLE[entity].fields[0].key,
  op: 'eq',
  value: '',
  assignTo: '',
  priority: 100,
  enabled: true,
});

export const fieldMeta = (entity, key) =>
  (ASSIGNABLE[entity]?.fields || []).find((f) => f.key === key) || null;

/** Does one rule match one record? Pure, and shared by the dry run and the live path. */
export function ruleMatches(rule, record) {
  if (!rule || rule.enabled === false || !record) return false;
  const meta = fieldMeta(rule.entity, rule.field);
  if (!meta) return false;
  const raw = record[rule.field];
  const wanted = lower(rule.value);
  if (!wanted) return false;

  if (meta.list || Array.isArray(raw)) {
    const items = (Array.isArray(raw) ? raw : [raw]).map(lower).filter(Boolean);
    if (rule.op === 'any')
      return wanted
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .some((v) => items.includes(v));
    if (rule.op === 'contains') return items.some((v) => v.includes(wanted));
    return items.includes(wanted);
  }

  const text = lower(raw);
  if (!text) return false;
  if (rule.op === 'contains') return text.includes(wanted);
  if (rule.op === 'any')
    return wanted
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .includes(text);
  return text === wanted;
}

/** Enabled rules for an entity, in the order they are applied. */
export const rulesFor = (data, entity) =>
  (data?.assignmentRules || [])
    .filter((r) => r.entity === entity && r.enabled !== false)
    .sort(
      (a, b) =>
        (Number(a.priority) || 0) - (Number(b.priority) || 0) ||
        String(a.created || '').localeCompare(String(b.created || '')) ||
        String(a.name).localeCompare(String(b.name)),
    );

/**
 * The owner a record should get, or null. Returns the rule too, so the caller can say *why*
 * a record was assigned rather than presenting it as magic.
 */
export function assignmentFor(data, entity, record) {
  if (!record || clean(record.owner)) return null; // never take work off somebody
  for (const rule of rulesFor(data, entity))
    if (ruleMatches(rule, record)) return { owner: clean(rule.assignTo), rule };
  return null;
}

/** Apply rules to records being saved. Returns only the rows that actually change. */
export function applyAssignment(data, entity, rows = []) {
  const changed = [];
  for (const row of rows) {
    const hit = assignmentFor(data, entity, row);
    if (hit) changed.push({ ...row, owner: hit.owner, _rule: hit.rule.name });
  }
  return changed;
}

/**
 * What would this rule set do to records already in the workspace? Shown before a rule is
 * enabled, because "it will quietly change 200 records" is something to find out beforehand.
 */
export function dryRun(data, entity, extraRule = null) {
  const working = extraRule
    ? {
        ...data,
        assignmentRules: [...(data?.assignmentRules || []), { ...extraRule, enabled: true }],
      }
    : data;
  const records = working?.[entity] || [];
  const wouldAssign = [];
  let alreadyOwned = 0;
  let noMatch = 0;
  for (const record of records) {
    if (clean(record.owner)) {
      alreadyOwned += 1;
      continue;
    }
    const hit = assignmentFor(working, entity, record);
    if (!hit) {
      noMatch += 1;
      continue;
    }
    wouldAssign.push({
      id: record.id,
      name: record.name || record.title || 'Record',
      owner: hit.owner,
      rule: hit.rule.name,
    });
  }
  const byOwner = new Map();
  for (const row of wouldAssign) byOwner.set(row.owner, (byOwner.get(row.owner) || 0) + 1);
  return {
    total: records.length,
    wouldAssign,
    alreadyOwned,
    noMatch,
    byOwner: [...byOwner.entries()]
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function validateRule(form, rules = [], id = null) {
  const errors = {};
  if (!clean(form.name)) errors.name = 'Give the rule a name.';
  else if (rules.some((r) => r.id !== id && lower(r.name) === lower(form.name)))
    errors.name = 'A rule with that name already exists.';
  if (!ASSIGNABLE[form.entity]) errors.entity = 'Choose what this rule is about.';
  else if (!fieldMeta(form.entity, form.field)) errors.field = 'Choose a field this record has.';
  if (!OPS[form.op]) errors.op = 'Choose a comparison.';
  if (!clean(form.value)) errors.value = 'Enter a value to match.';
  if (!clean(form.assignTo)) errors.assignTo = 'Who should these be assigned to?';
  const priority = Number(form.priority);
  if (!Number.isFinite(priority) || priority < 1 || priority > 999)
    errors.priority = 'Order must be between 1 and 999.';
  return errors;
}

/**
 * Owners the workspace already knows about. Used to warn when a rule would assign work to a
 * name nobody uses — ownership is a text field, so a typo silently sends work nowhere.
 */
export function knownOwners(data) {
  const names = new Set();
  for (const table of ['candidates', 'demands', 'tasks', 'enrichment'])
    for (const row of data?.[table] || []) if (clean(row.owner)) names.add(clean(row.owner));
  for (const c of data?.clients || []) if (clean(c.owner)) names.add(clean(c.owner));
  return [...names].sort((a, b) => a.localeCompare(b));
}

export const ownerIsUnknown = (data, name) =>
  !!clean(name) && !knownOwners(data).some((o) => lower(o) === lower(name));
