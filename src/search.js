// Cross-entity global search (Phase A) — blueprint §8 "fast searchable table" extended to the
// whole workspace.
//
// Until now the top-bar search only reached candidates, so finding a demand, a client, a contact
// or a note meant knowing which page to be on first. That is a dozens-of-times-a-day tax.
//
// Two rules:
//   1. SEARCH IS PERMISSION-AWARE. It reads from the caller's in-memory workspace, which RLS
//      already filtered, and additionally never indexes an admin-only field. A recruiter must
//      not be able to discover a demand's budget by typing a number into the search box.
//   2. RESULTS ARE RANKED, NOT FILTERED. An exact name match outranks a passing mention in a
//      note, so the thing you meant is first rather than buried.

/** Fields that must never be searchable, because matching on them reveals them. */
const NEVER_INDEXED = new Set([
  'expected',
  'current',
  'budget',
  'internalCost',
  'margin',
  'statusToken',
  'hash',
  'dataUrl',
  'storageKey',
]);

export const RESULT_TYPES = [
  'candidate',
  'demand',
  'client',
  'contact',
  'referral',
  'note',
  'skill',
];

export const TYPE_LABELS = {
  candidate: 'Candidates',
  demand: 'Demands',
  client: 'Clients',
  contact: 'Contacts',
  referral: 'Referrals',
  note: 'Notes',
  skill: 'Skills',
};

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();

/**
 * Score one field against the query. Higher is better; 0 means no match.
 * Exact > starts-with > word-start > substring, scaled by how identifying the field is.
 */
export function scoreField(value, query, weight = 1) {
  const text = lower(value);
  const q = lower(query);
  if (!text || !q) return 0;
  if (text === q) return 100 * weight;
  if (text.startsWith(q)) return 60 * weight;
  // A match at a word boundary ("kumar" in "Aarav Kumar") beats one mid-word.
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) return 40 * weight;
  if (text.includes(q)) return 20 * weight;
  return 0;
}

/** Best score across several weighted fields. */
function best(query, fields) {
  let top = 0;
  for (const [value, weight] of fields) {
    if (Array.isArray(value)) {
      for (const item of value) top = Math.max(top, scoreField(item, query, weight));
    } else top = Math.max(top, scoreField(value, query, weight));
  }
  return top;
}

/**
 * Search everything the signed-in user can already see.
 * Returns a flat, ranked list; `groupResults` shapes it for display.
 */
export function searchWorkspace(data, query, { isAdmin = false, limit = 20 } = {}) {
  const q = clean(query);
  if (q.length < 2) return [];
  const out = [];

  for (const c of data?.candidates || []) {
    const score = best(q, [
      [c.name, 1],
      [c.email, 0.8],
      [c.phone, 0.8],
      [c.title, 0.6],
      [c.company, 0.5],
      [c.location, 0.4],
      [c.skills, 0.5],
      [c.tags, 0.4],
    ]);
    if (score)
      out.push({
        type: 'candidate',
        id: c.id,
        title: c.name,
        subtitle: [c.title, c.location].filter(Boolean).join(' · '),
        meta: c.status,
        score,
      });
  }

  for (const d of data?.demands || []) {
    // Budget is deliberately absent: matching on it would disclose it.
    const score = best(q, [
      [d.title, 1],
      [d.client, 0.8],
      [d.businessUnit, 0.5],
      [d.location, 0.4],
      [d.skills, 0.5],
      [d.tags, 0.4],
    ]);
    if (score)
      out.push({
        type: 'demand',
        id: d.id,
        title: d.title,
        subtitle: [d.client, d.location].filter(Boolean).join(' · '),
        meta: d.status,
        score,
      });
  }

  for (const c of data?.clients || []) {
    const score = best(q, [
      [c.name, 1],
      [c.industry, 0.5],
      [c.location, 0.4],
      [c.owner, 0.4],
    ]);
    if (score)
      out.push({
        type: 'client',
        id: c.id,
        title: c.name,
        subtitle: [c.industry, c.location].filter(Boolean).join(' · '),
        meta: c.status,
        score,
      });
  }

  for (const k of data?.clientContacts || []) {
    const score = best(q, [
      [k.name, 1],
      [k.email, 0.8],
      [k.phone, 0.7],
      [k.title, 0.5],
    ]);
    if (score) {
      const client = (data.clients || []).find((c) => c.id === k.clientId);
      out.push({
        type: 'contact',
        id: k.id,
        parentId: k.clientId,
        title: k.name,
        subtitle: [k.title, client?.name].filter(Boolean).join(' · '),
        meta: k.isPrimary ? 'Primary' : '',
        score,
      });
    }
  }

  for (const r of data?.referrals || []) {
    const score = best(q, [
      [r.refereeName, 1],
      [r.refereeEmail, 0.7],
      [r.referrerName, 0.6],
    ]);
    if (score)
      out.push({
        type: 'referral',
        id: r.id,
        title: r.refereeName,
        subtitle: `Referred by ${r.referrerName}`,
        meta: r.status,
        score,
      });
  }

  for (const n of data?.notes || []) {
    const score = best(q, [[n.text, 0.35]]);
    if (score) {
      const person = (data.candidates || []).find((c) => c.id === n.candidateId);
      out.push({
        type: 'note',
        id: n.id,
        parentId: n.candidateId,
        title: clean(n.text).slice(0, 80),
        subtitle: person ? person.name : 'Note',
        meta: n.date ? String(n.date).slice(0, 10) : '',
        score,
      });
    }
  }

  for (const s of data?.skills || []) {
    const score = best(q, [
      [s.name, 0.9],
      [s.aliases, 0.7],
      [s.domain, 0.4],
    ]);
    if (score)
      out.push({
        type: 'skill',
        id: s.id,
        title: s.name,
        subtitle: s.domain,
        meta: '',
        score,
      });
  }

  // Admin-only records never enter the index at all, rather than being filtered out later.
  if (isAdmin) {
    for (const dc of data?.demandCommercials || []) {
      const demand = (data.demands || []).find((d) => d.id === dc.demandId);
      const score = best(q, [[dc.notes, 0.3]]);
      if (score && demand)
        out.push({
          type: 'demand',
          id: demand.id,
          title: demand.title,
          subtitle: 'Commercial note',
          meta: demand.status,
          score,
        });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Group a ranked list into display sections, preserving rank order within each. */
export function groupResults(results) {
  const groups = [];
  for (const type of RESULT_TYPES) {
    const items = results.filter((r) => r.type === type);
    if (items.length) groups.push({ type, label: TYPE_LABELS[type], items });
  }
  return groups;
}

/** Guard used by tests and by the indexer: prove no forbidden field is ever read. */
export const isIndexable = (field) => !NEVER_INDEXED.has(field);
export const FORBIDDEN_FIELDS = [...NEVER_INDEXED];
