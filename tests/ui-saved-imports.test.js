import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SavedImports.jsx')).SavedImports;
});
afterEach(cleanup);
test.after(stopVite);
test('saved imports recover review, block unsaved approval and submit the current version', async () => {
  const calls = [];
  let version = 2;
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_stage_import') {
        version++;
        return { version };
      }
      if (name === 'api_import_action') return {};
      return args.p_batch
        ? {
            batch: { id: 'one', name: 'Saved sheet', status: 'draft', version, total: 1 },
            saved: 1,
            counts: { draft: 1 },
            rows: [
              {
                row: 1,
                sourceLine: 2,
                status: 'draft',
                candidate: { name: 'Alice', email: 'a@e.com' },
                error: '',
              },
            ],
          }
        : { batches: [{ id: 'one', name: 'Saved sheet', status: 'draft', total: 1 }], total: 1 };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Saved sheet' }));
  await settle();
  fireEvent.change(screen.getByLabelText('name for saved row 1'), {
    target: { value: 'Corrected' },
  });
  assert.equal(screen.getByRole('button', { name: 'Approve background import' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Save corrected row 1' }));
  await settle();
  assert.equal(
    calls.find(([name]) => name === 'api_stage_import')[1].p_rows[0].candidate.name,
    'Corrected',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve background import' }));
  await settle();
  assert.equal(calls.find(([name]) => name === 'api_import_action')[1].p_version, 3);
});
test('a partially staged batch cannot be approved', async () => {
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) =>
      args.p_batch
        ? {
            batch: { id: 'one', name: 'Partial', status: 'draft', version: 1, total: 2 },
            saved: 1,
            counts: { draft: 1 },
            rows: [],
          }
        : { batches: [{ id: 'one', name: 'Partial', status: 'draft', total: 2 }], total: 1 },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Partial' }));
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Approve background import' }).disabled, true);
  assert.ok(screen.getByText(/incomplete batch cannot be approved/));
});
