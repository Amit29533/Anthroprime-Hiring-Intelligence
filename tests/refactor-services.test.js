import test from 'node:test';
import assert from 'node:assert/strict';
import { planAutomation } from '../src/automationPlan.js';
import { normalizeData, TABLES } from '../src/schema.js';
import { mergeCandidateRecords } from '../src/dedupe.js';
import { backupBundle, parseBackup } from '../src/backup.js';
import { stageLabel, setStageLabels } from '../src/domain.js';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('normalization defaults frozen records without modifying nested report configuration', () => {
  const source = freeze({ candidates: [{ id: 'c' }], reports: [{ id: 'r', config: {} }] });
  const normalized = normalizeData(source);
  assert.deepEqual(source.candidates[0], { id: 'c' });
  assert.deepEqual(source.reports[0].config, {});
  assert.deepEqual(normalized.candidates[0].skills, []);
  assert.equal(normalized.reports[0].config.measure, 'count');
  assert.deepEqual(normalizeData(normalized), normalized, 'normalization is idempotent');
});

test('every workspace table can normalize a frozen minimal row without changing the input', () => {
  const source = freeze(Object.fromEntries(TABLES.map((table) => [table, [{ id: table }]])));
  const normalized = normalizeData(source, { activatePreferences: false });
  for (const table of TABLES) {
    assert.deepEqual(source[table], [{ id: table }]);
    assert.equal(normalized[table][0].id, table);
    assert.notEqual(normalized[table][0], source[table][0]);
  }
});

test('inspecting a backup does not activate its workspace preferences', () => {
  setStageLabels({ Interview: 'Team interview' });
  try {
    const bundle = backupBundle({
      settings: [{ id: 'workspace', custom: { stageLabels: { Interview: 'Backup interview' } } }],
    });
    const parsed = parseBackup(JSON.stringify(bundle));
    assert.equal(stageLabel('Interview'), 'Team interview');
    normalizeData(parsed.rows);
    assert.equal(stageLabel('Interview'), 'Backup interview');
  } finally {
    setStageLabels({});
  }
});

test('automation combines actions for the same candidate, deduplicates tags and retains action order', () => {
  const candidate = { id: 'c', tags: ['existing'], nextAction: 'Before' };
  const rule = {
    name: 'Ready review',
    enabled: true,
    triggerTable: 'considerations',
    triggerField: 'stage',
    value: 'Assessed',
    actions: [
      { type: 'tag', tag: 'review' },
      { type: 'nextAction', text: 'Check evidence' },
      { type: 'task', title: 'Review', dueDays: 2 },
    ],
  };
  const data = freeze({ candidates: [candidate], demands: [{ id: 'd' }], workflowRules: [rule] });
  const rows = [
    { id: 'a', candidateId: 'c', demandId: 'd', stage: 'Assessed' },
    { id: 'b', candidateId: 'c', demandId: 'd', stage: 'Assessed' },
  ];
  const plan = planAutomation(data, 'considerations', rows, [null, null], { base: '2026-10-03' });
  assert.deepEqual(plan.names, ['Ready review']);
  assert.equal(plan.batches[0][0], 'tasks');
  assert.equal(plan.batches[0][1].length, 2);
  assert.equal(plan.batches[0][1][0].due, '2026-10-05');
  assert.deepEqual(plan.batches[1][1][0].tags, ['existing', 'review']);
  assert.equal(plan.batches[1][1][0].nextAction, 'Check evidence');
  assert.deepEqual(candidate.tags, ['existing']);
});

test('disabled rules and unchanged fields produce no planned writes', () => {
  const row = { id: 'c', status: 'Ready' };
  const data = {
    candidates: [row],
    workflowRules: [
      {
        enabled: true,
        triggerTable: 'candidates',
        triggerField: 'status',
        value: 'Ready',
        actions: [{ type: 'task' }],
      },
    ],
  };
  assert.deepEqual(planAutomation(data, 'candidates', [row], [row], { base: '2026-10-03' }), {
    names: [],
    batches: [],
  });
});

test('a failed related-row transfer stops a merge before either profile is rewritten', async () => {
  const calls = [];
  await assert.rejects(
    mergeCandidateRecords(
      { notes: [{ id: 'n', candidateId: 'b' }] },
      { id: 'a' },
      { id: 'b' },
      async (table) => {
        calls.push(table);
        return false;
      },
    ),
    /Merge stopped while saving notes/,
  );
  assert.deepEqual(calls, ['notes']);
});

test('merge preserves pipeline collisions and marks the duplicate only after successful transfers', async () => {
  const data = freeze({
    considerations: [
      { id: 'a1', candidateId: 'a', demandId: 'd' },
      { id: 'b1', candidateId: 'b', demandId: 'd' },
      { id: 'b2', candidateId: 'b', demandId: 'other' },
    ],
    notes: [{ id: 'n', candidateId: 'b' }],
  });
  const calls = [];
  await mergeCandidateRecords(
    data,
    { id: 'a', name: 'Winner' },
    { id: 'b', email: 'b@example.com' },
    async (table, rows) => {
      calls.push({ table, rows });
      return true;
    },
  );
  assert.deepEqual(calls[0].rows, [{ id: 'b2', candidateId: 'a', demandId: 'other' }]);
  assert.equal(calls.at(-1).rows[0].mergedInto, 'a');
  assert.equal(calls.at(-1).rows[0].email, '');
  assert.equal(data.notes[0].candidateId, 'b');
});

test('merge refuses the same profile and propagates storage exceptions', async () => {
  await assert.rejects(
    mergeCandidateRecords({}, { id: 'a' }, { id: 'a' }, async () => true),
    /different profiles/,
  );
  await assert.rejects(
    mergeCandidateRecords({}, { id: 'a' }, { id: 'b' }, async () => {
      throw new Error('Offline');
    }),
    /Offline/,
  );
});
