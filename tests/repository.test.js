import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canWriteForRole,
  canExportForRole,
  historyRefreshLimit,
  mergeHistory,
} from '../src/repository.js';

test('merging recent cloud history preserves older loaded records and de-duplicates ids', () => {
  const history = mergeHistory(
    [
      { id: 'old', date: '2022-01-01T00:00:00Z', action: 'created' },
      { id: 'recent', date: '2024-01-01T00:00:00Z', action: 'updated' },
    ],
    [
      { id: 'recent', date: '2024-01-02T00:00:00Z', action: 'updated' },
      { id: 'new', date: '2024-01-03T00:00:00Z', action: 'created' },
    ],
  );

  assert.deepEqual(
    history.map(({ id }) => id),
    ['new', 'recent', 'old'],
  );
  assert.equal(history.find(({ id }) => id === 'recent').date, '2024-01-02T00:00:00Z');
});

test('cloud history refresh includes every event from a bulk write', () => {
  assert.equal(historyRefreshLimit(0), 1000);
  assert.equal(historyRefreshLimit(50), 1000);
  assert.equal(historyRefreshLimit(5000), 5000);
});

test('only recognized editor roles may write or export workspace data', () => {
  for (const role of ['admin', 'recruiter']) {
    assert.equal(canWriteForRole(role), true);
    assert.equal(canExportForRole(role), true);
  }
  for (const role of ['viewer', null, undefined, 'unknown']) {
    assert.equal(canWriteForRole(role), false);
    assert.equal(canExportForRole(role), false);
  }
});
