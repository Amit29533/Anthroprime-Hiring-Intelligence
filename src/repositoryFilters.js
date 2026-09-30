export const blankRepositoryFilters = () => ({ employer: '', engagement: '', maxExpected: '' });
export const hasRepositoryFilters = (filters) =>
  Object.values(filters).some((value) => value !== '');
export function validateRepositoryFilters(filters, isAdmin) {
  if (!['', 'Permanent', 'Contract', 'C2H', 'Subcontract'].includes(filters.engagement || ''))
    return 'Invalid engagement preference.';
  if (String(filters.employer || '').trim().length > 120)
    return 'Employer search must be 120 characters or fewer.';
  if (filters.maxExpected !== '' && filters.maxExpected != null) {
    if (!isAdmin) return 'Compensation filters require administrator access.';
    if (!Number.isFinite(Number(filters.maxExpected)) || Number(filters.maxExpected) < 0)
      return 'Maximum expected compensation must be zero or greater.';
  }
  return '';
}
export function matchesRepositoryFilters(candidate, filters) {
  return (
    (!filters.employer ||
      String(candidate.company || '')
        .toLowerCase()
        .includes(filters.employer.trim().toLowerCase())) &&
    (!filters.engagement || candidate.engagement === filters.engagement) &&
    (filters.maxExpected === '' ||
      filters.maxExpected == null ||
      (candidate.expected != null && Number(candidate.expected) <= Number(filters.maxExpected)))
  );
}
