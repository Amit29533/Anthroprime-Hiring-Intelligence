import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Availability, Profile;
test.before(async () => {
  Availability = (await load('/src/CandidateAvailability.jsx')).CandidateAvailability;
  Profile = (await load('/src/PagedRepository.jsx')).PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
const current = {
  token: 'a'.repeat(32),
  notice: 30,
  earliestStart: null,
  activeStatus: 'Active',
  mode: 'Hybrid',
};
const page = (overrides = {}) => ({
  candidateId: 'one',
  current: { ...current },
  rows: [],
  more: false,
  offset: 0,
  ...overrides,
});
test('availability preserves failed drafts and acknowledgement retries while distinguishing zero from unknown', async () => {
  const calls = [],
    updated = [];
  let lost = true;
  await mount(Availability, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    onUpdated: (value) => updated.push(value),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_candidate_availability') return page();
      if (lost) {
        lost = false;
        throw new Error('Acknowledgement lost. Retry.');
      }
      return page({
        recordedId: args.p_operation,
        replayed: true,
        current: { ...current, ...args.p_observation, token: 'b'.repeat(32) },
        rows: [
          {
            id: args.p_operation,
            candidateId: 'one',
            ...args.p_observation,
            recordedBy: 'recruiter',
            recordedAt: '2026-10-07T12:00:00Z',
          },
        ],
      });
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Record availability update' }));
  fireEvent.change(screen.getByLabelText('Availability notice days'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Availability source'), {
    target: { value: 'Candidate email reply' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Record availability update' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement/);
  assert.equal(screen.getByLabelText('Availability source').value, 'Candidate email reply');
  assert.equal(updated.length, 0);
  fireEvent.submit(screen.getByRole('form', { name: 'Record availability update' }));
  await settle();
  const writes = calls.filter(([name]) => name === 'api_record_candidate_availability');
  assert.equal(writes[0][1].p_operation, writes[1][1].p_operation);
  assert.equal(writes[1][1].p_observation.notice, 0);
  assert.equal(writes[1][1].p_observation.earliestStart, null);
  assert.equal(updated[0].notice, 0);
  assert.equal(updated[0].token, undefined);
  assert.match(screen.getByRole('status').textContent, /Previously recorded/);
  assert.ok(screen.getByText(/Source Candidate email reply/));
  assert.equal(screen.queryByRole('form'), null);
});
test('availability viewers traverse bounded history, receive errors, and cannot open the editor', async () => {
  const offsets = [];
  let invalid = true;
  await mount(Availability, {
    candidateId: 'one',
    enabled: true,
    editable: false,
    rpc: async (_name, args) => {
      offsets.push(args.p_offset);
      if (invalid) return page({ rows: Array(26).fill({ id: 'bad' }) });
      return page({
        more: args.p_offset === 0,
        offset: args.p_offset,
        rows: [
          {
            id: String(args.p_offset),
            candidateId: 'one',
            activeStatus: 'Active',
            notice: null,
            source: '',
            observed: null,
            captured: '2026-01-01',
          },
        ],
      });
    },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /invalid response/);
  invalid = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh availability' }));
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Record availability update' }), null);
  assert.ok(screen.getByText(/Source not recorded/));
  fireEvent.click(screen.getByRole('button', { name: 'Next observations' }));
  await settle();
  assert.equal(offsets.at(-1), 25);
  assert.equal(screen.getByRole('button', { name: 'Next observations' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous observations' }));
  await settle();
  assert.equal(offsets.at(-1), 0);
});
test('stale availability keeps the draft until explicit reload, and late saves cannot refresh a closed profile', async () => {
  let first = true,
    reads = 0,
    resolveSave;
  const updated = [];
  await mount(Availability, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    onUpdated: (value) => updated.push(value),
    rpc: async (name) => {
      if (name === 'api_candidate_availability') {
        reads++;
        return page({ current: { ...current, token: (reads === 1 ? 'a' : 'b').repeat(32) } });
      }
      if (first) {
        first = false;
        throw new Error('Candidate changed. Reload availability before saving.');
      }
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Record availability update' }));
  fireEvent.change(screen.getByLabelText('Availability source'), { target: { value: 'Call' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Record availability update' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /changed/);
  assert.equal(screen.getByLabelText('Availability source').value, 'Call');
  fireEvent.click(screen.getByRole('button', { name: 'Reload availability and discard draft' }));
  await settle();
  assert.equal(screen.queryByRole('form'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Record availability update' }));
  fireEvent.change(screen.getByLabelText('Availability source'), { target: { value: 'New call' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Record availability update' }));
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Save availability observation' }).disabled,
    true,
  );
  cleanup();
  resolveSave(page());
  await settle();
  assert.equal(updated.length, 0);
});
test('paged Candidate 360 uses sourced availability without fetching legacy sections or full tables', async () => {
  const calls = [];
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'api_candidate_section'
        ? { candidate: { id: 'one', name: 'Candidate', skills: [] } }
        : page();
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Availability' }));
  await settle();
  assert.ok(screen.getByRole('region', { name: 'Candidate availability' }));
  assert.deepEqual(
    calls.map(([name]) => name),
    ['api_candidate_section', 'api_candidate_availability'],
  );
});
