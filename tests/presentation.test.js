import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRANDING,
  DEFAULT_OPTIONS,
  brandingFor,
  initialsOf,
  buildPresentation,
  presentationHtml,
  presentationText,
  presentationFilename,
  validateBranding,
} from '../src/presentation.js';
import { normalizeData, emptyData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const CANDIDATE = {
  id: 'p1',
  anthroNumber: 1,
  name: 'Aarav Sharma',
  title: 'Lead Data Engineer',
  company: 'Northwind Retail',
  email: 'aarav@personal.example',
  phone: '+91 99887 76655',
  linkedin: 'https://linkedin.com/in/aarav',
  location: 'Bengaluru',
  experience: 11,
  relevantExperience: 8,
  notice: 30,
  mode: 'Hybrid',
  engagement: 'Permanent',
  current: 38,
  expected: 46,
  verified: '2026-09-01',
  summary: 'Builds lakehouse platforms for large retail data estates.',
  skills: ['Databricks', 'Azure'],
  skillsDetail: [
    {
      skill: 'Databricks',
      proficiency: 'Advanced',
      years: 7,
      evidence: 'Assessment',
      validated: true,
    },
    { skill: 'Azure', proficiency: 'Working', years: 4, evidence: 'Unverified' },
  ],
};

const consent = (status = 'granted') => ({
  id: 'k1',
  candidateId: 'p1',
  purpose: 'profile-sharing',
  status,
  date: '2026-09-10',
  noticeVersion: 'v2',
});

const world = (over = {}) =>
  normalizeData({
    ...emptyData(),
    candidates: [CANDIDATE],
    consents: [consent()],
    employmentHistory: [
      {
        id: 'h1',
        candidateId: 'p1',
        company: 'Northwind Retail',
        title: 'Lead Data Engineer',
        startDate: '2023-04-01',
        endDate: null,
      },
      {
        id: 'h2',
        candidateId: 'p1',
        company: 'Trellis Systems',
        title: 'Data Engineer',
        startDate: '2019-01-01',
        endDate: '2023-03-01',
        verified: '2026-08-01',
      },
    ],
    assessments: [
      {
        id: 'a1',
        candidateId: 'p1',
        title: 'Lakehouse rubric',
        score: 86,
        date: '2026-08-20',
        assessor: 'Priya',
        evidence: 'Built Genie spaces end to end.',
      },
    ],
    interviews: [
      {
        id: 'i1',
        candidateId: 'p1',
        demandId: 'd1',
        status: 'Completed',
        round: 'Technical',
        mode: 'Video',
        recommendation: 'Proceed',
        scheduledAt: '2026-09-05T10:00:00Z',
      },
    ],
    demands: [
      { id: 'd1', title: 'Senior Databricks Architect', client: 'Meridian', location: 'Bengaluru' },
    ],
    ...over,
  });

const build = (options = {}, context = {}, data = world()) =>
  buildPresentation(CANDIDATE, data.demands[0], data, options, context);

test('consent gates the document absolutely', () => {
  assert.equal(build().blocked, false, 'a granted consent allows generation');

  const missing = buildPresentation(CANDIDATE, null, world({ consents: [] }), {}, {});
  assert.equal(missing.blocked, true);
  assert.match(missing.reason, /cannot be generated/);
  assert.equal(presentationHtml(missing), '', 'a blocked document renders nothing at all');
  assert.equal(presentationText(missing), '');

  // The bug worth a test: a revoked consent is still a consent *record*. It must not pass.
  const revoked = buildPresentation(
    CANDIDATE,
    null,
    world({ consents: [consent('revoked')] }),
    {},
    {},
  );
  assert.equal(revoked.blocked, true, 'a revocation is not permission');
  assert.match(revoked.reason, /revoked/i);
  assert.equal(presentationHtml(revoked), '');

  const pending = buildPresentation(
    CANDIDATE,
    null,
    world({ consents: [consent('pending')] }),
    {},
    {},
  );
  assert.equal(pending.blocked, true, 'anything other than granted is refused');

  assert.equal(buildPresentation(null, null, world()).blocked, true, 'no candidate, no document');
});

test('contact details are withheld unless explicitly revealed', () => {
  const doc = build();
  const html = presentationHtml(doc);
  for (const secret of ['aarav@personal.example', '+91 99887 76655', 'linkedin.com/in/aarav'])
    assert.ok(!html.includes(secret), `${secret} must not reach the client by default`);
  assert.ok(doc.withheld.includes('contact details'), 'and the document says what it withheld');

  const revealed = presentationHtml(build({ showContact: true }));
  assert.ok(revealed.includes('aarav@personal.example'), 'revealing contact is an explicit choice');
  assert.ok(revealed.includes('+91 99887 76655'));
  assert.ok(
    !revealed.includes('linkedin.com/in/aarav'),
    'a LinkedIn URL is never presented — it is the shortest route around the agency',
  );
});

test('internal commercials never reach a client document', () => {
  const asRecruiter = build({ showCompensation: true }, { isAdmin: false });
  const html = presentationHtml(asRecruiter);
  // '46' alone is too loose an assertion — it occurs in the generated reference. Assert on the
  // rendered money value and on the fact list instead.
  assert.ok(!html.includes('₹46'), 'a recruiter asking for compensation still does not get it');
  assert.ok(
    !asRecruiter.facts.some(([label]) => label === 'Expected'),
    'and the field is absent from the model, not merely unrendered',
  );
  assert.ok(
    asRecruiter.withheld.some((w) => /admin only/.test(w)),
    'and is told why',
  );

  const asAdminDefault = presentationHtml(build({}, { isAdmin: true }));
  assert.ok(!asAdminDefault.includes('₹46'), 'even for an admin it is off by default');

  const asAdminOptedIn = presentationHtml(build({ showCompensation: true }, { isAdmin: true }));
  assert.ok(asAdminOptedIn.includes('₹46 LPA'), 'an admin may deliberately include expectations');
  assert.ok(
    !asAdminOptedIn.includes('₹38') && !asAdminOptedIn.includes('Current CTC'),
    'but current CTC is never presentable under any combination of options',
  );
});

test('anonymising hides the name and the current employer together', () => {
  const doc = build({ anonymise: true });
  assert.equal(doc.displayName, 'A. S.');
  assert.equal(doc.anonymised, true);
  const html = presentationHtml(doc);
  assert.ok(!html.includes('Aarav Sharma'), 'the name is gone');
  assert.ok(
    !html.includes('Northwind Retail'),
    'and so is the current employer — otherwise role + company identifies them anyway',
  );
  assert.ok(
    html.includes('Trellis Systems'),
    'past employers are still useful and not identifying',
  );
  assert.ok(
    html.includes('Confidential (current employer)'),
    'the omission is visible, not silent',
  );

  assert.equal(initialsOf('Aarav Sharma'), 'A. S.');
  assert.equal(initialsOf('  madonna '), 'M.');
  assert.equal(initialsOf(''), 'Candidate');
  assert.equal(initialsOf(null), 'Candidate');
});

test('the current employer can be revealed without anonymising', () => {
  const html = presentationHtml(build({ showCurrentEmployer: true }));
  assert.ok(html.includes('Northwind Retail'));
  assert.ok(html.includes('Current employer'));
});

test('what is not verified is stated rather than implied', () => {
  const doc = build();
  assert.deepEqual(
    doc.unverified,
    [],
    'this candidate is verified, has notice and a validated skill',
  );

  const thin = buildPresentation(
    { ...CANDIDATE, verified: '', notice: null, skillsDetail: [{ skill: 'Azure' }] },
    null,
    world(),
    {},
    {},
  );
  assert.equal(thin.unverified.length, 3);
  const html = presentationHtml(thin);
  assert.ok(html.includes('What is not verified'), 'the caveat is printed, not hidden');
  assert.ok(html.includes('Not verified'), 'and the notice period is labelled honestly');
  assert.ok(!html.includes('0 days'), 'an unknown notice period is never rendered as immediate');
});

test('sections switch off cleanly and never leave empty headings', () => {
  const bare = build({ showAssessments: false, showInterviews: false, showEmployment: false });
  const html = presentationHtml(bare);
  assert.ok(!html.includes('<h2>Assessments</h2>'));
  assert.ok(!html.includes('<h2>Experience</h2>'));
  assert.ok(!html.includes('Interview outcomes'));
  assert.equal(bare.assessments.length, 0);
  assert.equal(bare.employment.length, 0);

  const full = build({ showInterviews: true });
  assert.equal(full.interviews.length, 1);
  assert.ok(presentationHtml(full).includes('Proceed'));
});

test('evidence labels are shown but never invented', () => {
  const doc = build();
  assert.equal(doc.skills[0].evidence, 'Assessment');
  assert.equal(doc.skills[1].evidence, '', '"Unverified" is not an evidence claim, so it is blank');
  assert.equal(doc.skills[0].validated, true);
  const off = build({ showEvidence: false });
  assert.equal(off.skills[0].evidence, '');
});

test('branding comes from the workspace and is escaped into the document', () => {
  assert.deepEqual(brandingFor(normalizeData(emptyData())), DEFAULT_BRANDING);
  const branded = world({
    settings: [
      {
        id: 'workspace',
        custom: {
          branding: {
            agencyName: 'Ridge & Co <script>',
            accent: '#884400',
            footer: 'Confidential',
          },
        },
      },
    ],
  });
  const doc = buildPresentation(CANDIDATE, null, branded, {}, {});
  assert.equal(doc.brand.agencyName, 'Ridge & Co <script>');
  assert.equal(doc.brand.tagline, DEFAULT_BRANDING.tagline, 'unset fields fall back to defaults');
  const html = presentationHtml(doc);
  assert.ok(!html.includes('<script>'), 'branding is escaped — it is user input on a shared page');
  assert.ok(html.includes('Ridge &amp; Co'));
  assert.ok(html.includes('#884400'), 'the accent colour is applied');
  assert.ok(html.includes('Confidential'));
});

test('the reference and filename are stable and safe', () => {
  const doc = build();
  assert.match(doc.reference, /^ANTHRO-\d{5}$/);
  assert.equal(buildPresentation(CANDIDATE, null, world(), {}, {}).reference, doc.reference);
  assert.match(presentationFilename(doc), /^aarav-sharma-anthro-.*\.html$/);
  assert.match(presentationFilename(build({ anonymise: true })), /^a-s-/);
  assert.equal(presentationFilename(null), 'candidate-.html');
});

test('the text version carries the same disclosures as the HTML', () => {
  const text = presentationText(build());
  assert.ok(text.includes('ANTHROPRIME — CANDIDATE PROFILE'));
  assert.ok(text.includes('Aarav Sharma'));
  assert.ok(text.includes('Submitted for: Senior Databricks Architect'));
  assert.ok(text.includes('Databricks — Advanced (7 yrs), Assessment'));
  assert.ok(!text.includes('aarav@personal.example'), 'the same redaction applies');
  assert.ok(text.includes('Withheld: contact details'), 'and the same disclosure');
});

test('a presentation includes the role it was built for, or stands alone', () => {
  assert.equal(build().role.title, 'Senior Databricks Architect');
  const standalone = buildPresentation(CANDIDATE, null, world(), {}, {});
  assert.equal(standalone.role, null);
  assert.ok(!presentationHtml(standalone).includes('Submitted for'));
});

test('branding validation keeps the document renderable', () => {
  assert.deepEqual(validateBranding({ agencyName: 'Ridge', accent: '#1f6f5c' }), {});
  assert.match(validateBranding({ agencyName: '  ' }).agencyName, /needs an agency name/);
  assert.match(validateBranding({ agencyName: 'R', accent: 'green' }).accent, /hex colour/);
  assert.deepEqual(validateBranding({ agencyName: 'R', accent: '' }), {});
});

test('the defaults are the private ones', () => {
  assert.equal(DEFAULT_OPTIONS.showContact, false);
  assert.equal(DEFAULT_OPTIONS.showCompensation, false);
  assert.equal(DEFAULT_OPTIONS.showCurrentEmployer, false);
  assert.equal(
    DEFAULT_OPTIONS.anonymise,
    false,
    'but anonymising is a deliberate act, not default',
  );
});

test('it works against a real seeded candidate with consent', () => {
  const data = normalizeData(makeSeed());
  const withConsent = data.candidates.find((c) =>
    data.consents.some(
      (k) => k.candidateId === c.id && k.purpose === 'profile-sharing' && k.status === 'granted',
    ),
  );
  assert.ok(withConsent, 'the seed has a consented candidate to exercise this with');
  const doc = buildPresentation(withConsent, data.demands[0], data, {}, {});
  assert.equal(doc.blocked, false);
  const html = presentationHtml(doc);
  assert.ok(html.includes(withConsent.name));
  if (withConsent.email) assert.ok(!html.includes(withConsent.email), 'no contact leakage');
  assert.ok(html.startsWith('<!doctype html>'));
});
