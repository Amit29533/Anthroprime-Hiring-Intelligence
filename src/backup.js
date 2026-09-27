// Workspace backup (§12 / M5 groundwork): a single JSON bundle of every workspace table.
// Export is complete; restore merges rows table-by-table through the normal save path
// (row-level deletes are not applied — the audit table is append-only by design).
// Encrypted server-side backups with RPO/RTO targets remain an operations concern.
import {TABLES, normalizeData} from './schema.js';

export function backupBundle(data) {
  const bundle = { format: 'ecod-workspace-backup', version: 1, exportedAt: new Date().toISOString(), counts: {} };
  for (const t of TABLES) { bundle[t] = (data && data[t]) || []; bundle.counts[t] = bundle[t].length; }
  return bundle;
}

export function parseBackup(text) {
  const bundle = JSON.parse(text);
  if (!bundle || bundle.format !== 'ecod-workspace-backup' || !bundle.version) throw new Error('That file is not an ECOD workspace backup.');
  const data = {};
  for (const t of TABLES) {
    if (!Array.isArray(bundle[t])) throw new Error(`Backup is missing the ${t} table.`);
    data[t] = bundle[t];
  }
  return { rows: normalizeData(data), counts: bundle.counts || {}, exportedAt: bundle.exportedAt };
}
