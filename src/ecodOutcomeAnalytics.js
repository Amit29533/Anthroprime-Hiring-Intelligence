import Papa from 'papaparse';
import { getSupabase, getWorkspace } from './repository.js';
import { downloadFile } from './downloads.js';

export const TIMING_LABELS = {
  shortlist: 'Demand to first shortlist entry',
  submission: 'Shortlist entry to first submission',
  placement: 'Candidate entry to first active placement',
  reassessment: 'Completed enrichment to reassessment',
};

export async function prepareOutcomeExport(days) {
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_prepare_ecod_analytics_export', { p_days: days });
  if (error) throw new Error(error.message || 'Historical export could not be prepared.');
  return data;
}

export function outcomeMetricsCsv(receipt) {
  const m = receipt?.metrics;
  if (
    receipt?.schemaVersion !== 1 ||
    !receipt.receiptId ||
    !receipt.workspaceId ||
    !receipt.actor ||
    !receipt.preparedAt ||
    !m?.asOf ||
    !Array.isArray(m.timings) ||
    !Array.isArray(m.sources) ||
    !m.enrichment
  )
    throw new Error('Historical export receipt is incomplete.');
  const rows = [
    ...m.timings.map((r) => ({
      section: 'Timing',
      metric: TIMING_LABELS[r.metric] || r.metric,
      tracked: r.tracked,
      completed: r.completed,
      unobserved: r.unobserved,
      averageDays: r.averageDays,
      medianDays: r.medianDays,
      p90Days: r.p90Days,
    })),
    ...m.sources.map((r) => ({
      section: 'Source',
      metric: 'Candidate to active placement',
      source: r.source || 'Unknown',
      tracked: r.total,
      completed: r.placed,
      placementPct: r.placementPct,
    })),
    ...Object.entries(m.enrichment).map(([metric, count]) => ({
      section: 'Enrichment',
      metric,
      tracked: count,
    })),
  ].map((row) => ({
    section: '',
    metric: '',
    source: '',
    tracked: '',
    completed: '',
    unobserved: '',
    averageDays: '',
    medianDays: '',
    p90Days: '',
    placementPct: '',
    ...row,
    cohortDays: m.days,
    trackingSince: m.trackingSince,
    asOf: m.asOf,
    exportReceipt: receipt.receiptId,
    exportedAt: receipt.preparedAt,
    exportedBy: receipt.actor,
    workspaceId: receipt.workspaceId,
  }));
  return Papa.unparse(rows, { escapeFormulae: true });
}

export async function exportOutcomeMetrics(
  days,
  {
    prepare = prepareOutcomeExport,
    download = downloadFile,
    context = () => getWorkspace()?.id,
  } = {},
) {
  const workspace = context();
  const receipt = await prepare(days);
  if (workspace !== context())
    throw new Error('Workspace changed. Prepare a new historical export.');
  if (receipt?.metrics?.days !== days) throw new Error('Historical export period does not match.');
  const csv = outcomeMetricsCsv(receipt);
  download(csv, `ecod-history-${days}-days.csv`);
  return receipt.receiptId;
}
