// Phase D: assignment rules through the real screens. The behaviour that matters is that a
// rule fills an empty owner and never moves work somebody already holds.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, createHarness } from './ui-harness.js';
import { navTo, press, type, choose, submitVia, allText, withWindow } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
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

const store = () =>
  JSON.parse(localStorage.getItem('ecod-demo-v1') || 'null') || normalizeData(makeSeed());

const RULE = {
  id: 'ar1',
  name: 'Referrals to Neha',
  entity: 'candidates',
  field: 'source',
  op: 'eq',
  value: 'Referral',
  assignTo: 'Neha Kulkarni',
  priority: 100,
  enabled: true,
  created: '2026-09-01',
};

function world(rules = [], over = {}) {
  const seed = makeSeed();
  return normalizeData({ ...seed, assignmentRules: rules, ...over });
}

async function panel(rules = [], props = {}) {
  const data = props.data || world(rules);
  const harness = createHarness(data);
  harness.deleted = [];
  const modals = [];
  await mount(M.AssignmentPanel, {
    data,
    onSave: harness.save,
    onDelete: async (table, ids) => {
      harness.deleted.push({ table, ids });
      return true;
    },
    onNew: () => modals.push('new'),
    onEdit: (r) => modals.push(r.id),
    notify: (m) => harness.state.toasts.push(m),
    busy: false,
    ...props,
  });
  await settle(3);
  return { harness, modals, data };
}

test('an empty rule set explains what rules are for', async () => {
  await panel();
  assert.ok(screen.getByText('No assignment rules'));
  assert.ok(allText(/arrive unowned/).length);
  cleanup();
});

test('a rule is shown as a readable sentence', async () => {
  await panel([RULE]);
  const text = document.querySelector('.client-list').textContent;
  assert.ok(text.includes('Referrals to Neha'));
  assert.ok(text.includes('Source'), 'the field is named in human terms');
  assert.ok(text.includes('is exactly'), 'and so is the comparison');
  assert.ok(text.includes('Neha Kulkarni'));
  cleanup();
});

test('a rule pointing at a name nobody uses is flagged', async () => {
  await panel([{ ...RULE, assignTo: 'Nobodee Atall' }]);
  assert.ok(
    allText(/Nothing is owned by that name/).length,
    'ownership is free text, so a typo silently routes work nowhere',
  );
  cleanup();
});

test('only an administrator can change how work is routed', async () => {
  await panel([RULE], { role: 'recruiter' });
  assert.ok(screen.getByText('Referrals to Neha'), 'a recruiter can see the rules governing them');
  assert.equal(screen.queryByText('New rule'), null);
  assert.equal(screen.queryByText('Edit'), null);
  assert.equal(screen.queryByText('Pause'), null);
  assert.ok(allText(/Only an administrator can change how work is routed/).length);
  cleanup();
});

test('a rule can be paused and deleted', async () => {
  const { harness } = await panel([RULE]);
  await press('Pause');
  await settle(2);
  const write = harness.state.writes.find((w) => w.table === 'assignmentRules');
  assert.equal(write.rows[0].enabled, false, 'pausing stops it without deleting it');

  await withWindow(
    'confirm',
    () => false,
    async () => {
      await press('Delete');
    },
  );
  assert.equal(harness.deleted.length, 0, 'declining keeps the rule');
  await withWindow(
    'confirm',
    () => true,
    async () => {
      await press('Delete');
    },
  );
  assert.deepEqual(harness.deleted, [{ table: 'assignmentRules', ids: ['ar1'] }]);
  cleanup();
});

test('the catch-up run is previewed before anything is written', async () => {
  const data = world([RULE]);
  // Make sure some unowned referrals exist to be caught.
  data.candidates = data.candidates.map((c, i) =>
    i < 2 ? { ...c, source: 'Referral', owner: '' } : { ...c, owner: 'Amit Singh' },
  );
  const { harness } = await panel([RULE], { data });
  await press('Preview candidates');
  await settle(2);
  assert.ok(allText(/would be assigned/).length, 'the effect is stated first');
  assert.ok(allText(/2 to Neha Kulkarni/).length, 'broken down by who gets what');
  assert.ok(allText(/already owned/).length, 'and what is left alone');
  assert.equal(harness.state.writes.length, 0, 'nothing written yet');

  await press('Assign 2');
  await settle(3);
  const write = harness.state.writes.find((w) => w.table === 'candidates');
  assert.equal(write.rows.length, 2);
  assert.ok(write.rows.every((r) => r.owner === 'Neha Kulkarni'));
  cleanup();
});

test('the rule form previews the effect of a rule before it is created', async () => {
  const data = world([]);
  data.candidates = data.candidates.map((c) => ({ ...c, source: 'Referral', owner: '' }));
  const harness = createHarness(data);
  await mount(M.AssignmentRuleForm, {
    data,
    onClose: () => {},
    onSave: harness.save,
    busy: false,
  });
  await settle(2);
  await type('Rule name', 'Referrals to Neha');
  await type('Value', 'Referral');
  await type('Assign to', 'Neha Kulkarni');
  await settle(2);
  assert.ok(allText(/If this rule were on today/).length);
  assert.ok(
    allText(new RegExp(`${data.candidates.length} existing record`)).length,
    'the blast radius is stated before the rule exists',
  );
  cleanup();
});

test('a new candidate is assigned by a matching rule, and an owned one is left alone', async () => {
  const seed = makeSeed();
  seed.assignmentRules = [RULE];
  localStorage.setItem('ecod-demo-v1', JSON.stringify(seed));
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  await press('Add candidate');
  await type('Full name', 'Routed Person');
  await type('Email', 'routed@example.com');
  await type('Location', 'Bengaluru');
  await type('Current title', 'Engineer');
  await type('Skills', 'SQL');
  await choose('Source', 'Referral');
  await submitVia('Add candidate');
  await settle(4);
  const saved = store().candidates.find((c) => c.name === 'Routed Person');
  assert.ok(saved, 'the candidate was created');
  assert.equal(saved.owner, 'Neha Kulkarni', 'and routed by the rule');
  assert.ok(allText(/assigned by/).length, 'the toast says which rule did it, not just "saved"');
  cleanup();
});
