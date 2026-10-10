import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Scorecards, Profile;
test.before(async () => {
  Scorecards = (await load('/src/CandidateScorecards.jsx')).CandidateScorecards;
  Profile = (await load('/src/PagedRepository.jsx')).PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
const template = {
  id: 'rubric',
  name: 'Technical review',
  description: 'Observe capability',
  version: 1,
  validityDays: 180,
  rubric: [
    { id: 'technical', label: 'Technical', weight: 70, maxScore: 5 },
    { id: 'communication', label: 'Communication', weight: 30, maxScore: 5 },
  ],
};
const page = (extra = {}) => ({
  candidateId: 'one',
  rows: [],
  more: false,
  templates: [template],
  templatesMore: false,
  ...extra,
});
function fill() {
  fireEvent.change(screen.getByLabelText('Scorecard rubric'), { target: { value: 'rubric:1' } });
  fireEvent.change(screen.getByLabelText('Score Technical'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Score Communication'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Scorecard evidence'), {
    target: { value: 'Observed reasoning and communication during review' },
  });
}
test('scorecards preview weighted results, preserve failed drafts and reuse the receipt operation', async () => {
  const writes = [];
  let first = true,
    saved = null;
  await mount(Scorecards, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    rpc: async (name, args) => {
      if (name === 'api_candidate_scorecards') return page({ rows: saved ? [saved] : [] });
      writes.push(args);
      if (first) {
        first = false;
        throw new Error('Acknowledgement lost');
      }
      saved = {
        id: args.p_operation,
        title: template.name,
        score: 86,
        date: args.p_date,
        evidence: args.p_evidence,
        templateSnapshot: template,
        rubricScores: args.p_scores,
        recordedBy: 'actual-actor',
        recordedAt: '2026-10-07T10:00:00Z',
        validUntil: '2027-04-05',
      };
      return { id: args.p_operation, score: 86 };
    },
  });
  await settle();
  fill();
  assert.match(screen.getByText(/Weighted preview/).textContent, /86\/100/);
  fireEvent.click(screen.getByRole('button', { name: 'Submit sealed scorecard' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  assert.equal(screen.getByLabelText('Score Technical').value, '4');
  fireEvent.click(screen.getByRole('button', { name: 'Submit sealed scorecard' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.deepEqual(writes[1].p_scores, { technical: 4, communication: 5 });
  assert.equal(writes[1].p_template_version, 1);
  assert.equal('recordedBy' in writes[1], false);
  assert.match(screen.getByText(/Author actual-actor/).textContent, /Recorded/);
});
test('rubric conflicts retain evidence and require explicit reload and rescoring', async () => {
  let changed = false;
  await mount(Scorecards, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    rpc: async (name) => {
      if (name === 'api_candidate_scorecards')
        return page({ templates: [{ ...template, version: changed ? 2 : 1 }] });
      changed = true;
      throw new Error('Rubric changed. Refresh and review the current version.');
    },
  });
  await settle();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Submit sealed scorecard' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Rubric changed/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh scorecards' }));
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Submit sealed scorecard' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload current rubric' }));
  await settle();
  assert.equal(screen.getByLabelText('Score Technical').value, '');
  assert.match(screen.getByLabelText('Scorecard evidence').value, /Observed reasoning/);
  assert.match(screen.getByText(/Draft rubric:/).textContent, /v2/);
});
test('viewers see bounded scorecards without submit controls and paged Candidate 360 uses the dedicated RPC', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'api_candidate_scorecards') return page({ more: true });
    if (name === 'api_candidate_section')
      return { candidate: { id: 'one', name: 'Candidate', anthroId: 'ANTHRO-00001' } };
    if (name === 'api_candidate_quick_context') return { fingerprint: 'x', owners: [], tasks: [] };
    throw new Error('Unexpected full repository read');
  };
  await mount(Scorecards, { candidateId: 'one', enabled: true, editable: false, rpc });
  await settle();
  assert.equal(screen.queryByRole('form', { name: 'Record candidate scorecard' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Next scorecard page' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_offset, 50);
  cleanup();
  await mount(Profile, { candidateId: 'one', onClose: () => {}, rpc });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'More sections' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Scorecards', exact: true }));
  await settle();
  assert.ok(screen.getByRole('heading', { name: 'Rubric scorecards' }));
  assert.equal(
    calls.some(
      ([name, args]) => name === 'api_candidate_section' && args.p_section === 'scorecards',
    ),
    false,
  );
});
