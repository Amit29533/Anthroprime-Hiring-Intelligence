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
  Console = (await load('/src/DeliverySandbox.jsx')).default;
});
afterEach(cleanup);
test.after(stopVite);
const context = {
  connections: [
    {
      kind: 'delivery',
      state: 'enabled',
      generation: 1,
      head: 'connection-head',
      body: {
        owner: 'admin',
        account: 'Fictional fixture',
        purpose: 'Rehearsal only',
        costDecision: 'No external purchase',
        evidence: 'Fictional evidence',
        scenario: 'success',
        secretRef: 'none',
      },
    },
  ],
  rows: [],
  more: false,
  defaultHead: 'empty-head',
};
const preview = {
  head: 'source-head',
  eligible: true,
  preview: {
    recipient: 'fixture@example.invalid',
    subject: 'Fictional delivery exercise',
    text: 'No candidate message is transmitted.',
  },
};
test('reviewed sandbox intent locks source/schedule/operation on lost acknowledgement and retries exactly', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    candidateId: 'person',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'preview') return preview;
      writes.push(args);
      throw Error('Acknowledgement lost');
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Existing communication template UUID'), {
    target: { value: 'template' },
  });
  fireEvent.click(screen.getByText('Preview fictional delivery'));
  await settle();
  assert.ok(screen.getByText(/fixture@example.invalid/));
  fireEvent.click(screen.getByText('Prepare fictional intent'));
  await settle();
  assert.equal(
    screen.getByLabelText('Existing communication template UUID').matches(':disabled'),
    true,
  );
  fireEvent.click(screen.getByText('Retry sandbox request'));
  await settle();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(writes[0].p_head, 'source-head');
  assert.equal(writes[0].p_candidate, 'person');
});
test('administrator readiness records nonsecret references and preserves explicit generation head', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      writes.push(args);
      return { status: 'Recorded' };
    },
    diagnose: async () => ({ status: 'Recorded' }),
  });
  await settle();
  fireEvent.click(screen.getByText('Review Delivery sandbox readiness'));
  fireEvent.click(screen.getByText('Save dependency configuration'));
  await settle();
  assert.equal(writes[0].p_head, 'connection-head');
  assert.equal(writes[0].p_payload.secretRef, 'none');
  assert.ok(!('lastReason' in writes[0].p_payload));
  assert.ok(!screen.queryByLabelText('API key'));
  assert.ok(screen.getByText(/Only the fictional delivery capability/));
});
test('ambiguous outcomes offer reconciliation without resend or cancellation', async () => {
  const row = {
    id: 'intent',
    candidate_id: 'person',
    status: 'Ambiguous',
    attempts: 1,
    generation: 1,
  };
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return { ...context, rows: [row] };
      if (args.p_action === 'history')
        return { rows: [], attempts: [], head: 'current-head', status: 'Ambiguous', more: false };
      writes.push(args);
      return {};
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Review sandbox intent intent'));
  await settle();
  assert.ok(!screen.queryByText('Retry known failed sandbox intent'));
  assert.ok(!screen.queryByText('Cancel pending sandbox intent'));
  fireEvent.change(screen.getByLabelText('Sandbox recovery reason'), {
    target: { value: 'Review uncertain provider outcome' },
  });
  fireEvent.click(screen.getByText('Request sandbox reconciliation'));
  await settle();
  assert.equal(writes[0].p_action, 'request-reconcile');
  assert.equal(writes[0].p_head, 'current-head');
});
test('queue/history are bounded and viewers cannot prepare or configure', async () => {
  const calls = [];
  await mount(Console, {
    isCloud: true,
    role: 'viewer',
    scope: 'one',
    rpc: async (_, args) => {
      calls.push(args);
      return { ...context, more: true };
    },
  });
  await settle();
  assert.ok(!screen.queryByText('Integration readiness catalog'));
  assert.ok(!screen.queryByText('Prepare fictional intent'));
  fireEvent.click(screen.getByText('Next sandbox page'));
  await settle();
  assert.equal(calls.at(-1).p_offset, 25);
  assert.ok(screen.getByText(/Fictional delivery sandbox only/));
});
test('scope changes reject old replies and limited/demo roles do not mount', async () => {
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
        role: 'recruiter',
        scope: 'two',
        rpc: async () => ({ ...context, connections: [] }),
      }),
    ),
  );
  await settle();
  await act(async () => resolve(context));
  await settle();
  assert.ok(!screen.queryByText('Integration readiness catalog'));
  await act(async () =>
    mounted.rerender(
      React.createElement(Console, { isCloud: true, role: 'assessor', scope: 'two' }),
    ),
  );
  await settle();
  assert.ok(!screen.queryByText('Stage 1 dependent integrations'));
});
