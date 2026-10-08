import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUploadHandler,
  documentObjectKey,
  safeFilename,
} from '../netlify/functions/document-upload-url.js';
import { createDownloadHandler } from '../netlify/functions/document-download-url.js';

const post = (body) => ({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer test-token' },
  body: JSON.stringify(body),
});
const parsed = (response) => JSON.parse(response.body);

test('R2 object keys are tenant- and candidate-scoped with a sanitized filename', () => {
  assert.equal(safeFilename('../../A résumé (final).pdf'), 'A_r_sum_final_.pdf');
  assert.equal(
    documentObjectKey('workspace-1', 'candidate-1', '../../cv.pdf', 'object-1'),
    'workspace-1/candidates/candidate-1/object-1/cv.pdf',
  );
});

test('client upload signing requires admin access and a client visible in the workspace', async () => {
  let role = 'admin',
    visible = true,
    lookup;
  const handler = createUploadHandler({
    authorize: async () => ({
      membership: { workspace_id: 'workspace-1', role },
      supabase: {
        rpc: async () => ({ data: { required: false } }),
        from: (table) => {
          lookup = table;
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: visible ? { id: 'client-1' } : null,
                  error: null,
                }),
              }),
            }),
          };
        },
      },
    }),
    storage: () => ({ client: {}, bucket: 'documents' }),
    signer: async () => 'https://signed.example/upload',
  });
  const body = {
    clientId: 'client-1',
    filename: 'Agreement.pdf',
    contentType: 'application/pdf',
    size: 1024,
  };
  const response = await handler(post(body));
  assert.equal(response.statusCode, 200);
  assert.equal(lookup, 'clients');
  assert.match(parsed(response).storagePath, /^workspace-1\/clients\/client-1\//);
  role = 'recruiter';
  assert.equal((await handler(post(body))).statusCode, 403);
  role = 'admin';
  visible = false;
  assert.equal((await handler(post(body))).statusCode, 404);
  assert.equal((await handler(post({ ...body, candidateId: 'candidate-1' }))).statusCode, 400);
});

test('upload signing requires an allowed type, bounded size and a candidate in the workspace', async () => {
  const calls = [];
  const authorize = async (_event, options) => {
    assert.deepEqual(options, { write: true });
    return {
      membership: { workspace_id: 'workspace-1', role: 'recruiter' },
      supabase: {
        rpc: async () => ({ data: { required: false } }),
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'candidate-1' }, error: null }) }),
          }),
        }),
      },
    };
  };
  const handler = createUploadHandler({
    authorize,
    storage: () => ({ client: {}, bucket: 'documents' }),
    signer: async (_client, command, options) => {
      calls.push({ input: command.input, options });
      return 'https://signed.example/upload';
    },
  });
  const response = await handler(
    post({
      candidateId: 'candidate-1',
      filename: 'My CV.pdf',
      contentType: 'application/pdf',
      size: 1024,
    }),
  );
  assert.equal(response.statusCode, 200);
  const body = parsed(response);
  assert.equal(body.uploadUrl, 'https://signed.example/upload');
  assert.match(body.storagePath, /^workspace-1\/candidates\/candidate-1\/[\w-]+\/My_CV\.pdf$/);
  assert.equal(calls[0].input.Bucket, 'documents');
  assert.equal(calls[0].input.ContentType, 'application/pdf');
  assert.equal(calls[0].options.expiresIn, 300);
  assert.equal(calls[0].options.signableHeaders.has('content-type'), true);

  const rejected = await handler(
    post({
      candidateId: 'candidate-1',
      filename: 'malware.exe',
      contentType: 'application/octet-stream',
      size: 10,
    }),
  );
  assert.equal(rejected.statusCode, 400);
  assert.match(parsed(rejected).error, /not allowed/i);
});

test('download signing checks the RLS-visible record and workspace path', async () => {
  const document = {
    id: 'document-1',
    storagePath: 'workspace-1/candidates/candidate-1/object-1/cv.pdf',
    storageProvider: 'r2',
    removed: false,
  };
  const authorize = async () => ({
    membership: { workspace_id: 'workspace-1', role: 'viewer' },
    supabase: {
      rpc: async () => ({ data: { enforced: false } }),
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: document, error: null }) }),
        }),
      }),
    },
  });
  const handler = createDownloadHandler({
    authorize,
    storage: () => ({ client: {}, bucket: 'documents' }),
    signer: async (_client, command) => {
      assert.equal(command.input.Key, document.storagePath);
      return 'https://signed.example/download';
    },
  });
  const response = await handler(post({ documentId: document.id }));
  assert.equal(response.statusCode, 200);
  assert.equal(parsed(response).downloadUrl, 'https://signed.example/download');

  document.storagePath = 'another-workspace/candidates/candidate-1/object-1/cv.pdf';
  const rejected = await handler(post({ documentId: document.id }));
  assert.equal(rejected.statusCode, 403);
});
