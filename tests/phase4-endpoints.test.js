import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMachineHandler } from '../netlify/functions/machine-api.js';
import { createJobFeedHandler } from '../netlify/functions/approved-job-feed.js';
const token = 'anthro_m_' + 'a'.repeat(64),
  id = '80000000-0000-4000-8000-000000000001';
test('machine gateway hashes credentials, preserves cursor precision and validates writes', async () => {
  const calls = [];
  const handler = createMachineHandler({
    client: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { ok: true } };
      },
    }),
  });
  const event = {
    httpMethod: 'GET',
    headers: { authorization: `Bearer ${token}` },
    queryStringParameters: { action: 'events', after: '9007199254740993' },
  };
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal(calls[0].args.p_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(calls[0].args.p_request.after, '9007199254740993');
  assert.ok(!JSON.stringify(calls).includes(token));
  assert.equal((await handler({ ...event, headers: {} })).statusCode, 401);
  assert.equal((await handler({ ...event, httpMethod: 'POST' })).statusCode, 405);
  assert.equal(
    (
      await handler({
        ...event,
        queryStringParameters: { action: 'events', after: '9223372036854775808' },
      })
    ).statusCode,
    400,
  );
  const write = {
    ...event,
    httpMethod: 'POST',
    queryStringParameters: { action: 'candidate' },
    headers: { ...event.headers, 'idempotency-key': id },
    body: JSON.stringify({ externalId: 'person', body: { name: 'Test' }, version: 0 }),
  };
  assert.equal((await handler(write)).statusCode, 200);
  assert.equal(calls.at(-1).args.p_request.operationId, id);
  assert.equal((await handler({ ...write, body: '{broken' })).statusCode, 400);
  assert.equal((await handler({ ...write, body: 'a'.repeat(40001) })).statusCode, 413);
});
test('machine gateway maps conflicts, scopes, throttling and unavailable service without leaking secrets', async () => {
  const event = {
    httpMethod: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    queryStringParameters: { action: 'events' },
  };
  for (const [code, message, status] of [
    ['40001', 'Version conflict', 409],
    ['42501', 'Secret error', 403],
    ['P0001', 'Machine rate limit exceeded', 429],
  ]) {
    const h = createMachineHandler({
      client: () => ({ rpc: async () => ({ error: { code, message } }) }),
    });
    const result = await h(event);
    assert.equal(result.statusCode, status);
    if (code === '42501') assert.ok(!result.body.includes(message));
  }
  const h = createMachineHandler({
    client: () => {
      throw new Error(token);
    },
  });
  assert.equal((await h(event)).statusCode, 503);
  assert.ok(!(await h(event)).body.includes(token));
});
test('public feed generates attributed relative application links and bounds queries', async () => {
  const h = createJobFeedHandler({
    client: () => ({ rpc: async () => ({ data: { jobs: [{ id, title: 'Role' }], more: false } }) }),
  });
  const event = { httpMethod: 'GET', queryStringParameters: { ws: id, source: 'Community board' } };
  const result = await h(event);
  assert.equal(result.statusCode, 200);
  assert.match(JSON.parse(result.body).jobs[0].applyUrl, /source=Community%20board/);
  assert.match(result.headers['Cache-Control'] || result.headers['cache-control'], /no-store/);
  assert.equal(
    (await h({ ...event, queryStringParameters: { ws: id, source: '<script>' } })).statusCode,
    400,
  );
  assert.equal(
    (await h({ ...event, queryStringParameters: { ws: id, offset: '10001' } })).statusCode,
    400,
  );
  assert.equal((await h({ ...event, httpMethod: 'POST' })).statusCode, 405);
});
