import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthroIdFor,
  candidateIdFromAnthroId,
  legacyAnthroIdFor,
  resolveCandidateId,
} from '../src/anthroId.js';
import { normalizeData, emptyData } from '../src/schema.js';
import { searchWorkspace } from '../src/search.js';
import { searchCandidate, candidateSearchText } from '../src/domain.js';
import { backupBundle, parseBackup, restoreBackupRows } from '../src/backup.js';
import { previewImport } from '../src/import.js';
import { reportRows } from '../src/reports.js';
import { portalOverview } from '../src/portal.js';
import { mergeContext, renderTemplate, dossierHtml } from '../src/templates.js';
import { offerLetterText } from '../src/offerLetter.js';
import { buildSubmissionPack } from '../src/submissions.js';
import { saveRows, loadData } from '../src/repository.js';
import { mergeCandidateRecords } from '../src/dedupe.js';
import { buildVectors } from '../src/semantic.js';
import { changesSince } from '../src/sync.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n) => ({
  id: id(n),
  anthroNumber: n,
  name: 'Same Name',
  email: `c${n}@example.com`,
  skills: [],
});

test('Anthro-IDs use exactly five digits and resolve case-insensitively', () => {
  assert.notEqual(anthroIdFor(person(1)), anthroIdFor(person(2)));
  assert.equal(anthroIdFor(person(1)), 'ANTHRO-00001');
  assert.equal(candidateIdFromAnthroId(anthroIdFor(person(1)).toLowerCase(), [person(1)]), id(1));
  assert.equal(candidateIdFromAnthroId('ANTHRO-00000000'), null);
  assert.equal(candidateIdFromAnthroId(id(1)), null);
});

test('local backfill preserves allocations and never truncates or recycles the five-digit namespace', () => {
  const data = normalizeData({ candidates: [{ id: id(2) }, { id: id(1) }] });
  assert.equal(data.candidates.find((c) => c.id === id(1)).anthroId, 'ANTHRO-00001');
  assert.equal(data.candidates.find((c) => c.id === id(2)).anthroId, 'ANTHRO-00002');
  assert.deepEqual(normalizeData(data), data);
  assert.throws(
    () => normalizeData({ candidates: [person(1), { ...person(2), anthroNumber: 1 }] }),
    /Duplicate Anthro-ID/,
  );
  assert.throws(
    () => normalizeData({ candidates: [{ ...person(1), anthroNumber: 99999 }, { id: id(2) }] }),
    /capacity/,
  );
  assert.throws(
    () => normalizeData({ candidates: [{ ...person(1), anthroNumber: 100000 }] }),
    /between/,
  );
});

test('old UUID references still identify candidates while their visible IDs stay compact', () => {
  const data = normalizeData({ candidates: [person(1)] });
  assert.equal(data.candidates[0].anthroId, 'ANTHRO-00001');
  assert.equal(searchWorkspace(data, legacyAnthroIdFor(person(1)))[0].id, id(1));
  assert.equal(candidateIdFromAnthroId('ANTHRO-00001', data.candidates), id(1));
});

test('stale local snapshots cannot allocate the same number to concurrent new candidates', async (t) => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const initial = normalizeData({ candidates: [person(1)] });
  const a = { id: id(2), name: 'First new', email: 'new2@example.com', skills: [] };
  const b = { id: id(3), name: 'Second new', email: 'new3@example.com', skills: [] };
  const [first, second] = await Promise.all([
    saveRows('candidates', [a], initial),
    saveRows('candidates', [b], initial),
  ]);
  assert.equal(first.rows[0].anthroId, 'ANTHRO-00002');
  assert.equal(second.rows[0].anthroId, 'ANTHRO-00003');
  const loaded = await loadData();
  assert.equal(loaded.candidates.length, 3);
  assert.equal(new Set(loaded.candidates.map((c) => c.anthroId)).size, 3);
});

test('existing profiles get IDs, supplied identity overrides are ignored, and edits keep the same ID', () => {
  const data = normalizeData({ candidates: [{ ...person(1), anthroId: 'fake' }] });
  assert.equal(data.candidates[0].anthroId, anthroIdFor(person(1)));
  const edited = normalizeData({
    ...data,
    candidates: [{ ...data.candidates[0], name: 'Changed', email: 'new@example.com' }],
  });
  assert.equal(edited.candidates[0].anthroId, data.candidates[0].anthroId);
  assert.deepEqual(normalizeData(edited), edited);
});

test('a stale demo candidate save preserves newer profiles, related records and their audit history', async (t) => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const stale = normalizeData({ candidates: [person(1), person(2)] });
  await saveRows('candidates', [{ ...person(1), name: 'Newer edit' }], stale);
  const fresh = await loadData();
  await saveRows(
    'notes',
    [{ id: id(99), candidateId: id(1), text: 'Keep this newer note' }],
    fresh,
  );
  await saveRows('candidates', [{ ...person(2), name: 'Second edit' }], stale);
  const actual = await loadData();
  assert.equal(actual.candidates.find((c) => c.id === id(1)).name, 'Newer edit');
  assert.equal(actual.candidates.find((c) => c.id === id(2)).name, 'Second edit');
  assert.equal(actual.notes[0].text, 'Keep this newer note');
  assert.equal(actual.history.length, 3);
});

test('merged IDs remain searchable across chained merges and backup/restore', async () => {
  const data = normalizeData({
    candidates: [
      person(1),
      { ...person(2), mergedInto: id(1) },
      { ...person(3), mergedInto: id(2) },
    ],
  });
  assert.equal(data.candidates.length, 1);
  assert.equal(data.mergedCandidates.length, 2);
  assert.deepEqual(data.candidates[0].anthroAliases, [
    legacyAnthroIdFor(person(1)),
    anthroIdFor(person(2)),
    legacyAnthroIdFor(person(2)),
    anthroIdFor(person(3)),
    legacyAnthroIdFor(person(3)),
  ]);
  assert.equal(searchWorkspace(data, anthroIdFor(person(3)))[0].id, id(1));
  assert.ok(searchCandidate(data.candidates[0], anthroIdFor(person(2))));
  assert.ok(candidateSearchText(data.candidates[0]).includes(anthroIdFor(person(1)).toLowerCase()));
  const restored = parseBackup(JSON.stringify(backupBundle(data))).rows;
  assert.deepEqual(restored.candidates, data.candidates);
  const saved = [];
  await restoreBackupRows(restored, async (table, rows) => {
    if (table === 'candidates') saved.push(...rows);
    return true;
  });
  assert.equal(saved.length, 3);
  assert.equal(resolveCandidateId(id(3), saved), id(1));
  assert.equal(
    resolveCandidateId(id(1), [
      { ...person(1), mergedInto: id(2) },
      { ...person(2), mergedInto: id(1) },
    ]),
    null,
  );
});

test('a supplied CSV Anthro-ID identifies existing candidates even when contacts changed', () => {
  const data = normalizeData({ candidates: [person(1)] });
  const raw = [{ identity: anthroIdFor(person(1)), name: 'Changed', email: 'changed@example.com' }];
  const mapping = { anthroId: 'identity', name: 'name', email: 'email' };
  assert.match(previewImport(raw, mapping, data.candidates)[0].error, /Duplicate of/);
  raw[0].identity = anthroIdFor(person(2));
  assert.match(previewImport(raw, mapping, data.candidates)[0].error, /assigned automatically/);
  raw[0].identity = '';
  const entry = previewImport(raw, mapping, data.candidates)[0];
  assert.equal(entry.error, null);
  assert.equal(entry.candidate.anthroId, anthroIdFor(entry.candidate));
});

test('portal, reports, templates and generated documents use the same candidate identity', () => {
  const data = normalizeData({
    candidates: [person(1)],
    offers: [{ id: id(11), candidateId: id(1) }],
    placements: [{ id: id(12), candidateId: id(1) }],
  });
  const c = data.candidates[0];
  const identity = anthroIdFor(c);
  assert.equal(portalOverview(c, data).profile.anthroId, identity);
  for (const entity of ['candidates', 'offers', 'placements'])
    assert.equal(reportRows(data, entity)[0].anthroId, identity);
  assert.equal(renderTemplate('{{Candidate.anthroId}}', mergeContext({ candidate: c })), identity);
  assert.ok(dossierHtml(c, data).includes(identity));
  assert.ok(offerLetterText({ role: 'Engineer' }, c).includes(identity));
  assert.ok(buildSubmissionPack(c, null, data).packText.includes(identity));
});

test('local saves and reloads preserve identity and retired records', async (t) => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const data = normalizeData({
    ...emptyData(),
    candidates: [person(1), { ...person(2), mergedInto: id(1) }],
  });
  const result = await saveRows(
    'candidates',
    [{ ...data.candidates[0], name: 'Edited', anthroId: 'tampered' }],
    data,
  );
  assert.equal(result.rows[0].anthroId, anthroIdFor(person(1)));
  const loaded = await loadData();
  assert.equal(loaded.candidates[0].name, 'Edited');
  assert.deepEqual(loaded.candidates[0].anthroAliases, [
    legacyAnthroIdFor(person(1)),
    anthroIdFor(person(2)),
    legacyAnthroIdFor(person(2)),
  ]);
});

test('candidate IDs cannot influence semantic similarity', () => {
  const a = { ...person(1), title: 'Engineer', skills: ['Python'] };
  const b = { ...a, id: 'abcf1234-ffff-4fff-8fff-ffffffffffff' };
  const { vec } = buildVectors([a, b], []);
  assert.deepEqual(vec.get(a.id), vec.get(b.id));
});

test('incremental exports include retired identity rows changed by a recent merge', () => {
  const data = normalizeData({
    candidates: [
      { ...person(1), created: '2025-01-01' },
      { ...person(2), created: '2025-01-01', mergedInto: id(1) },
    ],
    history: [
      { id: id(60), entityId: id(2), entityType: 'candidates', date: '2026-10-06T08:00:00Z' },
    ],
  });
  const exported = changesSince(data, '2026-10-06');
  assert.equal(exported.candidates.length, 1);
  assert.equal(exported.candidates[0].anthroId, anthroIdFor(person(2)));
  assert.equal(exported.candidates[0].mergedInto, id(1));
  assert.equal(Object.hasOwn(exported, 'mergedCandidates'), false);
});

test('retired append-only evidence resolves to the surviving candidate without mutating the source', () => {
  const raw = {
    candidates: [person(1), { ...person(2), mergedInto: id(1) }],
    skillEvidence: [{ id: id(40), candidateId: id(2), skillId: id(50) }],
  };
  const data = normalizeData(raw);
  assert.equal(data.skillEvidence[0].candidateId, id(1));
  assert.equal(raw.skillEvidence[0].candidateId, id(2));
});

test('merge transfers training and editable lifecycle references before retiring the ID', async () => {
  const data = { candidates: [person(1), person(2)] };
  for (const table of [
    'enrichment',
    'interviews',
    'offers',
    'placements',
    'referrals',
    'consents',
    'tasks',
    'submissions',
    'interviewSlots',
  ])
    data[table] = [{ id: table, candidateId: id(2) }];
  data.poolMembers = [
    { id: 'winner-pool', candidateId: id(1), poolId: id(90) },
    { id: 'loser-pool', candidateId: id(2), poolId: id(90) },
    { id: 'other-pool', candidateId: id(2), poolId: id(91) },
  ];
  const calls = [];
  await mergeCandidateRecords(data, person(1), person(2), async (table, rows) => {
    calls.push({ table, rows });
    return true;
  });
  for (const call of calls.slice(0, -2))
    assert.ok(call.rows.every((row) => row.candidateId === id(1)));
  assert.deepEqual(
    calls.find((call) => call.table === 'poolMembers').rows.map((r) => r.id),
    ['other-pool'],
  );
  assert.equal(calls.at(-1).rows[0].mergedInto, id(1));
});
