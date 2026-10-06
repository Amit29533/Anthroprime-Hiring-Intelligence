import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SavedImports.jsx')).SavedImports;
});
afterEach(cleanup);
test.after(stopVite);
test('an incompatible RPC response cannot crash the importing screen', async () => {
  await mount(Panel, { isCloud: true, rpc: async () => [] });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /invalid response/);
  assert.ok(screen.getByRole('button', { name: 'Refresh saved imports' }));
});
