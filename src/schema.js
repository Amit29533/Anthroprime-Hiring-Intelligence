import { normalizeRow } from './rowDefaults.js';
import {
  allCandidateRows,
  anthroIdFor,
  assignAnthroIds,
  legacyAnthroIdFor,
  resolveCandidateId,
} from './anthroId.js';
// Shared data shape for demo and cloud modes, kept dependency-free so tests can import it.
import { setCustomTaxonomy } from './taxonomy.js';
import { setStageLabels } from './domain.js';
export const TABLES = [
  'candidates',
  'demands',
  'considerations',
  'assessmentTemplates',
  'assessments',
  'notes',
  'enrichment',
  'history',
  'employmentHistory',
  'compensationHistory',
  'availabilityHistory',
  'auditEvents',
  'taxonomy',
  'demandCommercials',
  'settings',
  'consents',
  'interviews',
  'offers',
  'tasks',
  'submissions',
  'publicApplications',
  'workflowRules',
  'clients',
  'documents',
  'clientContacts',
  'departments',
  'reports',
  'skills',
  'personSkills',
  'skillEvidence',
  'referrals',
  'interviewSlots',
  'assignmentRules',
  'placements',
  'placementCommercials',
  'talentPools',
  'poolMembers',
];
export const emptyData = () => Object.fromEntries(TABLES.map((t) => [t, []]));
// Fill in fields/tables added after a stored (or cloud) snapshot was written, apply the saved
// taxonomy extensions, and hide profiles merged into another record.
export function normalizeData(data, { activatePreferences = true, assignIdentities = true } = {}) {
  const out = emptyData();
  const candidates = assignIdentities
    ? assignAnthroIds(allCandidateRows(data))
    : allCandidateRows(data);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const aliases = new Map(candidates.map((c) => [c.id, [legacyAnthroIdFor(c)]]));
  for (const c of candidates.filter((c) => c.mergedInto)) {
    const winner = resolveCandidateId(c.id, byId);
    if (winner)
      aliases.set(
        winner,
        [...(aliases.get(winner) || []), anthroIdFor(c), legacyAnthroIdFor(c)].filter(Boolean),
      );
  }
  for (const table of TABLES) {
    const rows =
      table === 'candidates' ? candidates : Array.isArray(data?.[table]) ? data[table] : [];
    out[table] = rows
      .filter((row) => table !== 'candidates' || !row?.mergedInto)
      .map((row) => {
        const normalized = normalizeRow(table, row);
        if (table === 'candidates') normalized.anthroAliases = aliases.get(row.id) || [];
        // Append-only skill evidence and colliding historical links cannot be moved
        // by an editor. Resolve their retired reference in the read projection;
        // the database and audit history retain the original record identity.
        if (byId.get(normalized.candidateId)?.mergedInto)
          normalized.candidateId =
            resolveCandidateId(normalized.candidateId, byId) || normalized.candidateId;
        return normalized;
      });
  }
  const merged = candidates.filter((c) => c.mergedInto).map((c) => normalizeRow('candidates', c));
  if (merged.length) out.mergedCandidates = merged;
  if (activatePreferences) activateWorkspacePreferences(out);
  return out;
}

// Keep preference activation explicit so inspecting a backup cannot change the live workspace.
export function activateWorkspacePreferences(data) {
  const tax = data.taxonomy.find((r) => r && r.id === 'workspace');
  setCustomTaxonomy((tax && tax.custom) || {});
  const st = data.settings.find((r) => r && r.id === 'workspace');
  setStageLabels((st && st.custom && st.custom.stageLabels) || {});
}
