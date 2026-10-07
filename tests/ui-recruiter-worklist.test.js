import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Worklist;
test.before(async () => {
  Worklist = (await load('/src/RecruiterWorklist.jsx')).RecruiterWorklist;
});
afterEach(cleanup);
test.after(stopVite);
const row = {
  id: 'task',
  kind: 'tasks',
  title: 'Call candidate',
  candidate_id: 'candidate',
  due: '2026-10-06',
  overdue: true,
  state: false,
  version: 'a'.repeat(64),
};
const page = (rows = [row], more = false) => ({
  rows,
  more,
  counts: { tasks: { pending: 31, overdue: 30, completed: 1 } },
});
test('worklist retries a lost acknowledgement with the same intent and opens the candidate', async () => {
  const calls = [],
    opened = [];
  let first = true,
    done = false;
  await mount(Worklist, {
    editable: true,
    onOpen: (id) => opened.push(id),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_worklist_preferences') return { bucket: 'tasks', horizon: 7 };
      if (name === 'api_recruiter_worklist') return page(done ? [] : [row]);
      if (first) {
        first = false;
        throw new Error('Acknowledgement lost. Retry.');
      }
      done = true;
      return { replayed: true };
    },
  });
  await settle();
  assert.ok(screen.getByText('Tasks: 31 pending, 30 overdue, 1 completed / handled'));
  fireEvent.click(screen.getByRole('button', { name: 'Open candidate' }));
  assert.deepEqual(opened, ['candidate']);
  fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact worklist action' }));
  await settle();
  const writes = calls.filter(([name]) => name === 'api_worklist_action');
  assert.deepEqual(writes[0][1], writes[1][1]);
  assert.ok(screen.getByText('No matching work on this page.'));
});
test('viewer saves personal display settings and pages without mutation controls', async () => {
  const calls = [];
  await mount(Worklist, {
    editable: false,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'api_worklist_preferences'
        ? { bucket: 'tasks', horizon: 14 }
        : page([row], !args.p_offset);
    },
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Complete task' }), null);
  assert.equal(screen.getByLabelText('Upcoming days').value, '14');
  fireEvent.click(screen.getByRole('button', { name: 'Next worklist page' }));
  await settle();
  assert.equal(calls.filter(([name]) => name === 'api_recruiter_worklist').at(-1)[1].p_offset, 25);
  fireEvent.change(screen.getByLabelText('Worklist queue'), { target: { value: 'followups' } });
  await settle();
  assert.equal(calls.filter(([name]) => name === 'api_recruiter_worklist').at(-1)[1].p_offset, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Remember this view' }));
  await settle();
  assert.deepEqual(
    calls.filter(([name, args]) => name === 'api_worklist_preferences' && args?.p_save)[0][1],
    { p_save: true, p_kind: 'followups', p_days: 14 },
  );
});
test('queue failure clears stale rows and never reports an empty successful queue', async () => {
  await mount(Worklist, {
    editable: false,
    rpc: async (name, args) => {
      if (name === 'api_worklist_preferences') return { bucket: 'tasks', horizon: 7 };
      if (args.p_kind === 'followups') throw new Error('Queue unavailable');
      return page();
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Worklist queue'), { target: { value: 'followups' } });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Queue unavailable/);
  assert.equal(screen.queryByText('Call candidate'), null);
  assert.equal(screen.queryByText('No matching work on this page.'), null);
});

test('lost acknowledgement can be retried after the completed task disappears on refresh', async () => {
  const writes = [];
  let committed = false;
  await mount(Worklist, {
    editable: true,
    rpc: async (name, args) => {
      if (name === 'api_worklist_preferences') return { bucket: 'tasks', horizon: 7 };
      if (name === 'api_recruiter_worklist') return page(committed ? [] : [row]);
      writes.push(args);
      if (!committed) {
        committed = true;
        throw new Error('Response lost after commit');
      }
      return { replayed: true };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh worklist' }));
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Complete task' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact worklist action' }));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(screen.queryByRole('button', { name: 'Retry exact worklist action' }), null);
});

test('preferences load failure offers recovery and malformed queues do not claim success', async () => {
  let first = true;
  await mount(Worklist, {
    editable: false,
    rpc: async (name) => {
      if (name === 'api_worklist_preferences') {
        if (first) {
          first = false;
          throw new Error('View unavailable');
        }
        return { bucket: 'tasks', horizon: 7 };
      }
      return { rows: null, counts: {}, more: false };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading view' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /invalid response/);
  assert.equal(screen.queryByText('No matching work on this page.'), null);
});
