import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { outcomeMetricsCsv, exportOutcomeMetrics } from '../src/ecodOutcomeAnalytics.js';

const receipt = () => ({
  schemaVersion: 1,
  receiptId: 'receipt',
  workspaceId: 'workspace',
  actor: 'admin',
  preparedAt: '2026-10-07T12:00:00Z',
  metrics: {
    asOf: '2026-10-07T12:00:00Z',
    days: 90,
    trackingSince: '2026-10-07T00:00:00Z',
    timings: [
      {
        metric: 'submission',
        tracked: 2,
        completed: 1,
        unobserved: 1,
        averageDays: 2,
        medianDays: 2,
        p90Days: 2,
      },
    ],
    sources: [{ source: '=HYPERLINK("evil")', total: 2, placed: 1, placementPct: 50 }],
    enrichment: { plans: 1, completed: 1, reassessed: 0, readyAfterReassessment: 0 },
  },
});

test('historical CSV includes server provenance, honest missing values and formula-safe sources', () => {
  const original = receipt();
  const before = JSON.stringify(original);
  original.metrics.timings[0].medianDays = null;
  const csv = outcomeMetricsCsv(original);
  const rows = Papa.parse(csv, { header: true }).data;
  assert.equal(rows[0].medianDays, '');
  assert.equal(rows[0].unobserved, '1');
  assert.equal(rows[1].source, '\'=HYPERLINK("evil")');
  assert.ok(
    rows.every(
      (r) => r.exportReceipt === 'receipt' && r.exportedBy === 'admin' && r.cohortDays === '90',
    ),
  );
  original.metrics.timings[0].medianDays = 2;
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => outcomeMetricsCsv({ ...original, receiptId: null }), /incomplete/);
});

test('historical exports stop on missing receipts, mismatched periods and workspace changes', async () => {
  const downloads = [];
  const download = (...args) => downloads.push(args);
  await assert.rejects(exportOutcomeMetrics(90, { prepare: async () => ({}), download }), /period/);
  await assert.rejects(
    exportOutcomeMetrics(30, { prepare: async () => receipt(), download }),
    /period/,
  );
  let workspace = 'one';
  await assert.rejects(
    exportOutcomeMetrics(90, {
      context: () => workspace,
      prepare: async () => {
        workspace = 'two';
        return receipt();
      },
      download,
    }),
    /Workspace changed/,
  );
  assert.equal(downloads.length, 0);
  assert.equal(
    await exportOutcomeMetrics(90, { prepare: async () => receipt(), download }),
    'receipt',
  );
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0][1], 'ecod-history-90-days.csv');
});
