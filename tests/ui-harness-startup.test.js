import test from 'node:test';
import assert from 'node:assert/strict';
import { startVite, stopVite } from './ui-harness.js';

test.after(stopVite);

test('parallel UI module loads share one initialized Vite server', async () => {
  const servers = await Promise.all(Array.from({ length: 18 }, () => startVite()));
  assert.equal(new Set(servers).size, 1);
  assert.equal(await startVite(), servers[0]);
});
