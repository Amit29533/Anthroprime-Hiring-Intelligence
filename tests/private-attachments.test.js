import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createScanWorker } from '../scanner/worker.js';
import { createCvWorker } from '../netlify/functions/cv-extract-worker.js';
import { createUploadHandler } from '../netlify/functions/document-upload-url.js';
const bytes = Buffer.from('Jane Smith\njane@example.com');
const file = {
  id: 'file',
  workspace_id: 'ws',
  candidate_id: 'candidate',
  storage_path: 'ws/candidates/candidate/file/original.txt',
  hash: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  ext: 'txt',
  scan_lease: 'scan-lease',
  scan_status: 'clean',
  scan_etag: 'etag',
  lease: 'parse-lease',
};
test('generic attachment workers use verified bytes and source-specific scan/extraction receipts', async () => {
  const calls = [];
  const execution = () => ({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data:
          name === 'worker_claim_cv_scan' || name === 'worker_claim_cv'
            ? null
            : name === 'worker_claim_attachment_scan' || name === 'worker_claim_attachment_extract'
              ? file
              : true,
      };
    },
  });
  const storage = () => ({
    bucket: 'private',
    client: {
      send: async (cmd) => {
        if (cmd.input.IfMatch) assert.equal(cmd.input.IfMatch, 'etag');
        return { ETag: 'etag', ContentLength: bytes.length, Body: Readable.from([bytes]) };
      },
    },
  });
  assert.equal(
    (
      await createScanWorker({
        execution,
        storage,
        scan: async (b) => {
          assert.deepEqual(b, bytes);
          return { status: 'clean', engine: 'ClamAV/test' };
        },
      })()
    ).status,
    'clean',
  );
  assert.equal(calls.at(-1).name, 'worker_finish_attachment_scan');
  assert.equal(calls.at(-1).args.p_lease, 'scan-lease');
  const response = await createCvWorker({
    execution,
    storage,
    extract: async () => ({ state: 'ready', text: 'verified', draft: { name: 'Jane' } }),
  })();
  assert.deepEqual(await response.json(), { processed: 1 });
  assert.equal(calls.at(-1).name, 'worker_finish_attachment_extract');
  assert.equal(calls.at(-1).args.p_draft, undefined);
});
test('private upload signer uses the saved manifest key and conditional writes', async () => {
  let prepare, command;
  const handler = createUploadHandler({
    authorize: async () => ({
      membership: { workspace_id: 'ws', role: 'recruiter' },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'candidate' } }) }),
          }),
        }),
        rpc: async (name, args) => {
          assert.equal(name, 'api_prepare_attachment');
          prepare = args;
          return { data: { required: true, id: 'file', storagePath: file.storage_path } };
        },
      },
    }),
    storage: () => ({ client: {}, bucket: 'private' }),
    signer: async (_c, cmd, options) => {
      command = cmd.input;
      assert.ok(options.signableHeaders.has('if-none-match'));
      return 'signed';
    },
  });
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      documentId: 'file',
      candidateId: 'candidate',
      filename: 'original.txt',
      contentType: 'text/plain',
      size: bytes.length,
      hash: file.hash,
      kind: 'CV',
    }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(prepare.p_hash, file.hash);
  assert.equal(command.Key, file.storage_path);
  assert.equal(command.IfNoneMatch, '*');
  assert.equal(JSON.parse(response.body).quarantined, true);
});
