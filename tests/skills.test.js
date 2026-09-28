import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EVIDENCE_WEIGHT,
  EVIDENCE_TYPES,
  VALIDATED_WEIGHT,
  STALE_AFTER_DAYS,
  weightOf,
  findSkillByName,
  evidenceFor,
  decidingEvidence,
  derivePersonSkill,
  evidenceAgeDays,
  isStale,
  skillsForCandidate,
  candidatesWithSkill,
  skillInventory,
  unverifiedClaims,
  blankEvidence,
  validateEvidence,
  evidenceRow,
} from '../src/skills.js';
import { PROFICIENCY_LEVELS } from '../src/taxonomy.js';
import { normalizeData, emptyData } from '../src/schema.js';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const fixture = () =>
  normalizeData({
    ...emptyData(),
    candidates: [
      { id: 'p1', name: 'Aarav' },
      { id: 'p2', name: 'Bhavna' },
    ],
    skills: [
      { id: 's1', name: 'Databricks', domain: 'Data', aliases: ['DBX'] },
      { id: 's2', name: 'Apache Spark', domain: 'Data', aliases: ['PySpark', 'Spark'] },
      { id: 's3', name: 'Kubernetes', domain: 'Cloud', aliases: [] },
    ],
    personSkills: [
      {
        id: 'ps1',
        candidateId: 'p1',
        skillId: 's1',
        proficiency: 'Advanced',
        confidence: 100,
        validated: true,
        evidenceCount: 2,
        lastEvidence: daysAgo(10).slice(0, 10),
      },
      {
        id: 'ps2',
        candidateId: 'p1',
        skillId: 's2',
        proficiency: 'Working',
        confidence: 10,
        validated: false,
        evidenceCount: 1,
        lastEvidence: daysAgo(500).slice(0, 10),
      },
      {
        id: 'ps3',
        candidateId: 'p2',
        skillId: 's1',
        proficiency: 'Working',
        confidence: 30,
        validated: false,
        evidenceCount: 1,
        lastEvidence: daysAgo(20).slice(0, 10),
      },
    ],
    skillEvidence: [
      {
        id: 'e1',
        personSkillId: 'ps1',
        evidenceType: 'Assessment',
        proficiency: 'Advanced',
        years: 6,
        date: daysAgo(40),
      },
      {
        id: 'e2',
        personSkillId: 'ps1',
        evidenceType: 'Self-declared',
        proficiency: 'Expert',
        date: daysAgo(10),
      },
      {
        id: 'e3',
        personSkillId: 'ps2',
        evidenceType: 'Self-declared',
        proficiency: 'Working',
        date: daysAgo(500),
      },
      {
        id: 'e4',
        personSkillId: 'ps3',
        evidenceType: 'CV',
        proficiency: 'Working',
        date: daysAgo(20),
      },
    ],
  });

test('the evidence weights match the database function exactly', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/025_skills_model.sql', import.meta.url),
    'utf8',
  );
  const body = sql.slice(
    sql.indexOf('function public.skill_evidence_weight'),
    sql.indexOf('function public.refresh_person_skill'),
  );
  const fromSql = Object.fromEntries(
    [...body.matchAll(/when '([^']+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );
  assert.deepEqual(
    fromSql,
    EVIDENCE_WEIGHT,
    'src/skills.js and migration 025 must agree on what evidence is worth',
  );
  assert.ok(sql.includes(`>= ${VALIDATED_WEIGHT}`), 'the validation threshold matches too');
  for (const type of EVIDENCE_TYPES)
    assert.ok(sql.includes(`'${type}'`), `${type} is a value the database accepts`);
});

test('an assessment outranks a newer self-declared claim', () => {
  const rows = evidenceFor(fixture(), 'ps1');
  assert.deepEqual(
    rows.map((r) => r.id),
    ['e2', 'e1'],
    'evidence lists newest first',
  );
  const deciding = decidingEvidence(rows);
  assert.equal(
    deciding.id,
    'e1',
    'but the assessment decides, even though the self-declared claim is newer',
  );
  assert.equal(decidingEvidence([]), null);
  assert.equal(decidingEvidence(null), null);

  // Recency only breaks ties between equally strong evidence.
  const two = [
    { id: 'a', evidenceType: 'Assessment', date: daysAgo(100) },
    { id: 'b', evidenceType: 'Assessment', date: daysAgo(5) },
  ];
  assert.equal(decidingEvidence(two).id, 'b');
});

test('the derived view is computed from evidence, never asserted', () => {
  const data = fixture();
  const derived = derivePersonSkill(
    { id: 'ps1', proficiency: 'Exposure', confidence: 0 },
    evidenceFor(data, 'ps1'),
  );
  assert.equal(derived.proficiency, 'Advanced', 'the incoming claim of Exposure is ignored');
  assert.equal(derived.confidence, 100, 'assessment is 100, and corroboration cannot push past it');
  assert.equal(derived.validated, true);
  assert.equal(
    derived.years,
    6,
    'corroborating facts come from all evidence, not just the decider',
  );
  assert.equal(derived.evidenceCount, 2);

  const weak = derivePersonSkill({ id: 'ps2' }, evidenceFor(data, 'ps2'));
  assert.equal(weak.confidence, 10, 'a lone self-declared claim is worth little');
  assert.equal(weak.validated, false);

  const none = derivePersonSkill({ id: 'ps9', proficiency: 'Expert', confidence: 99 }, []);
  assert.equal(none.confidence, 0, 'no evidence means no confidence');
  assert.equal(none.validated, false);
  assert.equal(none.evidenceCount, 0);
  assert.equal(none.lastEvidence, null);
});

test('corroboration raises confidence, but only a little and never past 100', () => {
  const base = (type, n) =>
    derivePersonSkill(
      {},
      Array.from({ length: n }, (_, i) => ({
        evidenceType: type,
        proficiency: 'Working',
        date: daysAgo(i),
      })),
    );
  assert.equal(base('CV', 1).confidence, 30);
  assert.equal(base('CV', 2).confidence, 35, 'a second source adds 5');
  assert.equal(base('CV', 3).confidence, 40);
  assert.equal(base('CV', 10).confidence, 40, 'corroboration is capped at +10');
  assert.equal(base('Assessment', 5).confidence, 100, 'and the total never exceeds 100');
});

test('staleness distinguishes "never evidenced" from "evidenced recently"', () => {
  assert.equal(isStale({ lastEvidence: daysAgo(10).slice(0, 10) }), false);
  assert.equal(isStale({ lastEvidence: daysAgo(STALE_AFTER_DAYS + 5).slice(0, 10) }), true);
  assert.equal(
    isStale({ lastEvidence: null }),
    null,
    'never evidenced is a third state, not "fresh"',
  );
  assert.equal(isStale({}), null);
  assert.equal(evidenceAgeDays({ lastEvidence: null }), null);
  assert.ok(evidenceAgeDays({ lastEvidence: daysAgo(30).slice(0, 10) }) >= 29);
});

test('canonical lookup resolves aliases, as §6 requires', () => {
  const data = fixture();
  assert.equal(findSkillByName(data, 'Databricks').id, 's1');
  assert.equal(findSkillByName(data, '  databricks  ').id, 's1', 'case and whitespace insensitive');
  assert.equal(
    findSkillByName(data, 'pyspark').id,
    's2',
    'an alias resolves to the canonical skill',
  );
  assert.equal(findSkillByName(data, 'DBX').id, 's1');
  assert.equal(findSkillByName(data, 'COBOL'), null);
  assert.equal(findSkillByName(data, ''), null);
});

test('a candidate’s skills are ordered by strength and carry their evidence', () => {
  const rows = skillsForCandidate(fixture(), 'p1');
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Databricks', 'Apache Spark'],
  );
  assert.equal(rows[0].evidence.length, 2, 'the evidence travels with the skill');
  assert.equal(rows[0].stale, false);
  assert.equal(rows[1].stale, true, 'a 500-day-old claim is flagged');
  assert.deepEqual(skillsForCandidate(fixture(), 'nobody'), []);
});

test('"who can do X" ranks by proficiency then confidence, and can demand evidence', () => {
  const data = fixture();
  const all = candidatesWithSkill(data, 's1');
  assert.deepEqual(
    all.map((r) => r.candidateId),
    ['p1', 'p2'],
  );
  assert.equal(all[0].candidate.name, 'Aarav');
  assert.equal(candidatesWithSkill(data, 's1', { validatedOnly: true }).length, 1);
  assert.equal(candidatesWithSkill(data, 's1', { minProficiency: 'Advanced' }).length, 1);
  assert.equal(candidatesWithSkill(data, 's3').length, 0, 'nobody holds Kubernetes');
});

test('the skill inventory reports coverage without inventing a share', () => {
  const inv = skillInventory(fixture());
  assert.deepEqual(
    inv.map((r) => r.skill.name),
    ['Databricks', 'Apache Spark', 'Kubernetes'],
  );
  const dbx = inv[0];
  assert.equal(dbx.people, 2);
  assert.equal(dbx.validated, 1);
  assert.equal(dbx.validatedShare, 50);
  assert.equal(dbx.averageConfidence, 65);
  assert.equal(inv[1].stale, 1, 'the stale claim is counted');

  const unheld = inv[2];
  assert.equal(unheld.people, 0);
  assert.equal(unheld.validatedShare, null, 'a share of nobody is unknown, not 0%');
  assert.equal(unheld.averageConfidence, null);
});

test('the data-quality queue surfaces the weakest claims first, with a reason', () => {
  const claims = unverifiedClaims(fixture());
  assert.deepEqual(
    claims.map((c) => c.id),
    ['ps2', 'ps3'],
    'weakest confidence first',
  );
  assert.equal(claims[0].reason, 'Only self-declared or CV evidence');
  assert.equal(claims[0].name, 'Apache Spark');
  assert.equal(claims[0].candidate.name, 'Aarav');
  assert.ok(!claims.some((c) => c.id === 'ps1'), 'a validated, fresh claim is not in the queue');

  const never = unverifiedClaims({
    personSkills: [{ id: 'x', candidateId: 'p1', skillId: 's1', evidenceCount: 0, confidence: 0 }],
    skills: [{ id: 's1', name: 'Databricks' }],
    candidates: [{ id: 'p1', name: 'Aarav' }],
  });
  assert.equal(never[0].reason, 'No evidence recorded');
  assert.equal(unverifiedClaims(fixture(), { limit: 1 }).length, 1);
});

test('evidence is validated before it is recorded', () => {
  const ok = { ...blankEvidence('ps1'), assessor: 'Priya' };
  assert.deepEqual(validateEvidence(ok), {});
  assert.match(validateEvidence({ ...ok, personSkillId: '' }).personSkillId, /Choose the skill/);
  assert.match(validateEvidence({ ...ok, evidenceType: 'Hearsay' }).evidenceType, /evidence type/);
  assert.match(validateEvidence({ ...ok, proficiency: 'Wizard' }).proficiency, /proficiency/);
  assert.match(validateEvidence({ ...ok, years: '-2' }).years, /between 0 and 60/);
  assert.match(validateEvidence({ ...ok, years: 'lots' }).years, /between 0 and 60/);
  assert.equal(validateEvidence({ ...ok, years: '' }).years, undefined, 'years is optional');
  assert.match(
    validateEvidence({ ...blankEvidence('ps1'), evidenceType: 'Assessment' }).assessor,
    /unattributed evidence cannot be relied on/,
  );
  assert.equal(
    validateEvidence({ ...blankEvidence('ps1'), evidenceType: 'CV' }).assessor,
    undefined,
    'a CV needs no assessor — nobody is claiming to have verified it',
  );
});

test('the row built for insert coerces types the way the column expects', () => {
  const row = evidenceRow(
    { ...blankEvidence('ps1'), years: '6.5', lastUsed: '', assessor: '  Priya  ', note: ' ok ' },
    { id: 'e9', now: new Date('2026-09-28T10:00:00Z') },
  );
  assert.equal(row.years, 6.5, 'a numeric string becomes a number');
  assert.equal(row.lastUsed, null, 'an empty date becomes null, not an empty string');
  assert.equal(row.assessor, 'Priya');
  assert.equal(row.note, 'ok');
  assert.equal(row.date, '2026-09-28T10:00:00.000Z');
  assert.equal(evidenceRow({ ...blankEvidence('ps1'), years: '' }).years, null);
});

test('every proficiency level and evidence type is usable end to end', () => {
  for (const level of PROFICIENCY_LEVELS)
    assert.deepEqual(
      validateEvidence({ ...blankEvidence('ps1'), proficiency: level, assessor: 'x' }),
      {},
    );
  for (const type of EVIDENCE_TYPES) {
    assert.ok(weightOf(type) > 0, `${type} carries weight`);
    assert.deepEqual(
      validateEvidence({ ...blankEvidence('ps1'), evidenceType: type, assessor: 'x' }),
      {},
    );
  }
  assert.equal(weightOf('Hearsay'), 0, 'an unknown type is worth nothing');
});
