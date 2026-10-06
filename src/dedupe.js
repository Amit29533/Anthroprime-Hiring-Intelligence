// Blueprint §10 — probable-duplicate detection and the field-by-field merge review.
// Uncertain duplicates are never merged automatically; the recruiter picks every surviving value.
import { normalizeEmail, normalizePhone, normalizeLinkedIn } from './domain.js';
import { proficiencyRank } from './taxonomy.js';

const normName = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
export function duplicatePairs(candidates) {
  const pairs = [];
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i],
        b = candidates[j];
      if (a.mergedInto || b.mergedInto) continue;
      let reason = '';
      if (normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email))
        reason = 'Same email';
      else if (normalizePhone(a.phone) && normalizePhone(a.phone) === normalizePhone(b.phone))
        reason = 'Same phone';
      else if (
        normalizeLinkedIn(a.linkedin) &&
        normalizeLinkedIn(a.linkedin) === normalizeLinkedIn(b.linkedin)
      )
        reason = 'Same LinkedIn';
      else if (
        normName(a.name) &&
        normName(a.name) === normName(b.name) &&
        normName(a.company) &&
        normName(a.company) === normName(b.company)
      )
        reason = 'Same name and employer';
      else if (
        normName(a.name) &&
        normName(a.name) === normName(b.name) &&
        normName(a.location) &&
        normName(a.location) === normName(b.location)
      )
        reason = 'Same name and location';
      if (reason)
        pairs.push({
          a,
          b,
          reason,
          confidence: ['Same email', 'Same phone', 'Same LinkedIn'].includes(reason)
            ? 'high'
            : 'medium',
        });
    }
  return pairs;
}

export const MERGE_FIELDS = [
  'name',
  'email',
  'phone',
  'title',
  'company',
  'location',
  'experience',
  'relevantExperience',
  'notice',
  'current',
  'expected',
  'mode',
  'status',
  'source',
  'engagement',
  'earliestStart',
  'activeStatus',
  'summary',
  'linkedin',
  'verified',
];
const isEmpty = (v) => v == null || v === '';
// picks: { field: 'a'|'b' }. Defaults keep A's value, falling back to B when A is empty.
export function mergePreview(data, aId, bId, picks = {}) {
  const a = data.candidates.find((c) => c.id === aId),
    b = data.candidates.find((c) => c.id === bId);
  if (!a || !b) throw new Error('Both profiles must exist to merge.');
  const merged = { ...a };
  for (const f of MERGE_FIELDS) {
    const pick = picks[f] || (isEmpty(a[f]) && !isEmpty(b[f]) ? 'b' : 'a');
    merged[f] = pick === 'b' ? b[f] : a[f];
  }
  merged.skills = [...new Set([...(a.skills || []), ...(b.skills || [])])];
  const rows = new Map((a.skillsDetail || []).map((r) => [r.skill, r]));
  for (const row of b.skillsDetail || []) {
    const cur = rows.get(row.skill);
    if (!cur) rows.set(row.skill, row);
    else {
      const better =
        (row.validated && !cur.validated) ||
        (row.validated === cur.validated &&
          proficiencyRank(row.proficiency) > proficiencyRank(cur.proficiency));
      if (better) rows.set(row.skill, row);
    }
  }
  merged.skillsDetail = [...rows.values()];
  merged.id = a.id;
  // Re-verification is a deliberate recruiter act; a merge must not silently claim one.
  // The surviving `verified` value is whichever record the reviewer picked.
  return merged;
}
// Tables whose rows must follow the surviving record after a merge.
export const MERGE_FOLLOW_TABLES = [
  'considerations',
  'assessments',
  'notes',
  'enrichment',
  'documents',
  'employmentHistory',
  'compensationHistory',
  'availabilityHistory',
  'interviews',
  'offers',
  'tasks',
  'consents',
  'submissions',
  'referrals',
  'interviewSlots',
  'placements',
  'poolMembers',
];

// Transfer related rows before hiding the duplicate. Saves are sequential so a failure
// cannot hide a profile whose records have not moved successfully.
export async function mergeCandidateRecords(data, winner, loser, onSave) {
  if (!winner?.id || !loser?.id || winner.id === loser.id)
    throw new Error('Two different profiles are required to merge.');
  const persist = async (table, rows) => {
    if (!rows.length) return;
    if ((await onSave(table, rows)) === false)
      throw new Error(
        `Merge stopped while saving ${table}. Earlier transfers may have completed; review before retrying.`,
      );
  };
  for (const table of MERGE_FOLLOW_TABLES) {
    const records = data[table] || [];
    const moved = records
      .filter((row) => row.candidateId === loser.id && !row.removed)
      .filter(
        (row) =>
          !['considerations', 'poolMembers'].includes(table) ||
          !records.some(
            (existing) =>
              existing.candidateId === winner.id &&
              (table === 'poolMembers'
                ? existing.poolId === row.poolId
                : existing.demandId === row.demandId),
          ),
      )
      .map((row) => ({ ...row, candidateId: winner.id }));
    await persist(table, moved);
  }
  await persist('candidates', [winner]);
  await persist('candidates', [
    { ...loser, mergedInto: winner.id, skills: [], email: '', phone: '' },
  ]);
}
