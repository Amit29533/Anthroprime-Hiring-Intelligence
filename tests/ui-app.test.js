// Drives the real application shell the way a recruiter does: mount App, click through every
// page, and assert the workspace behaves. This is the suite that catches prop-wiring bugs — a
// page that renders happily but whose buttons call an undefined handler — which SSR cannot see.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  loadApp,
  mount,
  act,
  fireEvent,
  click,
  change,
  screen,
  cleanup,
  stopVite,
  settle,
  downloaded,
  resetDownloads,
} from './ui-harness.js';
import {
  navTo,
  press,
  type,
  choose,
  allLabelled,
  submitVia,
  allText,
  withWindow,
  pressPrefixed,
} from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { validateCandidate, MAX_EXPERIENCE_YEARS, MAX_NOTICE_DAYS } from '../src/domain.js';
import { MAX_DOCX_XML_BYTES } from '../src/documents.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
// A failing assertion must not leave its DOM behind for the next test to trip over.
afterEach(() => cleanup());

const store = () => JSON.parse(localStorage.getItem('ecod-demo-v1'));
const putStore = (data) => localStorage.setItem('ecod-demo-v1', JSON.stringify(data));

test('workspace search supports shortcuts, accessible results and clear/dismiss actions', async () => {
  await boot();
  const search = screen.getByRole('combobox', { name: 'Search your workspace' });
  await act(async () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true }));
  assert.equal(document.activeElement, search);
  await change(search, 'Aarav');
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByRole('listbox', { name: 'Search results' }));
  assert.ok(document.getElementById(search.getAttribute('aria-activedescendant')));
  await act(async () => fireEvent.keyDown(search, { key: 'Escape' }));
  assert.equal(search.getAttribute('aria-expanded'), 'false');
  await act(async () => fireEvent.submit(search.closest('form')));
  assert.equal(screen.queryByRole('dialog'), null, 'dismissed results cannot be opened by Enter');
  await act(async () => fireEvent.keyDown(search, { key: 'ArrowDown' }));
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  await click(screen.getByRole('button', { name: 'Clear workspace search' }));
  assert.equal(search.value, '');
  assert.equal(document.activeElement, search);
  await press('Create demand');
  const focused = document.activeElement;
  await act(async () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true }));
  assert.equal(document.activeElement, focused, 'shortcut respects an open modal');
});

test('theme preference cycles, persists and survives reopening the workspace', async () => {
  localStorage.removeItem('ecod-theme-v1');
  await boot();
  await click(screen.getByRole('button', { name: 'Theme: system. Switch to dark' }));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(localStorage.getItem('ecod-theme-v1'), 'dark');
  cleanup();
  await boot();
  assert.ok(screen.getByRole('button', { name: 'Theme: dark. Switch to light' }));
  await click(screen.getByRole('button', { name: 'Theme: dark. Switch to light' }));
  assert.equal(document.documentElement.dataset.theme, 'light');
  await click(screen.getByRole('button', { name: 'Theme: light. Switch to system' }));
  assert.equal(localStorage.getItem('ecod-theme-v1'), 'system');
});

test('notification panel can be dismissed with Escape and restores focus', async () => {
  await boot();
  const bell = screen.getByRole('button', { name: /items need attention|Nothing needs attention/ });
  await click(bell);
  assert.equal(bell.getAttribute('aria-expanded'), 'true');
  await act(async () => fireEvent.keyDown(document, { key: 'Escape' }));
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, bell);
});

test('dashboard work counts open the matching records and the filter can be cleared', async () => {
  const seed = makeSeed();
  seed.tasks = [
    { id: 'mine', title: 'My overdue task', owner: 'Amit Singh', due: '2020-01-01', done: false },
    {
      id: 'theirs',
      title: 'Another recruiter task',
      owner: 'Another person',
      due: '2020-01-01',
      done: false,
    },
  ];
  await boot(seed);
  await click(screen.getByRole('button', { name: /1\s*Overdue/ }));
  await screen.findByRole('heading', { name: 'Every conversation counts.' }, { timeout: 30000 });
  assert.ok(screen.getByText('My overdue task'));
  assert.equal(screen.queryByText('Another recruiter task'), null);
  await click(screen.getByRole('button', { name: 'Show all' }));
  await settle(4);
  assert.ok(screen.getByText('Another recruiter task'));
});

/** Boot the shell against a clean demo workspace. */
async function boot(seed) {
  localStorage.removeItem('ecod-demo-v1');
  if (seed) putStore(seed);
  const view = await mount(M.App, {});
  await settle(6);
  return view;
}

function compressedDocx(xml) {
  const source = new TextEncoder().encode(xml);
  const compressed = deflateRawSync(source);
  const name = new TextEncoder().encode('word/document.xml');
  const archive = new Uint8Array(30 + name.length + compressed.length);
  const view = new DataView(archive.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, 8, true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, source.length, true);
  view.setUint16(26, name.length, true);
  archive.set(name, 30);
  archive.set(compressed, 30 + name.length);
  return archive;
}

test('the workspace opens on the dashboard with seeded demands and follow-ups', async () => {
  await boot();
  assert.ok(screen.getByText('Your next great hire is already here.'), 'dashboard heading');
  assert.ok(screen.getByText('Active demands'), 'active demands panel');
  assert.ok(screen.getByText('On your radar'), 'follow-up panel');
  assert.ok(screen.getByText('Repository health'), 'freshness panel');
  assert.ok(screen.getByText('Senior Databricks Architect'), 'a seeded demand is listed');
  assert.ok(screen.getByText(/Demo workspace/), 'demo mode is labelled, never passed off as cloud');
  cleanup();
});

test('every navigation item opens its own page', async () => {
  await boot();
  const expected = [
    ['Candidates', 'Talent repository'],
    ['Demands', 'Find the people behind every possibility.'],
    ['Pipeline', 'Hiring pipeline'],
    ['Talent pools', 'A network, organized around possibility.'],
    ['Assessments', 'Build confidence in every candidate.'],
    ['Interviews', 'Interviews & offers'],
    ['Activities', 'Every conversation counts.'],
    ['Analytics', 'Talent intelligence, in perspective.'],
  ];
  for (const [page, heading] of expected) {
    await navTo(page);
    assert.ok(screen.getByText(heading), `${page} rendered "${heading}"`);
  }
  await press('Workspace settings');
  assert.ok(screen.getByText('A foundation for better recruiting.'), 'settings rendered');
  cleanup();
});

test('a candidate can be created from the repository and persists to the demo store', async () => {
  await boot();
  await navTo('Candidates');
  await press('Add candidate');
  await type('Full name', 'Test Recruitee');
  await type('Email', 'test.recruitee@example.com');
  await type('Location', 'Bengaluru');
  await type('Current title', 'Data Engineer');
  await type('Skills', 'Python, spark, databricks');
  await submitVia('Add candidate');
  const saved = store().candidates.find((c) => c.email === 'test.recruitee@example.com');
  assert.ok(saved, 'the profile reached the demo store');
  // "spark" normalises to the canonical skill and the duplicate "databricks" collapses.
  assert.deepEqual(
    saved.skills,
    ['Python', 'Apache Spark', 'Databricks'],
    'aliases normalised without duplicates',
  );
  assert.equal(saved.skillsDetail.length, 3, 'a skill-evidence row is created for every skill');
  assert.ok(screen.getByText('Saved to your repository.'), 'the recruiter is told the save landed');
  cleanup();
});

test('the form refuses a bad phone number and a duplicate identity', async () => {
  await boot();
  await navTo('Candidates');
  await press('Add candidate');
  await type('Full name', 'Bad Contact');
  await type('Email', 'bad.contact@example.com');
  await type('Phone', 'call me maybe');
  await type('Location', 'Bengaluru');
  await type('Current title', 'Engineer');
  await type('Skills', 'Python');
  await submitVia('Add candidate');
  assert.ok(
    screen.getByText('Enter a valid phone number with country code (7–15 digits).'),
    'validation blocks the save',
  );
  assert.ok(!store()?.candidates.some((c) => c.name === 'Bad Contact'), 'nothing was persisted');

  // Malformed emails never even reach validateCandidate: the field is type="email", so the
  // browser's own constraint validation stops the submit first. Assert that guard is wired.
  assert.equal(screen.getByLabelText(/^Email/).type, 'email', 'email format is gated natively');

  // Reusing an identity that already exists in the repository is caught by the app itself.
  const existing = makeSeed().candidates.find((c) => c.email);
  await type('Phone', '');
  await type('Email', existing.email);
  await submitVia('Add candidate');
  assert.ok(
    screen.getByText(/already uses this email or phone/),
    'a duplicate identity is refused',
  );
  assert.ok(!store()?.candidates.some((c) => c.name === 'Bad Contact'), 'still nothing persisted');

  await type('Email', 'bad.contact@example.com');
  await submitVia('Add candidate');
  assert.ok(
    store().candidates.some((c) => c.name === 'Bad Contact'),
    'a valid, unique profile saves',
  );
  cleanup();
});

test('one ceiling governs the form, the validator and the CSV importer', async () => {
  await boot();
  await navTo('Candidates');
  await press('Add candidate');
  // B5: the inputs used to hardcode 60/365 while the importer enforced nothing at all, so a
  // CSV row could smuggle in experience=9999. Both ends now read the same exported constant.
  assert.equal(
    Number(screen.getByLabelText(/^Total experience/).max),
    MAX_EXPERIENCE_YEARS,
    'the form input max comes from the shared constant',
  );
  assert.equal(Number(screen.getByLabelText(/^Relevant experience/).max), MAX_EXPERIENCE_YEARS);
  assert.equal(
    Number(screen.getByLabelText(/^Notice period/).max),
    MAX_NOTICE_DAYS,
    'the notice input max comes from the shared constant',
  );
  cleanup();

  // And the shared validator refuses the same values however the profile arrives.
  assert.equal(
    validateCandidate({
      name: 'Time Traveller',
      email: 'tt@example.com',
      experience: MAX_EXPERIENCE_YEARS + 30,
    }),
    `Total experience cannot exceed ${MAX_EXPERIENCE_YEARS} years.`,
  );
  assert.equal(
    validateCandidate({
      name: 'Time Traveller',
      email: 'tt@example.com',
      relevantExperience: MAX_EXPERIENCE_YEARS + 1,
    }),
    `Relevant experience cannot exceed ${MAX_EXPERIENCE_YEARS} years.`,
  );
  assert.equal(
    validateCandidate({
      name: 'Time Traveller',
      email: 'tt@example.com',
      notice: MAX_NOTICE_DAYS + 1,
    }),
    `Notice period cannot exceed ${MAX_NOTICE_DAYS} days.`,
  );
  assert.equal(
    validateCandidate({
      name: 'Sane Person',
      email: 'sane@example.com',
      experience: 12,
      relevantExperience: 6,
      notice: 30,
    }),
    null,
    'a realistic profile still passes',
  );
});

test('saving a view persists the search, filters and sort', async () => {
  await boot();
  await navTo('Candidates');
  await change(screen.getByLabelText('Search your workspace'), 'databricks');
  await settle();
  await withWindow(
    'prompt',
    () => 'Databricks bench',
    () => press('Save current view'),
  );
  await settle(3);
  const views = store().settings.find((s) => s.id === 'workspace').custom.savedViews;
  assert.equal(views.length, 1, 'the view was persisted');
  assert.equal(views[0].name, 'Databricks bench');
  assert.equal(views[0].filters.query, 'databricks', 'the search text is part of the saved view');
  assert.ok(screen.getByText('View "Databricks bench" saved.'), 'confirmation shown');
  cleanup();
});

test('deleting a saved view by a name that does not exist says so instead of silently doing nothing', async () => {
  const seed = makeSeed();
  seed.settings = [
    {
      id: 'workspace',
      custom: { savedViews: [{ id: 'v1', name: 'Kept view', filters: { query: '' } }] },
    },
  ];
  await boot(seed);
  await navTo('Candidates');
  await withWindow(
    'prompt',
    () => 'Not A Real View',
    () => press('Delete a view'),
  );
  await settle(3);
  assert.ok(screen.getByText(/No saved view is named/), 'the mismatch is reported');
  assert.equal(
    store().settings.find((s) => s.id === 'workspace').custom.savedViews.length,
    1,
    'nothing was deleted',
  );
  cleanup();
});

test('bulk readiness updates every selected profile', async () => {
  await boot();
  await navTo('Candidates');
  const boxes = allLabelled('Select ');
  assert.ok(boxes.length > 2, 'row checkboxes are labelled with the candidate name');
  await click(boxes[1]);
  await click(boxes[2]);
  await settle();
  assert.ok(screen.getByText('2 selected'), 'the bulk bar reports the selection');
  // Bulk actions are now two-step: choose, preview what will change, then commit.
  await choose('Bulk action', 'status');
  await choose('Bulk value', 'Ready');
  await press('Preview');
  await pressPrefixed('Apply to');
  await settle(3);
  assert.ok(
    store().candidates.filter((c) => c.status === 'Ready').length >= 2,
    'statuses were written',
  );
  cleanup();
});

test('exporting the repository downloads a CSV and records an audit event', async () => {
  await boot();
  await navTo('Candidates');
  resetDownloads();
  await press('Export');
  await settle(4);
  assert.equal(downloaded.length, 1, 'exactly one file was downloaded');
  assert.equal(downloaded[0].name, 'ecod-candidates.csv');
  assert.ok(
    store().auditEvents.some((e) => e.action === 'exported' && /candidates/.test(e.detail)),
    'the export appears in the audit trail',
  );
  cleanup();
});

test('opening a profile records a view and editing keeps the reader on their tab', async () => {
  await boot();
  await navTo('Candidates');
  await click(allText('Aarav Mehta')[0]);
  await settle(3);
  assert.ok(screen.getByText('Candidate 360'), 'the profile drawer opened');
  await press('ECOD');
  assert.ok(screen.getByText('ECOD readiness'), 'the ECOD tab shows its content');
  await press('Edit');
  assert.ok(screen.getByText('Edit candidate'), 'the edit form opened over the profile');
  await press('Cancel');
  await settle(2);
  assert.ok(screen.queryByText('ECOD readiness'), 'returned to ECOD, not reset to Overview');
  assert.ok(
    store().auditEvents.some((e) => e.action === 'viewed' && e.detail === 'Aarav Mehta'),
    'the profile view was audited (blueprint §12)',
  );
  cleanup();
});

test('a DOCX zip bomb is retained for manual review without unbounded extraction', async () => {
  await boot();
  await navTo('Candidates');
  await click(allText('Aarav Mehta')[0]);
  await settle(3);
  await press('Documents');

  const fileInput = document.querySelector('input[type="file"]');
  const file = new File(
    [compressedDocx(`<w:document>${'x'.repeat(MAX_DOCX_XML_BYTES * 2)}</w:document>`)],
    'oversized-cv.docx',
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  );
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
  });
  const uploadDeadline = Date.now() + 5000;
  let saved;
  while (!saved && Date.now() < uploadDeadline) {
    await settle(1);
    saved = store()?.documents?.find((row) => row.name === 'oversized-cv.docx');
  }
  await settle(3);
  assert.ok(saved, 'the recruiter can keep the source file');
  assert.equal(saved.parserStatus, 'manual', 'over-limit text is never labeled as parsed');
  assert.equal(saved.extracted, '');
  assert.ok(saved.dataUrl, 'the original remains attached in demo mode');
  assert.ok(screen.getByText(/Text could not be extracted automatically/));
  assert.ok(screen.getByText('Saved to your repository.'));
  cleanup();
});

test('skill evidence can be edited and saved from the profile', async () => {
  await boot();
  await navTo('Candidates');
  await click(allText('Aarav Mehta')[0]);
  await settle(3);
  await press('Skills & assessments');
  const proficiency = allLabelled('Proficiency for Databricks')[0];
  assert.ok(proficiency, 'per-skill proficiency control is present');
  await change(proficiency, 'Expert');
  // Aarav is seeded with this skill already validated, so drive to the checked state
  // rather than assuming a starting value.
  const validated = allLabelled('Validated Databricks')[0];
  if (!validated.checked) await click(validated);
  await settle();
  await press('Save skill evidence');
  await settle(3);
  const row = store()
    .candidates.find((c) => c.name === 'Aarav Mehta')
    .skillsDetail.find((s) => s.skill === 'Databricks');
  assert.equal(row.proficiency, 'Expert');
  assert.equal(row.validated, true);
  assert.equal(row.confidence, 90, 'validation raises confidence');
  cleanup();
});

test('a demand can be created from a pasted JD and every match stays explainable', async () => {
  await boot();
  await navTo('Demands');
  await press('Create demand');
  await type(
    'Job description',
    'We need a senior engineer with 8 years of experience in Databricks and Unity Catalog on Azure. Notice period 30 days. Bengaluru hybrid.',
  );
  await press('Extract requirements');
  await settle();
  assert.ok(
    screen.getByText(/Detected skills and numeric requirements are suggestions/),
    'extraction is presented as a reviewable draft, not a decision',
  );
  await type('Role title', 'Lakehouse Lead');
  await type('Client', 'Test Client');
  await type('Target start date', '2026-12-01');
  await click(screen.getByLabelText('Publish this role on the public careers page'));
  await submitVia('Create & find matches');
  assert.equal(
    store().demands.find((d) => d.title === 'Lakehouse Lead').careersVisible,
    true,
    'the role publication choice is saved with the demand',
  );
  assert.ok(
    screen.getByText('Your repository, matched.'),
    'the demand brief opened with its matches',
  );
  assert.ok(screen.getByText('Lakehouse Lead'), 'the new demand is the one being shown');
  const why = screen.queryAllByText('Why this match?');
  assert.ok(why.length > 0, 'every match offers an explanation');
  await click(why[0]);
  await settle();
  assert.ok(
    screen.queryByText('Requirement gaps') || screen.queryByText('Confirm before progressing'),
    'the breakdown separates hard failures from things still to verify',
  );
  cleanup();
});

test('JD extraction pulls skills, years and notice out of free text', async () => {
  await boot();
  await navTo('Demands');
  await press('Create demand');
  await type(
    'Job description',
    'Senior Databricks architect, 9 years experience, must know Unity Catalog and pyspark. 15 days notice preferred.',
  );
  await press('Extract requirements');
  await settle();
  const skills = screen.getByPlaceholderText('Databricks, Unity Catalog, Python');
  assert.match(skills.value, /Databricks/, 'canonical skill found');
  assert.match(skills.value, /Apache Spark/, 'the pyspark alias normalised');
  assert.match(skills.value, /Unity Catalog/);
  cleanup();
});

test('weights that only sum to 100 in decimal are accepted', async () => {
  await boot();
  await navTo('Demands');
  await press('Create demand');
  await type('Role title', 'Weight Probe');
  await type('Client', 'Probe Client');
  await type('Must-have skills', 'Databricks');
  await type('Target start date', '2026-12-01');
  // 33.4 + 33.3 + 33.3 === 99.99999999999999 in binary floating point.
  await type('Skills (%)', '33.4');
  await type('Experience (%)', '33.3');
  await type('Readiness (%)', '33.3');
  await type('Availability (%)', '0');
  await type('Budget (%)', '0');
  await type('Location (%)', '0');
  await submitVia('Create & find matches');
  assert.ok(!screen.queryByText('Matching weights must add up to 100%.'), 'no false rejection');
  assert.ok(screen.getByText('Your repository, matched.'), 'the demand was created');
  cleanup();
});

test('weights that really do not sum to 100 are still refused', async () => {
  await boot();
  await navTo('Demands');
  await press('Create demand');
  await type('Role title', 'Bad Weights');
  await type('Client', 'Probe Client');
  await type('Must-have skills', 'Databricks');
  await type('Target start date', '2026-12-01');
  await type('Skills (%)', '50');
  await submitVia('Create & find matches');
  assert.ok(screen.getByText('Matching weights must add up to 100%.'), 'the guard still works');
  cleanup();
});

test('moving a candidate out of a rejected stage keeps the disposition on record', async () => {
  const seed = makeSeed();
  seed.considerations[0].stage = 'Rejected';
  seed.considerations[0].reason = 'Skill gap: Unity Catalog';
  await boot(seed);
  await navTo('Pipeline');
  await click(screen.getByLabelText('Show rejected & withdrawn'));
  await settle();
  const selects = allLabelled('Stage for ');
  const target = selects.find((s) => s.value === 'Rejected');
  assert.ok(target, 'the rejected card is visible once closed stages are shown');
  await change(target, 'Interview');
  await settle(5);
  const after = store();
  const moved = after.considerations.find((c) => c.id === seed.considerations[0].id);
  assert.equal(moved.stage, 'Interview');
  assert.equal(moved.reason, '', 'the live row no longer claims a disposition');
  assert.ok(
    after.notes.some((n) =>
      /Previously recorded disposition: Skill gap: Unity Catalog/.test(n.text),
    ),
    'the reason survives as a dated interaction note instead of vanishing',
  );
  cleanup();
});

test('marking a consideration rejected requires a structured reason', async () => {
  await boot();
  await navTo('Pipeline');
  const select = allLabelled('Stage for ')[0];
  await change(select, 'Rejected');
  await screen.findByText(/Mark as rejected/i, {}, { timeout: 10000 });
  assert.ok(
    screen.getByText(/Mark as rejected/i),
    'the disposition dialog opens rather than saving silently',
  );
  await submitVia('Save outcome');
  assert.ok(screen.getByText(/Mark as rejected/i), 'the dialog refuses to close without a reason');
  await choose('Reason', 'Compensation mismatch');
  await type('Additional context', 'Expectation was double the budget.');
  await submitVia('Save outcome');
  const after = store();
  assert.ok(
    after.considerations.some(
      (c) => c.stage === 'Rejected' && c.reason.startsWith('Compensation mismatch'),
    ),
    'the reason code and the free text are both stored',
  );
  cleanup();
});

test('a closed demand locks pipeline moves and says why', async () => {
  const seed = makeSeed();
  seed.demands[0].status = 'Closed';
  await boot(seed);
  await navTo('Pipeline');
  assert.ok(
    screen.getByText(/pipeline moves are locked/i),
    'the lock is explained, not just silently disabled',
  );
  assert.equal(allLabelled('Stage for ')[0].disabled, true, 'stage moves are refused');
  cleanup();
});

test('an analytics quality queue drills into the filtered repository', async () => {
  await boot();
  await navTo('Analytics');
  assert.ok(screen.getByText('Data quality queues'));
  await click(screen.getByText('Missing email address').closest('button'));
  await settle(3);
  assert.ok(screen.getByText('Talent repository'), 'navigated to the repository');
  assert.ok(
    screen.getByText(/Quality filter: Missing email address/),
    'the queue is applied and visibly clearable',
  );
  cleanup();
});

test('a corrupt demo store offers recovery instead of a dead end', async () => {
  localStorage.setItem('ecod-demo-v1', '{ this is not json');
  await mount(M.App, {});
  await settle(5);
  assert.ok(screen.getByText('Unable to open the workspace'));
  assert.ok(screen.getByText(/Saved demo data is corrupt/), 'the message says what happened');
  await press('Reset demo data');
  await settle(6);
  assert.ok(screen.getByText('Your next great hire is already here.'), 'the workspace recovered');
  cleanup();
});

test('the dossier export downloads a self-contained, provenance-stamped document', async () => {
  await boot();
  await navTo('Candidates');
  await click(allText('Aarav Mehta')[0]);
  await settle(3);
  resetDownloads();
  await press('Dossier');
  await settle(3);
  assert.equal(downloaded.length, 1, 'one dossier downloaded');
  assert.match(downloaded[0].name, /^dossier-aarav-mehta\.html$/);
  cleanup();
});
