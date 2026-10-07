import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/FreshnessReviews.jsx')).FreshnessReviews;
});
afterEach(cleanup);
test.after(stopVite);
const page = {
  enabled: false,
  staleDays: 121,
  lastRun: null,
  total: 51,
  rows: [
    {
      id: 'receipt',
      anthroId: 'ANTHRO-12345',
      verifiedOn: '2026-01-01',
      status: 'failed',
      attempts: 5,
      lastError: 'Task creation failed',
    },
  ],
};
test('freshness controls opt in explicitly, validate threshold, page and retry failed work', async () => {
  const calls = [];
  let enabled = false;
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_freshness_reviews') return { ...page, enabled };
      if (name === 'api_set_freshness_reviews') {
        enabled = args.p_enabled;
        return { enabled, staleDays: args.p_stale_days };
      }
      return true;
    },
  });
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Retry freshness review ANTHRO-12345' }).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText('Stale after days'), { target: { value: '29' } });
  assert.equal(screen.getByRole('button', { name: 'Enable freshness reviews' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Stale after days'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enable freshness reviews' }));
  await settle();
  assert.deepEqual(calls.find(([n]) => n === 'api_set_freshness_reviews')[1], {
    p_enabled: true,
    p_stale_days: 150,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry freshness review ANTHRO-12345' }));
  await settle();
  assert.deepEqual(calls.find(([n]) => n === 'api_retry_freshness_review')[1], { p_id: 'receipt' });
  fireEvent.click(screen.getByRole('button', { name: 'Next freshness reviews' }));
  await settle();
  assert.equal(calls.filter(([n]) => n === 'api_freshness_reviews').at(-1)[1].p_offset, 50);
});
test('missing freshness migrations show an error and provide no local activation fallback', async () => {
  await mount(Panel, { isCloud: true, rpc: async () => null });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Apply the freshness-review migration/);
  assert.equal(screen.queryByRole('button', { name: 'Enable freshness reviews' }), null);
});
test('lost setting acknowledgements can be retried with the same desired state', async () => {
  const calls = [];
  let lost = true;
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      if (name === 'api_freshness_reviews') return page;
      calls.push(args);
      if (lost) {
        lost = false;
        throw new Error('Lost policy receipt');
      }
      return { enabled: true, staleDays: 121 };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Enable freshness reviews' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost policy/);
  fireEvent.click(screen.getByRole('button', { name: 'Enable freshness reviews' }));
  await settle();
  assert.deepEqual(calls[0], calls[1]);
});
