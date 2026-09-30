import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankAssessmentTemplate,
  validateAssessmentTemplate,
  rubricScore,
  assessmentTemplateFields,
  assessmentExpiry,
} from '../src/assessmentTemplates.js';
import { staticPoolMembers, validatePool } from '../src/pools.js';
import { blankReport, runReport, reportRows, fieldsFor } from '../src/reports.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';
import { matchCandidate, today } from '../src/domain.js';

const template = () => ({
  ...blankAssessmentTemplate(),
  id: 'template',
  name: 'Architect readiness',
});
test('weighted rubrics validate, reject gaps and snapshot the exact version', () => {
  const row = template();
  assert.equal(validateAssessmentTemplate(row), '');
  assert.match(validateAssessmentTemplate({ ...row, validityDays: 0 }), /Validity/);
  assert.match(
    validateAssessmentTemplate({
      ...row,
      rubric: [{ id: 'one', label: 'One', weight: 40, maxScore: 5 }],
    }),
    /100/,
  );
  assert.match(validateAssessmentTemplate({ ...row, id: '' }, [row]), /already exists/);
  assert.equal(rubricScore(row.rubric, { technical: 4 }), null);
  assert.equal(rubricScore(row.rubric, { technical: 6, communication: 5 }), null);
  const fields = assessmentTemplateFields(row, { technical: 4, communication: 3 }, '2026-09-30');
  assert.equal(fields.score, 74);
  assert.equal(fields.validUntil, '2027-03-29');
  row.rubric[0].weight = 10;
  row.version = 2;
  assert.equal(fields.templateSnapshot.rubric[0].weight, 70);
  assert.equal(fields.templateSnapshot.version, 1);
  assert.equal(assessmentExpiry('2024-02-28', 2), '2024-03-01');
});

test('assessment expiry changes matching while preserving recorded evidence', () => {
  const data = makeSeed(),
    candidate = data.candidates[0],
    demand = data.demands[0];
  const assessment = {
    candidateId: candidate.id,
    date: today(),
    score: 100,
    validUntil: '2000-01-01',
  };
  const expired = matchCandidate(candidate, demand, [assessment]);
  const baseline = matchCandidate(candidate, demand, []);
  assert.equal(expired.score, baseline.score);
  assert.ok(
    matchCandidate(candidate, demand, [{ ...assessment, validUntil: '2099-01-01' }]).score >=
      expired.score,
  );
  assert.equal(assessment.score, 100);
});

test('curated membership is independent of changing profile skills and does not delete candidates', () => {
  const data = normalizeData(makeSeed()),
    candidate = data.candidates[0];
  data.poolMembers = [{ id: 'member', poolId: 'pool', candidateId: candidate.id, active: true }];
  assert.equal(staticPoolMembers(data, 'pool').length, 1);
  candidate.skills = [];
  assert.equal(staticPoolMembers(data, 'pool').length, 1);
  data.poolMembers[0].active = false;
  assert.equal(staticPoolMembers(data, 'pool').length, 0);
  assert.ok(data.candidates.includes(candidate));
  assert.match(
    validatePool({ name: ' group ' }, [{ id: 'existing', name: 'Group' }]),
    /already exists/,
  );
});

const placementData = () => ({
  candidates: [{ id: 'person', name: 'Aarav' }],
  demands: [{ id: 'demand', title: 'Architect' }],
  clients: [{ id: 'client', name: 'Meridian' }],
  placements: [
    {
      id: 'one',
      candidateId: 'person',
      demandId: 'demand',
      clientId: 'client',
      status: 'Active',
      recruiter: 'Amit',
      notes: 'Internal confidential note',
    },
  ],
  placementCommercials: [
    {
      placementId: 'one',
      billRate: 100,
      costRate: 70,
      billedAmount: 500,
      collectedAmount: 300,
      currency: 'INR',
      basis: 'Monthly',
    },
  ],
});
const placementReport = (measure = 'count', measureField = '', groupBy = '') => ({
  ...blankReport('placements'),
  name: 'Deployment report',
  config: { ...blankReport().config, measure, measureField, groupBy },
});
test('placement reporting projects permitted operational facts and derives commercials for admins', () => {
  const data = placementData();
  const recruiterRows = reportRows(data, 'placements');
  assert.equal(recruiterRows[0].client, 'Meridian');
  assert.equal(recruiterRows[0].notes, undefined);
  assert.equal(recruiterRows[0].billRate, undefined);
  assert.equal(
    fieldsFor('placements').some((f) => f.key === 'marginPercent'),
    false,
  );
  assert.equal(runReport(data, placementReport('count', '', 'status')).groups[0].value, 1);
  assert.match(runReport(data, placementReport('sum', 'collectedAmount')).error, /role/);
  const adminRows = reportRows(data, 'placements', { isAdmin: true });
  assert.equal(adminRows[0].marginPercent, 30);
  assert.equal(adminRows[0].outstandingAmount, 200);
  assert.equal(
    runReport(data, placementReport('sum', 'collectedAmount'), { isAdmin: true }).total,
    300,
  );
});
test('commercial reports refuse sums across currencies or rate bases', () => {
  const data = placementData();
  data.placements.push({ ...data.placements[0], id: 'two' });
  data.placementCommercials.push({
    ...data.placementCommercials[0],
    placementId: 'two',
    currency: 'USD',
    basis: 'Annual',
  });
  assert.match(
    runReport(data, placementReport('sum', 'billedAmount'), { isAdmin: true }).error,
    /one currency/,
  );
  data.placementCommercials[1].currency = 'INR';
  assert.match(
    runReport(data, placementReport('average', 'billRate'), { isAdmin: true }).error,
    /rate basis/,
  );
});
