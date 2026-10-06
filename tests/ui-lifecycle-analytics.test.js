import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/LifecycleAnalytics.jsx')).LifecycleAnalytics;
});
afterEach(cleanup);
test.after(stopVite);
const sample = {
  considerations: 3,
  openJourneys: 1,
  candidates: 4,
  readyCandidates: 2,
  averageDaysToReady: 6,
  baselineRecords: 8,
  trackingSince: '2026-10-06T10:00:00Z',
  stages: [{ stage: 'Submitted', reached: 2 }],
  progression: [{ from: 'Offer', to: 'Deployed', entered: 0, progressed: 0, pct: null }],
  sources: [{ source: 'Referral', total: 4, ready: 2 }],
};
test('historical metrics explain incomplete cohorts and refresh the selected period', async () => {
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    fetchMetrics: async (days) => {
      calls.push(days);
      return sample;
    },
  });
  await settle();
  assert.ok(screen.getByText(/3 tracked demand journeys/));
  assert.ok(screen.getByText(/8 pre-existing records/));
  assert.ok(screen.getByText(/Ready status is recruiter-recorded/));
  assert.ok(screen.getByText('—'));
  fireEvent.change(screen.getByLabelText('Historical cohort period'), { target: { value: '30' } });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await settle();
  assert.deepEqual(calls, [90, 30, 30]);
});
test('missing migration is visible and demo never fabricates historical metrics', async () => {
  await mount(Panel, {
    isCloud: true,
    fetchMetrics: async () => {
      throw new Error('Apply the lifecycle_analytics migration.');
    },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /migration/);
  await cleanup();
  let calls = 0;
  await mount(Panel, {
    isCloud: false,
    fetchMetrics: async () => {
      calls++;
    },
  });
  await settle();
  assert.equal(calls, 0);
  assert.ok(screen.getByText(/Demo records have no verified transition history/));
});
