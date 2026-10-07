import test from 'node:test';
import assert from 'node:assert/strict';
import {
  config,
  createFreshnessReviewWorker,
} from '../netlify/functions/freshness-review-worker.js';
test('freshness review worker uses an hourly bounded service RPC', async () => {
  assert.equal(config.schedule, '15 * * * *');
  const calls = [];
  const worker = createFreshnessReviewWorker({
    client: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: { created: 2, cancelled: 1 } };
      },
    }),
  });
  assert.deepEqual(await (await worker()).json(), { created: 2, cancelled: 1 });
  assert.deepEqual(calls, [['worker_run_freshness_reviews', { p_limit: 20 }]]);
});
test('freshness batch failure conceals private database errors', async () => {
  const worker = createFreshnessReviewWorker({
    client: () => ({ rpc: async () => ({ error: { message: 'private candidate credentials' } }) }),
  });
  await assert.rejects(
    worker(),
    (e) => /batch failed/.test(e.message) && !/private|credentials/.test(e.message),
  );
});
