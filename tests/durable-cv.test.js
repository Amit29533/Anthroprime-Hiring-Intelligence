import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  readCvBytes,
  extractCvOriginal,
  serverDocxText,
} from '../netlify/functions/_shared/cv-extraction.js';
import { createCvUploadHandler } from '../netlify/functions/cv-upload-url.js';
import { createCvWorker, isolatedExtraction } from '../netlify/functions/cv-extract-worker.js';
import { uploadSavedCv } from '../src/durableCv.js';
const bytes = Buffer.from('Jane Smith\njane@example.com\nReact developer');
const file = {
  id: 'file',
  workspace_id: 'ws',
  batch_id: 'batch',
  row_no: 1,
  name: 'cv.txt',
  ext: 'txt',
  mime: 'text/plain',
  size: bytes.length,
  hash: createHash('sha256').update(bytes).digest('hex'),
  storage_path: 'ws/imports/batch/file',
  state: 'uploading',
  lease: 'lease',
  scan_status: 'clean',
  scan_etag: 'etag',
};
test('server verifies bytes and isolates extraction with manual fallback and bounded reads', async () => {
  assert.deepEqual(await readCvBytes(Readable.from([bytes]), bytes.length), bytes);
  await assert.rejects(readCvBytes(Readable.from([bytes]), bytes.length - 1), /size/);
  const result = await isolatedExtraction(bytes, file);
  assert.equal(result.state, 'ready');
  assert.equal(result.draft.email, 'jane@example.com');
  await assert.rejects(extractCvOriginal(bytes, { ...file, hash: '0'.repeat(64) }), /fingerprint/);
  const empty = Buffer.from('%PDF-1.7\n');
  const manual = await extractCvOriginal(
    empty,
    {
      ...file,
      ext: 'pdf',
      size: empty.length,
      hash: createHash('sha256').update(empty).digest('hex'),
    },
    {
      loadPdf: async () => ({
        getDocument: () => ({
          promise: Promise.reject(new Error('secret parser detail')),
          destroy: async () => {},
        }),
      }),
    },
  );
  assert.equal(manual.state, 'manual');
  assert.equal(manual.text, '');
  await assert.rejects(isolatedExtraction(bytes, file, { timeoutMs: 1 }), /timed out/);
  assert.throws(() => serverDocxText(Buffer.from('bad zip')), /DOCX/);
});
test('CV signer enforces workspace, fixed saved key and conditional immutable writes', async () => {
  let command, options;
  const authorize = async () => ({
    membership: { workspace_id: 'ws' },
    supabase: {
      from: (table) => ({
        select: () => ({
          eq: () =>
            table === 'importBatches'
              ? { maybeSingle: async () => ({ data: { status: 'draft' } }) }
              : { eq: () => ({ maybeSingle: async () => ({ data: file }) }) },
        }),
      }),
    },
  });
  const handler = createCvUploadHandler({
    authorize,
    storage: () => ({ client: {}, bucket: 'private' }),
    signer: async (_c, cmd, opts) => {
      command = cmd.input;
      options = opts;
      return 'signed';
    },
  });
  const event = { httpMethod: 'POST', body: JSON.stringify({ batch: 'batch', row: 1 }) };
  const response = await handler(event);
  assert.equal(response.statusCode, 200);
  assert.equal(command.IfNoneMatch, '*');
  assert.equal(command.Key, file.storage_path);
  assert.ok(options.signableHeaders.has('if-none-match'));
  assert.equal(JSON.parse(response.body).headers['If-None-Match'], '*');
  const blocked = createCvUploadHandler({
    authorize: async () => ({ ...(await authorize()), membership: { workspace_id: 'other' } }),
  });
  assert.equal((await blocked(event)).statusCode, 404);
  const error = createCvUploadHandler({
    authorize: async () => {
      throw new Error('secret');
    },
  });
  assert.ok(!(await error(event)).body.includes('secret'));
});
test('lost PUT receipt recovers existing original; wrong files cannot resume', async () => {
  const original = {
    name: file.name,
    size: bytes.length,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
  const calls = [];
  const rpc = async (name, args) => {
    calls.push(name);
    return name === 'api_cv_files' ? [file] : null;
  };
  let sent;
  await uploadSavedCv('batch', 1, original, {
    rpc,
    prepare: async () => ({
      uploadUrl: 'signed',
      headers: { 'Content-Type': 'text/plain', 'If-None-Match': '*' },
    }),
    send: async (_url, options) => {
      sent = options;
      return { ok: false, status: 412 };
    },
  });
  assert.equal(sent.headers['If-None-Match'], '*');
  assert.deepEqual(calls, ['api_cv_files', 'api_cv_uploaded']);
  await assert.rejects(
    uploadSavedCv('batch', 1, { ...original, name: 'changed.txt' }, { rpc }),
    /original file/,
  );
});
test('worker accepts only leased result and redacts failures', async () => {
  const calls = [];
  const execution = () => ({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === 'worker_claim_cv' ? file : true };
    },
  });
  const worker = createCvWorker({
    execution,
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
    extract: async () => ({ state: 'ready', text: 'safe', draft: { name: 'Jane' } }),
  });
  assert.deepEqual(await (await worker()).json(), { processed: 1 });
  assert.equal(calls[1].args.p_lease, 'lease');
  const failed = createCvWorker({
    execution,
    storage: () => {
      throw new Error('secret credentials');
    },
  });
  assert.equal((await failed()).status, 200);
  assert.equal(calls.at(-1).args.p_state, 'failed');
  const rejected = createCvWorker({
    execution: () => ({ rpc: async () => ({ error: new Error('secret service key') }) }),
  });
  const response = await rejected();
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('secret'));
});
