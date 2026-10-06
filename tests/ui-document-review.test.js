import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/DocumentReviewQueue.jsx')).DocumentReviewQueue;
});
afterEach(cleanup);
test.after(stopVite);
const row = {
  id: 'doc',
  name: 'old.txt',
  provider: 'r2',
  scan: 'unverified',
  eligible: true,
  owner: 'candidate',
  removed: false,
};
test('document review adopts only eligible originals and preserves idempotency after a lost receipt', async () => {
  const calls = [];
  let fail = true;
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_document_review_queue')
        return {
          rows: [
            row,
            { ...row, id: 'legacy', name: 'supabase.pdf', provider: 'supabase', eligible: false },
          ],
          total: 2,
          privateDocuments: true,
        };
      if (name === 'api_review_document_retention' && fail) {
        fail = false;
        throw new Error('Lost receipt');
      }
      return null;
    },
  });
  await settle();
  assert.equal(
    screen.queryByRole('button', { name: 'Quarantine legacy original supabase.pdf' }),
    null,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quarantine legacy original old.txt' }));
  await settle();
  assert.equal(calls.find(([name]) => name === 'api_adopt_legacy_document')[1].p_document, 'doc');
  fireEvent.click(screen.getByRole('button', { name: 'Review retention old.txt' }));
  fireEvent.change(screen.getByLabelText('Retention reason'), {
    target: { value: 'Business review complete' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record retention decision' }));
  await settle();
  assert.ok(screen.getByRole('alert').textContent.includes('Lost receipt'));
  fireEvent.click(screen.getByRole('button', { name: 'Record retention decision' }));
  await settle();
  const attempts = calls.filter(([name]) => name === 'api_review_document_retention');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0][1].p_request, attempts[1][1].p_request);
  assert.equal(attempts[1][1].p_days, 30);
});
test('scheduled holds remain reachable and require explicit release before archive', async () => {
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        rows: args.p_deferred ? [{ ...row, decision: 'hold', note: 'Preserve evidence' }] : [],
        total: args.p_deferred ? 1 : 0,
        privateDocuments: true,
      };
    },
  });
  await settle();
  fireEvent.click(screen.getByLabelText('Include scheduled document reviews'));
  await settle();
  assert.equal(calls.at(-1)[1].p_deferred, true);
  fireEvent.click(screen.getByRole('button', { name: 'Review retention old.txt' }));
  assert.equal(screen.getByRole('option', { name: 'Archive' }).disabled, true);
  assert.ok(screen.getByText(/A hold remains active/));
});
