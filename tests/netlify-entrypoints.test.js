import test from 'node:test';
import assert from 'node:assert/strict';

const endpoints = [
  'controlled-workflow-run',
  'controlled-workflow-callback',
  'google-oauth-start',
  'google-oauth-callback',
  'google-diagnostic',
  'google-calendar-callback',
  'delivery-sandbox-diagnostic',
  'delivery-sandbox-callback',
];

test('deployed entrypoints select the correct Netlify API and reject unsupported methods', async (t) => {
  for (const name of endpoints)
    await t.test(name, async () => {
      const module = await import(`../netlify/functions/${name}.js`);
      const method = name === 'google-oauth-callback' ? 'POST' : 'GET';
      // Netlify selects its web Request/Response API when a default export exists.
      // Exercise the actual entrypoint, rather than only its dependency-injected factory.
      const result = module.default
        ? await module.default(new Request(`https://fixture.invalid/${name}`, { method }))
        : await module.handler({
            httpMethod: method,
            headers: {},
            body: '',
            queryStringParameters: {},
          });
      if (module.default) {
        assert.ok(result instanceof Response, 'Modern entrypoint must return a web Response');
        assert.equal(result.status, 405);
      } else {
        assert.equal(result.statusCode, 405);
        assert.equal(typeof result.body, 'string');
        assert.equal(new Headers(result.headers).get('cache-control'), 'no-store');
      }
    });
});

test('actual protected entrypoints reject missing credentials or callback verification', async (t) => {
  for (const name of endpoints)
    await t.test(name, async () => {
      const module = await import(`../netlify/functions/${name}.js`);
      const method = name === 'google-oauth-callback' ? 'GET' : 'POST';
      const result = await module.handler({
        httpMethod: method,
        headers: {},
        body: '{}',
        queryStringParameters: {},
      });
      assert.ok([400, 401, 403, 409, 503].includes(result.statusCode), `Denied safely: ${name}`);
      assert.equal(typeof result.body, 'string');
      assert.equal(new Headers(result.headers).get('cache-control'), 'no-store');
    });
});
