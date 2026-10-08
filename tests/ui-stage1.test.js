import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  mount,
  cleanup,
  stopVite,
  screen,
  fireEvent,
  settle,
  React,
  act,
} from './ui-harness.js';
let Facts, Duplicates, Assigned;
test.before(async () => {
  Facts = (await load('/src/CandidateFacts.jsx')).CandidateFacts;
  Duplicates = (await load('/src/DuplicateReview.jsx')).DuplicateReview;
  Assigned = (await load('/src/AssignedWork.jsx')).AssignedWork;
});
afterEach(cleanup);
test.after(stopVite);
const page = (kind = 'employment', extra = {}) => ({
  candidateId: 'one',
  kind,
  head: 'a'.repeat(32),
  current: { company: 'Employer', title: 'Engineer', location: 'Pune', engagement: 'Permanent' },
  rows: [],
  latestConfirmed: null,
  more: false,
  ...extra,
});
test('fact confirmation and current application are explicit and acknowledgement retries keep the same operation', async () => {
  const writes = [];
  let lost = true;
  await mount(Facts, {
    candidateId: 'one',
    kind: 'employment',
    enabled: true,
    editable: true,
    rpc: async (name, args) => {
      if (name === 'api_candidate_facts') return page();
      writes.push(args);
      if (lost) {
        lost = false;
        throw new Error('Receipt lost');
      }
      return page('employment', {
        recordedId: args.p_operation,
        replayed: true,
        rows: [{ id: args.p_operation, ...args.p_details, verification: 'observed' }],
      });
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Record employment fact' }));
  assert.equal(
    screen.getByLabelText('I reviewed the source and confirm this observation').checked,
    false,
  );
  assert.equal(
    screen.getByLabelText('Apply this observation to the current profile').checked,
    false,
  );
  fireEvent.change(screen.getByLabelText('Source or evidence reference'), {
    target: { value: 'Candidate letter' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Record employment fact' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Receipt lost/);
  assert.equal(screen.getByLabelText('Source or evidence reference').value, 'Candidate letter');
  fireEvent.submit(screen.getByRole('form', { name: 'Record employment fact' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.equal(writes[1].p_confirmed, false);
  assert.equal(writes[1].p_apply_current, false);
  assert.equal(writes[1].p_details.startDate, null);
  assert.equal(writes[1].p_details.endDate, null);
  assert.match(screen.getByRole('status').textContent, /Previously recorded/);
  fireEvent.click(screen.getByRole('button', { name: `Correct fact ${writes[0].p_operation}` }));
  assert.equal(
    screen.getByLabelText('I reviewed the source and confirm this observation').checked,
    false,
  );
});
test('a late fact save cannot replace another candidate context', async () => {
  let finish;
  const updates = [];
  const rpc = async (name, args) =>
    name === 'api_candidate_facts'
      ? page('employment', { candidateId: args.p_candidate })
      : new Promise((resolve) => {
          finish = () => resolve(page('employment', { recordedId: args.p_operation }));
        });
  const view = await mount(Facts, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    rpc,
    onUpdated: (v) => updates.push(v),
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Record employment fact' }));
  fireEvent.change(screen.getByLabelText('Source or evidence reference'), {
    target: { value: 'Letter' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Record employment fact' }));
  await settle();
  await act(async () =>
    view.rerender(
      React.createElement(Facts, {
        candidateId: 'two',
        enabled: true,
        editable: true,
        rpc,
        onUpdated: (v) => updates.push(v),
      }),
    ),
  );
  await settle();
  finish();
  await settle();
  assert.equal(updates.length, 0);
  assert.equal(screen.queryByRole('status'), null);
});
test('duplicate merging requires reviewed choices and preserves a failed decision for exact retry', async () => {
  const writes = [];
  let lost = true;
  await mount(Duplicates, {
    editable: true,
    rpc: async (name, args) => {
      if (name === 'api_duplicate_queue')
        return {
          rows: [
            {
              a: 'one',
              b: 'two',
              a_name: 'First',
              b_name: 'Second',
              reason: 'Name and employer match',
            },
          ],
          more: false,
        };
      if (name === 'api_duplicate_context')
        return {
          a: { id: 'one', name: 'First' },
          b: { id: 'two', name: 'Second' },
          fields: ['name'],
          events: [],
          head: 'a'.repeat(32),
        };
      writes.push(args);
      if (lost) {
        lost = false;
        throw new Error('Lost response');
      }
      return { status: args.p_status };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review pair' }));
  await settle();
  const merge = screen.getByRole('button', { name: 'Merge B into A' });
  assert.equal(merge.disabled, true);
  fireEvent.change(screen.getByLabelText('Duplicate decision reason'), {
    target: { value: 'Same candidate confirmed by source' },
  });
  fireEvent.click(
    screen.getByLabelText('I reviewed both identities and every selected field for this merge'),
  );
  fireEvent.click(merge);
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost response/);
  fireEvent.click(screen.getByRole('button', { name: 'Merge B into A' }));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
});
test('assigned-access refresh removes cached candidate and evaluation controls after revocation', async () => {
  let revoked = false;
  await mount(Assigned, {
    rpc: async (name, args) => {
      if (revoked) throw new Error('Assignment unavailable');
      return args.p_assignment
        ? {
            candidate: { id: 'one', name: 'Assigned person', skills: ['SQL'] },
            assignment: { id: 'assignment', version: 1, expires: '2026-12-01' },
            rows: [],
            more: false,
          }
        : { rows: [{ id: 'assignment', kind: 'evaluation', target_id: 'one' }], more: false };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Open assignment' }));
  await settle();
  assert.ok(screen.getByRole('form', { name: 'Assigned evaluation' }));
  revoked = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh assigned access' }));
  await settle();
  assert.equal(screen.queryByRole('form', { name: 'Assigned evaluation' }), null);
  assert.equal(screen.queryByText(/Assigned person/), null);
  assert.match(screen.getByRole('alert').textContent, /unavailable/);
});
