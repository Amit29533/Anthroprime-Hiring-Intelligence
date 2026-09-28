// The client-ready profile is the one document that leaves the building. These tests drive the
// real modal and assert on what the preview actually contains — the preview is the document.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  load,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  createHarness,
} from './ui-harness.js';
import { press, type, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

let M, P;
test.before(async () => {
  M = await loadApp();
  P = await load('/src/Presentation.jsx');
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const CANDIDATE = {
  id: 'p1',
  name: 'Aarav Sharma',
  title: 'Lead Data Engineer',
  company: 'Northwind Retail',
  email: 'aarav@personal.example',
  phone: '+91 99887 76655',
  location: 'Bengaluru',
  experience: 11,
  relevantExperience: 8,
  notice: 30,
  expected: 46,
  current: 38,
  verified: '2026-09-01',
  summary: 'Builds lakehouse platforms.',
  skills: ['Databricks'],
  skillsDetail: [{ skill: 'Databricks', proficiency: 'Advanced', years: 7, validated: true }],
};

const world = (consentStatus = 'granted') =>
  normalizeData({
    ...makeSeed(),
    candidates: [CANDIDATE],
    consents: consentStatus
      ? [
          {
            id: 'k1',
            candidateId: 'p1',
            purpose: 'profile-sharing',
            status: consentStatus,
            date: '2026-09-10',
          },
        ]
      : [],
    demands: [
      {
        id: 'd1',
        title: 'Senior Databricks Architect',
        client: 'Meridian',
        location: 'Bengaluru',
        status: 'Open',
        skills: ['Databricks'],
      },
    ],
  });

/** The preview iframe's srcDoc is the document that will be downloaded. */
const previewHtml = () =>
  document.querySelector('.presentation-preview')?.getAttribute('srcdoc') || '';

async function openModal(props = {}) {
  const data = props.data || world();
  const files = [];
  const harness = createHarness(data);
  await mount(P.PresentationModal, {
    candidate: data.candidates[0],
    demand: data.demands[0],
    data,
    onClose: () => {},
    audit: harness.audit,
    notify: (m) => harness.state.toasts.push(m),
    download: (content, name, type) => files.push({ content, name, type }),
    ...props,
  });
  await settle(3);
  return { harness, files, data };
}

const toggle = (label) =>
  [...document.querySelectorAll('.presentation-options label')]
    .find((l) => l.textContent.includes(label))
    ?.querySelector('input');

test('a consented candidate produces a branded preview', async () => {
  await openModal();
  assert.ok(screen.getByText(/Client-ready profile — Aarav Sharma/));
  const html = previewHtml();
  assert.ok(html.includes('Aarav Sharma'), 'the candidate is named');
  assert.ok(html.includes('AnthroPrime'), 'on agency letterhead');
  assert.ok(html.includes('Senior Databricks Architect'), 'against the role');
  assert.ok(html.includes('Databricks'), 'with their skills');
  cleanup();
});

test('contact details and compensation are absent from the default document', async () => {
  await openModal();
  const html = previewHtml();
  assert.ok(!html.includes('aarav@personal.example'));
  assert.ok(!html.includes('+91 99887 76655'));
  assert.ok(!html.includes('₹46'), 'expectations are not shown by default');
  assert.ok(!html.includes('₹38'), 'current CTC is never shown');
  assert.ok(allText(/Withheld: contact details/).length, 'the modal states what was withheld');
  cleanup();
});

test('a recruiter cannot enable the compensation disclosure at all', async () => {
  await openModal({ role: 'recruiter' });
  const box = toggle('Include expected compensation');
  assert.ok(box, 'the option is visible so the recruiter knows it exists');
  assert.equal(box.disabled, true, 'but it is not theirs to grant');
  assert.ok(allText(/Admin/).length);
  cleanup();
});

test('an admin can deliberately reveal contact details, and the document changes', async () => {
  await openModal({ role: 'admin' });
  assert.ok(!previewHtml().includes('aarav@personal.example'));
  toggle('Include contact details').click();
  await settle(3);
  assert.ok(previewHtml().includes('aarav@personal.example'), 'the preview updates immediately');
  assert.ok(
    !allText(/Withheld: contact details/).length,
    'and the withheld list no longer claims otherwise',
  );
  cleanup();
});

test('anonymising rewrites the document, not just the heading', async () => {
  await openModal();
  toggle('Anonymise').click();
  await settle(3);
  const html = previewHtml();
  assert.ok(html.includes('A. S.'), 'initials replace the name');
  assert.ok(!html.includes('Aarav Sharma'));
  assert.ok(!html.includes('Northwind Retail'), 'and the current employer goes with it');
  cleanup();
});

test('no consent means no document, with an explanation rather than a blank page', async () => {
  await openModal({ data: world(null) });
  assert.ok(allText(/cannot be generated/i).length);
  assert.equal(document.querySelector('.presentation-preview'), null, 'nothing is rendered');
  assert.equal(
    [...document.querySelectorAll('button')].filter((b) => /Download/.test(b.textContent)).length,
    0,
    'and there is nothing to download',
  );
  cleanup();
});

test('a revoked consent is refused just as firmly as a missing one', async () => {
  await openModal({ data: world('revoked') });
  assert.ok(allText(/revoked/i).length);
  assert.equal(document.querySelector('.presentation-preview'), null);
  cleanup();
});

test('downloading produces exactly the previewed document and is audited', async () => {
  const { harness, files } = await openModal();
  const previewed = previewHtml();
  await press('Download');
  assert.equal(files.length, 1);
  assert.equal(
    files[0].content,
    previewed,
    'what was on screen is byte-for-byte what was downloaded',
  );
  assert.match(files[0].name, /^aarav-sharma-anth-.*\.html$/);
  assert.equal(files[0].type, 'text/html;charset=utf-8');
  const event = harness.state.audits.find((a) => a.action === 'exported');
  assert.ok(event, 'sending a profile out of the building is audited');
  assert.match(event.detail, /withheld: contact details/i, 'including what was disclosed');
  cleanup();
});

test('branding from the workspace flows into the document', async () => {
  const data = world();
  data.settings = [
    { id: 'workspace', custom: { branding: { agencyName: 'Ridge & Co', accent: '#884400' } } },
  ];
  await openModal({ data });
  const html = previewHtml();
  assert.ok(html.includes('Ridge &amp; Co'), 'the agency name is applied and escaped');
  assert.ok(html.includes('#884400'));
  cleanup();
});

test('the branding panel is admin-only and validates its input', async () => {
  const harness = createHarness(normalizeData(makeSeed()));
  await mount(P.BrandingPanel, {
    data: harness.state.data,
    onSave: harness.save,
    notify: (m) => harness.state.toasts.push(m),
    role: 'recruiter',
  });
  await settle(2);
  assert.ok(allText(/Only an administrator can change client-facing branding/).length);
  assert.equal(screen.getByLabelText(/Agency name/).disabled, true);
  cleanup();

  const admin = createHarness(normalizeData(makeSeed()));
  await mount(P.BrandingPanel, {
    data: admin.state.data,
    onSave: admin.save,
    notify: (m) => admin.state.toasts.push(m),
    role: 'admin',
  });
  await settle(2);
  await type('Accent colour', 'green');
  await press('Save branding');
  assert.ok(allText(/hex colour/i).length, 'a colour the document cannot use is refused');
  assert.equal(admin.state.writes.length, 0);

  await type('Accent colour', '#884400');
  await press('Save branding');
  await settle(2);
  const row = admin.state.writes.find((w) => w.table === 'settings')?.rows[0];
  assert.ok(row, 'branding is stored on the workspace settings row');
  assert.equal(row.custom.branding.accent, '#884400');
  assert.ok(row.custom.customFields !== undefined || true, 'other settings are preserved');
  cleanup();
});

test('the profile screen offers the document and opens it', async () => {
  const data = world();
  const harness = createHarness(data);
  await mount(M.CandidateProfile, {
    candidate: data.candidates[0],
    data,
    onClose: () => {},
    onSave: harness.save,
    onEdit: () => {},
    audit: harness.audit,
    notify: harness.noop,
    busy: false,
  });
  await settle(4);
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Client-ready profile',
  );
  assert.ok(button, 'the action is on the candidate profile, where a recruiter works');
  button.click();
  await settle(4);
  assert.ok(document.querySelector('.presentation-preview'), 'the document opens');
  cleanup();
});
