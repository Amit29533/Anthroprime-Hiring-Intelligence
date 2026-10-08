import test from 'node:test';
import assert from 'node:assert/strict';
import {
  config,
  createInterviewReminderWorker,
} from '../netlify/functions/interview-reminder-worker.js';
test('internal reminder worker uses a bounded service RPC on its schedule', async () => {
  assert.equal(config.schedule, '* * * * *');
  const calls = [];
  const worker = createInterviewReminderWorker({
    client: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: { created: 2 }, error: null };
      },
    }),
  });
  assert.deepEqual(await (await worker()).json(), { created: 2 });
  assert.deepEqual(calls, [['worker_run_interview_reminders', { p_limit: 20 }]]);
});
test('reminder worker errors do not expose database payloads', async () => {
  const worker = createInterviewReminderWorker({
    client: () => ({ rpc: async () => ({ error: { message: 'secret candidate text' } }) }),
  });
  await assert.rejects(
    worker(),
    (err) => /reminders failed/.test(err.message) && !err.message.includes('secret'),
  );
});
