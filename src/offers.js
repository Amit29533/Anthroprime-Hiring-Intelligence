// Offer module — Zoho G1 equivalent, scoped honestly: offer records with terms, a
// Draft → Sent → decision lifecycle and mail-client drafts. E-signature and PDF
// generation are explicitly out of scope for this release.
export const OFFER_STATUSES = [
  'Draft',
  'Pending approval',
  'Sent',
  'Accepted',
  'Rejected',
  'Withdrawn',
];
export const OFFER_TONES = {
  Draft: 'gray',
  'Pending approval': 'amber',
  Sent: 'blue',
  Accepted: 'green',
  Rejected: 'red',
  Withdrawn: 'gray',
};
export const OPEN_OFFER_STATUSES = ['Draft', 'Pending approval', 'Sent'];

export const offerIsOpen = (offer) => OPEN_OFFER_STATUSES.includes(offer.status);

// Blueprint I7 — offer approvals. A workspace can require an offer to be approved before it
// leaves the building. Without a record of *which* draft was approved, the setting is
// decorative: approval used to return the offer to plain 'Draft', and 'Draft' always showed
// "Mark sent", so any recruiter could email terms straight to a candidate and skip the gate.
// The material terms an approval is granted against. Notes are internal commentary and
// deliberately excluded — editing one should not force a re-approval.
export const OFFER_TERMS = ['candidateId', 'demandId', 'role', 'location', 'ctc', 'joining'];

/** A client-side mirror for local demo mode; the database creates its own trusted snapshot. */
export const offerTermsSnapshot = (offer) =>
  Object.fromEntries(OFFER_TERMS.map((k) => [k, offer?.[k] ?? null]));

/** True when a term changed, which invalidates any approval already granted. */
export const offerTermsChanged = (before = {}, after = {}) =>
  OFFER_TERMS.some((k) => String(before?.[k] ?? '') !== String(after?.[k] ?? ''));

/** True only when an approval exists for the exact current terms. */
export const offerApprovalCurrent = (offer) =>
  Boolean(
    offer?.termsApproved === true ||
      (offer?.approvedAt && offer?.approvedTerms && !offerTermsChanged(offer.approvedTerms, offer)),
  );

/** True while an approvals-enabled workspace still owes this draft an approval. */
export const offerNeedsApproval = (offer, approvalsOn) =>
  Boolean(approvalsOn) && offer?.status === 'Draft' && !offerApprovalCurrent(offer);

/** Drop a granted approval — used whenever the terms it covered are edited. */
export const clearOfferApproval = (offer) => ({
  ...offer,
  approvedAt: null,
  approvedBy: '',
  approvedTerms: null,
});

export function offersSummary(offers = []) {
  const open = offers.filter(offerIsOpen).length;
  const accepted = offers.filter((o) => o.status === 'Accepted').length;
  const decided = offers.filter((o) => ['Accepted', 'Rejected'].includes(o.status));
  const acceptRate = decided.length ? Math.round((accepted / decided.length) * 100) : null;
  return {
    open,
    accepted,
    sent: offers.filter((o) => o.status === 'Sent').length,
    drafts: offers.filter((o) => o.status === 'Draft').length,
    pending: offers.filter((o) => o.status === 'Pending approval').length,
    acceptRate,
  };
}
