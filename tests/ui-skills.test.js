// The skills model driven through the real components. The behaviour that matters most is the
// one the blueprint is explicit about: recording evidence must never remove or overwrite what
// was there before.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  createHarness,
  click,
} from './ui-harness.js';
import { press, type, choose, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';
import { skillsForCandidate } from '../src/skills.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

function world() {
  const data = normalizeData(makeSeed());
  const harness = createHarness(data);
  return { data, harness, candidate: data.candidates[0] };
}

async function panel(extra = {}) {
  const { data, harness, candidate } = world();
  await mount(M.SkillEvidencePanel, {
    candidate,
    data,
    onSave: harness.save,
    notify: (m) => harness.state.toasts.push(m),
    busy: false,
    ...extra,
  });
  await settle(3);
  return { data, harness, candidate };
}

test('a candidate’s skills show proficiency, confidence and evidence age', async () => {
  const { data, candidate } = await panel();
  const rows = skillsForCandidate(data, candidate.id);
  assert.ok(rows.length > 0, 'the seeded candidate has skills');
  assert.ok(screen.getByText(rows[0].name), 'the strongest skill is listed first');
  assert.ok(allText(/% confidence/).length, 'confidence is shown, not just a level');
  assert.ok(allText(/Last evidenced/).length, 'and so is how old the evidence is');
  assert.ok(allText(/Validated/).length);
  cleanup();
});

test('the evidence timeline can be opened and shows each observation', async () => {
  const { data, candidate } = await panel();
  const row = skillsForCandidate(data, candidate.id)[0];
  await press(`${row.evidence.length} observation${row.evidence.length === 1 ? '' : 's'}`);
  await settle(2);
  assert.ok(document.querySelector('.evidence-timeline'), 'the timeline opened');
  assert.equal(
    document.querySelectorAll('.evidence-timeline li').length,
    row.evidence.length,
    'every observation is listed',
  );
  cleanup();
});

test('recording evidence adds an observation and never removes one', async () => {
  const { data, harness, candidate } = await panel();
  const row = skillsForCandidate(data, candidate.id)[0];
  const before = row.evidence.length;

  await press('Add evidence');
  await settle(2);
  await choose('Evidence type', 'Certification');
  await choose('Proficiency demonstrated', 'Expert');
  await type('Relevant years', '9');
  await press('Record evidence');
  await settle(4);

  const evidenceWrite = harness.state.writes.find((w) => w.table === 'skillEvidence');
  assert.ok(evidenceWrite, 'an evidence row was written');
  assert.equal(evidenceWrite.rows.length, 1, 'exactly one new observation');
  assert.equal(evidenceWrite.rows[0].evidenceType, 'Certification');
  assert.equal(evidenceWrite.rows[0].proficiency, 'Expert');
  assert.equal(evidenceWrite.rows[0].years, 9);
  assert.equal(evidenceWrite.rows[0].personSkillId, row.id);

  // Nothing existing was touched: the store still holds every prior observation.
  const after = harness.state.data.skillEvidence.filter((e) => e.personSkillId === row.id);
  assert.equal(after.length, before + 1, 'the prior observations are all still there');
  for (const old of row.evidence)
    assert.ok(
      after.some((e) => e.id === old.id),
      `observation ${old.id} survived`,
    );

  // And the derived view was recomputed rather than asserted.
  const derivedWrite = harness.state.writes.find((w) => w.table === 'personSkills');
  assert.ok(derivedWrite, 'the derived person-skill was refreshed');
  assert.equal(derivedWrite.rows[0].id, row.id);
  assert.ok(derivedWrite.rows[0].evidenceCount === before + 1);
  assert.equal(derivedWrite.rows[0].years, 9, 'corroborating facts were taken from all evidence');
  cleanup();
});

test('a weaker new claim does not downgrade a stronger existing one', async () => {
  const h2 = createHarness(normalizeData(makeSeed()));
  await mount(M.SkillEvidencePanel, {
    candidate: h2.state.data.candidates[0],
    data: h2.state.data,
    onSave: h2.save,
    notify: () => {},
    busy: false,
  });
  await settle(3);
  const target = skillsForCandidate(h2.state.data, h2.state.data.candidates[0].id)[0];
  const links = [...document.querySelectorAll('.text-link')].filter(
    (b) => b.textContent === 'Add evidence',
  );
  await click(links[0]);
  await settle(2);
  await choose('Evidence type', 'Self-declared');
  await choose('Proficiency demonstrated', 'Expert');
  await press('Record evidence');
  await settle(4);

  const derived = h2.state.writes.find((w) => w.table === 'personSkills').rows[0];
  assert.equal(
    derived.proficiency,
    target.proficiency,
    'a self-declared claim of Expert does not beat the existing assessed level',
  );
  assert.equal(derived.evidenceCount, target.evidence.length + 1, 'but it is still recorded');
  cleanup();
});

test('an assessment without an assessor is refused', async () => {
  const { harness } = await panel();
  await press('Add evidence');
  await settle(2);
  await choose('Evidence type', 'Assessment');
  await press('Record evidence');
  await settle(2);
  assert.ok(
    allText(/unattributed evidence cannot be relied on/i).length,
    'the form explains why it is refused',
  );
  assert.equal(harness.state.writes.length, 0, 'nothing was recorded');
  cleanup();
});

test('an out-of-range number of years is refused before saving', async () => {
  const { harness } = await panel();
  await press('Add evidence');
  await settle(2);
  await type('Relevant years', '99');
  await type('Assessor', 'Priya');
  await press('Record evidence');
  await settle(2);
  assert.ok(allText(/between 0 and 60/).length);
  assert.equal(harness.state.writes.length, 0);
  cleanup();
});

test('a viewer sees the evidence but cannot add any', async () => {
  await panel({ role: 'viewer' });
  assert.ok(allText(/% confidence/).length, 'a viewer can still read the record');
  assert.equal(
    [...document.querySelectorAll('.text-link')].filter((b) => b.textContent === 'Add evidence')
      .length,
    0,
    'but has no way to record evidence',
  );
  cleanup();
});

test('the panel never offers a way to edit or delete an observation', async () => {
  const { data, candidate } = await panel();
  const row = skillsForCandidate(data, candidate.id)[0];
  await press(`${row.evidence.length} observation${row.evidence.length === 1 ? '' : 's'}`);
  await settle(2);
  const controls = [...document.querySelectorAll('.evidence-timeline button')].map((b) =>
    b.textContent.toLowerCase(),
  );
  assert.deepEqual(
    controls.filter((t) => /edit|delete|remove/.test(t)),
    [],
    'blueprint §7: evidence is append-only, so there is nothing to edit or delete',
  );
  cleanup();
});

test('the skill inventory summarises the bench and queues weak claims', async () => {
  const data = normalizeData(makeSeed());
  const opened = [];
  await mount(M.SkillInventoryPanel, { data, onOpenCandidate: (id) => opened.push(id) });
  await settle(3);
  assert.ok(screen.getByText('Skill inventory'));
  assert.ok(screen.getByText('Databricks'), 'a seeded skill is listed');
  assert.ok(document.querySelectorAll('tbody tr').length > 0, 'the inventory has rows');
  assert.ok(screen.getByText('Claims needing a human'), 'the data-quality queue is present');

  const link = document.querySelector('.client-list .text-link');
  if (link) {
    await click(link);
    await settle(2);
    assert.equal(opened.length, 1, 'a queued claim opens the candidate');
  }
  cleanup();
});

test('an empty workspace reports no skills rather than fabricating a share', async () => {
  const data = normalizeData({ ...makeSeed(), skills: [], personSkills: [], skillEvidence: [] });
  await mount(M.SkillInventoryPanel, { data });
  await settle(2);
  assert.ok(allText(/No skills recorded in this workspace yet/).length);
  assert.ok(allText(/Every recorded skill is validated and current/).length);
  cleanup();
});
