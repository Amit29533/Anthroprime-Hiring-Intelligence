import test from 'node:test';
import assert from 'node:assert/strict';
import { saveImportReview } from '../src/durableImports.js';
import { sha256 } from '../src/documents.js';
import { createImportWorker } from '../netlify/functions/import-worker.js';
test('staging uses bounded pages and propagates the acknowledged version', async () => {
  const calls = [];
  let version = 1;
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return { version: name === 'api_create_import' ? version : ++version };
  };
  const preview = Array.from({ length: 121 }, (_, i) => ({
    row: i + 2,
    candidate: { name: `Candidate ${i}` },
    error: i === 1 ? 'Missing contact' : '',
  }));
  await saveImportReview({ id: 'fixed', name: 'Sheet', mapping: { name: 'Name' }, preview }, rpc);
  assert.deepEqual(
    calls.slice(1).map(([, args]) => args.p_rows.length),
    [50, 50, 21],
  );
  assert.deepEqual(
    calls.slice(1).map(([, args]) => args.p_version),
    [1, 2, 3],
  );
  assert.equal(calls.at(-1)[1].p_rows.at(-1).sourceLine, 122);
  assert.equal(calls.at(-1)[1].p_rows.at(-1).row, 121);
  assert.equal(calls[2][1].p_batch, 'fixed');
});
test('file fingerprints use the full standard SHA-256 digest', async () => {
  assert.equal(
    await sha256(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
test('worker requests a bounded atomic database batch and redacts errors', async () => {
  let args;
  const worker = createImportWorker({
    client: () => ({
      rpc: async (name, value) => {
        args = [name, value];
        return { data: { completed: 2 } };
      },
    }),
  });
  assert.deepEqual(await (await worker()).json(), { completed: 2 });
  assert.deepEqual(args, ['worker_run_imports', { p_limit: 20 }]);
  await assert.rejects(
    createImportWorker({ client: () => ({ rpc: async () => ({ error: new Error('secret') }) }) })(),
    /Check migrations/,
  );
});
