import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Journey, Assigned, ReadinessReport;
test.before(async () => {
  const m = await load('/src/DemandJourney.jsx');
  Journey = m.DemandJourney;
  Assigned = m.AssignedDemandJourney;
  ReadinessReport = m.DemandReadinessReport;
});
afterEach(cleanup);
test.after(stopVite);
const body = {
  requirements: [{ id: 'years', kind: 'experience', name: 'Relevant experience', minimum: 3 }],
  kit: [{ id: 'technical', label: 'Technical', weight: 100 }],
  threshold: 80,
  assessmentDays: 90,
  reviewers: 1,
  requireReadyForSubmission: true,
};
const person = { id: 'one', name: 'First candidate', anthroId: 'ANTHRO-00001' };
const base = {
  head: 'a'.repeat(32),
  configuration: { version: 1, body },
  state: 'Not validated',
  validatedReady: false,
  candidate: person,
  checks: [
    { id: 'years', name: 'Relevant experience', status: 'unknown', reason: 'No current evidence' },
  ],
  evaluations: [],
  history: [],
  claims: [],
  gaps: [],
  evaluators: [],
  editors: [{ id: 'editor', label: 'Editor' }],
};
function rpcReads(name, args) {
  if (name !== 'api_demand_journey') throw new Error('Unexpected API');
  if (args.p_action === 'shortlist')
    return {
      rows: [{ ...person, state: 'Not validated', validatedReady: false, checks: base.checks }],
      more: false,
    };
  if (args.p_action === 'report')
    return { reviewedPopulation: 1, validatedReady: 0, hardRequirementsSatisfied: 0 };
  return structuredClone(base);
}
test('sourced claims require explicit confirmation and failed acknowledgement retries preserve the exact operation', async () => {
  const writes = [];
  let lost = true;
  await mount(Journey, {
    demand: { id: 'demand', skills: ['SQL'] },
    rpc: async (name, args) => {
      if (args.p_action === 'claim') {
        writes.push(args);
        if (lost) {
          lost = false;
          throw new Error('Acknowledgement lost');
        }
        return { recordedId: args.p_operation, replayed: true };
      }
      return rpcReads(name, args);
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review demand evidence for ANTHRO-00001' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Record sourced eligibility evidence' }));
  assert.equal(
    screen.getByLabelText('I reviewed the source and confirm this evidence').checked,
    false,
  );
  fireEvent.change(screen.getByLabelText('Journey source'), {
    target: { value: 'Employment evidence reviewed' },
  });
  fireEvent.change(screen.getByLabelText('Journey value'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed claim' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement/);
  assert.equal(screen.getByLabelText('Journey source').value, 'Employment evidence reviewed');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed claim' }));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_payload.confirmed, false);
  assert.equal(writes[0].p_payload.value, 5);
});
test('blind scorecards preserve draft and acknowledgement operation across focus checks and hide controls after revocation', async () => {
  let revoked = false,
    lost = true;
  const writes = [];
  await mount(Assigned, {
    rpc: async (name, args) => {
      assert.equal(name, 'api_assigned_demand_journey');
      if (revoked) throw new Error('Assignment unavailable');
      if (args.p_operation) {
        writes.push(args);
        if (lost) {
          lost = false;
          throw new Error('Lost response');
        }
        return { score: 90 };
      }
      return args.p_cycle
        ? {
            head: 'a'.repeat(32),
            kit: body.kit,
            candidate: person,
            configurationVersion: 1,
            ownEvaluation: null,
            closed: false,
          }
        : { rows: [{ id: 'cycle', demand_title: 'Engineer' }], more: false };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Open demand assessment' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Score Technical'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText('Evidence Technical'), {
    target: { value: 'Reviewed technical exercise' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Seal independent scorecard' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost response/);
  fireEvent(window, new window.Event('focus'));
  await settle();
  assert.equal(screen.getByLabelText('Evidence Technical').value, 'Reviewed technical exercise');
  fireEvent.click(screen.getByRole('button', { name: 'Seal independent scorecard' }));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(screen.queryByRole('button', { name: 'Seal independent scorecard' }), null);
  revoked = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh assigned demand access' }));
  await settle();
  assert.equal(screen.queryByRole('form', { name: 'Blind demand scorecard' }), null);
  assert.equal(screen.queryByText(/First candidate/), null);
  assert.match(screen.getByRole('alert').textContent, /unavailable/);
});
test('failed configuration keeps its reviewed kit and allows an explicit version refresh', async () => {
  const calls = [];
  let head = 'a'.repeat(32);
  await mount(Journey, {
    demand: { id: 'demand', skills: ['SQL'] },
    rpc: async (name, args) => {
      if (args.p_action === 'configure') {
        calls.push(args);
        throw new Error('Evidence changed; review new version');
      }
      return {
        ...rpcReads(name, args),
        ...(args.p_action === 'context' || !args.p_action ? { head } : {}),
      };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review requirements and interview kit' }));
  fireEvent.change(screen.getByLabelText('Criterion 1 label'), {
    target: { value: 'SQL interview' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed configure' }));
  await settle();
  assert.equal(screen.getByLabelText('Criterion 1 label').value, 'SQL interview');
  head = 'b'.repeat(32);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh version and keep draft' }));
  await settle();
  assert.equal(screen.getByLabelText('Criterion 1 label').value, 'SQL interview');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed configure' }));
  await settle();
  assert.equal(calls[1].p_head, head);
  assert.notEqual(calls[0].p_operation, calls[1].p_operation);
});

test('readiness reports preserve failed export receipts and expose coverage without viewer export', async () => {
  const writes = [];
  const snapshot = {
    reviewedPopulation: 1000,
    validatedReady: 2,
    hardRequirementsSatisfied: 3,
    bounded: true,
    cohorts: {
      periodDays: 90,
      startedAssessmentCycles: 8,
      coverage: 'Recorded journey events only',
    },
  };
  const rpc = async (name, args) => {
    if (name === 'api_demand_readiness_report') return { head: 'a'.repeat(32), snapshot };
    writes.push(args);
    throw new Error('Export acknowledgement lost');
  };
  await mount(ReadinessReport, {
    demands: [{ id: 'one', title: 'Engineer' }],
    role: 'recruiter',
    rpc,
  });
  await settle();
  assert.ok(screen.getByText(/Population limited to the first 1,000/));
  fireEvent.click(screen.getByRole('button', { name: 'Export audited readiness snapshot' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /acknowledgement lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Export audited readiness snapshot' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.equal(writes[0].p_head, writes[1].p_head);
  cleanup();
  await mount(ReadinessReport, {
    demands: [{ id: 'one', title: 'Engineer' }],
    role: 'viewer',
    rpc,
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Export audited readiness snapshot' }), null);
});
