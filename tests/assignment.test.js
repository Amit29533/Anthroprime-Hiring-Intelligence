import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSIGNABLE,
  OPS,
  blankRule,
  fieldMeta,
  ruleMatches,
  rulesFor,
  assignmentFor,
  applyAssignment,
  dryRun,
  validateRule,
  knownOwners,
  ownerIsUnknown,
} from '../src/assignment.js';
import { normalizeData, emptyData } from '../src/schema.js';

const rule = (over = {}) => ({
  id: 'r1',
  ...blankRule('candidates'),
  name: 'Referrals to Amit',
  field: 'source',
  op: 'eq',
  value: 'Referral',
  assignTo: 'Amit Singh',
  priority: 100,
  created: '2026-09-01',
  ...over,
});

const world = (rules = [], over = {}) =>
  normalizeData({
    ...emptyData(),
    assignmentRules: rules,
    candidates: [
      { id: 'c1', name: 'Aarav', source: 'Referral', location: 'Pune', skills: ['SQL'], owner: '' },
      {
        id: 'c2',
        name: 'Bhavna',
        source: 'Job board',
        location: 'Bengaluru',
        skills: ['Azure'],
        owner: '',
      },
      {
        id: 'c3',
        name: 'Chetan',
        source: 'Referral',
        location: 'Pune',
        skills: [],
        owner: 'Neha Kulkarni',
      },
    ],
    demands: [
      {
        id: 'd1',
        title: 'Data Engineer',
        client: 'Meridian',
        location: 'Pune',
        skills: ['SQL'],
        owner: '',
      },
    ],
    ...over,
  });

test('every assignable field belongs to the record type it claims', () => {
  for (const [entity, spec] of Object.entries(ASSIGNABLE)) {
    assert.ok(spec.label, `${entity} is labelled`);
    assert.ok(spec.fields.length, `${entity} has fields`);
    for (const f of spec.fields) assert.ok(f.key && f.label, `${entity}.${f.key} is named`);
  }
  assert.deepEqual(Object.keys(OPS), ['eq', 'contains', 'any']);
  assert.equal(fieldMeta('candidates', 'source').label, 'Source');
  assert.equal(fieldMeta('candidates', 'nonsense'), null);
  assert.equal(fieldMeta('nope', 'source'), null);
});

test('a rule never takes work off somebody who already owns it', () => {
  const data = world([rule()]);
  const owned = data.candidates.find((c) => c.id === 'c3');
  assert.equal(
    assignmentFor(data, 'candidates', owned),
    null,
    'Chetan matches the rule but is already Neha’s — silently moving him would be worse than nothing',
  );
  const unowned = data.candidates.find((c) => c.id === 'c1');
  assert.equal(assignmentFor(data, 'candidates', unowned).owner, 'Amit Singh');
});

test('the first matching rule wins, in a defined order', () => {
  const data = world([
    rule({
      id: 'slow',
      name: 'Catch-all',
      field: 'location',
      value: 'Pune',
      assignTo: 'Second',
      priority: 200,
    }),
    rule({
      id: 'fast',
      name: 'Referrals',
      field: 'source',
      value: 'Referral',
      assignTo: 'First',
      priority: 10,
    }),
  ]);
  const hit = assignmentFor(data, 'candidates', data.candidates[0]);
  assert.equal(hit.owner, 'First', 'lower priority number runs first');
  assert.equal(hit.rule.name, 'Referrals', 'and the caller can say which rule did it');
  assert.deepEqual(
    rulesFor(data, 'candidates').map((r) => r.id),
    ['fast', 'slow'],
  );
});

test('rules for other entities and disabled rules never fire', () => {
  const data = world([
    rule({ id: 'off', enabled: false, assignTo: 'Nobody' }),
    rule({
      id: 'other',
      entity: 'demands',
      field: 'client',
      value: 'Meridian',
      assignTo: 'Demand owner',
    }),
  ]);
  assert.equal(assignmentFor(data, 'candidates', data.candidates[0]), null);
  assert.equal(assignmentFor(data, 'demands', data.demands[0]).owner, 'Demand owner');
  assert.deepEqual(rulesFor(data, 'candidates'), [], 'a disabled rule is not in the running order');
});

test('matching handles text, lists and each comparison', () => {
  const c = { source: 'Referral', title: 'Senior Data Engineer', skills: ['Azure', 'SQL'] };
  assert.equal(ruleMatches(rule({ op: 'eq', value: 'referral' }), c), true, 'case-insensitive');
  assert.equal(ruleMatches(rule({ op: 'eq', value: 'Job board' }), c), false);
  assert.equal(ruleMatches(rule({ field: 'title', op: 'contains', value: 'data' }), c), true);
  assert.equal(ruleMatches(rule({ field: 'title', op: 'eq', value: 'data' }), c), false);
  assert.equal(ruleMatches(rule({ op: 'any', value: 'Referral, Job board' }), c), true);
  assert.equal(ruleMatches(rule({ op: 'any', value: 'Agency, Job board' }), c), false);
  // List fields
  assert.equal(ruleMatches(rule({ field: 'skills', op: 'eq', value: 'sql' }), c), true);
  assert.equal(ruleMatches(rule({ field: 'skills', op: 'any', value: 'Kafka, Azure' }), c), true);
  assert.equal(ruleMatches(rule({ field: 'skills', op: 'contains', value: 'az' }), c), true);
  assert.equal(ruleMatches(rule({ field: 'skills', op: 'eq', value: 'Kafka' }), c), false);
  // Degenerate input never matches everything by accident.
  assert.equal(ruleMatches(rule({ value: '' }), c), false, 'an empty value matches nothing');
  assert.equal(
    ruleMatches(rule({ field: 'location' }), c),
    false,
    'a missing field does not match',
  );
  assert.equal(ruleMatches(null, c), false);
  assert.equal(ruleMatches(rule(), null), false);
});

test('applying returns only the rows that actually change', () => {
  const data = world([rule()]);
  const changed = applyAssignment(data, 'candidates', data.candidates);
  assert.deepEqual(
    changed.map((c) => c.id),
    ['c1'],
    'c2 does not match; c3 is already owned',
  );
  assert.equal(changed[0].owner, 'Amit Singh');
  assert.equal(changed[0]._rule, 'Referrals to Amit', 'the reason travels with the change');
  assert.deepEqual(
    applyAssignment(world([]), 'candidates', data.candidates),
    [],
    'no rules, no changes',
  );
});

test('the dry run reports what a rule would do before it is enabled', () => {
  const data = world([]);
  const preview = dryRun(data, 'candidates', rule());
  assert.equal(preview.total, 3);
  assert.deepEqual(
    preview.wouldAssign.map((r) => r.id),
    ['c1'],
  );
  assert.equal(preview.wouldAssign[0].owner, 'Amit Singh');
  assert.equal(preview.wouldAssign[0].rule, 'Referrals to Amit');
  assert.equal(preview.alreadyOwned, 1, 'Chetan is untouched and counted separately');
  assert.equal(preview.noMatch, 1);
  assert.deepEqual(preview.byOwner, [{ owner: 'Amit Singh', count: 1 }]);
});

test('a dry run of the live rule set needs no extra rule', () => {
  const live = dryRun(world([rule()]), 'candidates');
  assert.deepEqual(
    live.wouldAssign.map((r) => r.id),
    ['c1'],
  );
  const none = dryRun(world([]), 'candidates');
  assert.deepEqual(none.wouldAssign, []);
  assert.equal(none.noMatch, 2, 'two unowned records match nothing');
});

test('a dry run never mutates the workspace it is previewing', () => {
  const data = world([rule()]);
  const snapshot = JSON.stringify(data);
  dryRun(data, 'candidates', rule({ id: 'extra', name: 'Another', assignTo: 'Someone' }));
  applyAssignment(data, 'candidates', data.candidates);
  assert.equal(JSON.stringify(data), snapshot);
});

test('rule validation catches what would make a rule useless', () => {
  const existing = [rule()];
  const good = { ...blankRule('candidates'), name: 'New', value: 'Referral', assignTo: 'Amit' };
  assert.deepEqual(validateRule(good, existing), {});
  assert.match(validateRule({ ...good, name: '' }, existing).name, /Give the rule a name/);
  assert.match(
    validateRule({ ...good, name: 'referrals TO amit' }, existing).name,
    /already exists/,
  );
  assert.deepEqual(validateRule({ ...good, name: 'Referrals to Amit' }, existing, 'r1'), {});
  assert.match(validateRule({ ...good, field: 'nope' }, existing).field, /field this record has/);
  assert.match(validateRule({ ...good, op: 'weird' }, existing).op, /comparison/);
  assert.match(validateRule({ ...good, value: '  ' }, existing).value, /value to match/);
  assert.match(validateRule({ ...good, assignTo: '' }, existing).assignTo, /assigned to/);
  assert.match(validateRule({ ...good, priority: 0 }, existing).priority, /between 1 and 999/);
  assert.match(validateRule({ ...good, priority: 'abc' }, existing).priority, /between 1 and 999/);
  assert.match(
    validateRule({ ...good, entity: 'unicorns' }, existing).entity,
    /what this rule is about/,
  );
});

test('assigning to a name nobody uses is detectable, because owner is free text', () => {
  const data = world([], { clients: [{ id: 'cl1', name: 'Meridian', owner: 'Priya Raman' }] });
  assert.deepEqual(knownOwners(data), ['Neha Kulkarni', 'Priya Raman']);
  assert.equal(ownerIsUnknown(data, 'Neha Kulkarni'), false);
  assert.equal(ownerIsUnknown(data, 'neha kulkarni'), false, 'matched case-insensitively');
  assert.equal(
    ownerIsUnknown(data, 'Nehaa Kulkarni'),
    true,
    'a typo would silently route work to nobody, so it is worth warning about',
  );
  assert.equal(
    ownerIsUnknown(data, ''),
    false,
    'an empty name is a validation problem, not a typo',
  );
});
