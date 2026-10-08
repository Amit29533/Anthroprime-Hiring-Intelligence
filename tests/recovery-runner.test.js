import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes, createHash } from 'node:crypto';
import { encryptStream, decryptFile, recoveryKey } from '../scripts/recovery/codec.mjs';
import {
  capture,
  verify,
  restore,
  validateConfig,
  pgEnvironment,
  baselineSql,
} from '../scripts/recovery/runner.mjs';
const workspace = '00000000-0000-0000-0000-000000000011';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'anthro-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32),
    reports = [],
    calls = [];
  const baseline = {
    schemas: ['public', 'auth', 'ecod_processing_private', 'ecod_delivery_private'],
    tables: [
      {
        schema: 'ecod_delivery_private',
        table: 'provider_receipts',
        rows: 1,
        fingerprint: 'fixture',
      },
    ],
    sequences: [{ sequence: 'anthro_sequence', state: { last_value: 21, is_called: true } }],
    roles: [['authenticated', false, true, false, false, false, false, false]],
  };
  const c = {
    directory,
    sourceRef: 'source-test',
    destinationRef: 'offsite-test',
    keyRef: 'custody-test',
    sourceService: 'source',
    workspaces: [workspace],
    offsiteConfirmed: true,
    drainConfirmed: true,
  };
  const client = {
    rpc: async (_, args) => {
      if (args.p_action === 'lockdown') return { data: { paused: true } };
      if (args.p_action === 'configuration')
        return {
          data: {
            configured: true,
            generation: 2,
            keyRef: c.keyRef,
            destinationRef: c.destinationRef,
          },
        };
      reports.push(args.p_payload);
      return { data: { status: 'Recorded' } };
    },
    storage: { listBuckets: async () => ({ data: [] }) },
  };
  const run = (name, args, service, options) => {
    calls.push({ name, args, service });
    if (options?.stream)
      return {
        source: Readable.from([
          Buffer.from(
            name === 'pg_dump'
              ? 'PGDMP fictional archive'
              : 'CREATE ROLE authenticated;\nALTER ROLE authenticated NOLOGIN;\n',
          ),
        ]),
        done: Promise.resolve(),
        abort() {},
      };
    if (name === 'pg_restore') return Promise.resolve(baseline.schemas.join('\n'));
    const sql = args.at(-1);
    if (sql === baselineSql) return Promise.resolve(JSON.stringify(baseline));
    if (sql.includes('current_database()'))
      return Promise.resolve(service === 'source' ? 'source@host:5432' : 'isolated@host:5432');
    if (sql.includes('jsonb_agg(x)')) return Promise.resolve('[]');
    if (sql.includes('operator_target_objects')) return Promise.resolve('0');
    if (sql.includes('select paused')) return Promise.resolve('t');
    return Promise.resolve('');
  };
  const storage = () => ({
    bucket: 'private-fixture',
    client: { send: async () => ({ Contents: [], IsTruncated: false }) },
  });
  return { directory, key, reports, calls, baseline, c, client, run, storage };
}
test('encrypted recovery assets reject altered ciphertext, wrong custody keys and bundle substitution', async (t) => {
  const { directory, key } = await fixture(t);
  assert.throws(() => recoveryKey('short'), /256-bit/);
  for (const data of [Buffer.from('private fictional journal'), Buffer.alloc(0)]) {
    const n = data.length ? 'data' : 'empty',
      path = join(directory, n);
    await encryptStream(Readable.from([data]), path, key, 'bundle:' + n);
    await decryptFile(path, path + '.plain', key, 'bundle:' + n);
    assert.deepEqual(await readFile(path + '.plain'), data);
    await assert.rejects(decryptFile(path, path + '.wrong', randomBytes(32), 'bundle:' + n));
    await assert.rejects(decryptFile(path, path + '.other', key, 'other-bundle:' + n));
  }
  const path = join(directory, 'data'),
    bytes = await readFile(path);
  bytes[22] ^= 1;
  await writeFile(path, bytes);
  await assert.rejects(decryptFile(path, path + '.tampered', key, 'bundle:data'));
  await assert.rejects(
    encryptStream(Readable.from([Buffer.alloc(4)]), join(directory, 'bounded'), key, 'fixture', {
      maxBytes: 3,
    }),
    /bound/,
  );
});
test('full capture verifies encrypted assets and isolated restore preserves scope, sequences and pause before reporting', async (t) => {
  const f = await fixture(t),
    bundle = await capture(f.c, f);
  assert.equal(bundle.paused, true);
  assert.equal(f.reports.length, 1);
  const verified = await verify(bundle.root, f.key);
  assert.deepEqual(verified.manifest.baseline, f.baseline);
  assert.deepEqual((await readdir(bundle.root)).sort(), [
    'database.enc',
    'envelope.json',
    'manifest.enc',
    'roles.enc',
  ]);
  const result = await restore(
    bundle.root,
    {
      ...f.c,
      targetService: 'isolated',
      targetRef: 'isolated-test',
      isolatedConfirmed: true,
      stageDirectory: join(f.directory, 'restore'),
    },
    f,
  );
  assert.equal(result.paused, true);
  assert.equal(f.reports.at(-1).component, 'restore');
  assert.equal(f.reports.at(-1).body.backupDigest, bundle.digest);
  assert.ok(
    f.calls.some((x) => x.name === 'pg_restore' && x.args.includes('--single-transaction')),
  );
  assert.ok(
    !(await readFile(join(bundle.root, 'database.enc'))).includes(Buffer.from('fictional archive')),
  );
});
test('drain, lost originals, source-target alias and altered backup fail without a passing restore receipt', async (t) => {
  const f = await fixture(t);
  await assert.rejects(capture({ ...f.c, drainConfirmed: false }, f), /Drain/);
  assert.equal(f.reports.filter((x) => x.status === 'passed').length, 0);
  const missingRun = (name, args, service, options) =>
    args.at(-1)?.includes?.('jsonb_agg(x)')
      ? Promise.resolve(
          JSON.stringify([{ provider: 'r2', key: 'missing', hash: 'a'.repeat(64), size: 1 }]),
        )
      : f.run(name, args, service, options);
  await assert.rejects(capture(f.c, { ...f, run: missingRun }), /original is absent/);
  assert.equal(f.reports.filter((x) => x.status === 'passed').length, 0);
  const bundle = await capture(f.c, f),
    c = {
      ...f.c,
      targetService: 'alias',
      targetRef: 'isolated-test',
      isolatedConfirmed: true,
      stageDirectory: join(f.directory, 'alias'),
    };
  const aliasRun = (name, args, service, options) =>
    args.at(-1)?.includes?.('current_database()')
      ? Promise.resolve('source@host:5432')
      : f.run(name, args, service, options);
  await assert.rejects(restore(bundle.root, c, { ...f, run: aliasRun }), /source database/);
  assert.equal(
    f.reports.filter((x) => x.component === 'restore' && x.status === 'passed').length,
    0,
  );
  const bytes = await readFile(join(bundle.root, 'roles.enc'));
  bytes[21] ^= 1;
  await writeFile(join(bundle.root, 'roles.enc'), bytes);
  await assert.rejects(verify(bundle.root, f.key), /identity mismatch/);
  assert.equal(
    (await readdir(bundle.root)).some((x) => x.startsWith('.verify')),
    false,
  );
});
test('operator config and subprocess environment reject URLs and strip browser/server credentials', async (t) => {
  const f = await fixture(t);
  assert.equal(validateConfig(f.c), f.c);
  assert.throws(() => validateConfig({ ...f.c, sourceService: 'postgres://secret@host/db' }));
  assert.throws(() => validateConfig({ ...f.c, offsiteConfirmed: false }));
  const env = pgEnvironment('source');
  assert.equal(env.PGSERVICE, 'source');
  for (const secret of [
    'RECOVERY_KEY_HEX',
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_SECRET_ACCESS_KEY',
    'PGPASSWORD',
  ])
    assert.equal(env[secret], undefined);
});
test('original copies retain bytes and reject replacement ETags, hash mismatch and database drift', async (t) => {
  const f = await fixture(t),
    bytes = Buffer.from('fictional private original'),
    hash = createHash('sha256').update(bytes).digest('hex'),
    etag = '"fixture-version"';
  const run = (name, args, service, options) =>
    args.at(-1)?.includes?.('jsonb_agg(x)')
      ? Promise.resolve(
          JSON.stringify([
            { provider: 'r2', key: 'private/original.txt', hash, size: bytes.length, etag },
          ]),
        )
      : f.run(name, args, service, options);
  const storage = () => ({
    bucket: 'private-fixture',
    client: {
      send: async (command) => {
        if (command.constructor.name === 'ListObjectsV2Command')
          return { Contents: [{ Key: 'private/original.txt', Size: bytes.length, ETag: etag }] };
        assert.equal(command.input.IfMatch, etag);
        return { ETag: etag, ContentLength: bytes.length, Body: Readable.from([bytes]) };
      },
    },
  });
  const bundle = await capture(f.c, { ...f, run, storage });
  const verified = await verify(bundle.root, f.key, {
    stageDirectory: join(f.directory, 'originals'),
  });
  assert.deepEqual(await readFile(join(verified.stage, 'object-000000.enc.plain')), bytes);
  assert.equal(verified.manifest.objects[0].etag, etag);
  const replaced = () => ({
    bucket: 'private-fixture',
    client: {
      send: async (command) =>
        command.constructor.name === 'ListObjectsV2Command'
          ? { Contents: [{ Key: 'private/original.txt', Size: bytes.length, ETag: etag }] }
          : { ETag: '"replacement"', ContentLength: bytes.length, Body: Readable.from([bytes]) },
    },
  });
  await assert.rejects(capture(f.c, { ...f, run, storage: replaced }), /changed during capture/);
  assert.equal(f.reports.at(-1).status, 'unavailable');
  let snapshots = 0;
  const drift = (name, args, service, options) =>
    args.at(-1) === baselineSql
      ? Promise.resolve(
          JSON.stringify(++snapshots === 1 ? f.baseline : { ...f.baseline, sequences: [] }),
        )
      : f.run(name, args, service, options);
  await assert.rejects(capture(f.c, { ...f, run: drift }), /Database changed/);
  const nonempty = (name, args, service, options) =>
    args.at(-1)?.includes?.('operator_target_objects')
      ? Promise.resolve('1')
      : f.run(name, args, service, options);
  const writesBefore = f.calls.filter(
    (x) => x.name === 'pg_restore' && x.args.includes('--single-transaction'),
  ).length;
  await assert.rejects(
    restore(
      bundle.root,
      {
        ...f.c,
        targetService: 'isolated',
        targetRef: 'isolated-test',
        isolatedConfirmed: true,
        stageDirectory: join(f.directory, 'nonempty'),
      },
      { ...f, run: nonempty },
    ),
    /empty isolated/,
  );
  assert.equal(
    f.calls.filter((x) => x.name === 'pg_restore' && x.args.includes('--single-transaction'))
      .length,
    writesBefore,
  );
});
