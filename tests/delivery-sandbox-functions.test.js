import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  dispatchFictional,
  verifySandboxCallback,
  deliveryCapabilities,
} from '../netlify/functions/_shared/delivery-sandbox.js';
import {
  createDeliverySandboxWorker,
  config,
} from '../netlify/functions/delivery-sandbox-worker.js';
import { createSandboxCallback } from '../netlify/functions/delivery-sandbox-callback.js';
import { createSandboxDiagnostic } from '../netlify/functions/delivery-sandbox-diagnostic.js';
const id = '79000000-0000-4000-8000-000000000021',
  workspace = '79000000-0000-4000-8000-000000000011';
const body = {
  workspace,
  intent: id,
  generation: 1,
  eventId: 'fixture',
  messageId: 'sandbox:' + id,
  type: 'Delivered',
  at: new Date().toISOString(),
};
const secret = 'fictional-key-for-local-tests-only-123456789';
function signed(value = body, now = Date.now()) {
  const raw = JSON.stringify(value),
    timestamp = String(Math.floor(now / 1000));
  return {
    body: raw,
    headers: {
      'x-delivery-timestamp': timestamp,
      'x-delivery-signature': createHmac('sha256', secret)
        .update(timestamp + '.' + raw)
        .digest('hex'),
    },
    httpMethod: 'POST',
  };
}
test('sandbox callbacks require bounded HMAC authentication, freshness and exact normalized identity', () => {
  const request = signed();
  assert.deepEqual(verifySandboxCallback(request.body, request.headers, secret), body);
  assert.equal(deliveryCapabilities.live, false);
  assert.throws(
    () => verifySandboxCallback(request.body + ' ', request.headers, secret),
    /authentication/,
  );
  assert.throws(
    () => verifySandboxCallback(request.body, request.headers, secret, Date.now() + 400000),
    /authentication/,
  );
  assert.throws(() => verifySandboxCallback(request.body, request.headers, 'short'), /configured/);
  for (const override of [{ at: 1 }, { at: '2026' }, { generation: 2147483648 }]) {
    const invalid = signed({ ...body, ...override });
    assert.throws(() => verifySandboxCallback(invalid.body, invalid.headers, secret), /normalized/);
  }
  const arbitrary = signed({ ...body, recipient: 'private@example.com' });
  assert.throws(
    () => verifySandboxCallback(arbitrary.body, arbitrary.headers, secret),
    /normalized/,
  );
});
test('callback endpoint never forwards unauthenticated bodies and conceals worker failures', async () => {
  const calls = [];
  const handler = createSandboxCallback({
    secret: () => secret,
    client: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: { replayed: true } };
      },
    }),
  });
  assert.equal((await handler({ ...signed(), body: 'tampered' })).statusCode, 401);
  assert.equal(calls.length, 0);
  assert.equal((await handler(signed())).statusCode, 200);
  assert.equal(calls[0][0], 'worker_delivery_sandbox');
  assert.deepEqual(calls[0][1].p_payload, body);
  const unavailable = createSandboxCallback({ secret: () => '' });
  assert.equal((await unavailable(signed())).statusCode, 503);
  const failed = createSandboxCallback({
    secret: () => secret,
    client: () => ({
      rpc: async () => ({ error: { message: 'private recipient and server secret' } }),
    }),
  });
  const result = await failed(signed());
  assert.equal(result.statusCode, 409);
  assert.ok(!result.body.includes('server secret'));
});
test('accepted-then-timeout records a fictional receipt before returning ambiguous', async () => {
  const calls = [];
  const client = {
    rpc: async (_, p) => {
      calls.push(p);
      return { data: { outcome: 'accepted' } };
    },
  };
  assert.equal(
    await dispatchFictional(
      client,
      { id, lease: 'lease' },
      { adapter: 'fictional', scenario: 'accepted-timeout' },
    ),
    'ambiguous',
  );
  assert.equal(calls[0].p_action, 'sink');
  assert.ok(!JSON.stringify(calls).includes('recipient'));
});
test('duplicate and reordered fictional events use stable event IDs without transport URLs', async () => {
  for (const scenario of ['duplicate', 'reordered']) {
    const calls = [];
    const client = {
      rpc: async (_, p) => {
        calls.push(p);
        return {
          data: p.p_action === 'sink' ? { outcome: 'accepted', messageId: 'sandbox:' + id } : {},
        };
      },
    };
    assert.equal(
      await dispatchFictional(
        client,
        { id, lease: 'lease' },
        { adapter: 'fictional', scenario, workspace, generation: 1 },
      ),
      'accepted',
    );
    assert.equal(calls.length, 3);
    if (scenario === 'duplicate') assert.deepEqual(calls[1], calls[2]);
    else {
      assert.equal(calls[1].p_payload.type, 'Delivered');
      assert.equal(calls[2].p_payload.type, 'Provider accepted');
      assert.ok(Date.parse(calls[2].p_payload.at) < Date.parse(calls[1].p_payload.at));
    }
  }
});
test('scheduled dispatcher claims one, gates immediately before sink and reconciles separately', async () => {
  const calls = [];
  const client = {
    rpc: async (_, p) => {
      calls.push(p.p_action);
      const data =
        p.p_action === 'claim'
          ? { rows: [{ id, lease: 'lease' }] }
          : p.p_action === 'gate'
            ? { allowed: true, adapter: 'fictional', scenario: 'success' }
            : p.p_action === 'sink'
              ? { outcome: 'accepted' }
              : p.p_action === 'reconcile-list'
                ? { rows: [] }
                : {};
      return { data };
    },
  };
  assert.equal(config.schedule, '*/5 * * * *');
  const result = await (await createDeliverySandboxWorker({ client: () => client })()).json();
  assert.equal(result.examined, 1);
  assert.deepEqual(calls, ['claim', 'gate', 'sink', 'finish', 'reconcile-list']);
});
test('lost sink acknowledgement finishes ambiguous and suppressed final gates never call a sink', async () => {
  for (const allowed of [true, false]) {
    const calls = [];
    const client = {
      rpc: async (_, p) => {
        calls.push(p);
        if (p.p_action === 'sink') throw Error('Remote acknowledgement lost');
        return {
          data:
            p.p_action === 'claim'
              ? { rows: [{ id, lease: 'lease' }] }
              : p.p_action === 'gate'
                ? { allowed, adapter: 'fictional', scenario: 'success' }
                : p.p_action === 'reconcile-list'
                  ? { rows: [] }
                  : {},
        };
      },
    };
    await createDeliverySandboxWorker({ client: () => client })();
    if (allowed)
      assert.equal(calls.find((x) => x.p_action === 'finish').p_payload.outcome, 'ambiguous');
    else assert.ok(!calls.some((x) => x.p_action === 'sink'));
  }
});
test('diagnostic uses current authenticated admin/MFA RPC then server-only presence check', async () => {
  const calls = [];
  const authorize = async () => ({
    user: { id },
    membership: { role: 'admin' },
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { workspace, generation: 1 } };
      },
    },
  });
  const handler = createSandboxDiagnostic({
    authorize,
    secret: () => secret,
    client: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { status: 'Diagnostic recorded' } };
      },
    }),
  });
  const result = await handler({ httpMethod: 'POST' });
  assert.equal(result.statusCode, 200);
  assert.equal(calls[0].args.p_action, 'diagnostic-token');
  assert.equal(calls[1].args.p_payload.callbackConfigured, true);
  assert.ok(!JSON.stringify(calls).includes(secret));
  const denied = createSandboxDiagnostic({
    authorize: async () => ({ membership: { role: 'recruiter' } }),
  });
  assert.equal((await denied({ httpMethod: 'POST' })).statusCode, 403);
});
