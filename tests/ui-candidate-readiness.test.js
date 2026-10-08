import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Review, Profile;
test.before(async () => {
  Review = (await load('/src/CandidateReadiness.jsx')).CandidateReadiness;
  Profile = (await load('/src/PagedRepository.jsx')).PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
const page = (extra = {}) => ({
  candidateId: 'one',
  fingerprint: 'source',
  headId: null,
  state: 'Not reviewed',
  profileStatus: 'Assessing',
  eligible: false,
  blockers: ['No general assessment'],
  rows: [],
  more: false,
  ...extra,
});

test('Ready needs evidence checks; failed decisions retain evidence and retry the same operation', async () => {
  const writes = [];
  let first = true,
    ready = false;
  await mount(Review, {
    candidateId: 'one',
    enabled: true,
    validator: true,
    rpc: async (name, args) => {
      if (name === 'api_candidate_readiness')
        return page({ eligible: true, blockers: [], state: ready ? 'Ready' : 'Not reviewed' });
      writes.push(args);
      if (first) {
        first = false;
        throw new Error('Acknowledgement lost');
      }
      ready = true;
      return { id: 'decision' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Readiness decision'), { target: { value: 'Ready' } });
  fireEvent.change(screen.getByLabelText('Validator evidence'), {
    target: { value: 'Reviewed current assessment evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record readiness decision' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement/);
  assert.equal(
    screen.getByLabelText('Validator evidence').value,
    'Reviewed current assessment evidence',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Record readiness decision' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.equal(writes[1].p_fingerprint, 'source');
  assert.equal(writes[1].p_head, null);
  assert.match(screen.getByText(/Validated review/).textContent, /Ready.*Assessing/);
});

test('blocked readiness cannot be validated Ready and ordinary readers see bounded history without mutation controls', async () => {
  const calls = [];
  await mount(Review, {
    candidateId: 'one',
    enabled: true,
    validator: false,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return page({
        more: true,
        rows: [
          {
            id: 'old',
            decision: 'Near-ready',
            at: '2026-10-07',
            expires: '2026-11-06',
            reason: 'Gap review pending',
            actor: 'admin',
            candidateId: 'one',
          },
        ],
      });
    },
  });
  await settle();
  assert.ok(screen.getByText('No general assessment'));
  assert.equal(screen.queryByRole('button', { name: 'Record readiness decision' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Next readiness history page' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_offset, 50);
  cleanup();
  await mount(Review, {
    candidateId: 'one',
    enabled: true,
    validator: true,
    rpc: async () => page(),
  });
  await settle();
  assert.equal(screen.getByRole('option', { name: 'Ready', exact: true }).disabled, true);
});

test('paged Candidate 360 loads readiness with its scoped RPC instead of a generic section or complete repository', async () => {
  const calls = [];
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_candidate_readiness') return page();
      if (name === 'api_candidate_section')
        return { candidate: { id: 'one', name: 'Candidate', anthroId: 'ANTHRO-00001' } };
      if (name === 'api_candidate_quick_context')
        return { fingerprint: 'x', owners: [], tasks: [] };
      throw new Error('Unexpected repository read');
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Readiness review', exact: true }));
  await settle();
  assert.ok(screen.getByText('No general assessment'));
  assert.equal(calls.filter(([name]) => name === 'api_candidate_readiness').length, 1);
  assert.equal(
    calls.some(
      ([name, args]) => name === 'api_candidate_section' && args.p_section === 'readiness',
    ),
    false,
  );
});
