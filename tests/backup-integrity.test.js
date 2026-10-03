import test from 'node:test';
import assert from 'node:assert/strict';
import { backupBundle, parseBackup, restoreBackupRows } from '../src/backup.js';
import { emptyData } from '../src/schema.js';

test('a backup cannot silently discard a table listed in its manifest', () => {
  const bundle = backupBundle(emptyData());
  delete bundle.candidates;
  assert.throws(() => parseBackup(JSON.stringify(bundle)), /missing the candidates table/);
});

test('backup parsing rejects unsupported versions and truncated table counts', () => {
  const bundle = backupBundle(emptyData());
  assert.throws(() => parseBackup(JSON.stringify({ ...bundle, version: 2 })), /version/);
  bundle.counts.candidates = 2;
  assert.throws(() => parseBackup(JSON.stringify(bundle)), /count.*candidates|candidates.*count/i);
});

test('older manifests allow newly introduced tables to be absent', () => {
  const bundle = backupBundle(emptyData());
  bundle.tableList = bundle.tableList.filter((name) => name !== 'talentPools');
  delete bundle.talentPools;
  assert.deepEqual(parseBackup(JSON.stringify(bundle)).rows.talentPools, []);
});

test('restore stops after a rejected save and reports possible partial progress', async () => {
  const calls = [];
  await assert.rejects(
    restoreBackupRows(
      { candidates: [{ id: 'c' }], demands: [{ id: 'd' }], tasks: [{ id: 't' }] },
      async (table) => {
        calls.push(table);
        return table !== 'demands';
      },
    ),
    /Restore stopped at the demands table.*Earlier tables may already have been restored/,
  );
  assert.deepEqual(calls, ['candidates', 'demands']);
});

test('restore counts successful nonempty tables and propagates storage exceptions', async () => {
  const rows = { candidates: [{ id: 'c' }], demands: [] };
  assert.deepEqual(await restoreBackupRows(rows, async () => true), { touched: 1, total: 1 });
  await assert.rejects(
    restoreBackupRows(rows, async () => {
      throw new Error('Offline');
    }),
    /Offline/,
  );
});
