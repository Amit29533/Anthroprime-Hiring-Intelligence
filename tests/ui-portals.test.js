// The two public-facing surfaces. Blueprint D1/D3 (§12 consent) and the candidate portal are
// easy to render and hard to get right: they must read the *same* workspace a recruiter edits,
// must not publish a closed search, must not accept an application without consent, and must
// never show a candidate the recruiter-only half of their own record. These drive the real
// components against the real store, then follow one applicant all the way round the loop:
// careers page → recruiter accepts → profile + consent ledger → candidate withdraws consent.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, click, screen, cleanup, stopVite, settle } from './ui-harness.js';
import { navTo, press, type, allText, submitVia, rowOf, pressIn } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { validatePortalPayload } from '../src/portal.js';

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

test('an attributed feed application preserves its source through recruiter acceptance', async () => {
  await boot();
  history.replaceState({}, '', '/careers.html?source=Community%20board');
  try {
    await mount(M.CareersApp, {});
    await settle(6);
    await press('Apply');
    await type('Full name', 'Attributed Applicant');
    await type('Email', 'attributed@example.com');
    await click(screen.getByLabelText(/consent to AnthroPrime contacting me/));
    await submitVia('Submit application');
    assert.equal(
      store().publicApplications.find((a) => a.email === 'attributed@example.com').source,
      'Community board',
    );
    cleanup();
    history.replaceState({}, '', '/');
    await mount(M.App, {});
    await settle(6);
    await navTo('Activities');
    assert.ok(screen.getByText(/Source: Community board/));
    await pressIn(rowOf('Attributed Applicant'), 'Accept into repository');
    await settle(4);
    assert.equal(
      store().candidates.find((c) => c.email === 'attributed@example.com').source,
      'Community board',
    );
  } finally {
    history.replaceState({}, '', '/');
  }
});

test('the careers page publishes the recruiter workspace, not a frozen seed', async () => {
  const data = makeSeed();
  const open = data.demands.filter((d) => d.status === 'Open').length;
  data.demands.push({
    ...data.demands[0],
    id: 'demand-public-1',
    title: 'Public Test Role',
    status: 'Open',
    careersVisible: true,
  });
  data.demands.push({
    ...data.demands[0],
    id: 'demand-closed-1',
    title: 'Withdrawn Search',
    status: 'Closed',
  });
  data.demands.push({
    ...data.demands[0],
    id: 'demand-private-1',
    title: 'Internal-only Search',
    status: 'Open',
    careersVisible: false,
  });
  putStore(data);

  await mount(M.CareersApp, {});
  await settle(6);
  assert.ok(screen.getByText('Open roles'), 'the page renders its own heading');
  assert.ok(
    screen.getByText('Public Test Role'),
    'a demand the recruiter explicitly published appears',
  );
  assert.ok(
    !screen.queryByText('Withdrawn Search'),
    'a closed search is never advertised to applicants',
  );
  assert.ok(
    !screen.queryByText('Internal-only Search'),
    'an open role remains private until a recruiter publishes it',
  );
  assert.equal(
    allText('Apply').length,
    open + 1,
    'exactly one Apply control per published open role',
  );
});

test('applying needs a real email address and an explicit consent to be contacted', async () => {
  await boot();
  await mount(M.CareersApp, {});
  await settle(6);
  await press('Apply');

  await submitVia('Submit application');
  assert.ok(screen.getByText('Name and email are required.'), 'an empty form is refused');

  await type('Full name', 'Priya Applicant');
  // 'priya@localhost' satisfies the browser's own type="email" constraint but not the app's
  // stricter check — so this exercises the application's validation rather than the browser's.
  await type('Email', 'priya@localhost');
  await submitVia('Submit application');
  assert.ok(screen.getByText('Enter a valid email address.'), 'a domain-less email is refused');

  await type('Email', 'priya.applicant@example.com');
  await submitVia('Submit application');
  assert.ok(
    screen.getByText('We need your consent to contact you about this application.'),
    'consent is a precondition, not a footnote',
  );
  assert.ok(!store(), 'nothing at all is written before consent is given');
});

test('an applicant becomes a profile with a consent ledger they can then manage themselves', async () => {
  await boot();
  await mount(M.CareersApp, {});
  await settle(6);

  const roleTitle = document.querySelector('.careers-role h2').textContent;
  await press('Apply');
  await type('Full name', 'Priya Applicant');
  await type('Email', 'priya.applicant@example.com');
  await type('A few words about your fit', 'Five years building Databricks pipelines.');
  // Consent to being contacted, but deliberately NOT to profile sharing.
  await click(screen.getByLabelText(/consent to AnthroPrime contacting me/));
  await submitVia('Submit application');
  assert.ok(screen.getByText('Application received.'), 'the applicant gets a confirmation');

  const app = store().publicApplications.find((a) => a.email === 'priya.applicant@example.com');
  assert.ok(app, 'the application landed in the workspace queue, not a separate silo');
  assert.equal(app.status, 'pending');
  assert.equal(app.demandTitle, roleTitle, 'it remembers which role was applied for');
  assert.equal(app.consentContact, true);
  assert.equal(app.consentSharing, false, 'an unticked box is not consent');
  assert.ok(app.statusToken, 'each new application receives a private status code');
  assert.ok(screen.getByText(app.statusToken), 'the code is shown once on the confirmation screen');

  await click(screen.getByRole('button', { name: /^Track your application/ }));
  await type('Your email', 'priya.applicant@example.com');
  await type('Private application code', '00000000-0000-4000-8000-000000000000');
  await submitVia('Check status');
  assert.ok(
    screen.getByText('No application matched that email and private code.'),
    'email by itself or an incorrect code reveals no application status',
  );
  await type('Private application code', app.statusToken);
  await submitVia('Check status');
  assert.ok(screen.getByText('Received — in review'), 'the applicant can use the private code');
  cleanup();

  // A recruiter reviews the queue in Activities and accepts it.
  await mount(M.App, {});
  await settle(6);
  await navTo('Activities');
  assert.ok(
    screen.getByText(/Career applications/),
    'the public queue is visible to the recruiter',
  );
  assert.ok(screen.getByText('Priya Applicant'), 'and this applicant is in it');
  await pressIn(rowOf('Priya Applicant'), 'Accept into repository');
  await settle(4);

  const after = store();
  const person = after.candidates.find((c) => c.email === 'priya.applicant@example.com');
  assert.ok(person, 'accepting created a reusable profile');
  assert.equal(person.name, 'Priya Applicant');
  assert.equal(person.source, 'Career page', 'provenance is kept, per blueprint §1');
  assert.ok(
    person.summary.includes('Five years building Databricks pipelines.'),
    'their own words are kept',
  );
  const consents = after.consents.filter((x) => x.candidateId === person.id);
  assert.deepEqual(
    consents.map((c) => c.purpose),
    ['recruiting-contact'],
    'the ledger records exactly the consent that was given',
  );
  assert.equal(consents[0].status, 'granted');
  assert.equal(after.publicApplications.find((a) => a.id === app.id).status, 'accepted');
  const applicationNote = after.notes.find((n) => n.candidateId === person.id);
  assert.equal(
    applicationNote.followUp,
    null,
    'an application note with no follow-up date uses SQL NULL rather than an empty date string',
  );
  cleanup();

  // The applicant can now open their own record and withdraw that consent.
  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', 'priya.applicant@example.com');
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  assert.ok(screen.getByText('Welcome, Priya'), 'the portal opens on their own record');
  assert.ok(screen.getByText('recruiting-contact'), 'their consent is shown back to them');
  await pressIn(rowOf('recruiting-contact'), 'Withdraw');
  await settle(4);
  assert.ok(screen.getByText('Withdrawn'), 'the withdrawal is reflected immediately');

  const revoked = store().consents.find((x) => x.candidateId === person.id);
  assert.equal(revoked.status, 'revoked', 'withdrawal is recorded, not silently deleted');
});

test('the portal refuses an email that is not in the workspace', async () => {
  await boot();
  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', 'nobody@example.com');
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  assert.ok(
    screen.getByText('No profile with that email in the demo workspace.'),
    'a wrong email is refused rather than opening someone else’s record',
  );
  assert.ok(screen.getByText('Open your record'), 'and the gate is still on screen');
});

test('the portal shows the candidate their own record and hides the recruiter’s half of it', async () => {
  await boot();
  const seed = makeSeed();
  // Pick someone with pipeline history and consents, so the curated view has something in it.
  const person = seed.candidates.find(
    (c) =>
      seed.consents.some((x) => x.candidateId === c.id) &&
      seed.considerations.some((k) => k.candidateId === c.id),
  );
  assert.ok(person, 'the seed has a candidate with both consents and pipeline history');
  const secret =
    seed.notes.find((n) => n.candidateId === person.id)?.text ||
    seed.considerations.find((k) => k.candidateId === person.id)?.reason;

  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', person.email);
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  await settle(3);

  assert.ok(screen.getByText(person.name), 'their profile is shown');
  assert.ok(
    screen.getByText('Your applications'),
    'their pipeline is shown, in candidate language',
  );
  assert.ok(screen.getByText('Your consents'), 'and their consent ledger');
  const body = document.body.textContent;
  assert.ok(!body.includes('match score'), 'no recruiter scoring vocabulary leaks through');
  assert.ok(!/internal cost|Margin:/i.test(body), 'no commercial terms leak through');
  if (secret) assert.ok(!body.includes(secret), 'internal notes stay internal');
});

test('a candidate can update their own availability and the recruiter sees numbers, not strings', async () => {
  await boot();
  const seed = makeSeed();
  const person = seed.candidates.find((c) => c.email);
  putStore(seed);

  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', person.email);
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  await settle(3);

  await type('Notice period (days)', '15');
  await type('Preferred locations', 'Bengaluru, Remote');
  await press('Save preferences');
  await settle(4);
  assert.ok(
    screen.getByText('Preferences saved to the demo workspace.'),
    'the save is acknowledged',
  );

  const saved = store().candidates.find((c) => c.id === person.id);
  assert.equal(saved.notice, 15, 'notice is stored as a number the matcher can compare');
  assert.equal(typeof saved.notice, 'number');
  assert.equal(saved.preferredLocations, 'Bengaluru, Remote');
  // Nothing outside PORTAL_EDITABLE may be touched by a self-service save.
  assert.equal(saved.name, person.name);
  assert.equal(saved.title, person.title);
  assert.equal(
    saved.current,
    person.current,
    'the internal current-CTC figure is not candidate-editable',
  );
});

test('a candidate cannot bypass the shared notice cap from the portal', async () => {
  await boot();
  const seed = makeSeed();
  const person = seed.candidates.find((c) => c.email);
  const original = person.notice;
  putStore(seed);

  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', person.email);
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  await settle(3);
  await type('Notice period (days)', '366');
  await press('Save preferences');
  await settle(2);

  assert.ok(
    screen.getByText('Notice period must be a whole number from 0 to 365 days.'),
    'the same cap is enforced on self-service, not only in the recruiter form',
  );
  assert.equal(
    store().candidates.find((c) => c.id === person.id).notice,
    original,
    'invalid availability does not reach the workspace',
  );
});

test('a blank notice is stored as unknown rather than as zero or NaN', async () => {
  await boot();
  const seed = makeSeed();
  const person = seed.candidates.find((c) => c.email);
  person.notice = 30;
  person.earliestStart = '2026-10-15';
  person.preferredLocations = 'Bengaluru, Remote';
  person.engagement = 'Contract';
  putStore(seed);

  await mount(M.PortalApp, {});
  await settle(6);
  await type('Your email', person.email);
  await submitVia('Open my record');
  if (screen.queryByRole('button', { name: /^Update availability/ }))
    await click(screen.getByRole('button', { name: /^Update availability/ }));
  if (screen.queryByRole('button', { name: /^Privacy and consents/ }))
    await click(screen.getByRole('button', { name: /^Privacy and consents/ }));
  await settle(3);
  await type('Notice period (days)', '');
  await type('Earliest start', '');
  await type('Preferred locations', '');
  await type('Engagement preference', '');
  await press('Save preferences');
  await settle(4);

  const saved = store().candidates.find((c) => c.id === person.id);
  assert.equal(saved.notice, null, 'cleared means unknown — never 0 (immediate) and never NaN');
  assert.equal(saved.earliestStart, null, 'a cleared date means unknown');
  assert.equal(saved.preferredLocations, '', 'free-text preferences can be removed');
  assert.equal(saved.engagement, '', 'engagement preferences can be removed');
  assert.equal(M.normalizePortalPayload({ notice: '', expected: '  ' }).expected, null);
  assert.equal(
    validatePortalPayload({ notice: 366 }),
    'Notice period must be a whole number from 0 to 365 days.',
  );
  assert.equal(
    validatePortalPayload({ notice: -1 }),
    'Notice period must be a whole number from 0 to 365 days.',
  );
});
