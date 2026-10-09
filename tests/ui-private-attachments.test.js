import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, screen, fireEvent, settle, cleanup, stopVite } from './ui-harness.js';
import { sha256 } from '../src/documents.js';
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

test('failed legacy originals resume the same metadata record only with matching original bytes', async () => {
  const bytes = new TextEncoder().encode('test').buffer;
  const failed = {
    id: 'doc',
    name: 'cv.txt',
    stored: false,
    storageError: 'Failed to fetch',
    size: 4,
    hash: await sha256(bytes),
  };
  const uploaded = [],
    saved = [];
  await mount(Panel, {
    record: failed,
    isCloud: true,
    read: async () => {
      throw new Error('Legacy retry must not read scan state');
    },
    upload: async (draft, file) => {
      uploaded.push([draft, file]);
      return { ...draft, stored: true, storageError: '' };
    },
    onSave: async (table, rows) => {
      saved.push([table, rows]);
      return true;
    },
  });
  await settle();
  const file = { name: 'cv.txt', size: 4, arrayBuffer: async () => bytes };
  fireEvent.change(screen.getByLabelText('Resume attachment cv.txt'), {
    target: { files: [{ ...file, name: 'other.txt' }] },
  });
  await settle();
  assert.equal(uploaded.length, 0);
  assert.match(screen.getByRole('alert').textContent, /original file/);
  fireEvent.change(screen.getByLabelText('Resume attachment cv.txt'), {
    target: { files: [file] },
  });
  await settle();
  assert.equal(uploaded.length, 1);
  assert.equal(saved[0][0], 'documents');
  assert.equal(saved[0][1][0].id, 'doc');
  assert.equal(saved[0][1][0].stored, true);
  cleanup();
  await mount(Panel, { record: failed, isCloud: true, readOnly: true });
  await settle();
  assert.equal(screen.queryByLabelText('Resume attachment cv.txt'), null);
});
