import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let M;
test.before(async () => {
  M = await load('/src/OperationsConsole.jsx');
});
afterEach(cleanup);
test.after(stopVite);
const policy = {
  enabled: false,
  subjectDays: 30,
  feedbackHours: 48,
  taskGraceHours: 24,
  retentionMonths: 24,
  retentionReference: 'Unapproved — review only',
};
const context = {
  policy,
  policyVersion: 0,
  health: { queues: [{ kind: 'workflow', pending: 2, failed: 1 }] },
  jobs: [],
  more: false,
};
test('demo hides cloud operations; cloud policy and health render without destructive controls', async () => {
  await mount(M.OperationsConsole, {
    isCloud: false,
    rpc: () => {
      throw Error('Unexpected call');
    },
  });
  assert.equal(screen.queryByText('Operations and governance'), null);
  cleanup();
  await mount(M.OperationsConsole, { isCloud: true, scope: 'one', rpc: async () => context });
  await settle();
  assert.match(screen.getByText(/workflow/).closest('p').textContent, /2 pending.*1 failed/);
  assert.equal(screen.queryByRole('button', { name: /Delete|Erase|Send email/ }), null);
  assert.equal(screen.getByLabelText('Task overdue grace (hours)').value, '24');
});
test('lost policy acknowledgement freezes exact operation and payload through explicit retry', async () => {
  const calls = [];
  await mount(M.OperationsConsole, {
    isCloud: true,
    scope: 'one',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      calls.push(structuredClone(args));
      if (calls.length === 1) throw Error('Acknowledgement lost');
      return { policyVersion: 1 };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Retention policy reference'), {
    target: { value: 'Approved reference 2026-10' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save operations policy' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /lost/);
  assert.equal(
    screen.getByLabelText('Retention policy reference').closest('fieldset').disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry pending operation' }));
  await settle();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(screen.queryByRole('button', { name: 'Retry pending operation' }), null);
});
test('selection rejects duplicate IDs and creates a frozen explicit job with no implicit candidate mutation', async () => {
  const calls = [];
  await mount(M.OperationsConsole, {
    isCloud: true,
    scope: 'one',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'detail')
        return {
          job: {
            id: 'job',
            kind: 'report',
            status: 'Pending',
            version: 1,
            body: { reason: 'Reviewed selected report' },
          },
          rows: [],
          counts: { Pending: 1 },
          more: false,
        };
      calls.push(args);
      return { id: 'job', status: 'Pending' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Selected Anthro-IDs'), {
    target: { value: 'ANTHRO-00001 ANTHRO-00001' },
  });
  fireEvent.change(screen.getByLabelText('Job review reason'), {
    target: { value: 'Reviewed selected report' },
  });
  assert.equal(screen.getByRole('button', { name: 'Create bounded job' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Selected Anthro-IDs'), {
    target: { value: 'ANTHRO-00001' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create bounded job' }));
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].p_payload.anthroIds, ['ANTHRO-00001']);
  assert.ok(screen.getByRole('button', { name: 'Process next 10 items' }));
  assert.equal(screen.queryByRole('button', { name: 'Confirm reviewed bulk changes' }), null);
});
test('bulk review displays differences and failed items block confirmation', async () => {
  await mount(M.OperationsConsole, {
    isCloud: true,
    scope: 'one',
    rpc: async (_, args) =>
      args.p_action === 'context'
        ? {
            ...context,
            jobs: [
              {
                id: 'job',
                kind: 'bulk',
                status: 'Review',
                processed: 0,
                total: 1,
                created_at: '2026-10-08',
              },
            ],
          }
        : {
            job: {
              id: 'job',
              kind: 'bulk',
              status: 'Review',
              version: 2,
              body: { reason: 'Reviewed explicit changes' },
            },
            rows: [
              {
                id: 'item',
                state: 'Failed',
                code: 'SOURCE_CHANGED',
                result: {
                  anthroId: 'ANTHRO-00001',
                  owner: 'Before',
                  proposedOwner: 'After',
                  nextAction: 'Call',
                  proposedNextAction: 'Review',
                },
              },
            ],
            counts: { Failed: 1 },
            more: false,
          },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /Bulk owner and next-action preview/ }));
  await settle();
  assert.ok(screen.getByText(/Owner: Before → After/));
  assert.equal(
    screen.getByRole('button', { name: 'Confirm reviewed bulk changes' }).disabled,
    true,
  );
  assert.ok(screen.getByRole('button', { name: 'Re-prepare failed or stale items' }));
});
test('redacted health export requires an audited receipt and offers an explicit download', async () => {
  const downloads = [];
  const evidence = { scope: 'Current workspace counts', queues: [], destructiveExecution: false };
  await mount(M.OperationsConsole, {
    isCloud: true,
    scope: 'one',
    download: (v) => downloads.push(v),
    rpc: async (_, args) => (args.p_action === 'context' ? context : evidence),
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare redacted health evidence' }));
  await settle();
  assert.equal(downloads.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Download operations evidence' }));
  assert.deepEqual(downloads, [evidence]);
});
test('SLA quiet windows suppress notices while preserving bounded review and personal preferences', async () => {
  const writes = [];
  const page = {
    rows: [{ kind: 'task', id: 'task', candidateId: 'candidate', deadline: '2026-10-07' }],
    more: false,
    counts: { task: 1 },
    preferences: { enabled: true, quietStart: 22, quietEnd: 6 },
    policyEnabled: true,
    quiet: true,
    noticeEnabled: false,
  };
  const opened = [];
  await mount(M.SlaWorklist, {
    scope: 'one',
    onOpen: (row) => opened.push(row),
    rpc: async (_, args) => {
      if (args.p_save) writes.push(args);
      return page;
    },
  });
  await settle();
  assert.equal(screen.queryByRole('status'), null);
  assert.ok(screen.getByText(/quiet for this UTC hour/));
  fireEvent.click(screen.getByRole('button', { name: 'Open candidate for task' }));
  assert.deepEqual(opened, ['candidate']);
  fireEvent.click(screen.getByRole('button', { name: 'Save internal notice preferences' }));
  await settle();
  assert.deepEqual(writes[0].p_preferences, page.preferences);
});
