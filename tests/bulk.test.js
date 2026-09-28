import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_ACTIONS, planBulk, describePlan, skipSummary } from '../src/bulk.js';
import { normalizeData, emptyData } from '../src/schema.js';
import { STAGES } from '../src/domain.js';

const world = (over = {}) =>
  normalizeData({
    ...emptyData(),
    candidates: [
      {
        id: 'c1',
        name: 'Aarav',
        owner: 'Amit Singh',
        tags: ['Bench'],
        status: 'Ready',
        skills: [],
      },
      { id: 'c2', name: 'Bhavna', owner: '', tags: [], status: 'Assessing', skills: [] },
      { id: 'c3', name: 'Chetan', owner: 'Neha', tags: ['Bench'], status: 'Ready', skills: [] },
    ],
    demands: [
      { id: 'd1', title: 'Data Engineer', status: 'Open', skills: [] },
      { id: 'd2', title: 'Closed role', status: 'Closed', skills: [] },
    ],
    considerations: [{ id: 'k1', candidateId: 'c1', demandId: 'd1', stage: 'Interview' }],
    ...over,
  });

const ALL = ['c1', 'c2', 'c3'];

test('every action declares what input it needs', () => {
  for (const [key, spec] of Object.entries(BULK_ACTIONS)) {
    assert.ok(spec.label, `${key} has a label`);
    assert.ok(['text', 'choice', 'demand'].includes(spec.needs), `${key} declares its input`);
    if (spec.needs === 'choice') assert.ok(spec.options.length, `${key} offers options`);
  }
});

test('a plan is refused before it can do anything wrong', () => {
  const data = world();
  assert.match(
    planBulk(data, { action: 'nope', ids: ALL, value: 'x' }).blocked,
    /Choose an action/,
  );
  assert.match(
    planBulk(data, { action: 'tag', ids: [], value: 'x' }).blocked,
    /Select at least one/,
  );
  assert.match(planBulk(data, { action: 'tag', ids: ALL, value: '  ' }).blocked, /Enter a value/);
  assert.match(
    planBulk(data, { action: 'status', ids: ALL, value: 'Brilliant' }).blocked,
    /valid option/,
  );
  assert.match(
    planBulk(data, { action: 'owner', ids: ALL, value: 'X', role: 'viewer' }).blocked,
    /viewer role cannot change records/,
    'a viewer cannot even build a plan',
  );
  // A blocked plan writes nothing at all.
  const blocked = planBulk(data, { action: 'tag', ids: [], value: 'x' });
  assert.deepEqual(blocked.writes, {});
  assert.deepEqual(blocked.changes, []);
});

test('assigning an owner skips people who already have that owner', () => {
  const plan = planBulk(world(), { action: 'owner', ids: ALL, value: 'Amit Singh' });
  assert.deepEqual(
    plan.changes.map((c) => c.id),
    ['c2', 'c3'],
  );
  assert.deepEqual(
    plan.skipped.map((s) => s.id),
    ['c1'],
  );
  assert.match(plan.skipped[0].reason, /Already owned/);
  assert.equal(plan.writes.candidates.length, 2);
  assert.equal(plan.writes.candidates[0].owner, 'Amit Singh');
  assert.match(
    plan.changes.find((c) => c.id === 'c3').summary,
    /Owner Neha → Amit Singh/,
    'the summary shows the before and after, not just the after',
  );
  assert.match(plan.changes.find((c) => c.id === 'c2').summary, /Owner set to/);
});

test('tagging is idempotent and case-insensitive', () => {
  const plan = planBulk(world(), { action: 'tag', ids: ALL, value: '  bench ' });
  assert.deepEqual(
    plan.changes.map((c) => c.id),
    ['c2'],
    'c1 and c3 already have "Bench"',
  );
  assert.deepEqual(plan.writes.candidates[0].tags, ['bench']);
  assert.equal(plan.skipped.length, 2);

  const untag = planBulk(world(), { action: 'untag', ids: ALL, value: 'BENCH' });
  assert.deepEqual(
    untag.changes.map((c) => c.id),
    ['c1', 'c3'],
  );
  assert.deepEqual(untag.writes.candidates[0].tags, []);
  assert.match(untag.skipped[0].reason, /Does not have that tag/);
});

test('a bulk change never drops the other fields on the record', () => {
  const plan = planBulk(world(), { action: 'status', ids: ['c1'], value: 'Unavailable' });
  const row = plan.writes.candidates[0];
  assert.equal(row.name, 'Aarav', 'the rest of the record is preserved');
  assert.deepEqual(row.tags, ['Bench']);
  assert.equal(row.owner, 'Amit Singh');
  assert.equal(row.status, 'Unavailable');
});

test('shortlisting creates pipeline entries and skips anyone already in it', () => {
  const plan = planBulk(world(), { action: 'shortlist', ids: ALL, value: 'd1' });
  assert.deepEqual(
    plan.changes.map((c) => c.id),
    ['c2', 'c3'],
  );
  assert.deepEqual(
    plan.skipped.map((s) => s.id),
    ['c1'],
  );
  assert.match(plan.skipped[0].reason, /Already in the pipeline \(Interview\)/);
  assert.equal(plan.writes.considerations.length, 2);
  assert.equal(plan.writes.considerations[0].stage, STAGES[0], 'entering at the first stage');
  assert.equal(plan.writes.considerations[0].demandId, 'd1');
  assert.ok(plan.writes.considerations[0].id, 'each entry gets its own id');
  assert.notEqual(plan.writes.considerations[0].id, plan.writes.considerations[1].id);
  assert.equal(plan.undoable, false, 'creating pipeline rows is not offered as undoable');
});

test('shortlisting to a closed or unknown demand is refused with a reason', () => {
  const data = world();
  assert.match(planBulk(data, { action: 'shortlist', ids: ALL, value: 'd2' }).blocked, /is Closed/);
  assert.match(
    planBulk(data, { action: 'shortlist', ids: ALL, value: 'nope' }).blocked,
    /Choose a demand/,
  );
  assert.match(
    planBulk(data, { action: 'shortlist', ids: ALL, value: '' }).blocked,
    /Choose a demand/,
  );
});

test('a plan carries the undo payload for the rows it would change', () => {
  const plan = planBulk(world(), { action: 'status', ids: ALL, value: 'Unavailable' });
  assert.equal(plan.undoable, true);
  assert.equal(plan.undo.candidates.length, plan.writes.candidates.length);
  const originals = Object.fromEntries(plan.undo.candidates.map((c) => [c.id, c.status]));
  assert.equal(originals.c1, 'Ready', 'the previous value is captured, not the new one');
  assert.equal(originals.c2, 'Assessing');
  // Undo restores exactly what was there.
  for (const row of plan.undo.candidates) {
    const current = world().candidates.find((c) => c.id === row.id);
    assert.deepEqual(row, current, 'undo writes back the record as it was');
  }
});

test('a record deleted between selection and confirmation is reported, not ignored', () => {
  const plan = planBulk(world(), { action: 'tag', ids: ['c1', 'ghost'], value: 'New' });
  const ghost = plan.skipped.find((s) => s.id === 'ghost');
  assert.ok(ghost, 'the missing record is accounted for');
  assert.match(ghost.reason, /No longer exists/);
  assert.equal(plan.changes.length, 1);
});

test('the plan describes itself in one honest line', () => {
  const data = world();
  assert.equal(
    describePlan(planBulk(data, { action: 'owner', ids: ALL, value: 'Amit Singh' })),
    '2 records will change; 1 skipped.',
  );
  assert.equal(
    describePlan(planBulk(data, { action: 'status', ids: ['c1'], value: 'Ready' })),
    'No changes — all 1 selected record already match.',
    'a no-op says so rather than reporting success',
  );
  assert.equal(
    describePlan(planBulk(data, { action: 'tag', ids: ['c2'], value: 'New' })),
    '1 record will change.',
  );
  assert.match(
    describePlan(planBulk(data, { action: 'tag', ids: [], value: 'x' })),
    /Select at least one/,
  );
});

test('skip reasons are grouped so twenty rows do not become twenty lines', () => {
  const many = normalizeData({
    ...emptyData(),
    candidates: Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      name: `P${i}`,
      tags: ['Bench'],
      status: 'Ready',
      skills: [],
    })),
  });
  const plan = planBulk(many, {
    action: 'tag',
    ids: many.candidates.map((c) => c.id),
    value: 'Bench',
  });
  const summary = skipSummary(plan);
  assert.deepEqual(summary, [{ reason: 'Already tagged', count: 12 }]);
  assert.deepEqual(skipSummary({ skipped: [] }), []);
});

test('planning is pure — the workspace is untouched until the caller writes', () => {
  const data = world();
  const snapshot = JSON.stringify(data);
  planBulk(data, { action: 'owner', ids: ALL, value: 'Someone' });
  planBulk(data, { action: 'shortlist', ids: ALL, value: 'd1' });
  planBulk(data, { action: 'untag', ids: ALL, value: 'Bench' });
  assert.equal(JSON.stringify(data), snapshot, 'nothing was mutated while planning');
});
