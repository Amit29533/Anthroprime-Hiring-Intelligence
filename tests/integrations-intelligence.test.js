import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  publicAddress,
  webhookTarget,
  webhookSignature,
  verifyWebhook,
  deliverWebhook,
  runWebhookBatch,
} from '../netlify/functions/_shared/webhooks.js';
import { providerRequest } from '../netlify/functions/_shared/intelligence.js';
import { createIntelligenceHandler } from '../netlify/functions/intelligence.js';
import { createIntegrationHandler } from '../netlify/functions/integration-candidate.js';
import { localVector } from '../src/intelligence.js';

test('webhook signatures resist tampering and stale replay; target validation blocks internal networks', async () => {
  const secret = 'secret',
    ts = '1800000000',
    body = '{"id":"event"}';
  const signature = webhookSignature(secret, ts, body);
  assert.ok(verifyWebhook(secret, ts, body, signature, Number(ts)));
  assert.ok(!verifyWebhook(secret, ts, body + ' ', signature, Number(ts)));
  assert.ok(!verifyWebhook(secret, ts, body, signature, Number(ts) + 301));
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '2002:7f00:1::1',
    '2001:db8::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('93.184.216.34'), true);
  await assert.rejects(
    webhookTarget('https://example.com', async () => [{ address: '127.0.0.1', family: 4 }]),
    /public/,
  );
  await assert.rejects(webhookTarget('https://user:secret@example.com'), /public HTTPS/);
});

test('delivery pins validated DNS, signs actual bytes and refuses redirects', async () => {
  let options, sent;
  const ok = await deliverWebhook(
    { url: 'https://example.com/events', secret: 'key', event: { id: 'e1' } },
    {
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: (_url, opts, cb) => {
        options = opts;
        const req = new EventEmitter();
        req.end = (body) => {
          sent = body;
          cb({ statusCode: 302, resume() {} });
        };
        return req;
      },
    },
  );
  assert.equal(ok, false);
  options.lookup('example.com', {}, (_error, address) => assert.equal(address, '93.184.216.34'));
  options.lookup('example.com', { all: true }, (_error, addresses) =>
    assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]),
  );
  assert.equal(
    options.headers['Anthroprime-Signature'],
    `v1=${webhookSignature('key', options.headers['Anthroprime-Timestamp'], sent)}`,
  );
});

test('worker records failure without echoing receiver credentials or content', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'worker_claim_webhooks'
        ? { data: [{ id: '1', lease: 'l', secret: 'secret' }] }
        : {};
    },
  };
  assert.equal(
    (
      await runWebhookBatch(client, async () => {
        throw new Error('secret body');
      })
    ).attempted,
    1,
  );
  assert.equal(calls[1][1].p_ok, false);
  assert.ok(!JSON.stringify(calls[1]).includes('secret'));
});

test('optional AI never calls provider when disabled, validates input and records failure', async () => {
  let providerCalls = 0;
  const disabled = createIntelligenceHandler({
    authorize: async () => ({
      supabase: {
        rpc: async () => ({ error: { code: '42501', message: 'External AI is disabled' } }),
      },
    }),
    service: () => ({}),
    provider: async () => {
      providerCalls++;
    },
  });
  assert.equal(
    (await disabled({ httpMethod: 'POST', body: '{"action":"embedding","candidateId":"c1"}' }))
      .statusCode,
    403,
  );
  assert.equal(providerCalls, 0);
  assert.equal((await disabled({ httpMethod: 'POST', body: 'null' })).statusCode, 400);
  const calls = [];
  const failed = createIntelligenceHandler({
    authorize: async () => ({
      supabase: { rpc: async () => ({ data: { id: 'job', text: 'React engineer' } }) },
      user: { id: 'user' },
      membership: { workspace_id: 'workspace' },
    }),
    service: () => ({
      rpc: async (name, args) => {
        calls.push(args);
        return name === 'worker_controlled_workflows'
          ? { data: { allowed: true, generation: 1, embeddingModel: 'text-embedding-3-small' } }
          : {};
      },
    }),
    provider: async () => {
      throw new Error('secret');
    },
  });
  const response = await failed({
    httpMethod: 'POST',
    body: '{"action":"embedding","candidateId":"c1"}',
  });
  assert.equal(response.statusCode, 503);
  assert.ok(!response.body.includes('secret'));
  assert.equal(calls.at(-1).p_failed, true);
});

test('provider uses Responses without response storage and rejects malformed embeddings', async () => {
  let request;
  const result = await providerRequest('draft', 'React engineer', {
    key: 'secret',
    draftModel: 'configured-model',
    fetcher: async (url, options) => {
      request = { url, ...JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          output: [{ content: [{ type: 'output_text', text: 'Review skills' }] }],
        }),
      };
    },
  });
  assert.equal(result.content, 'Review skills');
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 600);
  await assert.rejects(
    providerRequest('embedding', 'React', {
      key: 's',
      fetcher: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, 2] }] }) }),
    }),
    /invalid vector/,
  );
});

test('integration HTTP API requires idempotency key and reports optimistic conflicts', async () => {
  const handler = createIntegrationHandler({
    authorize: async () => ({
      supabase: {
        rpc: async () => ({
          error: { code: '40001', message: 'External record version conflict' },
        }),
      },
    }),
  });
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ source: 'crm', externalId: '1', candidate: { name: 'A' } }),
  };
  assert.equal((await handler(event)).statusCode, 400);
  assert.equal(
    (await handler({ ...event, headers: { 'idempotency-key': 'request-1' } })).statusCode,
    409,
  );
});

test('retrieval evaluation fixtures preserve strong skill matches and deterministic namespace', () => {
  const fixtures = [
    {
      text: 'React TypeScript AWS engineer',
      query: 'React TypeScript',
      other: 'Accountant payroll Excel',
    },
    {
      text: 'Python PostgreSQL backend',
      query: 'Python PostgreSQL',
      other: 'Sales account manager',
    },
  ];
  const cosine = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  for (const f of fixtures)
    assert.ok(
      cosine(localVector(f.query), localVector(f.text)) >
        cosine(localVector(f.query), localVector(f.other)),
    );
  assert.deepEqual(localVector('REACT'), localVector('react'));
  assert.equal(localVector('React').length, 384);
});
