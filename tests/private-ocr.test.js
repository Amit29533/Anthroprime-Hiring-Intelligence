import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { privateOcr, createOcrExtraction, createOcrWorker } from '../scanner/ocr.js';
const token = 'test-only-private-ocr-token-32-characters';
test('OCR client sends bytes only to the fixed private sidecar and bounds every response', async () => {
  const bytes = Buffer.from('%PDF-1.4');
  let calls = 0;
  const send = async (url, options) => {
    calls++;
    assert.equal(url, 'http://ocr:8080/extract');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(options.body, bytes);
    return new Response(JSON.stringify({ text: 'Jane Smith', engine: 'tesseract 5.3.0' }));
  };
  assert.equal((await privateOcr(bytes, { token, send })).text, 'Jane Smith');
  await assert.rejects(privateOcr(bytes, { token: '', send }), /configured/);
  assert.equal(calls, 1);
  for (const payload of [
    { text: 'x'.repeat(40001), engine: 'tesseract' },
    { text: 'x', engine: '' },
    { text: 3, engine: 'tesseract' },
  ])
    await assert.rejects(
      privateOcr(bytes, { token, send: async () => new Response(JSON.stringify(payload)) }),
      /Invalid/,
    );
  await assert.rejects(
    privateOcr(bytes, { token, send: async () => new Response('x'.repeat(250001)) }),
    /limit/,
  );
  await assert.rejects(
    privateOcr(bytes, {
      token,
      send: async () => new Response('secret tool output', { status: 422 }),
    }),
    /unavailable/,
  );
});
test('OCR runs only after verified text extraction reports a manual PDF and returns reviewable drafts', async () => {
  const bytes = Buffer.from('%PDF-1.4');
  let calls = 0;
  const ocr = async () => {
    calls++;
    return { text: 'Jane Smith\njane@example.com\nReact developer', engine: 'tesseract 5.3.0' };
  };
  const ready = createOcrExtraction({
    text: async () => ({ state: 'ready', text: 'already searchable', draft: {} }),
    ocr,
  });
  assert.equal((await ready(bytes, { ext: 'pdf' })).method, 'text');
  assert.equal(calls, 0);
  const manual = createOcrExtraction({
    text: async () => ({ state: 'manual', text: '', draft: {} }),
    ocr,
  });
  assert.equal((await manual(bytes, { ext: 'txt' })).method, 'text');
  assert.equal(calls, 0);
  const result = await manual(bytes, { ext: 'pdf' });
  assert.equal(result.method, 'ocr');
  assert.equal(result.state, 'ready');
  assert.equal(result.draft.email, 'jane@example.com');
  const unavailable = createOcrExtraction({
    text: async () => ({ state: 'manual' }),
    ocr: async () => {
      throw new Error('OCR unavailable');
    },
  });
  await assert.rejects(unavailable(bytes, { ext: 'pdf' }));
});
test('private OCR worker claims its dedicated lease and records method/engine with the matching receipt', async () => {
  const bytes = Buffer.from('%PDF-1.4');
  const calls = [];
  const file = {
    id: 'f',
    workspace_id: 'ws',
    batch_id: 'batch',
    storage_path: 'ws/imports/batch/f',
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
    scan_status: 'clean',
    scan_etag: 'etag',
    lease: 'lease',
    ext: 'pdf',
  };
  const run = createOcrWorker({
    execution: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: name === 'worker_claim_ocr_cv' ? file : true };
      },
    }),
    storage: () => ({
      bucket: 'private',
      client: {
        send: async () => ({
          ETag: 'etag',
          ContentLength: bytes.length,
          Body: Readable.from([bytes]),
        }),
      },
    }),
    extract: async () => ({
      state: 'ready',
      text: 'Jane',
      draft: { name: 'Jane' },
      method: 'ocr',
      engine: 'tesseract 5.3.0',
    }),
  });
  assert.deepEqual(await (await run()).json(), { processed: 1 });
  assert.equal(calls[0].name, 'worker_claim_ocr_cv');
  assert.equal(calls.at(-1).name, 'worker_finish_ocr_cv');
  assert.equal(calls.at(-1).args.p_lease, 'lease');
  assert.equal(calls.at(-1).args.p_method, 'ocr');
  assert.equal(calls.at(-1).args.p_engine, 'tesseract 5.3.0');
});
