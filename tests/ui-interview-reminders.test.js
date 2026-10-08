import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/InterviewReminders.jsx')).InterviewReminders;
});
afterEach(cleanup);
test.after(stopVite);
test('reminders expose enable/pause, bounded pages and explicit retry for failed future interviews', async () => {
  let enabled = false;
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'api_set_interview_reminders') {
      enabled = args.p_enabled;
      return { enabled };
    }
    if (name === 'api_retry_interview_reminder') return true;
    return {
      enabled,
      lastRun: null,
      total: 51,
      rows: [
        {
          id: 'receipt',
          interviewId: 'interview',
          scheduledAt: '2099-01-01T10:00:00Z',
          status: 'failed',
          lastError: 'Task creation failed (SQLSTATE P0001)',
        },
      ],
    };
  };
  await mount(Panel, { isCloud: true, rpc });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Enable interview reminders' }));
  await settle();
  assert.deepEqual(calls.find(([name]) => name === 'api_set_interview_reminders')[1], {
    p_enabled: true,
  });
  assert.ok(screen.getByRole('button', { name: 'Pause interview reminders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next reminders' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_offset, 50);
  fireEvent.click(screen.getByRole('button', { name: 'Retry reminder' }));
  await settle();
  assert.deepEqual(calls.find(([name]) => name === 'api_retry_interview_reminder')[1], {
    p_id: 'receipt',
  });
  assert.ok(screen.getByText(/No candidate email is sent/));
});
