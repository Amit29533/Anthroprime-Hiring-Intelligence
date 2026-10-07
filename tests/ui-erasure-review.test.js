import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/ErasureReview.jsx')).ErasureReview;
});
afterEach(cleanup);
test.after(stopVite);
const caseRecord = { id: 'case', status: 'in_review', version: 3 };
const page = {
  review: {
    id: 'review',
    currentVerification: true,
    createdAt: '2026-10-07',
    inventory: {
      identities: 2,
      total: 4,
      counts: [{ category: 'notes', area: 'records', count: 1 }],
    },
  },
  rows: [{ area: 'records', decision: 'pending', reference: '' }],
};
test('erasure scope capture requires evidence and reuses the operation after a lost receipt', async () => {
  const calls = [];
  let lost = true,
    changed = 0;
  await mount(Panel, {
    caseRecord,
    onChanged: () => changed++,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_erasure_review') return { review: null, rows: [] };
      if (lost) {
        lost = false;
        throw new Error('Lost scope receipt');
      }
      return { id: 'case', version: 4 };
    },
  });
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Capture current erasure scope' }).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText('Erasure evidence or retention reference'), {
    target: { value: 'Approved scope review reference' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Capture current erasure scope' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost scope/);
  fireEvent.click(screen.getByRole('button', { name: 'Capture current erasure scope' }));
  await settle();
  const captures = calls.filter(([n]) => n === 'api_capture_erasure_scope');
  assert.equal(captures[0][1].p_operation, captures[1][1].p_operation);
  assert.equal(captures[1][1].p_version, 3);
  assert.equal(changed, 1);
});
test('erasure outcomes require an explicit choice and carry a policy or evidence reference', async () => {
  const calls = [];
  await mount(Panel, {
    caseRecord,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_erasure_review') return page;
      return { id: 'case', version: 4 };
    },
  });
  await settle();
  assert.match(screen.getByText(/2 identities/).textContent, /4 identified database records/);
  assert.equal(screen.getByRole('button', { name: 'Record outcome for records' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Erasure evidence or retention reference'), {
    target: { value: 'Retention-policy reference RET-123' },
  });
  fireEvent.change(screen.getByLabelText('Outcome for records'), { target: { value: 'retained' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record outcome for records' }));
  await settle();
  assert.equal(calls.at(-1)[0], 'api_review_erasure_area');
  assert.equal(calls.at(-1)[1].p_decision, 'retained');
  assert.equal(calls.at(-1)[1].p_review, 'review');
  assert.equal(calls.at(-1)[1].p_note, 'Retention-policy reference RET-123');
});
test('unverified erasure cases do not fetch inventory and missing migrations stay visible', async () => {
  await mount(Panel, {
    caseRecord: { ...caseRecord, status: 'opened' },
    rpc: () => {
      throw new Error('Unexpected inventory');
    },
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Capture current erasure scope' }), null);
  cleanup();
  await mount(Panel, { caseRecord, rpc: async () => null });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Apply the erasure-scope migration/);
});
