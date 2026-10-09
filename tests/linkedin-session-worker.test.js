import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, WorkerError } from '../linkedin-session-worker/server.mjs';
const token = 'w'.repeat(32);
const config = { token, liAt: 'cookie', minIntervalMs: 0, dailyLimit: 2, budgetMs: 1000 };
const call = async (
  server,
  {
    auth = `Bearer ${token}`,
    body = '{"profile":"https://www.linkedin.com/in/priya-sharma"}',
    path = '/profile',
  } = {},
) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: path === '/health' ? 'GET' : 'POST',
    headers: { Authorization: auth },
    body: path === '/health' ? undefined : body,
  });
  return { status: response.status, body: await response.json() };
};
test('session worker requires the shared token, bounds input, enforces a daily cap and never echoes the cookie', async () => {
  const seen = [];
  const server = createServer(config, async (profile) => {
    seen.push(profile);
    return { profile, name: 'Priya Sharma' };
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await call(server, { auth: 'Bearer wrong' })).status, 401);
    assert.equal((await call(server, { body: 'x'.repeat(2000) })).status, 413);
    assert.equal((await call(server, { body: 'not json' })).status, 400);
    assert.equal(seen.length, 0);
    const ok = await call(server);
    assert.equal(ok.status, 200);
    assert.equal(JSON.stringify(ok.body).includes('cookie'), false);
    assert.equal((await call(server)).status, 200);
    assert.equal((await call(server)).status, 429);
    assert.deepEqual((await call(server, { path: '/health' })).body, {
      ok: true,
      configured: true,
    });
  } finally {
    server.close();
  }
});
test('session worker reports blocked sessions as 409 without retrying', async () => {
  const server = createServer({ ...config, dailyLimit: 5 }, async () => {
    throw new WorkerError(409, 'session-blocked', 'Refresh the cookie.');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await call(server);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'session-blocked');
  } finally {
    server.close();
  }
});
