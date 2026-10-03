import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/ExecutionJobs.jsx')).ExecutionJobsPanel;
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());
const job = {
  id: 'job1',
  ruleName: 'Ready follow-up',
  entityType: 'candidates',
  entityId: 'candidate1',
  status: 'failed',
  attempts: 5,
  created: '2026-10-03T10:00:00Z',
  lastError: 'Workflow could not complete.',
};
test('admin sees failed jobs and retries through the protected RPC, then filters the queue', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'api_execution_jobs') return { enabled: true, jobs: [job], total: 1 };
    return null;
  };
  await mount(Panel, { isCloud: true, rpc });
  await settle();
  assert.ok(screen.getByText('Server execution enabled'));
  assert.ok(screen.getByText('Workflow could not complete.'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry Ready follow-up' }));
  await settle();
  assert.ok(
    calls.some(([name, args]) => name === 'api_retry_execution_job' && args.p_id === 'job1'),
  );
  fireEvent.change(screen.getByLabelText('Job status'), { target: { value: 'failed' } });
  await settle();
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === 'api_execution_jobs' && args.p_status === 'failed' && args.p_offset === 0,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pause server execution' }));
  await settle();
  assert.ok(
    calls.some(([name, args]) => name === 'api_set_server_execution' && args.p_enabled === false),
  );
});
test('missing migration and failed loads stay visible instead of implying an empty queue', async () => {
  await mount(Panel, {
    isCloud: true,
    rpc: async () => {
      throw new Error('Apply migration 035 to enable server execution.');
    },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /migration 035/);
  assert.equal(screen.queryByText('No jobs found for this filter.'), null);
  assert.equal(screen.queryByRole('button', { name: 'Enable server execution' }), null);
});
test('demo explains server prerequisites without trying to call cloud RPCs', async () => {
  await mount(Panel, {
    isCloud: false,
    rpc: async () => {
      throw new Error('must not be called');
    },
  });
  await settle();
  assert.ok(screen.getByText(/Demo rules continue to run in this browser/));
  assert.equal(screen.queryByRole('button', { name: 'Enable server execution' }), null);
});
test('completed jobs are read-only and empty pagination is truthful', async () => {
  await mount(Panel, { isCloud: true, rpc: async () => ({ enabled: false, jobs: [], total: 0 }) });
  await settle();
  assert.ok(screen.getByText('0–0 of 0'));
  assert.equal(screen.getByRole('button', { name: 'Next jobs' }).disabled, true);
  cleanup();
  await mount(Panel, {
    isCloud: true,
    rpc: async () => ({ enabled: true, jobs: [{ ...job, status: 'completed' }], total: 1 }),
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Retry Ready follow-up' }), null);
});
