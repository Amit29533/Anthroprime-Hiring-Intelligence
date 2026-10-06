import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCvEvidence, evidenceReady } from '../src/cvEvidence.js';
import { parseCVText } from '../src/cvParser.js';
test('CV evidence preserves section lines and explicit dates without inferring missing facts', () => {
  const text =
    'Jane Smith\njane@example.com\nWork Experience:\nDeveloper at Example | 2021–Present\nEducation\nBSc, Example College\nCertifications\nAWS certificate\nProjects\nHiring app\nSkills\nReact';
  const parsed = parseCVText(text);
  assert.equal(parsed.cvEvidence.items.length, 4);
  assert.deepEqual(
    parsed.cvEvidence.items.map((i) => i.section),
    ['employment', 'education', 'certifications', 'projects'],
  );
  assert.equal(parsed.cvEvidence.items[0].period, '2021–Present');
  assert.equal(parsed.cvEvidence.items[0].sourceLine, 4);
  assert.equal(parsed.cvEvidence.items[1].period, '');
  assert.equal(evidenceReady(parsed.cvEvidence), false);
  assert.equal(
    evidenceReady({
      ...parsed.cvEvidence,
      items: parsed.cvEvidence.items.map((i) => ({ ...i, reviewed: true })),
    }),
    true,
  );
  assert.deepEqual(extractCvEvidence('React engineer\nNo headings').items, []);
});
test('CV evidence bounds Unicode bytes and excerpts and exposes omissions', () => {
  const result = extractCvEvidence(
    'Education\n' + Array.from({ length: 100 }, () => '学'.repeat(600)).join('\n'),
  );
  assert.equal(result.truncated, true);
  assert.ok(result.items.length <= 16);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 10000);
  assert.ok(
    result.items.every((i) => i.evidence.length <= 400 && i.label.length <= 160 && !i.reviewed),
  );
});
