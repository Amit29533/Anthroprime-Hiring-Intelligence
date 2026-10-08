import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  React,
  act,
  load,
  mount,
  cleanup,
  stopVite,
  screen,
  fireEvent,
  settle,
} from './ui-harness.js';
let Console;
test.before(async () => {
  Console = (await load('/src/ProcessingRecovery.jsx')).default;
});
afterEach(cleanup);
test.after(stopVite);
const context = {
  policies: [
    {
      kind: 'processing',
      state: 'configured',
      generation: 2,
      head: 'generation-two',
      healthy: false,
      body: {
        owner: 'fixture-admin',
        account: 'Private fixture',
        purpose: 'Fictional native acceptance',
        costDecision: 'Existing host quota reviewed',
        evidence: 'Fictional controlled evidence',
        requireOcr: true,
        keyRef: 'custody:test',
        destinationRef: 'worker:test',
        rpoHours: 24,
        rtoMinutes: 120,
      },
    },
  ],
  defaultHead: 'empty-head',
  paused: false,
  queue: { imports: 3, attachments: 1 },
};
test('Stage 2 configuration retries the exact reviewed generation and operation after a lost response', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'history') return { rows: [], more: false };
      writes.push(args);
      throw Error('Acknowledgement lost');
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Review existing Stage 2 configuration'));
  fireEvent.click(screen.getByText('Save Stage 2 configuration'));
  await settle();
  assert.equal(screen.getByLabelText('Stage 2 capability').matches(':disabled'), true);
  fireEvent.click(screen.getByText('Retry Stage 2 request'));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_head, 'generation-two');
  assert.equal(writes[0].p_payload.keyRef, 'custody:test');
  assert.ok(!screen.queryByLabelText('API key'));
  fireEvent.click(screen.getByText('Discard Stage 2 retry'));
  await settle();
  assert.equal(screen.getByLabelText('Stage 2 capability').matches(':disabled'), false);
});
test('lockdown has no browser unlock or invented evidence and bounded history uses explicit offsets', async () => {
  const calls = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (_, args) => {
      calls.push(args);
      return args.p_action === 'context' ? { ...context, paused: true } : { rows: [], more: true };
    },
  });
  await settle();
  assert.ok(screen.getByText(/Only the server operator can unlock/));
  assert.equal(screen.getByText('Save Stage 2 configuration').disabled, true);
  assert.ok(!screen.queryByText('Unlock'));
  fireEvent.click(screen.getByText('Next Stage 2 evidence'));
  await settle();
  assert.equal(calls.at(-1).p_offset, 25);
  assert.equal(calls.at(-1).p_action, 'history');
});
test('Stage 2 hides nonadmin/demo access and drops old tenant replies on scope changes', async () => {
  let resolve;
  const old = new Promise((r) => {
    resolve = r;
  });
  const mounted = await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async () => old,
  });
  await act(async () =>
    mounted.rerender(
      React.createElement(Console, {
        isCloud: true,
        role: 'admin',
        scope: 'two',
        rpc: async (_, args) =>
          args.p_action === 'context'
            ? { ...context, policies: [], queue: { imports: 0, attachments: 0 } }
            : { rows: [], more: false },
      }),
    ),
  );
  await settle();
  await act(async () => resolve(context));
  await settle();
  assert.ok(screen.getByText(/Quarantined import queue: 0/));
  assert.ok(!screen.queryByText(/Generation: 2/));
  await act(async () =>
    mounted.rerender(
      React.createElement(Console, {
        isCloud: true,
        role: 'recruiter',
        scope: 'two',
        rpc: () => assert.fail('Nonadmin RPC'),
      }),
    ),
  );
  assert.ok(!screen.queryByText('Stage 2 private processing and recovery'));
});
