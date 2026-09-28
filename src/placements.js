// Placement and deployment records close the ECOD lifecycle after an accepted offer. A placement
// is operational history; its commercial terms live in a separate admin-only table.

export const PLACEMENT_STATUSES = ['Planned', 'Active', 'Completed', 'Terminated', 'Cancelled'];
export const BILLING_BASES = ['Annual', 'Monthly', 'Daily', 'Hourly', 'Fixed'];
export const CURRENCIES = ['INR', 'USD', 'GBP', 'EUR', 'AED', 'SGD'];

export const blankPlacement = (clientId = null) => ({
  candidateId: '',
  demandId: '',
  clientId,
  considerationId: null,
  offerId: null,
  status: 'Planned',
  startDate: '',
  endDate: '',
  engagementType: '',
  workMode: '',
  location: '',
  recruiter: '',
  notes: '',
});

export const blankPlacementCommercial = (placementId = null) => ({
  placementId,
  billRate: null,
  costRate: null,
  currency: 'INR',
  basis: 'Annual',
  billedAmount: null,
  collectedAmount: null,
  notes: '',
});

const numberOrNull = (value) =>
  value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);

export function validatePlacement(form, data, id = null) {
  const errors = {};
  if (!form?.candidateId) errors.candidateId = 'Select a candidate.';
  if (!form?.demandId) errors.demandId = 'Select a demand.';
  if (!form?.clientId) errors.clientId = 'The demand must belong to a client account.';
  if (!PLACEMENT_STATUSES.includes(form?.status)) errors.status = 'Unknown placement status.';
  if (!form?.startDate) errors.startDate = 'Start date is required.';
  if (form?.startDate && form?.endDate && form.endDate < form.startDate)
    errors.endDate = 'End date cannot be before the start date.';
  const demand = (data?.demands || []).find((row) => row.id === form?.demandId);
  if (demand && demand.clientId !== form.clientId)
    errors.demandId = 'The selected demand does not belong to this client.';
  if (
    (data?.placements || []).some(
      (row) =>
        row.id !== id &&
        row.candidateId === form?.candidateId &&
        row.demandId === form?.demandId &&
        !['Terminated', 'Cancelled'].includes(row.status),
    )
  )
    errors.candidateId = 'This candidate already has a live placement for the demand.';
  return errors;
}

export function validatePlacementCommercial(form) {
  const errors = {};
  for (const key of ['billRate', 'costRate', 'billedAmount', 'collectedAmount']) {
    const value = numberOrNull(form?.[key]);
    if (value != null && value < 0) errors[key] = 'Enter zero or a positive amount.';
  }
  if (!CURRENCIES.includes(form?.currency)) errors.currency = 'Unknown currency.';
  if (!BILLING_BASES.includes(form?.basis)) errors.basis = 'Unknown billing basis.';
  return errors;
}

export function normalizePlacementCommercial(form, placementId) {
  return {
    ...form,
    placementId,
    billRate: numberOrNull(form.billRate),
    costRate: numberOrNull(form.costRate),
    billedAmount: numberOrNull(form.billedAmount),
    collectedAmount: numberOrNull(form.collectedAmount),
  };
}

export function placementMargin(commercial) {
  const bill = numberOrNull(commercial?.billRate);
  const cost = numberOrNull(commercial?.costRate);
  if (bill == null || cost == null) return { amount: null, percent: null };
  const amount = bill - cost;
  return { amount, percent: bill === 0 ? null : Math.round((amount / bill) * 1000) / 10 };
}

export function placementSummary(data, rows = data?.placements || []) {
  const active = rows.filter((row) => row.status === 'Active').length;
  const planned = rows.filter((row) => row.status === 'Planned').length;
  const completed = rows.filter((row) => row.status === 'Completed').length;
  const billed = (data?.placementCommercials || [])
    .filter((commercial) => rows.some((row) => row.id === commercial.placementId))
    .reduce((sum, commercial) => sum + (numberOrNull(commercial.billedAmount) || 0), 0);
  const collected = (data?.placementCommercials || [])
    .filter((commercial) => rows.some((row) => row.id === commercial.placementId))
    .reduce((sum, commercial) => sum + (numberOrNull(commercial.collectedAmount) || 0), 0);
  return { total: rows.length, active, planned, completed, billed, collected };
}

export const placementsForClient = (data, clientId) =>
  (data?.placements || [])
    .filter((row) => row.clientId === clientId)
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));

export const placementsForCandidate = (data, candidateId) =>
  (data?.placements || [])
    .filter((row) => row.candidateId === candidateId)
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
