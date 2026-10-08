import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Hub;
test.before(async () => {
  Hub = (await load('/src/IndependentWorkHub.jsx')).default;
});
afterEach(cleanup);
test.after(stopVite);

function response(name, args) {
  if (name === 'api_delivery_sandbox') return { connections: [], rows: [], more: false };
  if (name === 'api_foundation') return { fields: [], views: [], members: [], demands: [] };
  if (name === 'api_test_communications')
    return args.p_action === 'browse'
      ? { rows: [], more: false }
      : {
          transport: 'test-only',
          rows: [],
          templates: [],
          more: false,
          policy: { enabled: false, daily_limit: 3 },
        };
  if (name === 'api_feedback_queue')
    return { rows: [{ id: 'response', clientId: 'client', label: 'Review account' }], more: false };
  if (name === 'api_worklist_preferences') return { bucket: 'tasks', horizon: 7 };
  if (name === 'api_recruiter_worklist') return { rows: [], counts: {}, more: false };
  if (name === 'api_sla_worklist')
    return {
      rows: [{ kind: 'task', id: 'task', candidateId: 'candidate', deadline: '2026-10-07' }],
      counts: {},
      preferences: { enabled: false, quietStart: 0, quietEnd: 0 },
      more: false,
    };
  if (name === 'api_repository_quality')
    return { rows: [], counts: {}, affectedCandidates: 0, nextCursor: null };
  throw Error(`Unexpected RPC ${name}`);
}

test('shared hub wires five live queues and UUID candidate/client navigation for viewers', async () => {
  const calls = [],
    candidates = [],
    clients = [];
  await mount(Hub, {
    isCloud: true,
    role: 'viewer',
    scope: 'one',
    rpc: async (name, args) => {
      calls.push(name);
      return response(name, args);
    },
    onOpen: (id) => candidates.push(id),
    onOpenClient: (id) => clients.push(id),
  });
  await settle(8);
  for (const name of [
    'api_test_communications',
    'api_feedback_queue',
    'api_recruiter_worklist',
    'api_sla_worklist',
    'api_repository_quality',
  ])
    assert.ok(calls.includes(name), name);
  assert.equal(calls.includes('api_anthro_id_capacity'), false);
  assert.equal(screen.queryByRole('button', { name: 'Configure test transport' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Open candidate for task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open account feedback' }));
  assert.deepEqual(candidates, ['candidate']);
  assert.deepEqual(clients, ['client']);
});

test('demo and limited roles never mount internal queues or fetch their data', async () => {
  for (const props of [
    { isCloud: false, role: 'admin' },
    ...['assessor', 'sales', 'client'].map((role) => ({ isCloud: true, role })),
  ]) {
    await mount(Hub, {
      ...props,
      rpc: async () => {
        assert.fail('Internal RPC for excluded surface');
      },
    });
    assert.equal(screen.queryByRole('region', { name: 'Independent feature work queues' }), null);
    cleanup();
  }
});

test('workspace changes remount every queue and discard late prior-workspace replies', async () => {
  let resolveOld;
  const rpc = async (name, args) =>
    name === 'api_feedback_queue'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : response(name, args);
  const view = await mount(Hub, { isCloud: true, role: 'viewer', scope: 'old', rpc });
  await settle();
  view.rerender(
    React.createElement(Hub, {
      isCloud: true,
      role: 'viewer',
      scope: 'new',
      rpc: async (name, args) =>
        name === 'api_feedback_queue' ? { rows: [], more: false } : response(name, args),
    }),
  );
  await settle();
  resolveOld({ rows: [{ id: 'old', label: 'Prior workspace secret' }], more: false });
  await settle();
  assert.equal(screen.queryByText(/Prior workspace secret/), null);
});
