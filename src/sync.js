// Blueprint §14 — API groundwork: day-granularity incremental change feed over the loaded
// workspace. The demo surfaces it as a JSON export; a future backend can expose the same
// shape as GET /changes?updated_since=…
import { allCandidateRows } from './anthroId.js';
const FIELDS = ['updated', 'created', 'date', 'uploaded', 'captured', 'verified'];
export function changesSince(data, since) {
  const day = String(since || '').slice(0, 10);
  const touched = (row) => FIELDS.some((f) => row && row[f] && String(row[f]).slice(0, 10) >= day);
  const out = {};
  const changedCandidates = new Set(
    (data?.history || [])
      .filter((row) => row.entityType === 'candidates' && touched(row))
      .map((row) => row.entityId),
  );
  for (const table of Object.keys(data || {})) {
    if (table === 'mergedCandidates') continue;
    if (Array.isArray(data[table]))
      out[table] =
        table === 'candidates'
          ? allCandidateRows(data).filter((row) => touched(row) || changedCandidates.has(row.id))
          : data[table].filter(touched);
  }
  return out;
}
