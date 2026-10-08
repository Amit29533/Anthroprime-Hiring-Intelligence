import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
import { extractCvEvidence } from '../src/cvEvidence.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SavedImports.jsx')).SavedImports;
});
afterEach(cleanup);
test.after(stopVite);
test('saved CV review requires confirmation and resets it when fields change', async () => {
  const calls = [];
  let candidate = {
    name: 'Jane',
    email: 'jane@example.com',
    cvEvidence: extractCvEvidence('Education\nBSc Example'),
  };
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_stage_import') {
        candidate = args.p_rows[0].candidate;
        return {};
      }
      return args.p_batch
        ? {
            batch: { id: 'one', name: 'CV review', status: 'draft', version: 1, total: 1 },
            saved: 1,
            counts: { excluded: 1 },
            rows: [{ row: 1, sourceLine: 1, status: 'excluded', candidate }],
          }
        : { batches: [{ id: 'one', name: 'CV review', status: 'draft', total: 1 }], total: 1 };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'CV review' }));
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Save corrected row 1' }).disabled, true);
  fireEvent.click(screen.getByLabelText('Row 1 confirm evidence 1'));
  assert.equal(screen.getByRole('button', { name: 'Save corrected row 1' }).disabled, false);
  fireEvent.change(screen.getByLabelText('Row 1 evidence label 1'), {
    target: { value: 'Corrected BSc' },
  });
  assert.equal(screen.getByLabelText('Row 1 confirm evidence 1').checked, false);
  assert.equal(screen.getByRole('button', { name: 'Save corrected row 1' }).disabled, true);
  fireEvent.click(screen.getByLabelText('Row 1 confirm evidence 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Save corrected row 1' }));
  await settle();
  const saved = calls.find(([name]) => name === 'api_stage_import')[1].p_rows[0].candidate
    .cvEvidence.items[0];
  assert.equal(saved.label, 'Corrected BSc');
  assert.equal(saved.evidence, 'BSc Example');
  assert.equal(saved.reviewed, true);
});
