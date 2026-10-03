import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionWorker, config } from '../netlify/functions/execution-worker.js';
import { runExecutionBatch, executionClient } from '../netlify/functions/_shared/execution.js';
test('scheduled worker invokes a bounded service-only batch', async () => {
  assert.equal(config.schedule, '* * * * *');
  const calls = [];
  const client = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: { completed: 2, retriedOrFailed: 0 }, error: null };
    },
  };
  const response = await createExecutionWorker({ client: () => client })();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, 2);
  assert.deepEqual(calls, [['worker_run_execution_jobs', { p_limit: 20 }]]);
});
test('worker errors omit database payloads and credentials', async () => {
  await assert.rejects(
    runExecutionBatch({ rpc: async () => ({ error: { message: 'secret database payload' } }) }),
    (error) => !error.message.includes('secret') && error.message.includes('batch failed'),
  );
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.throws(executionClient, /configuration is missing/);
  } finally {
    if (original !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  }
});
