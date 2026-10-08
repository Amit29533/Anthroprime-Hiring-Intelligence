import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { capture, verify, baselineSql } from '../scripts/recovery/runner.mjs';
import { encryptStream } from '../scripts/recovery/codec.mjs';
test('Supabase originals are included independently of R2 and authenticated manifests reject unsafe asset names', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'anthro-supabase-originals-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32),
    bytes = Buffer.from('fictional Supabase original'),
    baseline = {
      schemas: ['public', 'auth', 'ecod_processing_private', 'ecod_delivery_private'],
      tables: [],
      sequences: [],
      roles: [],
    };
  let downloads = 0;
  const c = {
    directory,
    sourceRef: 'source-test',
    destinationRef: 'offsite-test',
    keyRef: 'custody-test',
    sourceService: 'source',
    workspaces: ['00000000-0000-0000-0000-000000000011'],
    offsiteConfirmed: true,
    drainConfirmed: true,
  };
  const client = {
    rpc: async (_, args) => ({
      data:
        args.p_action === 'lockdown'
          ? { paused: true }
          : args.p_action === 'configuration'
            ? {
                configured: true,
                generation: 1,
                keyRef: c.keyRef,
                destinationRef: c.destinationRef,
              }
            : {},
    }),
    storage: {
      listBuckets: async () => ({ data: [{ id: 'documents' }] }),
      from: () => ({
        list: async (prefix) => ({
          data: prefix ? [{ name: 'original.pdf', id: 'file' }] : [{ name: 'folder', id: null }],
        }),
        download: async (path) => {
          downloads++;
          assert.equal(path, 'folder/original.pdf');
          return { data: new Blob([bytes]) };
        },
      }),
    },
  };
  const run = (name, args, service, options) => {
    if (options?.stream)
      return {
        source: Readable.from([
          Buffer.from(name === 'pg_dump' ? 'PGDMP fictional archive' : 'CREATE ROLE fixture;'),
        ]),
        done: Promise.resolve(),
        abort() {},
      };
    return Promise.resolve(
      args.at(-1) === baselineSql
        ? JSON.stringify(baseline)
        : args.at(-1).includes('current_database()')
          ? 'source@host:5432'
          : '[]',
    );
  };
  const storage = () => ({
      bucket: 'private-fixture',
      client: { send: async () => ({ Contents: [] }) },
    }),
    bundle = await capture(c, { key, client, run, storage }),
    verified = await verify(bundle.root, key, { stageDirectory: join(directory, 'staged') });
  assert.equal(downloads, 1);
  assert.equal(verified.manifest.objects[0].provider, 'supabase');
  assert.deepEqual(await readFile(join(verified.stage, 'object-000000.enc.plain')), bytes);
  verified.manifest.files.push({ name: '../outside.enc', bytes: 0, digest: 'a'.repeat(64) });
  await rm(join(bundle.root, 'manifest.enc'));
  await encryptStream(
    Readable.from([Buffer.from(JSON.stringify(verified.manifest))]),
    join(bundle.root, 'manifest.enc'),
    key,
    verified.manifest.id + ':manifest',
  );
  await assert.rejects(verify(bundle.root, key), /identity mismatch/);
});
