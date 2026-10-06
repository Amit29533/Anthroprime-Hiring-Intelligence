import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/DocumentReputation.jsx')).DocumentReputation;
});
afterEach(cleanup);
test.after(stopVite);
test('VirusTotal UI shows server configuration and treats unknown documents as unverified', async () => {
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    documents: [{ id: 'doc', name: 'CV.pdf', hash: 'a'.repeat(64) }],
    request: async (body) => {
      calls.push(body);
      return body.action === 'status'
        ? { configured: true, licensed: true }
        : { status: 'unknown' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Document reputation file'), { target: { value: 'doc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check VirusTotal reputation' }));
  await settle();
  assert.deepEqual(calls.at(-1), { action: 'lookup', documentId: 'doc' });
  assert.ok(screen.getByText('Unknown to VirusTotal — unverified'));
  assert.ok(screen.getByText(/does not change document permissions/));
  assert.equal(
    document.querySelector('input[type="password"]'),
    null,
    'no key is entered into browser state',
  );
});
test('VirusTotal is disabled without licensed server configuration', async () => {
  await mount(Panel, {
    isCloud: true,
    documents: [],
    request: async () => ({ configured: false, licensed: false }),
  });
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Check VirusTotal reputation' }).disabled, true);
});
