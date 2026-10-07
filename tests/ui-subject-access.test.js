import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
} from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SubjectAccessReview.jsx')).SubjectAccessReview;
});
afterEach(cleanup);
test.after(stopVite);
const caseRecord = { id: 'case', status: 'in_review', version: 4 };
const page = {
  review: { id: 'review', state: 'draft', expiresAt: '2026-10-14' },
  total: 26,
  pending: 26,
  rows: [
    { category: 'notes', id: 'note', data: { text: 'Third-party comment' }, decision: 'pending' },
  ],
  packages: [],
};
test('explicit row decisions reuse identifiers after lost acknowledgement and page in bounded steps', async () => {
  const calls = [];
  let lost = true,
    changed = 0;
  await mount(Panel, {
    caseRecord,
    onChanged: () => changed++,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_subject_access_page') return page;
      if (lost) {
        lost = false;
        throw new Error('Lost disclosure receipt');
      }
      return { id: 'case', version: 5 };
    },
  });
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Prepare and download JSON package' }).disabled,
    true,
  );
  assert.equal(screen.getByRole('button', { name: 'Save record decisions' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Access review reference'), {
    target: { value: 'Reviewed third-party disclosure reference' },
  });
  fireEvent.change(screen.getByLabelText('Decision for notes note'), {
    target: { value: 'redact' },
  });
  fireEvent.change(screen.getByLabelText('Redacted JSON for notes note'), {
    target: { value: '{invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save record decisions' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /valid JSON/);
  assert.equal(calls.filter(([n]) => n === 'api_review_subject_access_rows').length, 0);
  fireEvent.change(screen.getByLabelText('Redacted JSON for notes note'), {
    target: { value: '{"text":"[removed]"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save record decisions' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost disclosure/);
  fireEvent.click(screen.getByRole('button', { name: 'Save record decisions' }));
  await settle();
  const updates = calls.filter(([n]) => n === 'api_review_subject_access_rows');
  assert.equal(updates[0][1].p_operation, updates[1][1].p_operation);
  assert.deepEqual(updates[1][1].p_decisions, [
    { category: 'notes', id: 'note', decision: 'redact', data: { text: '[removed]' } },
  ]);
  assert.equal(changed, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Next access records' }));
  await settle();
  assert.equal(calls.filter(([n]) => n === 'api_subject_access_page').at(-1)[1].p_offset, 25);
});
test('preparation downloads verified JSON, keeps a retry ID and records a separate delivery reference', async () => {
  resetDownloads();
  const calls = [];
  let lost = true,
    changed = 0;
  const prepared = {
    ...page,
    review: { ...page.review, state: 'prepared' },
    pending: 0,
    rows: [],
    packages: [
      { id: 'package', preparedAt: '2026-10-07', included: 1, withheld: 0, sha256: 'a'.repeat(64) },
    ],
  };
  await mount(Panel, {
    caseRecord,
    onChanged: () => changed++,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_subject_access_page') return prepared;
      if (name === 'api_prepare_subject_access_package') {
        if (lost) {
          lost = false;
          throw new Error('Lost package receipt');
        }
        const content = JSON.stringify({
          schemaVersion: 1,
          caseId: 'case',
          packageId: args.p_operation,
          records: [],
        });
        return {
          id: 'case',
          version: 5,
          packageId: args.p_operation,
          content,
          sha256: createHash('sha256').update(content).digest('hex'),
        };
      }
      return { id: 'case', version: 6 };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Access review reference'), {
    target: { value: 'Approved package disclosure reference' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare and download JSON package' }));
  await settle();
  assert.equal(downloaded.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare and download JSON package' }));
  await settle(100);
  assert.equal(downloaded.length, 1);
  const prepares = calls.filter(([n]) => n === 'api_prepare_subject_access_package');
  assert.equal(prepares[0][1].p_operation, prepares[1][1].p_operation);
  assert.equal(changed, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Record delivery reference for package' }));
  await settle();
  assert.equal(calls.at(-1)[0], 'api_record_subject_access_delivery');
  assert.equal(calls.at(-1)[1].p_package, 'package');
});
test('unverified requests never fetch disclosure records and missing migrations show an actionable error', async () => {
  await mount(Panel, {
    caseRecord: { ...caseRecord, status: 'opened' },
    rpc: () => {
      throw new Error('Unexpected fetch');
    },
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Create fresh access snapshot' }), null);
  cleanup();
  await mount(Panel, { caseRecord, rpc: async () => null });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Apply the access-package migration/);
});
