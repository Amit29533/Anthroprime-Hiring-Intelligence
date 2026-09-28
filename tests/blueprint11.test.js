import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';
import {
  portalOverview,
  applyPortalUpdate,
  PORTAL_EDITABLE,
  coolingOffCheck,
} from '../src/portal.js';
import { OFFER_STATUSES, OFFER_TONES, offersSummary } from '../src/offers.js';

const seed = normalizeData(makeSeed());

test('candidate portal sees a curated record — never internal fields', () => {
  const c = seed.candidates[0];
  const view = portalOverview(c, seed);
  assert.equal(view.profile.name, c.name);
  assert.ok(!('owner' in view.profile), 'owner is internal');
  assert.ok(!('current' in view.profile), 'internal current-CTC is never exposed');
  assert.ok(!('notes' in view), 'internal notes are never exposed');
  assert.ok(
    Array.isArray(view.applications) && Array.isArray(view.consents),
    'applications and consents projected',
  );
  const sub = seed.submissions[0];
  if (sub) {
    const mine = view.submissions.find((s) => s.status);
    assert.ok(
      mine === undefined || !('pack' in (mine || {})),
      'submission packs are not exported raw',
    );
  }
  // whitelist write path
  const updated = applyPortalUpdate(c, {
    notice: 12,
    stage: 'Ready',
    current: 99,
    owner: 'hacker',
  });
  assert.equal(updated.notice, 12);
  assert.equal(updated.stage, c.stage, 'stage not writable via portal');
  assert.equal(updated.current, c.current, 'current CTC not writable via portal');
  assert.deepEqual(PORTAL_EDITABLE, [
    'notice',
    'earliestStart',
    'activeStatus',
    'mode',
    'engagement',
    'preferredLocations',
    'expected',
  ]);
});

test('cooling-off guards re-submission after a recent client rejection', () => {
  const c = seed.candidates[0];
  const demand = { id: 'd-1', title: 'T', client: 'Northstar Financial' };
  const other = { id: 'd-2', title: 'T2', client: 'Meridian Group' };
  const subs = [
    {
      candidateId: c.id,
      demandId: 'd-1',
      clientStatus: 'Rejected',
      submittedOn: '2026-09-10',
      decidedOn: '2026-09-12',
    },
    {
      candidateId: c.id,
      demandId: 'd-2',
      clientStatus: 'Rejected',
      submittedOn: '2026-09-10',
      decidedOn: '2026-09-12',
    },
  ];
  const hit = coolingOffCheck(c.id, subs, [demand, other], 'Northstar Financial', 30, '2026-09-28');
  assert.equal(hit.blocked, true, 'same client inside 30 days warns');
  assert.equal(hit.daysAgo, 16);
  const otherClient = coolingOffCheck(
    c.id,
    [subs[0]],
    [demand, other],
    'Meridian Group',
    30,
    '2026-09-28',
  );
  assert.equal(otherClient.blocked, false, 'a different client is not affected');
  const expired = coolingOffCheck(
    c.id,
    subs,
    [demand, other],
    'Northstar Financial',
    7,
    '2026-09-28',
  );
  assert.equal(expired.blocked, false, 'window expiry clears the guard');
  const accepted = coolingOffCheck(
    c.id,
    [
      {
        candidateId: c.id,
        demandId: 'd-1',
        clientStatus: 'Shortlisted',
        submittedOn: '2026-09-25',
      },
    ],
    [demand],
    'Northstar Financial',
    30,
    '2026-09-28',
  );
  assert.equal(accepted.blocked, false, 'only rejections trigger cooling-off');
});

test('offers support an approval state between draft and sent', () => {
  assert.ok(OFFER_STATUSES.includes('Pending approval'));
  assert.equal(OFFER_TONES['Pending approval'], 'amber');
  const summary = offersSummary([
    { status: 'Draft' },
    { status: 'Pending approval' },
    { status: 'Sent' },
    { status: 'Accepted' },
  ]);
  assert.equal(summary.drafts, 1, 'pending offers are not drafts');
  assert.equal(summary.sent, 1);
  assert.equal(summary.acceptRate, 100);
});
