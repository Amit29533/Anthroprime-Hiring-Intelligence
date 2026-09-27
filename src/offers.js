// Offer module — Zoho G1 equivalent, scoped honestly: offer records with terms, a
// Draft → Sent → decision lifecycle and mail-client drafts. E-signature and PDF
// generation are explicitly out of scope for this release.
export const OFFER_STATUSES = ['Draft', 'Pending approval', 'Sent', 'Accepted', 'Rejected', 'Withdrawn'];
export const OFFER_TONES = { Draft: 'gray', 'Pending approval': 'amber', Sent: 'blue', Accepted: 'green', Rejected: 'red', Withdrawn: 'gray' };
export const OPEN_OFFER_STATUSES = ['Draft', 'Sent'];

export const offerIsOpen = offer => OPEN_OFFER_STATUSES.includes(offer.status);

export function offersSummary(offers = []) {
  const open = offers.filter(offerIsOpen).length;
  const accepted = offers.filter(o => o.status === 'Accepted').length;
  const decided = offers.filter(o => ['Accepted', 'Rejected'].includes(o.status));
  const acceptRate = decided.length ? Math.round(accepted / decided.length * 100) : null;
  return { open, accepted, sent: offers.filter(o => o.status === 'Sent').length, drafts: offers.filter(o => o.status === 'Draft').length, acceptRate };
}
