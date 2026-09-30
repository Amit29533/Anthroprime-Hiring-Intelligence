import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankRepositoryFilters,
  matchesRepositoryFilters,
  validateRepositoryFilters,
} from '../src/repositoryFilters.js';
test('structured filters match literal employers, engagement and known compensation ceilings', () => {
  const filters = {
    ...blankRepositoryFilters(),
    employer: ' DELo ',
    engagement: 'Contract',
    maxExpected: '30',
  };
  assert.equal(
    matchesRepositoryFilters(
      { company: 'Deloitte', engagement: 'Contract', expected: 30 },
      filters,
    ),
    true,
  );
  assert.equal(
    matchesRepositoryFilters(
      { company: 'Deloitte', engagement: 'Permanent', expected: 25 },
      filters,
    ),
    false,
  );
  assert.equal(
    matchesRepositoryFilters(
      { company: 'Deloitte', engagement: 'Contract', expected: null },
      filters,
    ),
    false,
  );
  assert.equal(
    matchesRepositoryFilters(
      { company: 'Deloitte', engagement: 'Contract', expected: 0 },
      { ...filters, maxExpected: '0' },
    ),
    true,
  );
  assert.match(validateRepositoryFilters(filters, false), /administrator/);
  assert.match(
    validateRepositoryFilters({ ...filters, maxExpected: '-1' }, true),
    /zero or greater/,
  );
});
