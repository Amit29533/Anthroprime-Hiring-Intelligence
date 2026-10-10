import test from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, click, screen, cleanup, stopVite } from './ui-harness.js';
import { emptyData } from '../src/schema.js';

test.after(async () => {
  cleanup();
  await stopVite();
});

test('merge failure keeps the review open and never announces success or hides the duplicate', async () => {
  const { Settings } = await load('/src/Workflows.jsx');
  const data = emptyData();
  data.candidates = [
    { id: 'a', name: 'Winner', phone: '1234567890', skills: [] },
    { id: 'b', name: 'Duplicate', phone: '1234567890', skills: [] },
  ];
  data.notes = [{ id: 'n', candidateId: 'b', text: 'Keep this record' }];
  const calls = [],
    notifications = [],
    audits = [];
  let reloads = 0;
  await mount(Settings, {
    data,
    onSave: async (table, rows) => {
      calls.push({ table, rows });
      return false;
    },
    notify: (message) => notifications.push(message),
    audit: (event) => audits.push(event),
    onReload: () => reloads++,
  });
  await click(screen.getByRole('button', { name: /^Operations and maintenance/ }));
  await click(screen.getByRole('button', { name: /Winner.*Duplicate/ }));
  await click(screen.getByRole('button', { name: 'Merge into Winner', exact: true }));
  assert.deepEqual(
    calls.map((call) => call.table),
    ['notes'],
  );
  assert.match(notifications[0], /Merge stopped while saving notes/);
  assert.equal(
    notifications.some((message) => message.startsWith('Profiles merged')),
    false,
  );
  assert.equal(audits.length, 0);
  assert.equal(reloads, 0);
  assert.equal(screen.getByRole('button', { name: 'Merge into Winner' }).disabled, false);
});
