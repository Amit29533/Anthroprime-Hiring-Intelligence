import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SavedImports.jsx')).SavedImports;
});
afterEach(cleanup);
test.after(stopVite);
test('reopened CV imports expose original-file recovery and require explicit row inclusion or exclusion', async () => {
  const calls = [];
  let state = 'uploading',
    version = 1;
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'api_cv_files') return [{ id: 'file', row_no: 1, name: 'Original.txt', state }];
    if (name === 'api_stage_import') {
      version++;
      return {};
    }
    return args.p_batch
      ? {
          batch: {
            id: 'cv',
            name: 'CV upload',
            status: 'draft',
            mapping: { _kind: 'cv' },
            total: 1,
            version,
          },
          saved: 1,
          counts: { excluded: 1 },
          rows: [
            { row: 1, sourceLine: 1, status: 'excluded', candidate: {}, error: 'Awaiting upload' },
          ],
        }
      : { batches: [{ id: 'cv', name: 'CV upload', status: 'draft', total: 1 }], total: 1 };
  };
  await mount(Panel, { isCloud: true, rpc });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'CV upload' }));
  await settle();
  assert.ok(screen.getByLabelText('Resume CV Original.txt'));
  assert.ok(screen.getByText(/scan: pending/));
  assert.match(
    screen.getByText(/Quarantined files cannot/).textContent,
    /cannot be extracted, approved or downloaded/,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Exclude CV row 1' }));
  await settle();
  const exclusion = calls.find(([name]) => name === 'api_stage_import');
  assert.equal(exclusion[1].p_rows[0].error, 'Excluded by reviewer.');
  assert.equal(exclusion[1].p_version, 1);
});
