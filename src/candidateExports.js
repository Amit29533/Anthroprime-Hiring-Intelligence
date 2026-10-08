import Papa from 'papaparse';
import { cloud, getSupabase } from './repository.js';
import { canExportData, downloadFile, exportCandidates } from './downloads.js';

async function exportRpc(name, args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || 'Candidate export is unavailable.');
  return data;
}
let preparing = false;

export async function exportCandidateData(rows, notify, { isCloud = cloud, rpc = exportRpc } = {}) {
  if (!canExportData(notify)) return false;
  if (preparing) {
    notify?.('A candidate export is already being prepared.');
    return false;
  }
  preparing = true;
  try {
    if (!isCloud) return exportCandidates(rows, notify);
    const enabled = await rpc('api_candidate_export_mode');
    if (typeof enabled !== 'boolean')
      throw new Error('Candidate export configuration is unavailable.');
    if (!enabled) return exportCandidates(rows, notify);
    const ids = rows.map((row) => row.id);
    if (!ids.length || ids.length > 500)
      throw new Error('Select 1 to 500 candidates for an audited export.');
    const result = await rpc('api_prepare_candidate_export', { p_ids: ids });
    if (result?.allowed === false)
      throw new Error(
        `Candidate export limit reached. Try again in ${result.retryAfter || 60} seconds.`,
      );
    if (
      !result?.allowed ||
      !Array.isArray(result.rows) ||
      result.rows.length !== ids.length ||
      !result.receiptId ||
      !result.preparedAt ||
      !result.actor ||
      result.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(result.sha256 || '')
    )
      throw new Error('Candidate export receipt is unavailable.');
    const csv = Papa.unparse(
      result.rows.map((row) => ({
        ...row,
        exportedAt: result.preparedAt,
        exportedBy: result.actor,
        exportReceipt: result.receiptId,
        exportSchema: result.schemaVersion,
        exportSnapshotSha256: result.sha256,
      })),
      { escapeFormulae: true },
    );
    return downloadFile(csv, 'ecod-candidates.csv', 'text/csv;charset=utf-8');
  } catch (error) {
    notify?.(error.message || 'Candidate export is unavailable.');
    return false;
  } finally {
    preparing = false;
  }
}
