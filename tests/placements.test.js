import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankPlacement,
  validatePlacement,
  validatePlacementCommercial,
  normalizePlacementCommercial,
  placementMargin,
  placementSummary,
  placementsForClient,
  placementsForCandidate,
} from '../src/placements.js';
import { emptyData, normalizeData, TABLES } from '../src/schema.js';

const fixture = () =>
  normalizeData({
    ...emptyData(),
    candidates: [
      { id: 'p1', name: 'Aarav' },
      { id: 'p2', name: 'Maya' },
    ],
    clients: [{ id: 'c1', name: 'Meridian' }],
    demands: [{ id: 'd1', clientId: 'c1', title: 'Architect' }],
    placements: [
      {
        id: 'x1',
        candidateId: 'p1',
        demandId: 'd1',
        clientId: 'c1',
        status: 'Active',
        startDate: '2026-09-01',
      },
    ],
    placementCommercials: [
      {
        id: 'm1',
        placementId: 'x1',
        billRate: 100,
        costRate: 70,
        billedAmount: 50,
        collectedAmount: 25,
      },
    ],
  });

test('placements and their restricted commercials are first-class repository tables', () => {
  assert.ok(TABLES.includes('placements'));
  assert.ok(TABLES.includes('placementCommercials'));
  const data = fixture();
  assert.equal(data.placements[0].status, 'Active');
  assert.equal(data.placementCommercials[0].currency, 'INR');
});

test('placement validation requires a real client demand, dates and one live row', () => {
  const data = fixture();
  const blank = validatePlacement(blankPlacement(), data);
  assert.match(blank.candidateId, /Select/);
  assert.match(blank.demandId, /Select/);
  assert.match(blank.startDate, /required/);

  const duplicate = validatePlacement(
    {
      ...blankPlacement('c1'),
      candidateId: 'p1',
      demandId: 'd1',
      status: 'Active',
      startDate: '2026-09-02',
    },
    data,
  );
  assert.match(duplicate.candidateId, /already has a live placement/);

  const wrongDate = validatePlacement(
    {
      ...blankPlacement('c1'),
      candidateId: 'p2',
      demandId: 'd1',
      startDate: '2026-09-10',
      endDate: '2026-09-09',
    },
    data,
  );
  assert.match(wrongDate.endDate, /before/);

  const missing = validatePlacement(
    {
      ...blankPlacement('missing-client'),
      candidateId: 'missing-candidate',
      demandId: 'missing-demand',
      startDate: '2026-09-10',
    },
    data,
  );
  assert.match(missing.candidateId, /no longer exists/);
  assert.match(missing.demandId, /no longer exists/);
  assert.match(missing.clientId, /no longer exists/);
});

test('commercial validation rejects negative amounts and margin stays explainable', () => {
  assert.match(
    validatePlacementCommercial({ currency: 'INR', basis: 'Annual', billRate: -1 }).billRate,
    /positive/,
  );
  assert.deepEqual(placementMargin({ billRate: 100, costRate: 70 }), { amount: 30, percent: 30 });
  assert.deepEqual(placementMargin({ billRate: null, costRate: 70 }), {
    amount: null,
    percent: null,
  });
  const row = normalizePlacementCommercial(
    { billRate: '100.5', costRate: '', billedAmount: '20', collectedAmount: null },
    'x1',
  );
  assert.equal(row.billRate, 100.5);
  assert.equal(row.costRate, null);
  assert.equal(row.placementId, 'x1');
});

test('placement summaries use real records and real commercial amounts', () => {
  const data = fixture();
  assert.deepEqual(placementSummary(data), {
    total: 1,
    active: 1,
    planned: 0,
    completed: 0,
    billed: 50,
    collected: 25,
  });
  assert.deepEqual(
    placementsForClient(data, 'c1').map((row) => row.id),
    ['x1'],
  );
  assert.deepEqual(
    placementsForCandidate(data, 'p1').map((row) => row.id),
    ['x1'],
  );
});
