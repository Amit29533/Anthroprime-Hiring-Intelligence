import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  React,
  load,
  mount,
  cleanup,
  stopVite,
  screen,
  fireEvent,
  settle,
  makeSeed,
} from './ui-harness.js';
import { extractCvEvidence, evidenceReady, groupCvEvidence } from '../src/cvEvidence.js';
let Workbench, Enterprise, Cv, Assessment, Enrichment, Interview, Placement;
test.before(async () => {
  Workbench = (await load('/src/CompletionWorkbench.jsx')).default;
  Enterprise = (await load('/src/EnterpriseOperations.jsx')).default;
  Cv = (await load('/src/CvEvidenceReview.jsx')).CvEvidenceReview;
  const w = await load('/src/Workflows.jsx');
  Assessment = w.AssessmentForm;
  Enrichment = w.EnrichmentForm;
  Interview = (await load('/src/Interviews.jsx')).ScheduleModal;
  Placement = (await load('/src/Clients.jsx')).PlacementForm;
});
afterEach(cleanup);
test.after(stopVite);
const context = { definitions: [], emptyHead: 'empty', enrollments: [], more: false };
const result = {
  head: 'historical-head',
  rows: [{ label: 'Ready', events: 2, candidates: 1 }],
  coverageStartedAt: '2026-10-01',
  cohort: { newCandidates: 1, convertedCandidates: 1, targetState: 'Ready' },
  criteria: { source: 'lifecycle', group: 'state', from: '2026-10-08', to: '2026-10-08' },
  notice: 'Recorded events only',
};
const rpc = async (name, args) => (args.p_action === 'history' ? result : context);

test('malformed imported CV groupings can be rebuilt without losing excerpts or approving claims', async () => {
  const original = extractCvEvidence('Experience\nEngineer 2020 – Present');
  for (const records of [
    false,
    null,
    0,
    { bad: true },
    [null],
    [{ label: 42 }],
    [{ ...groupCvEvidence(original).records[0], sourceLines: null }],
  ]) {
    let value;
    function Host() {
      const [state, setState] = React.useState({ ...original, records });
      value = state;
      return React.createElement(Cv, { value: state, onChange: setState });
    }
    await mount(Host);
    assert.equal(evidenceReady(value), false);
    assert.match(screen.getByRole('alert').textContent, /invalid structure/);
    fireEvent.click(screen.getByText('Rebuild cited CV records'));
    assert.deepEqual(value.items, original.items);
    assert.deepEqual(value.records[0].sourceLines, [2]);
    assert.equal(evidenceReady(value), false);
    assert.equal(screen.queryByRole('alert'), null);
    cleanup();
  }
  await mount(Cv, { value: { ...original, records: [null] } });
  assert.ok(screen.getByRole('alert'));
  assert.equal(screen.queryByText('Rebuild cited CV records'), null);
});

test('invalid dates remain editable while malformed excerpts block review safely', async () => {
  const original = groupCvEvidence(extractCvEvidence('Experience\nEngineer 2020 – Present'));
  function Host() {
    const [value, onChange] = React.useState({
      ...original,
      records: [{ ...original.records[0], start: '2026-02-30' }],
    });
    return React.createElement(Cv, { value, onChange });
  }
  await mount(Host);
  assert.ok(screen.getByRole('alert'));
  assert.equal(screen.getByLabelText('CV record reviewed 1').disabled, true);
  fireEvent.change(screen.getByLabelText('CV record start 1'), { target: { value: '2020' } });
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(screen.getByLabelText('CV record reviewed 1').disabled, false);
  cleanup();
  await mount(Cv, { value: { items: [null] } });
  assert.match(screen.getByRole('alert').textContent, /Re-extract/);
  assert.equal(evidenceReady({ items: [{ reviewed: true }] }), false);
});

test('completion controls respect local, external, viewer and administrator scope', async () => {
  for (const props of [
    { isCloud: false, role: 'admin' },
    { isCloud: true, role: 'assessor' },
    { isCloud: true, role: 'client' },
    { isCloud: true, role: 'sales' },
  ]) {
    await mount(Workbench, { ...props, rpc });
    assert.equal(screen.queryByText('Reports, campaigns and operational health'), null);
    cleanup();
  }
  await mount(Workbench, { isCloud: true, role: 'viewer', rpc });
  await settle();
  fireEvent.click(screen.getByText('Run historical report'));
  await settle();
  assert.ok(screen.getByText('Ready'));
  assert.equal(screen.queryByText('Record aggregate export'), null);
  assert.equal(screen.queryByText('Save historical criteria'), null);
  assert.equal(screen.queryByText('Operational health'), null);
});

test('a lost export acknowledgment freezes inputs and retries its identical audited operation', async () => {
  const writes = [],
    downloads = [];
  await mount(Workbench, {
    isCloud: true,
    role: 'recruiter',
    download: (...args) => downloads.push(args),
    rpc: async (name, args) => {
      if (args.p_action === 'history-export') {
        writes.push(args);
        if (writes.length === 1) throw new Error('Lost acknowledgment');
        return { ...result, status: 'Aggregate export recorded', operation: args.p_operation };
      }
      return rpc(name, args);
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Run historical report'));
  await settle();
  fireEvent.click(screen.getByText('Record aggregate export'));
  await settle();
  assert.ok(screen.getByText('Lost acknowledgment'));
  assert.equal(screen.getByLabelText('UTC from').closest('fieldset').disabled, true);
  fireEvent.click(screen.getByText('Retry exact completion operation'));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  fireEvent.click(screen.getByText('Download recorded aggregate report'));
  assert.equal(downloads.length, 1);
  assert.match(downloads[0][0], /historical-head/);
  fireEvent.change(screen.getByLabelText('Group historical events'), {
    target: { value: 'month' },
  });
  assert.equal(screen.queryByText('Download recorded aggregate report'), null);
});

test('Strict Mode previews every campaign step and queues only the reviewed candidate and schedule', async () => {
  const calls = [];
  const c = {
    ...context,
    definitions: [
      {
        id: 'def',
        kind: 'campaign',
        name: 'Availability',
        version: 1,
        body: { enabled: true, steps: [{ template: 'tpl', day: 0 }] },
        head: 'definition-head',
      },
    ],
  };
  const Strict = (props) =>
    React.createElement(React.StrictMode, null, React.createElement(Workbench, props));
  await mount(Strict, {
    isCloud: true,
    role: 'recruiter',
    initialTab: 'campaigns',
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_test_communications')
        return args.p_action === 'browse'
          ? {
              rows: [{ id: 'person', name: 'Fictional Person', anthroId: 'ANTHRO-00001' }],
              more: false,
            }
          : { templates: [] };
      if (args.p_action === 'campaign-preview')
        return {
          head: 'reviewed',
          name: 'Availability',
          transport: 'test-only',
          eligible: true,
          steps: [
            {
              availableAt: '2026-10-08',
              source: {
                eligible: true,
                preview: {
                  recipient: 'person@example.invalid',
                  purpose: 'recruiting-contact',
                  subject: 'Fictional greeting',
                  text: 'Fictional text',
                },
              },
            },
          ],
        };
      if (args.p_action === 'campaign-enroll') return { status: 'Test campaign queued' };
      return c;
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Current enabled campaign'), { target: { value: 'def' } });
  fireEvent.change(screen.getByLabelText('Campaign candidate'), { target: { value: 'person' } });
  fireEvent.click(screen.getByText('Review all campaign steps'));
  await settle();
  assert.ok(screen.getByText('Fictional greeting'));
  fireEvent.click(screen.getByText('Queue reviewed test campaign'));
  await settle();
  const preview = calls.find(([, p]) => p.p_action === 'campaign-preview')[1],
    write = calls.find(([, p]) => p.p_action === 'campaign-enroll')[1];
  assert.deepEqual(write.p_payload, preview.p_payload);
  assert.equal(write.p_head, 'reviewed');
  assert.equal(screen.queryByText('Configure campaign'), null);
});

test('enterprise queue search reaches the server with pagination reset', async () => {
  const calls = [];
  await mount(Enterprise, {
    isCloud: true,
    role: 'admin',
    rpc: async (n, p) => {
      calls.push(p);
      return p.p_action === 'context'
        ? { policies: [], defaultHead: 'empty' }
        : { rows: [], more: false };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Queue search'), { target: { value: ' ANTHRO-54321 ' } });
  fireEvent.change(screen.getByLabelText('Exact queue status or role'), {
    target: { value: 'Prepared' },
  });
  fireEvent.submit(screen.getByLabelText('Queue search').closest('form'));
  await settle();
  for (const action of ['members', 'cases', 'browse', 'access-history'])
    assert.ok(
      calls.some(
        (p) =>
          p.p_action === action &&
          p.p_offset === 0 &&
          p.p_payload.query === 'ANTHRO-54321' &&
          p.p_payload.status === 'Prepared',
      ),
    );
});

test('CV grouped records retain citations, require review and invalidate confirmation after editing', async () => {
  let value = extractCvEvidence('Experience\nEngineer 2020-Present\nBuilt a tool');
  function Host() {
    const [v, set] = React.useState(value);
    value = v;
    return React.createElement(Cv, { value: v, onChange: set });
  }
  await mount(Host);
  fireEvent.click(screen.getByText('Build cited CV records'));
  assert.equal(value.records[0].start, '2020');
  fireEvent.click(screen.getByText('Merge next into record 1'));
  assert.deepEqual(value.records[0].sourceLines, [2, 3]);
  fireEvent.click(screen.getByLabelText('CV record reviewed 1'));
  fireEvent.click(screen.getByLabelText('CV confirm evidence 1'));
  fireEvent.click(screen.getByLabelText('CV confirm evidence 2'));
  assert.equal(evidenceReady(value), true);
  fireEvent.change(screen.getByLabelText('CV evidence label 1'), {
    target: { value: 'Corrected engineer' },
  });
  assert.equal(screen.getByLabelText('CV record reviewed 1').checked, false);
  assert.equal(evidenceReady(value), false);
});

test('all four extended record forms save configured typed custom values', async () => {
  const data = makeSeed();
  const modules = ['assessments', 'enrichment', 'interviews', 'placements'];
  data.settings[0].custom.customFields = {
    ...data.settings[0].custom.customFields,
    ...Object.fromEntries(modules.map((m) => [m, [{ name: 'Review code', type: 'number' }]])),
  };
  const saved = [];
  const onSave = async (table, rows) => {
    saved.push([table, rows]);
    return true;
  };
  const onClose = () => {};
  for (const [Component, module, props, button] of [
    [Assessment, 'assessments', { data, candidateId: data.candidates[0].id }, 'Save assessment'],
    [Enrichment, 'enrichment', { data }, 'Create plan'],
    [
      Interview,
      'interviews',
      {
        candidates: data.candidates,
        demands: data.demands,
        settings: data.settings,
        preselect: { candidateId: data.candidates[0].id },
      },
      'Schedule interview',
    ],
    [
      Placement,
      'placements',
      { data, clientId: data.placements[0].clientId, placement: data.placements[0] },
      'Save placement',
    ],
  ]) {
    await mount(Component, { ...props, onSave, onClose });
    fireEvent.change(screen.getByLabelText('Review code'), { target: { value: '12.5' } });
    if (module === 'assessments') {
      fireEvent.change(screen.getByLabelText(/Assessor/), { target: { value: 'Reviewer' } });
      fireEvent.change(screen.getByLabelText(/Evidence & observations/), {
        target: { value: 'Test evidence' },
      });
    }
    if (module === 'enrichment') {
      fireEvent.change(screen.getByLabelText(/Learning action/), { target: { value: 'Practice' } });
      fireEvent.change(screen.getByLabelText(/Expected evidence/), {
        target: { value: 'Demonstration' },
      });
      fireEvent.change(screen.getByLabelText(/Owner/), { target: { value: 'Reviewer' } });
      fireEvent.change(screen.getByLabelText(/Due date/), {
        target: { value: new Date().toISOString().slice(0, 10) },
      });
    }
    const submit = screen.getByText(button);
    fireEvent.submit(submit.closest('form'));
    await settle();
    assert.ok(
      saved.some(([table, rows]) => table === module && rows[0].custom?.['Review code'] === 12.5),
      `${module} persists typed custom fields`,
    );
    cleanup();
  }
});
