import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/DocumentAccessAudit.jsx')).DocumentAccessAudit;
});
afterEach(cleanup);
test.after(stopVite);
test('access audit shows rate-limit windows and requests bounded pages and periods', async () => {
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    read: async (args) => {
      calls.push(args);
      return { enabled: true, total: 51, counts: { issued: 4, throttled: 1 }, rows: [] };
    },
  });
  await settle();
  assert.equal(calls[0].p_hours, 24);
  assert.match(screen.getByRole('status').textContent, /Rate limits/);
  fireEvent.click(screen.getByRole('button', { name: 'Next access events' }));
  await settle();
  assert.equal(calls.at(-1).p_offset, 50);
  fireEvent.change(screen.getByLabelText('Document audit period'), { target: { value: '168' } });
  await settle();
  assert.deepEqual(calls.at(-1), { p_offset: 0, p_hours: 168 });
});
