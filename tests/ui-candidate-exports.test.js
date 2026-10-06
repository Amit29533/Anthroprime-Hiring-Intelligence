import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  mount,
  cleanup,
  stopVite,
  screen,
  fireEvent,
  settle,
  downloaded,
  resetDownloads,
  blobText,
} from './ui-harness.js';
let exportData, Panel;
test.before(async () => {
  exportData = (await load('/src/candidateExports.js')).exportCandidateData;
  Panel = (await load('/src/CandidateExportAudit.jsx')).CandidateExportAudit;
});
afterEach(() => {
  cleanup();
  resetDownloads();
});
test.after(stopVite);
const receipt = {
  allowed: true,
  receiptId: 'receipt',
  preparedAt: '2026-10-06T10:00:00Z',
  actor: 'server-actor',
  schemaVersion: 1,
  sha256: 'a'.repeat(64),
  rows: [{ anthroId: 'ANTHRO-12345', name: '=Server Name', email: 'server@example.com' }],
};
test('audited CSV uses only server projection, protects formulae and carries server provenance', async () => {
  const calls = [];
  assert.equal(
    await exportData([{ id: 'candidate', name: 'Untrusted Browser', current: 900 }], () => {}, {
      isCloud: true,
      rpc: async (name, args) => {
        calls.push([name, args]);
        return name.endsWith('_mode') ? true : receipt;
      },
    }),
    true,
  );
  const csv = await blobText(downloaded[0].blob);
  assert.ok(csv.includes("'=Server Name"));
  assert.ok(csv.includes('server-actor'));
  assert.ok(csv.includes('receipt'));
  assert.ok(csv.includes('ANTHRO-12345'));
  assert.equal(csv.includes('Untrusted Browser'), false);
  assert.equal(csv.includes('900'), false);
  assert.deepEqual(calls[1][1], { p_ids: ['candidate'] });
});
test('quota, missing configuration and invalid receipts prevent local CSV creation', async () => {
  for (const response of [
    { allowed: false, retryAfter: 10 },
    { ...receipt, receiptId: null },
    null,
  ]) {
    const messages = [];
    assert.equal(
      await exportData([{ id: 'candidate' }], (m) => messages.push(m), {
        isCloud: true,
        rpc: async (name) => (name.endsWith('_mode') ? true : response),
      }),
      false,
    );
    assert.ok(messages.length);
    assert.equal(downloaded.length, 0);
  }
  assert.equal(
    await exportData([{ id: 'candidate' }], () => {}, { isCloud: true, rpc: async () => null }),
    false,
  );
});
test('audit panel flags volume and uses bounded server paging', async () => {
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    read: async (args) => {
      calls.push(args);
      return { enabled: true, total: 51, volume: 1000, throttled: 0, rows: [] };
    },
  });
  await settle();
  assert.match(screen.getByRole('status').textContent, /warrant review/);
  fireEvent.click(screen.getByRole('button', { name: 'Next export events' }));
  await settle();
  assert.equal(calls.at(-1).p_offset, 50);
  fireEvent.change(screen.getByLabelText('Candidate export audit period'), {
    target: { value: '168' },
  });
  await settle();
  assert.deepEqual(calls.at(-1), { p_offset: 0, p_hours: 168 });
});
