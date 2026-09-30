import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  click,
  act,
  fireEvent,
} from './ui-harness.js';
import { navTo, press, type, choose, submitVia } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { blankAssessmentTemplate } from '../src/assessmentTemplates.js';
import { normalizeData } from '../src/schema.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());
const store = () => JSON.parse(localStorage.getItem('ecod-demo-v1'));
const tabTo = (name) =>
  click(
    [...document.querySelectorAll('.repository-tabs button')].find((button) =>
      button.textContent.startsWith(name),
    ),
  );
async function boot(data = makeSeed()) {
  localStorage.setItem('ecod-demo-v1', JSON.stringify(data));
  await mount(M.App);
  await settle(6);
}

test('an admin creates a weighted template and an assessor records its exact version', async () => {
  await boot();
  await navTo('Assessments');
  await tabTo('Templates');
  await press('Create template');
  await type('Template name', 'Architecture panel');
  await type('Validity in days', '30');
  await type('Template description', 'Evaluate a practical architecture exercise.');
  await submitVia('Save template');
  await settle(4);
  assert.equal(store().assessmentTemplates[0].name, 'Architecture panel');
  await tabTo('Assessments');
  await press('Record assessment');
  const template = store().assessmentTemplates[0];
  await choose('Assessment template', template.id);
  await type('Technical capability', '4');
  await type('Communication', '3');
  await type('Assessor', 'Panel reviewer');
  await type(
    'Evidence & observations',
    'Designed the ingestion pipeline and explained trade-offs.',
  );
  await submitVia('Save assessment');
  await settle(4);
  const assessment = store().assessments.find((row) => row.templateId === template.id);
  assert.equal(assessment.score, 74);
  assert.equal(assessment.templateSnapshot.version, 1);
  assert.equal(assessment.templateSnapshot.validityDays, 30);
  assert.ok(assessment.validUntil);
  await tabTo('Templates');
  await press('Edit template');
  await type('Template name', 'Architecture panel revised');
  await submitVia('Save template');
  await settle(4);
  assert.equal(store().assessmentTemplates[0].version, 2);
  assert.equal(
    store().assessments.find((row) => row.id === assessment.id).templateSnapshot.name,
    'Architecture panel',
  );
});

test('incomplete rubric weights are refused before saving a template', async () => {
  await boot();
  await navTo('Assessments');
  await tabTo('Templates');
  await press('Create template');
  await type('Template name', 'Broken rubric');
  await type('Weight 1', '40');
  await submitVia('Save template');
  assert.ok(screen.getByRole('alert').textContent.includes('100%'));
  assert.equal(store().assessmentTemplates?.length || 0, 0);
});

test('curated pools persist membership, remove it reversibly and preserve candidate profiles', async () => {
  await boot();
  await navTo('Talent pools');
  await press('Create pool');
  await type('Pool name', 'Silver medalists');
  await type('Pool description', 'Strong candidates to reconnect with.');
  await submitVia('Save pool');
  await settle(4);
  await press('Add members');
  await click(screen.getByRole('checkbox', { name: /Aarav Mehta/ }));
  await press('Add 1 members');
  await settle(4);
  assert.equal(store().poolMembers[0].active, true);
  const count = store().candidates.length;
  await press('Remove Aarav Mehta');
  await settle(4);
  assert.equal(store().poolMembers[0].active, false);
  assert.equal(store().candidates.length, count);
  await press('Add members');
  await click(screen.getByRole('checkbox', { name: /Aarav Mehta/ }));
  await press('Add 1 members');
  await settle(4);
  assert.equal(store().poolMembers.length, 1, 'restoration reuses the original membership');
  assert.equal(store().poolMembers[0].active, true);
  await press('Archive pool');
  await settle(4);
  assert.equal(store().talentPools[0].archived, true);
  assert.equal(store().poolMembers.length, 1);
});

test('viewer libraries hide template and pool mutations', async () => {
  const data = normalizeData(makeSeed());
  data.assessmentTemplates = [
    { ...blankAssessmentTemplate(), id: 'template', name: 'Panel template' },
  ];
  await mount(M.Assessments, {
    data,
    onNew() {},
    onEnrich() {},
    onOpen() {},
    onSave() {},
    busy: false,
  });
  // Panel permissions are tested independently with an explicit reader role.
  cleanup();
  const { AssessmentTemplatePanel } = await (
    await import('./ui-harness.js')
  ).load('/src/AssessmentTemplates.jsx');
  await mount(AssessmentTemplatePanel, { data, role: 'viewer', onSave() {} });
  assert.equal(screen.queryByRole('button', { name: 'Create template' }) === null, true);
  assert.equal(screen.queryByRole('button', { name: 'Edit template' }) === null, true);
  cleanup();
  const { StaticPools } = await (await import('./ui-harness.js')).load('/src/StaticPools.jsx');
  await mount(StaticPools, { data, role: 'viewer', onSave() {}, onOpen() {} });
  assert.equal(screen.queryByRole('button', { name: 'Create pool' }) === null, true);
});

test('placement report fields respect the reader commercial permissions', async () => {
  const data = normalizeData(makeSeed());
  await mount(M.Reports, { data, role: 'recruiter', onSave() {}, onDelete() {}, notify() {} });
  await choose('About', 'placements');
  await choose('Group by', 'status');
  assert.equal(screen.queryByRole('option', { name: 'Bill rate' }) === null, true);
  assert.ok(screen.getByRole('option', { name: 'Placement status' }));
  cleanup();
  await mount(M.Reports, { data, role: 'admin', onSave() {}, onDelete() {}, notify() {} });
  await choose('About', 'placements');
  assert.ok(screen.getAllByRole('option', { name: 'Bill rate' }).length);
  // Simulate the real select rather than inspecting only the available labels.
  await act(async () =>
    fireEvent.change(screen.getByLabelText('Measure'), { target: { value: 'sum' } }),
  );
});
