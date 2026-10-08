// Application portability snapshot: only application rows present in memory.
// Private schemas, Auth, object bytes and unloaded cloud rows are not included.
// Restore merges rows table-by-table through the normal save path
// (row-level deletes are not applied — the audit table is append-only by design).
// Encrypted server-side backups with RPO/RTO targets remain an operations concern.
import { TABLES, normalizeData } from './schema.js';
import { allCandidateRows } from './anthroId.js';

export function backupBundle(data) {
  const bundle = {
    format: 'ecod-workspace-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    tableList: TABLES,
    counts: {},
    snapshotScope: {
      completeDisasterRecovery: false,
      description:
        'Application rows currently loaded for the caller; cloud coverage may be partial.',
      excluded: [
        'Unloaded cloud rows and protected columns',
        'Private governance, readiness, communication and operations schemas',
        'Auth accounts and credentials',
        'Original file bytes and external copies',
        'Database sequences, functions, policies and privileges',
      ],
    },
  };
  for (const t of TABLES) {
    bundle[t] = t === 'candidates' ? allCandidateRows(data) : (data && data[t]) || [];
    bundle.counts[t] = bundle[t].length;
  }
  return bundle;
}

export function parseBackup(text) {
  const bundle = JSON.parse(text);
  if (!bundle || bundle.format !== 'ecod-workspace-backup' || !bundle.version)
    throw new Error('That file is not an ECOD workspace backup.');
  if (bundle.version !== 1) throw new Error('Unsupported backup version. Use a version 1 backup.');
  if (Object.hasOwn(bundle, 'tableList') && !Array.isArray(bundle.tableList))
    throw new Error('Backup table manifest must be an array.');
  const manifest = Array.isArray(bundle.tableList) ? bundle.tableList : null; // older backups carry no manifest
  if (
    manifest &&
    (new Set(manifest).size !== manifest.length ||
      manifest.some((table) => !TABLES.includes(table)) ||
      ['candidates', 'demands', 'considerations'].some((table) => !manifest.includes(table)))
  )
    throw new Error('Backup table manifest is invalid or contains unsupported tables.');
  const required = manifest
    ? TABLES
    : TABLES.filter(
        (t) => !['workflowRules', 'assessmentTemplates', 'talentPools', 'poolMembers'].includes(t),
      ); // Older backups predate these metadata tables.
  const data = {};
  for (const t of required) {
    if (bundle[t] === undefined) {
      if (manifest && !manifest.includes(t)) {
        data[t] = [];
        continue;
      }
      throw new Error(`Backup is missing the ${t} table.`);
    }
    if (!Array.isArray(bundle[t])) throw new Error(`Backup is missing the ${t} table.`);
    if (bundle[t].some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
      throw new Error(`Backup contains an invalid row in the ${t} table.`);
    if (bundle.counts && Object.hasOwn(bundle.counts, t) && bundle.counts[t] !== bundle[t].length)
      throw new Error(`Backup row count does not match the ${t} table.`);
    data[t] = bundle[t];
  }
  return {
    rows: normalizeData(data, { activatePreferences: false }),
    counts: bundle.counts || {},
    exportedAt: bundle.exportedAt,
  };
}

// A save callback may report failure without throwing (App.save returns false).
// Stop at the failed table so a partial merge never reports a successful restore.
export async function restoreBackupRows(rows, onSave) {
  let touched = 0,
    total = 0;
  for (const table of TABLES) {
    const records = table === 'candidates' ? allCandidateRows(rows) : rows[table];
    if (!records?.length) continue;
    if ((await onSave(table, records)) === false)
      throw new Error(
        `Restore stopped at the ${table} table. Earlier tables may already have been restored.`,
      );
    touched++;
    total += records.length;
  }
  return { touched, total };
}
