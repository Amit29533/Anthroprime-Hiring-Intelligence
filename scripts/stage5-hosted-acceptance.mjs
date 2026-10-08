// Explicitly invoked in a disposable staging workspace, never run by build/test.
// Two real Auth sessions exercise PostgREST concurrency; tokens are never printed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const required = [
  'ANTHRO_ACCEPTANCE_URL',
  'ANTHRO_ACCEPTANCE_ANON_KEY',
  'ANTHRO_ACCEPTANCE_JWT_A',
  'ANTHRO_ACCEPTANCE_JWT_B',
  'ANTHRO_ACCEPTANCE_WORKSPACE',
  'ANTHRO_ACCEPTANCE_IDS',
];
if (
  process.env.ANTHRO_ACCEPTANCE_DISPOSABLE !== 'true' ||
  required.some((key) => !process.env[key])
) {
  throw new Error(
    'Set the documented acceptance variables and explicitly identify a disposable staging workspace. This harness creates retained report jobs and audit receipts.',
  );
}
const endpoint = new URL(process.env.ANTHRO_ACCEPTANCE_URL);
assert.ok(
  endpoint.protocol === 'https:' ||
    (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)),
  'Use HTTPS or a local development endpoint.',
);
const ids = process.env.ANTHRO_ACCEPTANCE_IDS.split(/[\s,;]+/).filter(Boolean);
assert.ok(
  ids.length >= 1 &&
    ids.length <= 10 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => /^ANTHRO-\d{5}$/.test(id)),
  'Choose 1–10 fictional staging Anthro-IDs.',
);
const tokens = [process.env.ANTHRO_ACCEPTANCE_JWT_A, process.env.ANTHRO_ACCEPTANCE_JWT_B];
assert.ok(tokens[0] !== tokens[1], 'Use two independently signed-in administrator sessions.');
async function rpc(session, args) {
  const response = await fetch(new URL('/rest/v1/rpc/api_operations', endpoint), {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: process.env.ANTHRO_ACCEPTANCE_ANON_KEY,
      Authorization: `Bearer ${tokens[session]}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  return { ok: response.ok, body };
}
const contexts = await Promise.all([
  rpc(0, { p_action: 'context' }),
  rpc(1, { p_action: 'context' }),
]);
for (const context of contexts) {
  assert.ok(context.ok, 'Both sessions must pass administrator/MFA checks.');
  assert.equal(
    context.body.workspaceId,
    process.env.ANTHRO_ACCEPTANCE_WORKSPACE,
    'Unexpected workspace; no job was created.',
  );
}
const job = randomUUID();
const startArgs = {
  p_action: 'start',
  p_job: job,
  p_operation: randomUUID(),
  p_payload: {
    kind: 'report',
    anthroIds: ids,
    reason: 'Disposable staging concurrency and recovery acceptance',
  },
};
const started = await rpc(0, startArgs);
assert.ok(started.ok, 'Report creation failed.');
assert.deepEqual(
  (await rpc(0, startArgs)).body,
  started.body,
  'Creation acknowledgement replay changed.',
);
const steps = [0, 1].map(() => ({
  p_action: 'step',
  p_job: job,
  p_version: 1,
  p_operation: randomUUID(),
  p_payload: {},
}));
const races = await Promise.all(steps.map((args, session) => rpc(session, args)));
assert.equal(
  races.filter((r) => r.ok).length,
  1,
  'Exactly one concurrent versioned mutation must succeed.',
);
const winner = races.findIndex((r) => r.ok),
  loser = 1 - winner;
assert.equal(
  races[loser].body.code,
  '40001',
  'The loser must receive an optimistic-version conflict.',
);
assert.deepEqual(
  (await rpc(winner, steps[winner])).body,
  races[winner].body,
  'Lost step acknowledgement must replay exactly.',
);
assert.equal(races[winner].body.status, 'Completed');
const exported = await rpc(winner, {
  p_action: 'export',
  p_job: job,
  p_version: 2,
  p_operation: randomUUID(),
  p_payload: {},
});
assert.ok(exported.ok, 'Completed report export failed.');
assert.equal(exported.body.rows.length, ids.length);
for (const row of exported.body.rows)
  for (const field of ['email', 'phone', 'current', 'expected', 'source_head'])
    assert.equal(field in row, false, 'Unexpected protected projection.');
console.log(
  JSON.stringify({
    passed: true,
    scenarios: [
      'real Auth/MFA administrator RPC',
      'same workspace',
      'create replay',
      'two-session conflict',
      'step replay',
      'redacted export',
    ],
    job,
    identities: ids.length,
    destructiveExecution: false,
    externalDelivery: false,
  }),
);
