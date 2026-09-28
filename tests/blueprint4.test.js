import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateSearchText } from '../src/domain.js';
import { conceptTermsFor, CONCEPTS } from '../src/taxonomy.js';
import {
  usableProfiles,
  demandCoverage,
  upliftConversion,
  clientFunnel,
} from '../src/analytics.js';
import { normalizeData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const seed = makeSeed();

test('concept expansion maps skills to domain vocabulary and feeds search text', () => {
  assert.ok(Object.keys(CONCEPTS).length >= 10, 'CONCEPTS covers at least ten domains');
  assert.deepEqual(conceptTermsFor('Databricks').sort(), ['data platform', 'lakehouse']);
  const c = seed.candidates.find((x) => x.skills.includes('Databricks'));
  const text = candidateSearchText(c, seed.documents);
  assert.ok(text.includes('lakehouse'), 'search text expands Databricks to lakehouse');
  assert.ok(text.includes('data platform'), 'search text expands Databricks to data platform');
});

test('usable profiles counts contactable, fresh candidates with skills', () => {
  assert.equal(usableProfiles(seed.candidates), 16);
  assert.equal(usableProfiles([]), 0);
});

test('demand coverage reports ready, near and unfilled per open demand', () => {
  const rows = demandCoverage(seed.candidates, seed.demands, seed.assessments);
  const open = seed.demands.filter((d) => d.status === 'Open');
  assert.equal(rows.length, open.length, 'one row per open demand');
  const first = rows[0];
  assert.equal(first.ready, 1);
  assert.equal(first.near, 6);
  assert.equal(first.missing, first.demand.positions - first.ready);
  for (const r of rows) assert.ok(r.ready >= 0 && r.near >= 0 && r.missing >= 0);
});

test('uplift conversion and client funnel summarise the ECOD loop', () => {
  const u = upliftConversion(seed.candidates, seed.assessments, seed.enrichment);
  assert.deepEqual(u, {
    assessed: 16,
    enriched: 1,
    readyAfter: 0,
    assessedToEnriched: 6,
    enrichedToReady: 0,
  });
  const funnel = Object.fromEntries(
    clientFunnel(seed.considerations).map((f) => [f.stage, f.count]),
  );
  assert.deepEqual(funnel, { Submitted: 1, Interview: 2, Offer: 1, Deployed: 0 });
});

test('normalizeData defaults per-demand stage sets and candidate preference fields', () => {
  const out = normalizeData({
    candidates: [{ id: 'c1', name: 'A', skills: [] }],
    demands: [
      { id: 'd1', title: 'T' },
      { id: 'd2', title: 'U', stageSet: 'broken' },
      { id: 'd3', title: 'V', stageSet: ['Identified', 'Offer'] },
    ],
    consents: [
      { id: 'k1', candidateId: 'c1', purpose: 'marketing', status: 'granted', date: '2026-01-01' },
    ],
  });
  assert.deepEqual(
    out.demands.find((d) => d.id === 'd1').stageSet,
    [],
    'missing stageSet becomes empty array',
  );
  assert.equal(
    out.demands.find((d) => d.id === 'd1').careersVisible,
    false,
    'legacy demands stay private until explicitly published',
  );
  assert.deepEqual(
    out.demands.find((d) => d.id === 'd2').stageSet,
    [],
    'non-array stageSet becomes empty array',
  );
  assert.deepEqual(
    out.demands.find((d) => d.id === 'd3').stageSet,
    ['Identified', 'Offer'],
    'valid stageSet passes through',
  );
  const c = out.candidates[0];
  for (const k of ['timezone', 'preferredLocations', 'nextAction', 'externalId'])
    assert.equal(c[k], '', `candidate default ${k}`);
  assert.equal(out.consents.length, 1, 'consents rows survive normalize');
});
