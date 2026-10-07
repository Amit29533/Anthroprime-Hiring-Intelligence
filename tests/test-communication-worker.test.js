import test from 'node:test';
import assert from 'node:assert/strict';
import {
  config,
  createTestCommunicationWorker,
} from '../netlify/functions/test-communication-worker.js';
test('test worker schedules bounded atomic batches and hides private failures', async () => {
  assert.equal(config.schedule, '*/5 * * * *');
  const calls = [];
  const worker = createTestCommunicationWorker({
    client: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: { transport: 'test-only', testRecorded: 1 } };
      },
    }),
  });
  assert.deepEqual(await (await worker()).json(), { transport: 'test-only', testRecorded: 1 });
  assert.deepEqual(calls, [['worker_run_test_communications', { p_limit: 20 }]]);
  const failed = createTestCommunicationWorker({
    client: () => ({
      rpc: async () => ({ error: { message: 'private recipient and server key' } }),
    }),
  });
  await assert.rejects(
    failed(),
    (e) => /batch failed/.test(e.message) && !/recipient|key/.test(e.message),
  );
});
