import { normalizeRow } from './rowDefaults.js';
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
export function normalizeData(data, { activatePreferences = true } = {}) {
  const out = emptyData();
  for (const table of TABLES) {
    const rows = Array.isArray(data?.[table]) ? data[table] : [];
    out[table] = rows
      .filter((row) => table !== 'candidates' || !row?.mergedInto)
      .map((row) => normalizeRow(table, row));
  }
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
