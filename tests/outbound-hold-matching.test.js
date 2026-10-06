import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCandidate } from '../src/domain.js';
import { makeSeed } from '../src/seed.js';
test('a recruiting hold makes an otherwise matching profile ineligible without altering its evidence', () => {
  const data = makeSeed();
  const c = data.candidates[0],
    d = data.demands[0];
  const before = matchCandidate(c, d, data.assessments);
  const held = matchCandidate({ ...c, processingRestricted: true }, d, data.assessments);
  assert.equal(held.eligible, false);
  assert.ok(held.blockers.includes('Outbound recruiting hold'));
  assert.equal(held.score, before.score);
});
