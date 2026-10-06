import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadHandler } from '../netlify/functions/document-download-url.js';
const document = {
  id: 'doc',
  storagePath: 'ws/candidates/c/cv.pdf',
  storageProvider: 'r2',
  scanRequired: false,
};
const post = { httpMethod: 'POST', body: JSON.stringify({ documentId: 'doc' }) };
function fixture({
  gate = { enforced: true, allowed: true, requestId: 'receipt', document },
  finish = true,
  scan,
  provider,
} = {}) {
  const calls = [];
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: document }) }) }),
    }),
    rpc: async (name) => ({ data: name === 'api_begin_document_access' ? gate : scan }),
  };
  const handler = createDownloadHandler({
    authorize: async () => ({ supabase, membership: { workspace_id: 'ws' } }),
    storage: () => ({ client: {}, bucket: 'documents' }),
    signer: async () => {
      calls.push('signed');
      return 'https://private.example/?secret=token';
    },
    execution: () => ({
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: finish };
      },
      storage: {
        from: () => ({
          createSignedUrl: async (key, ttl) => {
            calls.push(['legacy', key, ttl]);
            return { data: { signedUrl: provider } };
          },
        }),
      },
    }),
  });
  return { handler, calls };
}
test('audited R2 URL returns only after its service receipt succeeds', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(post)).statusCode, 200);
  assert.equal(calls[0], 'signed');
  assert.equal(calls[1][1].p_outcome, 'issued');
});
test('rate limits and malformed gates prevent signing', async () => {
  for (const gate of [
    { enforced: true, allowed: false, retryAfter: 12 },
    {},
    { enforced: true, allowed: true },
  ]) {
    const { handler, calls } = fixture({ gate });
    const response = await handler(post);
    assert.equal(response.statusCode, gate.allowed === false ? 429 : 503);
    if (response.statusCode === 429) assert.equal(response.headers['retry-after'], '12');
    assert.equal(calls.length, 0);
  }
});
test('failed final authorization withholds the signed URL', async () => {
  const { handler } = fixture({ finish: false });
  const response = await handler(post);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes('secret'), false);
  assert.equal(response.body.includes('private.example'), false);
});
test('audited legacy signing uses service storage and records quarantined failures', async () => {
  const gate = {
    enforced: true,
    allowed: true,
    requestId: 'receipt',
    document: { ...document, storageProvider: 'supabase' },
  };
  const { handler, calls } = fixture({ gate, provider: 'https://legacy.example/signed' });
  assert.equal((await handler(post)).statusCode, 200);
  assert.deepEqual(calls[0], ['legacy', document.storagePath, 300]);
  gate.document.scanRequired = true;
  const blocked = fixture({ gate });
  assert.equal((await blocked.handler(post)).statusCode, 423);
  assert.equal(blocked.calls[0][1].p_reason, 'quarantined');
});
