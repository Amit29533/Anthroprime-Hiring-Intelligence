import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_RATE_SAMPLE,
  REFERRAL_STATUSES,
  REFERRER_TYPES,
  REWARD_STATUSES,
  blankReferral,
  validateReferral,
  existingCandidateFor,
  convertReferral,
  referrerLeaderboard,
  referralTotals,
  referralList,
} from '../src/referrals.js';
import { normalizeData, emptyData } from '../src/schema.js';

const ref = (over = {}) => ({
  ...blankReferral(),
  id: over.id || 'r1',
  referrerName: 'Priya Raman',
  referrerEmail: 'priya@anthroprime.example',
  refereeName: 'Devika Iyer',
  refereeEmail: 'devika@example.com',
  created: '2026-09-01',
  ...over,
});

const world = (referrals, extra = {}) => normalizeData({ ...emptyData(), referrals, ...extra });

test('the leaderboard and the headline stat use the same minimum sample', () => {
  assert.equal(MIN_RATE_SAMPLE, 3, 'one threshold, so the two figures can never disagree');
});

test('the vocabularies match the database check constraints', () => {
  assert.deepEqual(REFERRAL_STATUSES, [
    'New',
    'Contacted',
    'In pipeline',
    'Hired',
    'Not proceeding',
    'Duplicate',
  ]);
  assert.deepEqual(REFERRER_TYPES, ['Employee', 'Client', 'Partner', 'Candidate', 'Other']);
  assert.deepEqual(REWARD_STATUSES, ['Not eligible', 'Pending', 'Approved', 'Paid', 'Declined']);
  const blank = blankReferral();
  assert.equal(blank.status, 'New');
  assert.equal(blank.rewardStatus, 'Not eligible', 'no reward is implied until someone decides');
  assert.equal(blank.candidateId, null, 'a referral is never born as a candidate');
});

test('a referral must name both people and offer a way to make contact', () => {
  assert.deepEqual(validateReferral(ref(), []), {});
  assert.match(validateReferral(ref({ referrerName: ' ' }), []).referrerName, /Who is making/);
  assert.match(validateReferral(ref({ refereeName: '' }), []).refereeName, /Who is being referred/);
  assert.match(
    validateReferral(ref({ refereeEmail: '', refereePhone: '', refereeLinkedin: '' }), [])
      .refereeEmail,
    /email, phone or LinkedIn/,
    'a referral nobody can act on is not a referral',
  );
  assert.deepEqual(
    validateReferral(ref({ refereeEmail: '', refereePhone: '+91 99999 00000' }), []),
    {},
    'a phone number alone is enough',
  );
  assert.match(validateReferral(ref({ refereeEmail: 'nope' }), []).refereeEmail, /valid email/);
  assert.match(validateReferral(ref({ referrerEmail: 'nope' }), []).referrerEmail, /valid email/);
  assert.match(validateReferral(ref({ referrerType: 'Robot' }), []).referrerType, /referrer type/);
  assert.match(validateReferral(ref({ status: 'Maybe' }), []).status, /Choose a status/);
  assert.match(validateReferral(ref({ rewardStatus: 'Rich' }), []).rewardStatus, /reward state/);
});

test('the same person cannot be referred twice for the same role', () => {
  const existing = [ref({ id: 'r1', demandId: 'd1' })];
  assert.match(
    validateReferral(ref({ id: 'r2', demandId: 'd1' }), existing).refereeEmail,
    /already been referred for this role/,
  );
  assert.deepEqual(
    validateReferral(ref({ id: 'r2', demandId: 'd2' }), existing),
    {},
    'but the same person may be referred for a different role',
  );
  assert.deepEqual(
    validateReferral(ref({ id: 'r1', demandId: 'd1' }), existing, 'r1'),
    {},
    'editing a referral does not clash with itself',
  );
});

test('converting is deliberate and writes a consent record with the profile', () => {
  const r = ref({ note: 'Strong lakehouse background.' });
  const { candidate, consent, referral } = convertReferral(r, { basis: 'Referrer confirmed' });
  assert.equal(candidate.name, 'Devika Iyer');
  assert.equal(candidate.email, 'devika@example.com');
  assert.equal(candidate.source, 'Referral', 'source attribution is automatic');
  assert.equal(candidate.status, 'Sourced', 'a referred person has not applied');
  assert.match(candidate.summary, /Referred by Priya Raman/);
  assert.equal(consent.candidateId, candidate.id, 'the consent is bound to the new profile');
  assert.equal(consent.purpose, 'contact');
  assert.equal(consent.status, 'granted');
  assert.equal(consent.note, 'Referrer confirmed', 'the stated basis is written down, not assumed');
  assert.match(consent.source, /Referral by Priya Raman/);
  assert.equal(referral.candidateId, candidate.id, 'the referral now points at the profile');
  assert.equal(referral.status, 'In pipeline');
});

test('an existing candidate with the same email is surfaced before converting', () => {
  const data = world([ref()], {
    candidates: [{ id: 'c1', name: 'Devika Iyer', email: 'DEVIKA@example.com' }],
  });
  assert.equal(existingCandidateFor(data, ref()).id, 'c1', 'matched case-insensitively');
  assert.equal(existingCandidateFor(data, ref({ refereeEmail: 'someone@else.com' })), null);
  assert.equal(existingCandidateFor(data, ref({ refereeEmail: '' })), null, 'no email, no match');
});

test('totals report rates only when there is something to divide', () => {
  assert.deepEqual(referralTotals(world([])), {
    total: 0,
    open: 0,
    hired: 0,
    hireRate: null,
    awaitingReward: 0,
    unconverted: 0,
  });
  const all = world([
    ref({ id: 'a', status: 'New' }),
    ref({ id: 'b', status: 'Hired', rewardStatus: 'Pending', candidateId: 'c1' }),
    ref({ id: 'c', status: 'Not proceeding' }),
    ref({ id: 'd', status: 'In pipeline', candidateId: 'c2' }),
  ]);
  const t = referralTotals(all);
  assert.equal(t.total, 4);
  assert.equal(t.open, 2, 'New and In pipeline are open');
  assert.equal(t.hired, 1);
  assert.equal(t.hireRate, null, '1 hired of only 2 resolved is too small a sample to quote');
  assert.equal(t.awaitingReward, 1);
  assert.equal(t.unconverted, 1, 'the open referral with no profile yet');

  const allNew = referralTotals(world([ref({ id: 'a' }), ref({ id: 'b' })]));
  assert.equal(allNew.hireRate, null, 'nothing resolved means no conversion rate, not 0%');

  // With enough resolved referrals the rate appears, and matches the leaderboard's threshold.
  const enough = referralTotals(
    world([
      ref({ id: 'a', status: 'Hired' }),
      ref({ id: 'b', status: 'Not proceeding' }),
      ref({ id: 'c', status: 'Not proceeding' }),
      ref({ id: 'd', status: 'New' }),
    ]),
  );
  assert.equal(enough.hireRate, 33, '1 hired of 3 resolved');
  assert.equal(
    referralTotals(world([ref({ id: 'a', status: 'Hired' })])).hireRate,
    null,
    'a single hire is never shown as a 100% scheme',
  );
});

test('the leaderboard withholds a hire rate until it means something', () => {
  const rows = referrerLeaderboard(
    world([
      ref({ id: '1', referrerEmail: 'a@x.com', referrerName: 'Anita', status: 'Hired' }),
      ref({ id: '2', referrerEmail: 'a@x.com', referrerName: 'Anita', status: 'New' }),
      ref({ id: '3', referrerEmail: 'a@x.com', referrerName: 'Anita', status: 'Not proceeding' }),
      ref({ id: '4', referrerEmail: 'b@x.com', referrerName: 'Bala', status: 'Hired' }),
    ]),
  );
  const anita = rows.find((r) => r.name === 'Anita');
  const bala = rows.find((r) => r.name === 'Bala');
  assert.equal(anita.total, 3);
  assert.equal(anita.hired, 1);
  assert.equal(anita.hireRate, 33, 'three referrals is enough to quote a rate');
  assert.equal(
    bala.hireRate,
    null,
    'one lucky hire is not a 100% hire rate — that would mislead a reward decision',
  );
  assert.equal(rows[0].name, 'Anita', 'ordered by hires, then volume');
  assert.deepEqual(referrerLeaderboard(world([])), []);
});

test('the list searches both sides of the referral and keeps open ones on top', () => {
  const data = world([
    ref({ id: 'a', status: 'Hired', refereeName: 'Zara Khan' }),
    ref({ id: 'b', status: 'New', refereeName: 'Amit Bose', refereeEmail: 'amit@example.com' }),
  ]);
  assert.deepEqual(
    referralList(data).map((r) => r.id),
    ['b', 'a'],
    'open referrals first',
  );
  assert.deepEqual(
    referralList(data, { query: 'zara' }).map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    referralList(data, { query: 'priya' })
      .map((r) => r.id)
      .sort(),
    ['a', 'b'],
    'referrer is searchable too',
  );
  assert.deepEqual(
    referralList(data, { status: 'Hired' }).map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(referralList(data, { reward: 'Paid' }), []);
  assert.deepEqual(referralList(data, { query: 'nobody at all' }), []);
});
