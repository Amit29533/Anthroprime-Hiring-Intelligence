import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCvEvidence,
  groupCvEvidence,
  mergeCvRecords,
  validateCvRecords,
  evidenceReady,
  duplicateCvRecords,
} from '../src/cvEvidence.js';
import {
  singleSenderEmail,
  normalizeMessage,
} from '../netlify/functions/_shared/google-workspace.js';

test('cited records preserve partial dates and review without manufacturing organizations', () => {
  let value = groupCvEvidence(
    extractCvEvidence(
      'Experience\nEngineer, Example 2020 – Present\nBuilt a tool\nEducation\nBSc 2015-2019',
    ),
  );
  assert.equal(value.records[0].start, '2020');
  assert.equal(value.records[0].ongoing, true);
  assert.equal(value.records[0].organization, '');
  assert.equal(validateCvRecords(value), '');
  assert.equal(evidenceReady(value), false);
  value = mergeCvRecords(value, 0);
  assert.deepEqual(value.records[0].sourceLines, [2, 3]);
  assert.equal(value.records.length, 2);
  assert.equal(mergeCvRecords(value, 0), value);
  value = {
    ...value,
    items: value.items.map((i) => ({ ...i, reviewed: true })),
    records: value.records.map((r) => ({ ...r, reviewed: true })),
  };
  assert.equal(evidenceReady(value), true);
  const changed = {
    ...value,
    records: value.records.map((r, i) => (i === 0 ? { ...r, start: '2026-02-30' } : r)),
  };
  assert.match(validateCvRecords(changed), /dates/);
  assert.equal(evidenceReady(changed), false);
  for (const patch of [
    { start: '2025', end: '2024', ongoing: false },
    { sourceLines: [999] },
    { sourceLines: [2, 2] },
    { ongoing: true, end: '2025' },
    { reviewed: null },
  ])
    assert.ok(validateCvRecords({ ...value, records: [{ ...value.records[0], ...patch }] }));
  assert.deepEqual(
    duplicateCvRecords({
      ...value,
      records: [
        value.records[0],
        { ...value.records[0], label: value.records[0].label.toUpperCase() },
      ],
    }),
    [2],
  );
  assert.ok(validateCvRecords({ ...value, records: [null] }));
  assert.equal(evidenceReady({ records: [] }), false);
});

test('only unambiguous sender addresses and bounded Gmail reception timestamps drive replies', () => {
  assert.equal(singleSenderEmail('Candidate <PERSON@Example.com>'), 'person@example.com');
  for (const value of [
    'one@e.com, two@e.com',
    'one@e.com>',
    'Candidate <one@e.com',
    'one@e.com\r\nBcc: secret@e.com',
    'Display <one@e.com> tail',
  ])
    assert.equal(singleSenderEmail(value), '');
  const base = {
    id: 'message',
    threadId: 'thread',
    payload: { headers: [{ name: 'From', value: 'Candidate <person@example.com>' }] },
  };
  assert.equal(
    normalizeMessage({ ...base, internalDate: String(Date.now() - 1000) }).body.senderEmail,
    'person@example.com',
  );
  assert.ok(
    Number.isSafeInteger(
      normalizeMessage({ ...base, internalDate: String(Date.now() - 1000) }).body.receivedMs,
    ),
  );
  for (const internalDate of ['bad', 'Infinity', '-1', String(Date.now() + 3600000), undefined])
    assert.equal(normalizeMessage({ ...base, internalDate }).body.receivedMs, undefined);
});
