import test from 'node:test';
import assert from 'node:assert/strict';
import { runIndexBatch } from '../netlify/functions/_shared/indexing.js';
import { localVector } from '../src/localVector.js';
import indexWorker, { config } from '../netlify/functions/index-worker.js';
test('index worker uses the scheduled function entry point', () => {
  assert.equal(config.schedule, '* * * * *');
  assert.equal(typeof indexWorker, 'function');
});
test('worker computes private vectors with bounded parallel completions', async () => {
  let active = 0,
    peak = 0;
  const calls = [];
  const jobs = Array.from({ length: 9 }, (_, i) => ({
    workspaceId: 'w',
    candidateId: String(i),
    lease: 'l',
    text: 'React engineer',
  }));
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'worker_claim_index') return { data: jobs };
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { data: true };
    },
  };
  assert.deepEqual(await runIndexBatch(client), { claimed: 9, completed: 9, failed: 0 });
  assert.equal(peak, 4);
  assert.deepEqual(calls[1][1].p_vector, localVector('React engineer'));
});
test('superseded claims are harmless and failed writes enter retry without logging source data', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'worker_claim_index')
        return { data: [{ workspaceId: 'w', candidateId: 'c', lease: 'l', text: 'private text' }] };
      return args.p_failed ? { data: true } : { error: { message: 'private text' } };
    },
  };
  assert.equal((await runIndexBatch(client)).failed, 1);
  assert.equal(calls[2][1].p_failed, true);
  assert.ok(!JSON.stringify(calls[2]).includes('private text'));
});
