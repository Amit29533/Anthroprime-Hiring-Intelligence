import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleOAuthStart } from '../netlify/functions/google-oauth-start.js';
import { createGoogleDiagnostic } from '../netlify/functions/google-diagnostic.js';
import { createGoogleWorker } from '../netlify/functions/google-collaboration-worker.js';
import { createWebhookWorker } from '../netlify/functions/webhook-worker.js';
import { publicError } from '../netlify/functions/_shared/responses.js';
const config = {
  key: 'ab'.repeat(32),
  clientId: 'fixture',
  origin: 'https://fixture.invalid',
  redirect: 'https://fixture.invalid/callback',
};
const ticket = '79000000-0000-4000-8000-000000000001';

test('Google OAuth rejects methods, oversized bytes and nonadmins before reserving a ticket', async () => {
  let calls = 0;
  const endpoint = createGoogleOAuthStart({
    configuration: () => config,
    authorize: async () => {
      calls++;
      return {
        membership: { role: 'recruiter' },
        supabase: {
          rpc: () => {
            throw Error('Must not reserve');
          },
        },
      };
    },
  });
  assert.equal((await endpoint({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await endpoint({ httpMethod: 'POST', body: ' '.repeat(2001) })).statusCode, 400);
  assert.equal(
    (await endpoint({ httpMethod: 'POST', body: '{}', isBase64Encoded: true })).statusCode,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await endpoint({ httpMethod: 'POST', body: JSON.stringify({ kind: 'mailbox' }) })).statusCode,
    403,
  );
  assert.equal(calls, 1);
});

test('Google OAuth binds the reviewed operation and head to a server-issued PKCE ticket', async () => {
  let captured;
  const endpoint = createGoogleOAuthStart({
    configuration: () => config,
    authorize: async () => ({
      membership: { role: 'admin' },
      supabase: {
        rpc: async (name, p) => {
          captured = { name, p };
          return { data: { ticket, kind: 'calendar', account: 'fixture@example.invalid' } };
        },
      },
    }),
  });
  const result = await endpoint({
    httpMethod: 'POST',
    body: JSON.stringify({ kind: 'calendar', operation: ticket, head: 'reviewed-head' }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(captured.p.p_operation, ticket);
  assert.equal(captured.p.p_head, 'reviewed-head');
  const url = new URL(JSON.parse(result.body).url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('Google diagnostic never accesses credentials for a nonadmin or failed current gate', async () => {
  for (const role of ['viewer', 'recruiter', 'assessor', 'sales', 'admin']) {
    let adapterCalls = 0;
    const endpoint = createGoogleDiagnostic({
      authorize: async () => ({
        membership: { role },
        user: { id: ticket },
        supabase: { rpc: async () => ({ error: Error('Sensitive gate failure') }) },
      }),
      adapter: () => {
        adapterCalls++;
      },
    });
    const response = await endpoint({
      httpMethod: 'POST',
      body: JSON.stringify({ kind: 'calendar' }),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(adapterCalls, 0);
    assert.ok(!response.body.includes('Sensitive'));
  }
});

test('scheduled Google and webhook endpoints retain uncertainty and redact worker errors', async () => {
  const unavailable = () => {
    throw Error('fictional secret and candidate identity');
  };
  const google = await createGoogleWorker({ client: unavailable })();
  assert.equal(google.statusCode, 503);
  assert.ok(!google.body.includes('fictional secret'));
  const webhook = await createWebhookWorker({ client: () => ({}), run: unavailable })();
  assert.equal(webhook.status, 503);
  assert.equal(webhook.headers.get('cache-control'), 'no-store');
  assert.ok(!(await webhook.text()).includes('fictional secret'));
  const okay = await createWebhookWorker({
    client: () => ({}),
    run: async () => ({ processed: 2 }),
  })();
  assert.equal(okay.status, 200);
  assert.deepEqual(await okay.json(), { processed: 2 });
});

test('storage failures never put candidate data, signed URLs or credentials into server logs', () => {
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const response = publicError(
      Error('candidate@example.invalid https://storage.invalid/file?secret=credential'),
    );
    assert.equal(response.statusCode, 500);
    assert.deepEqual(logs, [['Document operation failed.', { statusCode: 500 }]]);
    assert.ok(!response.body.includes('credential'));
  } finally {
    console.error = original;
  }
});
