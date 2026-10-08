import { candidateIdentityText } from './anthroId.js';
// Employee and partner referrals (Zoho Recruit D6).
//
// Referrals are the highest-quality hiring source in most organisations, and the module is one
// of the most-used parts of an ATS. This layer works over the `referrals` table added in
// migration 026.
//
// The rule that shapes everything here: a referral is a THIRD PARTY's contact details, offered
// by somebody else. The referred person has not consented and may not know. So a referral is
// never silently promoted into a candidate profile — converting is a deliberate recruiter action
// that records where the consent came from.
import { uid, today } from './domain.js';

export const REFERRAL_STATUSES = [
  'New',
  'Contacted',
  'In pipeline',
  'Hired',
  'Not proceeding',
  'Duplicate',
];
export const REFERRER_TYPES = ['Employee', 'Client', 'Partner', 'Candidate', 'Other'];
export const REWARD_STATUSES = ['Not eligible', 'Pending', 'Approved', 'Paid', 'Declined'];

export const STATUS_TONE = {
  New: 'blue',
  Contacted: 'amber',
  'In pipeline': 'teal',
  Hired: 'green',
  'Not proceeding': 'gray',
  Duplicate: 'gray',
};
export const REWARD_TONE = {
  'Not eligible': 'gray',
  Pending: 'amber',
  Approved: 'blue',
  Paid: 'green',
  Declined: 'red',
};

/** Below this many resolved referrals, a percentage is noise rather than a measure. */
export const MIN_RATE_SAMPLE = 3;

/** A referral is finished when no further recruiting action is expected. */
export const OPEN_STATUSES = new Set(['New', 'Contacted', 'In pipeline']);

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const blankReferral = () => ({
  referrerName: '',
  referrerEmail: '',
  referrerType: 'Employee',
  refereeName: '',
  refereeEmail: '',
  refereePhone: '',
  refereeLinkedin: '',
  relationship: '',
  note: '',
  demandId: null,
  candidateId: null,
  status: 'New',
  outcome: '',
  rewardStatus: 'Not eligible',
  rewardNote: '',
  source: 'In-app',
});

/** Mirrors the table checks and the public RPC's validation. */
export function validateReferral(form, referrals = [], id = null) {
  const errors = {};
  if (!clean(form.referrerName)) errors.referrerName = 'Who is making the referral?';
  if (clean(form.referrerEmail) && !EMAIL.test(clean(form.referrerEmail)))
    errors.referrerEmail = 'Enter a valid email address.';
  if (!clean(form.refereeName)) errors.refereeName = 'Who is being referred?';
  if (!clean(form.refereeEmail) && !clean(form.refereePhone) && !clean(form.refereeLinkedin))
    errors.refereeEmail = 'Give an email, phone or LinkedIn so they can be reached.';
  else if (clean(form.refereeEmail) && !EMAIL.test(clean(form.refereeEmail)))
    errors.refereeEmail = 'Enter a valid email address.';
  if (!REFERRER_TYPES.includes(form.referrerType)) errors.referrerType = 'Choose a referrer type.';
  if (!REFERRAL_STATUSES.includes(form.status)) errors.status = 'Choose a status.';
  if (!REWARD_STATUSES.includes(form.rewardStatus)) errors.rewardStatus = 'Choose a reward state.';

  // Mirrors the partial unique index: same person, same role, once.
  const email = lower(form.refereeEmail);
  if (
    email &&
    referrals.some(
      (r) =>
        r.id !== id &&
        lower(r.refereeEmail) === email &&
        (r.demandId || null) === (form.demandId || null),
    )
  )
    errors.refereeEmail = 'That person has already been referred for this role.';
  return errors;
}

/** An existing candidate with the same email — the recruiter should know before converting. */
export function existingCandidateFor(data, referral) {
  const email = lower(referral?.refereeEmail);
  if (!email) return null;
  return (data?.candidates || []).find((c) => lower(c.email) === email) || null;
}

/**
 * Build the candidate a referral becomes. Never called automatically: the recruiter states the
 * consent basis, and that is written to the consent ledger alongside the profile.
 */
export function convertReferral(
  referral,
  { basis = 'Referrer confirmed permission', owner = '' } = {},
) {
  const candidateId = uid();
  const candidate = {
    id: candidateId,
    name: clean(referral.refereeName),
    email: lower(referral.refereeEmail),
    phone: clean(referral.refereePhone),
    linkedin: clean(referral.refereeLinkedin),
    title: '',
    location: '',
    skills: [],
    status: 'Sourced',
    source: 'Referral',
    owner,
    created: today(),
    summary: referral.note ? `Referred by ${clean(referral.referrerName)}: ${referral.note}` : '',
  };
  const consent = {
    id: uid(),
    candidateId,
    purpose: 'contact',
    status: 'granted',
    date: new Date().toISOString(),
    noticeVersion: 'referral-v1',
    source: `Referral by ${clean(referral.referrerName)}`,
    note: basis,
  };
  return {
    candidate,
    consent,
    referral: { ...referral, candidateId, status: 'In pipeline' },
  };
}

/** Who refers, how often, and how well — the number that makes a referral scheme work. */
export function referrerLeaderboard(data) {
  const rows = new Map();
  for (const r of data?.referrals || []) {
    const key = lower(r.referrerEmail) || lower(r.referrerName);
    if (!key) continue;
    const entry = rows.get(key) || {
      name: clean(r.referrerName),
      email: clean(r.referrerEmail),
      type: r.referrerType,
      total: 0,
      hired: 0,
      inPipeline: 0,
      rewardsPending: 0,
    };
    entry.total += 1;
    if (r.status === 'Hired') entry.hired += 1;
    if (r.status === 'In pipeline' || r.status === 'Contacted') entry.inPipeline += 1;
    if (r.rewardStatus === 'Pending' || r.rewardStatus === 'Approved') entry.rewardsPending += 1;
    rows.set(key, entry);
  }
  return [...rows.values()]
    .map((e) => ({
      ...e,
      // A hire rate over one referral is not a rate. Report it only once there is something to
      // divide, and never dress a single lucky hire up as 100% quality.
      hireRate: e.total >= MIN_RATE_SAMPLE ? Math.round((e.hired / e.total) * 100) : null,
    }))
    .sort((a, b) => b.hired - a.hired || b.total - a.total || a.name.localeCompare(b.name));
}

export function referralTotals(data) {
  const all = data?.referrals || [];
  const hired = all.filter((r) => r.status === 'Hired').length;
  const closed = all.filter((r) => !OPEN_STATUSES.has(r.status)).length;
  return {
    total: all.length,
    open: all.filter((r) => OPEN_STATUSES.has(r.status)).length,
    hired,
    // A conversion rate needs both a denominator and enough of one to mean anything. One hire
    // out of one resolved referral is not a 100% scheme — quoting that on the headline stat
    // would be the most prominent misleading number on the page. Same threshold as the
    // leaderboard, so the two never disagree.
    hireRate: closed >= MIN_RATE_SAMPLE ? Math.round((hired / closed) * 100) : null,
    awaitingReward: all.filter((r) => ['Pending', 'Approved'].includes(r.rewardStatus)).length,
    unconverted: all.filter((r) => !r.candidateId && OPEN_STATUSES.has(r.status)).length,
  };
}

export function referralList(data, { query = '', status = 'All', reward = 'All' } = {}) {
  const q = lower(query);
  return (data?.referrals || [])
    .filter((r) => {
      if (status !== 'All' && r.status !== status) return false;
      if (reward !== 'All' && r.rewardStatus !== reward) return false;
      if (!q) return true;
      return [
        candidateIdentityText(data.candidates?.find((c) => c.id === r.candidateId)),
        r.refereeName,
        r.refereeEmail,
        r.referrerName,
        r.referrerEmail,
        r.relationship,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    })
    .sort(
      (a, b) =>
        Number(OPEN_STATUSES.has(b.status)) - Number(OPEN_STATUSES.has(a.status)) ||
        String(b.created || '').localeCompare(String(a.created || '')),
    );
}
