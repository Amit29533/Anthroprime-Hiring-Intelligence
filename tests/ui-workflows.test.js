// The back-office surfaces: CSV import, automation rules, and the workspace data tools. These
// are where silent data damage happens — a row imported with experience=9999, a duplicate
// quietly merged, a rule that waits on a value its field can never hold, a "reset" that does
// nothing. Every assertion checks what actually landed in the store.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  React,
  act,
  mount,
  click,
  change,
  screen,
  cleanup,
  stopVite,
  settle,
  downloaded,
  resetDownloads,
  blobText,
} from './ui-harness.js';
import {
  navTo,
  press,
  type,
  choose,
  allLabelled,
  allText,
  byPlaceholder,
  submitVia,
  pressPrefixed,
} from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { TABLES } from '../src/schema.js';
import { MAX_EXPERIENCE_YEARS } from '../src/domain.js';
import { TRIGGER_VALUES } from '../src/automation.js';
import { today } from '../src/domain.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const KEY = 'ecod-demo-v1';
const store = () => JSON.parse(localStorage.getItem(KEY));
const putStore = (data) => localStorage.setItem(KEY, JSON.stringify(data));
const boot = () => localStorage.removeItem(KEY);

const HEADER =
  'name,email,phone,title,company,location,experience,relevantExperience,notice,current,expected,skills,mode,status,source,engagement';

/** Drive the import modal: paste CSV → read → review. Returns the preview counts on screen. */
async function reviewCsv(rows) {
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  await press('Import candidates');
  await change(byPlaceholder('name,email,title,skills…'), [HEADER, ...rows].join('\n'));
  await press('Read pasted CSV');
  assert.ok(
    screen.getByText(/Map your columns/),
    'the columns are mapped before anything is imported',
  );
  await press('Review import');
  await settle(2);
  const counts = [...document.querySelectorAll('.import-totals div')].map((d) => ({
    value: Number(d.querySelector('strong').textContent),
    label: d.querySelector('span').textContent,
  }));
  return Object.fromEntries(counts.map((c) => [c.label, c.value]));
}

/**
 * Narrow the repository to one person and tick their row. The table is paginated, so a
 * candidate can be in the workspace and still not be on screen — searching first is both
 * what a recruiter does and what makes the row addressable.
 */
async function selectCandidate(name) {
  await change(screen.getByLabelText('Search your workspace'), name);
  await settle(2);
  const box = allLabelled(`Select ${name}`)[0];
  assert.ok(box, `${name} is listed and selectable`);
  await click(box);
  await settle();
  return box;
}

async function openSettings() {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.trim().startsWith('Workspace settings'),
  );
  assert.ok(btn, 'workspace settings is reachable from the sidebar');
  await click(btn);
  await screen.findByText(
    'A foundation for better recruiting.',
    { selector: 'h1' },
    { timeout: 30000 },
  );
}

test('a pasted CSV becomes real profiles, with numbers as numbers and skills as a list', async () => {
  await boot();
  const counts = await reviewCsv([
    'Imported Person,imported.person@example.com,+91 90000 11111,Data Engineer,Example Co,Bengaluru,6,5,30,20,26,"Python; SQL; Databricks",Hybrid,Assessing,Referral,Permanent',
    'Second Import,second.import@example.com,,Analytics Engineer,Other Co,Pune,4,3,15,14,18,"dbt, Snowflake",Remote,Near-ready,LinkedIn,Permanent',
  ]);
  assert.equal(counts['ready to import'], 2, 'both rows validate');
  assert.equal(counts['rows skipped'], 0);

  await press('Import 2 candidates');
  await settle(4);

  const rows = store().candidates;
  const a = rows.find((c) => c.email === 'imported.person@example.com');
  assert.ok(a, 'the first row was imported');
  assert.equal(a.name, 'Imported Person');
  assert.equal(a.experience, 6, 'experience is a number the matcher can compare');
  assert.equal(typeof a.experience, 'number');
  assert.equal(a.notice, 30);
  assert.equal(a.current, 20);
  assert.deepEqual(
    a.skills,
    ['Python', 'SQL', 'Databricks'],
    'semicolon-separated skills are split',
  );
  assert.deepEqual(a.skillsDetail, [], 'no evidence is invented for an imported skill');
  assert.equal(a.source, 'Referral', 'provenance survives the import');

  const b = rows.find((c) => c.email === 'second.import@example.com');
  assert.deepEqual(b.skills, ['dbt', 'Snowflake'], 'comma-separated skills are split too');
  assert.equal(b.phone, '', 'a column left empty stays empty rather than becoming null-ish text');
});

test('an equal-count repository change refreshes the exact duplicate row before import', async () => {
  const seed = makeSeed();
  const existingFirst = {
    ...seed.candidates[0],
    id: 'existing-first',
    name: 'Existing First',
    email: 'first@example.com',
    phone: '',
  };
  const existingSecond = {
    ...seed.candidates[1],
    id: 'existing-second',
    name: 'Existing Second',
    email: 'second@example.com',
    phone: '',
  };
  const saved = [];
  let closed = false;
  const props = {
    data: { ...seed, candidates: [existingFirst] },
    onClose: () => {
      closed = true;
    },
    onSave: async (...args) => {
      saved.push(args);
      return true;
    },
    busy: false,
    notify: () => {},
  };
  const modal = await mount(M.ImportModal, props);
  await change(
    screen.getByPlaceholderText('name,email,title,skills…'),
    'name,email\nFirst Import,first@example.com\nSecond Import,second@example.com',
  );
  await press('Read pasted CSV');
  await press('Review import');
  await settle();
  assert.equal(
    screen.getByText('Duplicate of Existing First; skipped.').textContent,
    'Duplicate of Existing First; skipped.',
  );
  assert.equal(document.querySelector('.import-totals div strong').textContent, '1');

  await act(async () => {
    modal.rerender(
      React.createElement(M.ImportModal, {
        ...props,
        data: { ...seed, candidates: [existingSecond] },
      }),
    );
  });
  await settle();
  assert.ok(screen.getByText('The repository changed. Review the updated duplicate check.'));
  assert.ok(screen.getByText('Duplicate of Existing Second; skipped.'));
  assert.equal(document.querySelector('.import-totals div strong').textContent, '1');

  await press('Import 1 candidates');
  await settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0], 'candidates');
  assert.equal(saved[0][1][0].email, 'first@example.com');
  assert.equal(closed, true);
});

test(`a CSV row above the shared ceiling is refused, not imported at ${MAX_EXPERIENCE_YEARS + 1}`, async () => {
  await boot();
  const counts = await reviewCsv([
    `Time Traveller,time.traveller@example.com,,Fellow,Example Co,Pune,${MAX_EXPERIENCE_YEARS + 30},5,30,20,26,Python,Hybrid,Assessing,Referral,Permanent`,
    'Fine Person,fine.person@example.com,,Engineer,Example Co,Pune,9,5,30,20,26,Python,Hybrid,Assessing,Referral,Permanent',
  ]);
  assert.equal(counts['ready to import'], 1, 'only the realistic row is offered for import');
  assert.equal(counts['rows skipped'], 1);
  assert.ok(
    screen.getByText(`Total experience cannot exceed ${MAX_EXPERIENCE_YEARS} years.`),
    'and the row says exactly why — the same message the form gives',
  );

  await press('Import 1 candidates');
  await settle(4);
  const rows = store().candidates;
  assert.ok(
    !rows.some((c) => c.email === 'time.traveller@example.com'),
    'the impossible row never lands',
  );
  assert.ok(
    rows.some((c) => c.email === 'fine.person@example.com'),
    'the good row still imports',
  );
});

test('a duplicate in the CSV is skipped and the existing profile is left alone', async () => {
  await boot();
  const existing = makeSeed().candidates.find((c) => c.email);
  await reviewCsv([
    `Impostor,${existing.email},,Copycat,Nowhere,Mumbai,3,2,10,10,12,Python,Hybrid,Assessing,Referral,Permanent`,
  ]);
  assert.ok(
    screen.getByText(new RegExp(`^Duplicate of ${existing.name}; skipped\\.$`)),
    'the row names the profile it duplicates',
  );
  assert.ok(
    screen.getByText(/never merged automatically/),
    'and the importer says it will not merge',
  );
  await settle();
  const before = store();
  assert.ok(
    !before || !before.candidates.some((c) => c.name === 'Impostor'),
    'nothing was written',
  );
  cleanup();

  // The original profile is untouched when the repository is next opened.
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  assert.equal(allText(existing.name).length > 0, true, 'the original is still there, once');
  assert.ok(!allText('Impostor').length, 'and no impostor was added');
});

test('a row with no way to contact the person cannot be imported', async () => {
  await boot();
  const counts = await reviewCsv([
    'Nameless Contact,,,,,Bengaluru,5,4,30,18,22,Python,Hybrid,Assessing,Referral,Permanent',
  ]);
  assert.equal(counts['ready to import'], 0, 'nothing is importable');
  assert.equal(counts['rows skipped'], 1);
  assert.ok(screen.getByText('Provide an email address or phone number.'), 'the reason is stated');
});

test('the error report downloads exactly the rows that failed', async () => {
  await boot();
  await reviewCsv([
    `Time Traveller,time.traveller@example.com,,Fellow,Example Co,Pune,${MAX_EXPERIENCE_YEARS + 30},5,30,20,26,Python,Hybrid,Assessing,Referral,Permanent`,
    'Fine Person,fine.person@example.com,,Engineer,Example Co,Pune,9,5,30,20,26,Python,Hybrid,Assessing,Referral,Permanent',
  ]);
  resetDownloads();
  await press('Download error report');
  await settle(2);
  assert.equal(downloaded.length, 1, 'one file was downloaded');
  assert.equal(downloaded[0].name, 'ecod-import-errors.csv');
  const csv = await blobText(downloaded[0].blob);
  assert.ok(csv.includes('Time Traveller'), 'the failed row is in the report');
  assert.ok(csv.includes(`cannot exceed ${MAX_EXPERIENCE_YEARS}`), 'with the reason');
  assert.ok(!csv.includes('Fine Person'), 'and the row that passed is not');
});

test('an automation rule can only wait on a value its field can actually hold', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await openSettings();
  await press('New automation rule');
  await settle(2);

  await type('Rule name', 'Ready → line up demands');
  await choose('When this happens', 'candidates.status');
  // The value picker offers the field's own vocabulary rather than a free-text box, so a rule
  // cannot be saved waiting on a status no candidate will ever have.
  const offered = [...screen.getByLabelText(/^Value/).options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(
    offered,
    TRIGGER_VALUES['candidates.status'],
    'the picker offers the real statuses',
  );
  assert.ok(!offered.includes('Readyish'), 'and nothing invented');
  await choose('Value', 'Ready');
  // "Create task" is on by default, so its title field is already there — clicking it again
  // would switch the action off.
  assert.equal(
    screen.getByLabelText('Create task').checked,
    true,
    'creating a task is the default action',
  );
  await change(byPlaceholder('Task title'), 'Line up open demands for this person');
  await press('Save rule');
  await settle(3);

  const rule = store().workflowRules.find((r) => r.name === 'Ready → line up demands');
  assert.ok(rule, 'the rule was saved');
  assert.equal(rule.triggerTable, 'candidates');
  assert.equal(rule.triggerField, 'status');
  assert.equal(rule.op, 'eq');
  assert.equal(rule.value, 'Ready');
  assert.equal(rule.enabled, true);
  assert.deepEqual(
    rule.actions.map((a) => a.type),
    ['task'],
  );
  assert.equal(rule.actions[0].title, 'Line up open demands for this person');
});

test('a demand automation can create demand tasks but cannot configure candidate-only actions', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await openSettings();
  await press('New automation rule');
  await type('Rule name', 'Demand opens → line up the bench');
  await choose('When this happens', 'demands.status');
  await choose('Value', 'Open');

  for (const label of ['Add note', 'Tag candidate', 'Set next action']) {
    assert.equal(
      screen.getByLabelText(label).disabled,
      true,
      `${label} cannot be configured without a candidate-linked trigger`,
    );
  }
  assert.ok(
    screen.getByText(/Notes, tags and next actions need a candidate-linked trigger/),
    'the constraint is explained, not silently applied',
  );
  await change(byPlaceholder('Task title'), 'Line up the bench for this demand');
  await press('Save rule');
  await settle(3);
  const rule = store().workflowRules.find((r) => r.name === 'Demand opens → line up the bench');
  assert.deepEqual(
    rule.actions.map((a) => a.type),
    ['task'],
    'only a supported demand action was saved',
  );
});

test('a demand-open rule creates a demand-linked task when the status actually changes', async () => {
  await boot();
  const data = makeSeed();
  const demand = data.demands.find((d) => d.status === 'Open');
  demand.status = 'On hold';
  data.workflowRules = [
    {
      id: 'rule-demand-open',
      name: 'Line up the bench',
      triggerTable: 'demands',
      triggerField: 'status',
      op: 'eq',
      value: 'Open',
      actions: [{ type: 'task', title: 'Line up the bench for this demand', dueDays: 2 }],
      enabled: true,
      created: '2026-01-01',
    },
  ];
  data.tasks = [];
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Demands');
  await choose('Demand status', 'On hold');
  const card = [...document.querySelectorAll('.demand-card')].find((row) =>
    row.textContent.includes(demand.title),
  );
  assert.ok(card, 'the on-hold demand can be found');
  const openDemand = [...card.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === demand.title,
  );
  await click(openDemand);
  await settle(3);
  await press('Edit demand');
  await choose('Demand status', 'Open');
  await submitVia('Save demand');
  await settle(5);

  assert.equal(
    store().demands.find((d) => d.id === demand.id).status,
    'Open',
    'the recruiter reopened it',
  );
  const task = store().tasks.find((t) => t.title === 'Line up the bench for this demand');
  assert.ok(task, 'the rule fired once the field changed');
  assert.equal(task.demandId, demand.id, 'the task is attached to the demand');
  assert.equal(task.candidateId, null, 'no fake candidate is invented');
  const expectedDue = new Date(`${today()}T12:00:00`);
  expectedDue.setDate(expectedDue.getDate() + 2);
  assert.equal(
    task.due,
    `${expectedDue.getFullYear()}-${String(expectedDue.getMonth() + 1).padStart(2, '0')}-${String(expectedDue.getDate()).padStart(2, '0')}`,
  );
});

test('a legacy demand rule with candidate-only actions cannot be enabled silently', async () => {
  await boot();
  const data = makeSeed();
  data.workflowRules = [
    {
      id: 'legacy-demand-note',
      name: 'Legacy demand note',
      triggerTable: 'demands',
      triggerField: 'status',
      op: 'eq',
      value: 'Open',
      actions: [{ type: 'note', text: 'Line up the bench' }],
      enabled: false,
      created: '2026-01-01',
    },
  ];
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await openSettings();

  const row = [...document.querySelectorAll('.rule-row')].find((article) =>
    article.textContent.includes('Legacy demand note'),
  );
  assert.ok(row, 'the old rule remains visible');
  assert.ok(
    row.textContent.includes('Candidate-only actions cannot run on a demand trigger'),
    'its unsupported action is explained',
  );
  const enable = [...row.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === 'Enable',
  );
  assert.equal(enable.disabled, true, 'the unsupported rule cannot be switched on silently');

  const duplicate = [...row.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === 'Duplicate',
  );
  await click(duplicate);
  await settle(2);
  assert.equal(
    screen.getByLabelText('Add note').disabled,
    true,
    'the copy cannot repeat the unsupported action',
  );
  await press('Save rule');
  await settle(3);
  const repaired = store().workflowRules.find((rule) => rule.name === 'Legacy demand note (copy)');
  assert.deepEqual(
    repaired.actions.map((action) => action.type),
    ['task'],
    'the duplicate uses a supported demand-linked task instead',
  );
});

test('that rule then fires when a recruiter makes the change it waits for', async () => {
  await boot();
  const data = makeSeed();
  data.workflowRules = [
    {
      id: 'rule-test-1',
      name: 'Ready → line up demands',
      triggerTable: 'candidates',
      triggerField: 'status',
      op: 'eq',
      value: 'Ready',
      actions: [{ type: 'task', title: 'Line up open demands', dueDays: 2 }],
      enabled: true,
      created: '2026-01-01',
    },
  ];
  data.tasks = [];
  putStore(data);

  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  const target = data.candidates.find((c) => c.status !== 'Ready');
  assert.ok(target, 'the seed has someone who is not already Ready');
  const name = target.name;
  await selectCandidate(name);
  // Bulk actions are now two-step: choose, preview what will change, then commit.
  await choose('Bulk action', 'status');
  await choose('Bulk value', 'Ready');
  await press('Preview');
  await pressPrefixed('Apply to');
  await settle(4);

  const after = store();
  for (const table of TABLES) assert.ok(Array.isArray(after[table]), `${table} exists after reset`);
  assert.equal(
    after.candidates.find((c) => c.name === name).status,
    'Ready',
    'the change was made',
  );
  const tasks = after.tasks.filter((t) => t.title === 'Line up open demands');
  assert.equal(tasks.length, 1, 'and the rule created exactly one task for it');
  assert.equal(
    tasks[0].candidateId,
    after.candidates.find((c) => c.name === name).id,
    'attached to the person who changed',
  );
});

test('a paused rule stays paused and does nothing', async () => {
  await boot();
  const data = makeSeed();
  data.workflowRules = [
    {
      id: 'rule-test-2',
      name: 'Paused rule',
      triggerTable: 'candidates',
      triggerField: 'status',
      op: 'eq',
      value: 'Ready',
      actions: [{ type: 'task', title: 'Should never appear', dueDays: 1 }],
      enabled: false,
      created: '2026-01-01',
    },
  ];
  data.tasks = [];
  putStore(data);

  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  const target = data.candidates.find((c) => c.status !== 'Ready');
  await selectCandidate(target.name);
  // Bulk actions are now two-step: choose, preview what will change, then commit.
  await choose('Bulk action', 'status');
  await choose('Bulk value', 'Ready');
  await press('Preview');
  await pressPrefixed('Apply to');
  await settle(4);
  assert.equal(
    store().candidates.find((c) => c.id === target.id).status,
    'Ready',
    'the change really was made',
  );
  assert.ok(
    !store().tasks.some((t) => t.title === 'Should never appear'),
    'a paused rule is inert',
  );
});

test('resetting the demo workspace throws away edits and restores the sample data', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  await press('Add candidate');
  await type('Full name', 'Throwaway Person');
  await type('Email', 'throwaway.person@example.com');
  await type('Location', 'Bengaluru');
  await type('Current title', 'Engineer');
  await type('Skills', 'Python');
  await submitVia('Add candidate');
  await settle(3);
  assert.ok(
    store().candidates.some((c) => c.name === 'Throwaway Person'),
    'the edit is real',
  );

  await openSettings();
  await press('Reset demo data');
  await settle(4);

  const after = store();
  assert.ok(
    !after?.candidates.some((c) => c.name === 'Throwaway Person'),
    'the edit is gone from the store',
  );
  assert.ok(!allText('Throwaway Person').length, 'and from the screen');
  const seed = makeSeed();
  assert.equal(after.candidates.length, seed.candidates.length, 'the sample repository is back');
  await navTo('Candidates');
  assert.ok(allText(seed.candidates[0].name).length > 0, 'and rendered');
  assert.ok(
    after.auditEvents.some((a) => /reset/i.test(`${a.action} ${a.detail}`)),
    'a reset is not silent — it is recorded in the audit trail',
  );
});

test('recording an assessment preserves its evidence, scope and numeric score', async () => {
  await boot();
  const data = makeSeed();
  const person = data.candidates.find((c) => c.name === 'Aarav Mehta');
  const demand = data.demands.find((d) => d.status === 'Open');
  const statusBefore = person.status;
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Assessments');
  await press('Record assessment');

  await choose('Candidate', person.id);
  await choose('Demand (optional)', demand.id);
  await type('Assessment title', 'Architecture evidence review');
  await type('Score', '93');
  await type('Assessment date', today());
  await type('Assessor', 'Neha Kulkarni');
  await type(
    'Evidence & observations',
    'Designed a resilient Unity Catalog permission model and explained the trade-offs.',
  );
  await choose('Skill addressed', 'Unity Catalog');
  await type(
    'Skill gaps / recommended next steps',
    'Collect a recent production migration example.',
  );
  await submitVia('Save assessment');
  await settle(3);

  const assessment = store().assessments.find((a) => a.title === 'Architecture evidence review');
  assert.ok(assessment, 'the assessment was written');
  assert.equal(assessment.candidateId, person.id);
  assert.equal(assessment.demandId, demand.id);
  assert.equal(assessment.skill, 'Unity Catalog');
  assert.equal(assessment.score, 93, 'the numeric input remains numeric');
  assert.equal(typeof assessment.score, 'number');
  assert.equal(assessment.date, today());
  assert.equal(assessment.assessor, 'Neha Kulkarni');
  assert.match(assessment.evidence, /permission model/);
  assert.match(assessment.gap, /production migration/);
  assert.equal(
    store().candidates.find((c) => c.id === person.id).status,
    statusBefore,
    'assessment evidence does not silently change the recruiter-controlled readiness status',
  );
  assert.ok(
    screen.getByText('Architecture evidence review'),
    'the assessment appears in the table',
  );
  assert.ok(screen.getAllByText('93/100').length >= 1, 'and its score is visible');
});

test('enrichment plans retain their owner, due date and status updates', async () => {
  await boot();
  const data = makeSeed();
  const person = data.candidates.find((c) => c.name === 'Aarav Mehta');
  const demand = data.demands.find((d) => d.status === 'Open');
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Assessments');
  await press('Enrichment plan');

  await choose('Candidate', person.id);
  await choose('Demand (optional)', demand.id);
  await choose('Skill to close', 'Databricks');
  await type('Learning action', 'Complete the data governance practicum');
  await type('Expected evidence', 'Submit a scored access-control design and reviewer notes.');
  await type('Owner', 'Neha Kulkarni');
  const due = new Date(`${today()}T12:00:00`);
  due.setDate(due.getDate() + 14);
  const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  await type('Due date', dueDate);
  await submitVia('Create plan');
  await settle(3);

  const plan = store().enrichment.find((e) => e.title === 'Complete the data governance practicum');
  assert.ok(plan, 'the plan was created');
  assert.equal(plan.candidateId, person.id);
  assert.equal(plan.demandId, demand.id);
  assert.equal(plan.gapSkill, 'Databricks');
  assert.equal(plan.description, 'Submit a scored access-control design and reviewer notes.');
  assert.equal(plan.owner, 'Neha Kulkarni');
  assert.equal(plan.due, dueDate);
  assert.equal(plan.status, 'Planned');

  const plansTab = [...document.querySelectorAll('.repository-tabs button')].find((button) =>
    button.textContent.trim().startsWith('Enrichment plans'),
  );
  assert.ok(plansTab, 'the enrichment tab is available');
  await click(plansTab);
  await settle(2);
  await choose('Enrichment status for Complete the data governance practicum', 'Validated');
  await settle(3);
  assert.equal(
    store().enrichment.find((e) => e.id === plan.id).status,
    'Validated',
    'status changes are saved instead of being display-only',
  );
});

test('talent pools are live views of skills, readiness and freshness, not a second manual list', async () => {
  await boot();
  const data = makeSeed();
  const added = {
    ...data.candidates[0],
    id: 'pool-new-person',
    anthroNumber: undefined,
    anthroId: '',
    name: 'Dynamic Pool Member',
    email: 'dynamic.pool.member@example.com',
    phone: '',
    status: 'Ready',
    notice: 12,
    verified: today(),
    skills: ['Databricks'],
    skillsDetail: [],
  };
  data.candidates = [...data.candidates, added];
  data.candidates.find((c) => c.name === 'Vikram Rao').verified = '2020-01-01';
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Talent pools');

  const card = (name) =>
    [...document.querySelectorAll('.pool-card')].find((button) =>
      button.textContent.includes(name),
    );
  assert.ok(card('Databricks & data platforms'), 'the skills pool exists');
  assert.match(card('Databricks & data platforms').textContent, /candidates/);
  await click(card('Databricks & data platforms'));
  await settle(2);
  const names = [...document.querySelectorAll('.pool-person')].map((row) => row.textContent);
  assert.ok(
    names.some((name) => name.includes('Aarav Mehta')),
    'seeded Databricks talent is included',
  );
  assert.ok(
    names.some((name) => name.includes('Dynamic Pool Member')),
    'a new matching profile appears without manually adding it to a pool',
  );
  assert.ok(
    !names.some((name) => name.includes('Vikram Rao')),
    'a non-matching skill profile is excluded',
  );

  await click(card('Ready in 30 days'));
  await settle(2);
  const readyNames = [...document.querySelectorAll('.pool-person')].map((row) => row.textContent);
  assert.ok(
    readyNames.some((name) => name.includes('Dynamic Pool Member')),
    'ready and short-notice profiles qualify',
  );
  assert.ok(
    !readyNames.some((name) => name.includes('Rohan Iyer')),
    'Near-ready is not treated as Ready',
  );
  assert.ok(
    !readyNames.some((name) => name.includes('Sneha Kapoor')),
    'long notice periods do not qualify',
  );

  await click(card('Rediscover & reconnect'));
  await settle(2);
  const staleNames = [...document.querySelectorAll('.pool-person')].map((row) => row.textContent);
  assert.ok(
    staleNames.some((name) => name.includes('Vikram Rao')),
    'stale profiles are discoverable for revalidation',
  );
  assert.ok(
    !staleNames.some((name) => name.includes('Dynamic Pool Member')),
    'a freshly verified profile is not stale',
  );
});

test('open-ended employment history stores null dates rather than empty strings', async () => {
  await boot();
  const data = makeSeed();
  putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
  await click(allText('Aarav Mehta')[0]);
  await settle(3);
  await press('Employment');
  await click(screen.getByText('Add a role manually'));
  await type('Employer', 'New Studio');
  await type('Job title', 'Staff Engineer');
  // Both dates are intentionally blank; the open-ended role is current.
  await submitVia('Save role');
  await settle(3);
  const job = store().employmentHistory.find((r) => r.company === 'New Studio');
  assert.ok(job, 'the employment row was saved');
  assert.equal(job.startDate, null, 'unknown start date is SQL NULL');
  assert.equal(job.endDate, null, 'blank end date means current, not invalid empty date text');
});

test('an unscheduled task keeps its optional date and links null for PostgreSQL', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await navTo('Activities');
  await change(
    byPlaceholder('Add a task, e.g. Collect documents from Ishaan'),
    'Prepare a sourcing brief',
  );
  await press('Add task');
  await settle(3);
  const task = store().tasks.find((t) => t.title === 'Prepare a sourcing brief');
  assert.ok(task, 'the task was created');
  assert.equal(task.due, null, 'an empty date is sent as NULL, not invalid empty date text');
  assert.equal(task.candidateId, null);
  assert.equal(task.demandId, null);
});

test('an admin can enable the offer approval policy from workspace settings', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await openSettings();
  const approvalToggle = screen.getByLabelText('Require admin approval before offers are sent');
  assert.equal(approvalToggle.checked, false, 'the demo policy starts opt-in');
  await click(approvalToggle);
  await press('Save guardrails');
  await settle(3);
  assert.equal(
    store().settings.find((row) => row.id === 'workspace').custom.offerApprovals,
    true,
    'the policy is actually persisted in the workspace settings',
  );
});

test('the workspace backup downloads JSON that describes every table', async () => {
  await boot();
  await mount(M.App, {});
  await settle(6);
  await openSettings();
  resetDownloads();
  await press('Download workspace backup (JSON)');
  await settle(3);
  assert.equal(downloaded.length, 1, 'one file was downloaded');
  assert.match(downloaded[0].name, /\.json$/);
  const backup = JSON.parse(await blobText(downloaded[0].blob));
  for (const table of [
    'candidates',
    'demands',
    'considerations',
    'consents',
    'interviews',
    'offers',
  ]) {
    assert.ok(Array.isArray(backup[table]), `the backup carries ${table}`);
  }
  assert.ok(backup.candidates.length > 0, 'with the repository in it');
  assert.equal(backup.candidates[0].name, makeSeed().candidates[0].name, 'and it is the real data');
});
