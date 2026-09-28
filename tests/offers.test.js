// Offer approval policy (blueprint I7). The UI shows the gate; these pin the rules themselves
// so the client policy and the 014 database gate cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFER_STATUSES,
  OFFER_TERMS,
  offerIsOpen,
  offerNeedsApproval,
  offerTermsChanged,
  offerTermsSnapshot,
  clearOfferApproval,
  offersSummary,
} from '../src/offers.js';

const draft = (extra) => ({
  id: 'o1',
  status: 'Draft',
  ctc: 30,
  role: 'Architect',
  location: 'Bengaluru',
  joining: '2027-01-01',
  candidateId: 'c1',
  demandId: 'd1',
  ...extra,
});

test('Pending approval is a real status in the lifecycle, not a UI-only invention', () => {
  assert.ok(OFFER_STATUSES.includes('Pending approval'));
  assert.ok(
    OFFER_STATUSES.indexOf('Pending approval') < OFFER_STATUSES.indexOf('Sent'),
    'it sits between Draft and Sent',
  );
  assert.ok(offerIsOpen({ status: 'Pending approval' }), 'and it still counts as an open offer');
});

test('approvals off means any draft can be sent', () => {
  assert.equal(offerNeedsApproval(draft(), false), false);
  assert.equal(offerNeedsApproval(draft(), undefined), false, 'a missing setting is off, not on');
});

test('approvals on blocks a draft until an approval exists', () => {
  assert.equal(offerNeedsApproval(draft(), true), true);
  assert.equal(offerNeedsApproval(draft({ approvedAt: null }), true), true);
  const approved = draft({ approvedAt: '2026-09-01T10:00:00.000Z' });
  assert.equal(
    offerNeedsApproval({ ...approved, approvedTerms: offerTermsSnapshot(approved) }, true),
    false,
    'an approval for the exact current terms can be sent',
  );
  assert.equal(
    offerNeedsApproval(
      { ...approved, approvedTerms: { ...offerTermsSnapshot(approved), ctc: 29 } },
      true,
    ),
    true,
    'a stale approval snapshot does not unlock a modified package',
  );
  assert.equal(
    offerNeedsApproval(approved, true),
    true,
    'a timestamp by itself is not proof that these terms were approved',
  );
  assert.equal(
    offerNeedsApproval(draft({ status: 'Sent', approvedAt: null }), true),
    false,
    'the gate is about reaching Sent, not about offers already past it',
  );
  assert.equal(
    offerNeedsApproval(draft({ status: 'Pending approval' }), true),
    false,
    'a pending offer is waiting on an approver, not on the recruiter',
  );
  assert.equal(offerNeedsApproval(null, true), false, 'and it never throws on a missing offer');
});

test('an approval is granted against specific terms', () => {
  const approved = draft({ approvedAt: '2026-09-01T10:00:00.000Z', approvedBy: 'Admin' });
  for (const term of OFFER_TERMS) {
    assert.equal(
      offerTermsChanged(approved, { ...approved, [term]: 'something-else' }),
      true,
      `changing ${term} voids the approval`,
    );
  }
  assert.equal(
    offerTermsChanged(approved, { ...approved }),
    false,
    'an unchanged offer needs no re-approval',
  );
  assert.equal(
    offerTermsChanged(approved, { ...approved, notes: 'extra internal context' }),
    false,
    'internal notes are not a term the approver signed off on',
  );
  assert.equal(
    offerTermsChanged(approved, { ...approved, ctc: 30 }),
    false,
    'an equal package is not a change',
  );
  assert.equal(offerTermsChanged({}, {}), false);
});

test('clearing an approval removes both the stamp and the approver', () => {
  const original = draft({ approvedAt: '2026-09-01T10:00:00.000Z', approvedBy: 'Admin' });
  const cleared = clearOfferApproval({ ...original, approvedTerms: offerTermsSnapshot(original) });
  assert.equal(cleared.approvedAt, null);
  assert.equal(cleared.approvedBy, '');
  assert.equal(cleared.approvedTerms, null);
  assert.equal(cleared.ctc, 30, 'the terms themselves are untouched');
  assert.equal(offerNeedsApproval(cleared, true), true, 'so the gate closes again');
});

test('the offer summary counts pending approvals separately from drafts', () => {
  const s = offersSummary([
    draft(),
    draft({ id: 'o2', status: 'Pending approval' }),
    draft({ id: 'o3', status: 'Sent' }),
    draft({ id: 'o4', status: 'Accepted' }),
  ]);
  assert.equal(s.drafts, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.sent, 1);
  assert.equal(s.accepted, 1);
  assert.equal(s.open, 3, 'draft, pending and sent are all still open');
  assert.equal(s.acceptRate, 100);
});
