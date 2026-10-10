// Referrals through the real screens. The behaviour that matters most is the privacy one: a
// referred person is a third party who never applied, so they must not silently become a
// candidate record.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  click,
  screen,
  cleanup,
  stopVite,
  settle,
  createHarness,
} from './ui-harness.js';
import { navTo, press, type, choose, submitVia, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData, TABLES } from '../src/schema.js';

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

const referral = (over = {}) => ({
  id: 'r1',
  referrerName: 'Priya Raman',
  referrerEmail: 'priya@anthroprime.example',
  referrerType: 'Employee',
  refereeName: 'Devika Iyer',
  refereeEmail: 'devika@example.com',
  refereePhone: '',
  refereeLinkedin: '',
  relationship: 'Former colleague',
  note: 'Strong lakehouse background.',
  demandId: null,
  candidateId: null,
  status: 'New',
  outcome: '',
  rewardStatus: 'Not eligible',
  rewardNote: '',
  source: 'In-app',
  created: '2026-09-01',
  ...over,
});

const world = (referrals = []) => normalizeData({ ...makeSeed(), referrals });

async function page(referrals = [], props = {}) {
  const data = props.data || world(referrals);
  const harness = createHarness(data);
  const opened = [];
  const modals = [];
  await mount(M.Referrals, {
    data,
    onNew: () => modals.push({ type: 'new' }),
    onEdit: (r) => modals.push({ type: 'edit', r }),
    onConvert: (r) => modals.push({ type: 'convert', r }),
    onOpenCandidate: (id) => opened.push(id),
    busy: false,
    ...props,
  });
  await settle(3);
  return { harness, opened, modals, data };
}

test('an empty workspace explains where referrals come from', async () => {
  await page();
  assert.ok(screen.getByText('No referrals yet'));
  assert.ok(allText(/careers page/i).length, 'the public route is mentioned');
  cleanup();
});

test('referrals are listed with both sides and their state', async () => {
  await page([
    referral(),
    referral({ id: 'r2', refereeName: 'Amit Bose', status: 'Hired', rewardStatus: 'Pending' }),
  ]);
  assert.ok(screen.getByText('Devika Iyer'));
  assert.ok(screen.getByText('Amit Bose'));
  assert.ok(allText(/Priya Raman/).length, 'the referrer is shown');
  // "Hired" and "Pending" also appear in the filter dropdowns, so scope to the table body.
  const body = document.querySelector('tbody').textContent;
  assert.ok(body.includes('Hired'), 'the status is badged on the row');
  assert.ok(body.includes('Pending'), 'and so is the reward state');
  cleanup();
});

test('a hire rate is withheld until enough referrals exist to justify one', async () => {
  await page([referral({ id: 'a', status: 'Hired' })]);
  await click(screen.getByRole('button', { name: /^Referral insights/ }));
  assert.ok(allText(/1 hired/).length, 'the count is always shown');
  assert.equal(
    document.body.textContent.includes('100%'),
    false,
    'one lucky hire is never presented as a 100% hire rate',
  );
  cleanup();

  await page([
    referral({ id: 'a', status: 'Hired' }),
    referral({ id: 'b', status: 'New' }),
    referral({ id: 'c', status: 'Not proceeding' }),
  ]);
  await click(screen.getByRole('button', { name: /^Referral insights/ }));
  assert.ok(document.body.textContent.includes('33%'), 'three referrals is enough to quote one');
  cleanup();
});

test('an unconverted referral offers conversion; a converted one opens the profile', async () => {
  const { modals } = await page([referral()]);
  await press('Add as candidate');
  assert.equal(modals.length, 1);
  assert.equal(modals[0].type, 'convert', 'conversion is an explicit step, never automatic');
  cleanup();

  const withProfile = await page([referral({ candidateId: 'c1' })]);
  assert.equal(screen.queryByText('Add as candidate'), null, 'already converted');
  await press('Open profile');
  assert.deepEqual(withProfile.opened, ['c1']);
  cleanup();
});

test('a viewer can read referrals but cannot act on them', async () => {
  await page([referral()], { role: 'viewer' });
  assert.ok(screen.getByText('Devika Iyer'), 'the list is visible');
  assert.equal(screen.queryByText('Record referral'), null);
  assert.equal(screen.queryByText('Add as candidate'), null);
  assert.equal(screen.queryByText('Edit'), null);
  cleanup();
});

test('converting creates a candidate AND a consent record in the same action', async () => {
  const data = world([referral()]);
  const harness = createHarness(data);
  await mount(M.ConvertReferralModal, {
    referral: data.referrals[0],
    data,
    onClose: () => {},
    onSave: harness.save,
    audit: harness.audit,
    notify: (m) => harness.state.toasts.push(m),
    busy: false,
  });
  await settle(2);
  await press('Create candidate');
  await settle(3);

  const candidate = harness.state.writes.find((w) => w.table === 'candidates')?.rows[0];
  const consent = harness.state.writes.find((w) => w.table === 'consents')?.rows[0];
  const updated = harness.state.writes.find((w) => w.table === 'referrals')?.rows[0];
  assert.ok(candidate, 'a profile is created');
  assert.equal(candidate.source, 'Referral');
  assert.ok(consent, 'and a consent record is written in the same action');
  assert.equal(consent.candidateId, candidate.id);
  assert.match(consent.note, /happy to be contacted/, 'the stated basis is recorded verbatim');
  assert.equal(updated.candidateId, candidate.id, 'the referral is linked to the profile');
  assert.ok(
    harness.state.audits.some((a) => a.action === 'converted'),
    'and it is audited',
  );
  cleanup();
});

test('converting warns when that person is already in the repository', async () => {
  const data = world([referral()]);
  data.candidates = [{ ...data.candidates[0], email: 'devika@example.com', name: 'Devika I.' }];
  const harness = createHarness(data);
  await mount(M.ConvertReferralModal, {
    referral: data.referrals[0],
    data,
    onClose: () => {},
    onSave: harness.save,
    audit: () => {},
    notify: () => {},
    busy: false,
  });
  await settle(2);
  assert.ok(allText(/Already in the repository/).length);
  assert.ok(allText(/second profile/).length, 'the consequence is spelled out');
  cleanup();
});

test('the form refuses a referral nobody could act on', async () => {
  const data = world([]);
  const harness = createHarness(data);
  await mount(M.ReferralForm, {
    data,
    onClose: () => {},
    onSave: harness.save,
    busy: false,
  });
  await settle(2);
  await type('Referrer name', 'Priya Raman');
  await type('Name', 'Devika Iyer');
  await submitVia('Record referral');
  await settle(2);
  assert.ok(allText(/email, phone or LinkedIn/i).length);
  assert.equal(harness.state.writes.length, 0, 'nothing is stored');

  await type('Email', 'devika@example.com');
  await submitVia('Record referral');
  await settle(2);
  const row = harness.state.writes.find((w) => w.table === 'referrals')?.rows[0];
  assert.ok(row, 'a reachable referral saves');
  assert.equal(row.status, 'New');
  assert.equal(row.candidateId, null, 'and does not become a candidate on the way in');
  cleanup();
});

test('a duplicate referral for the same role is refused in the form', async () => {
  const data = world([referral({ demandId: null })]);
  const harness = createHarness(data);
  await mount(M.ReferralForm, { data, onClose: () => {}, onSave: harness.save, busy: false });
  await settle(2);
  await type('Referrer name', 'Someone Else');
  await type('Name', 'Devika Iyer');
  await type('Email', 'DEVIKA@example.com');
  await submitVia('Record referral');
  await settle(2);
  assert.ok(allText(/already been referred/i).length);
  assert.equal(harness.state.writes.length, 0);
  cleanup();
});

test('the page is reachable from the sidebar and records a referral end to end', async () => {
  localStorage.removeItem('ecod-demo-v1');
  await mount(M.App, {});
  await settle(6);
  await navTo('Referrals');
  assert.ok(screen.getByRole('heading', { name: 'Referrals', level: 1 }));
  await press('Record referral');
  await type('Referrer name', 'Priya Raman');
  await type('Referrer email', 'priya@anthroprime.example');
  await choose('Referrer type', 'Employee');
  await type('Name', 'Devika Iyer');
  await type('Email', 'devika@example.com');
  await submitVia('Record referral');
  await settle(4);
  const saved = (store().referrals || []).find((r) => r.refereeName === 'Devika Iyer');
  assert.ok(saved, 'the referral persisted to the workspace');
  assert.equal(saved.source, 'In-app');
  assert.equal(saved.candidateId, null);
  cleanup();
});

test('every table exists on a fresh demo workspace', async () => {
  // makeSeed() only produces the tables it has sample data for, so loadData() must normalize it.
  // Without that, the first save to a newer table crashed on `current[table]` — which is exactly
  // what happened to reports (batch 20) and referrals, and was missed because the report UI test
  // used a stubbed save rather than the real one.
  localStorage.removeItem('ecod-demo-v1');
  const { loadData } = await import('../src/repository.js');
  const fresh = await loadData();
  for (const table of TABLES)
    assert.ok(
      Array.isArray(fresh[table]),
      `${table} must be an array on a fresh workspace, or the first save to it throws`,
    );
});
