import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, screen, fireEvent, settle, cleanup, stopVite } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/AttachmentProcessing.jsx')).AttachmentProcessing;
});
afterEach(cleanup);
test.after(stopVite);
const record = { id: 'doc', name: 'cv.txt', scanRequired: true };
test('attachment status exposes transient retry and hides writes from viewers', async () => {
  const calls = [];
  const read = async (name, args) => {
    calls.push({ name, args });
    return name === 'api_attachment_status'
      ? [{ id: 'doc', uploaded: true, scan: 'error', parse: 'quarantined', retryable: true }]
      : null;
  };
  await mount(Panel, { record, isCloud: true, read });
  await settle();
  assert.ok(screen.getByText(/Private scan: error/));
  fireEvent.click(screen.getByRole('button', { name: 'Retry processing cv.txt' }));
  await settle();
  assert.equal(calls.filter((c) => c.name === 'api_retry_attachment').length, 1);
  cleanup();
  await mount(Panel, { record, isCloud: true, read, readOnly: true });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Retry processing cv.txt' }), null);
});
test('blocked files offer replacement guidance and incomplete uploads can be resumed', async () => {
  const read = async () => [{ id: 'doc', uploaded: true, scan: 'infected', parse: 'quarantined' }];
  await mount(Panel, { record, isCloud: true, read });
  await settle();
  assert.ok(screen.getByText(/File blocked/));
  assert.equal(screen.queryByRole('button', { name: 'Retry processing cv.txt' }), null);
  cleanup();
  await mount(Panel, {
    record,
    isCloud: true,
    read: async () => [{ id: 'doc', uploaded: false, scan: 'pending', parse: 'quarantined' }],
  });
  await settle();
  assert.ok(screen.getByLabelText('Resume attachment cv.txt'));
});
