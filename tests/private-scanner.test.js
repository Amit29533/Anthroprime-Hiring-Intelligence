import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { scanPrivateBytes, verifyDefinitions, clamdCommand } from '../scanner/clamd.js';
import { createScanWorker } from '../scanner/worker.js';
import { createCvWorker } from '../netlify/functions/cv-extract-worker.js';
import { createDownloadHandler } from '../netlify/functions/document-download-url.js';
const now = Date.UTC(2026, 9, 6, 10);
const version = 'ClamAV 1.4.3/27800/Tue Oct  6 09:00:00 2026';
const bytes = Buffer.from('Jane Smith\njane@example.com');
const file = {
  id: 'file',
  workspace_id: 'ws',
  batch_id: 'batch',
  storage_path: 'ws/imports/batch/file',
  size: bytes.length,
  hash: createHash('sha256').update(bytes).digest('hex'),
  scan_lease: 'lease',
};

test('scanner releases only exact completed verdicts with fresh, stable definitions', async () => {
  assert.equal(verifyDefinitions(version, now), version);
  for (const old of [
    '',
    'ClamAV 1.4.3/27800/Sun Oct  4 07:00:00 2026',
    'ClamAV 1.4.3/27800/Tue Oct  6 11:00:00 2026',
  ])
    assert.throws(() => verifyDefinitions(old, now), /definitions/);
  for (const [reply, status] of [
    ['stream: OK', 'clean'],
    ['stream: Eicar-Test-Signature FOUND', 'infected'],
  ]) {
    const calls = [];
    const command = async (name, data) => {
      calls.push(name);
      if (name === 'VERSION') return version;
      assert.deepEqual(data, bytes);
      return reply;
    };
    assert.equal((await scanPrivateBytes(bytes, { command, now })).status, status);
    assert.deepEqual(calls, ['VERSION', 'INSTREAM', 'VERSION']);
  }
  for (const reply of ['stream: OK\nERROR', 'stream: size limit exceeded ERROR', 'OK', ''])
    await assert.rejects(
      scanPrivateBytes(bytes, {
        now,
        command: async (name) => (name === 'VERSION' ? version : reply),
      }),
    );
  let versions = 0;
  await assert.rejects(
    scanPrivateBytes(bytes, {
      now,
      command: async (name) =>
        name === 'VERSION' ? version.replace('27800', String(27800 + versions++)) : 'stream: OK',
    }),
    /changed/,
  );
});

test('private clamd stream uses bounded framing and refuses truncated responses', async (t) => {
  let incoming;
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length === 10 + 4 + bytes.length + 4) {
        assert.equal(buffer.subarray(0, 10).toString(), 'zINSTREAM\0');
        assert.equal(buffer.readUInt32BE(10), bytes.length);
        incoming = buffer.subarray(14, 14 + bytes.length);
        assert.equal(buffer.readUInt32BE(buffer.length - 4), 0);
        socket.end('stream: OK\0');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(
    await clamdCommand('INSTREAM', bytes, { host: '127.0.0.1', port: server.address().port }),
    'stream: OK',
  );
  assert.deepEqual(incoming, bytes);
  const truncated = net.createServer((socket) => {
    socket.resume();
    socket.end('stream: OK');
  });
  await new Promise((resolve) => truncated.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => truncated.close(resolve)));
  await assert.rejects(
    clamdCommand('VERSION', null, { host: '127.0.0.1', port: truncated.address().port }),
    /Incomplete/,
  );
});

test('scan worker verifies the original hash and commits only its leased verdict', async () => {
  const calls = [];
  const execution = () => ({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === 'worker_claim_cv_scan' ? file : true };
    },
  });
  const storage = () => ({
    bucket: 'private',
    client: {
      send: async () => ({
        ContentLength: bytes.length,
        ETag: 'etag',
        Body: Readable.from([bytes]),
      }),
    },
  });
  const run = createScanWorker({
    execution,
    storage,
    scan: async (data) => {
      assert.deepEqual(data, bytes);
      return { status: 'clean', engine: version };
    },
  });
  assert.deepEqual(await run(), { processed: 1, status: 'clean' });
  assert.equal(calls.at(-1).args.p_etag, 'etag');
  assert.equal(calls.at(-1).args.p_lease, 'lease');
  for (const bad of [
    storage,
    () => {
      throw new Error('secret');
    },
  ]) {
    const run = createScanWorker({
      execution,
      storage: bad,
      scan: async () => {
        throw new Error('secret');
      },
    });
    assert.equal((await run()).status, 'error');
    assert.equal(calls.at(-1).args.p_etag, null);
  }
  const wrong = { ...file, hash: '0'.repeat(64) };
  const mismatch = createScanWorker({
    execution: () => ({
      rpc: async (name) => ({ data: name === 'worker_claim_cv_scan' ? wrong : true }),
    }),
    storage,
    scan: async () => {
      assert.fail('Unverified bytes must not be scanned');
    },
  });
  assert.equal((await mismatch()).status, 'error');
});

test('extraction never calls a parser for a quarantined or replaced original', async () => {
  let result;
  for (const claimed of [
    { ...file, scan_status: 'pending' },
    { ...file, scan_status: 'clean', scan_etag: 'old' },
  ]) {
    const run = createCvWorker({
      execution: () => ({
        rpc: async (name, args) => {
          if (name === 'worker_finish_cv') result = args;
          return { data: name === 'worker_claim_cv' ? { ...claimed, lease: 'lease' } : true };
        },
      }),
      storage: () => ({
        bucket: 'private',
        client: {
          send: async (cmd) => {
            assert.equal(cmd.input.IfMatch, 'old');
            return { ETag: 'new', ContentLength: bytes.length, Body: Readable.from([bytes]) };
          },
        },
      }),
      extract: async () => assert.fail('Quarantined original must not reach parser'),
    });
    await run();
    assert.equal(result.p_state, 'failed');
  }
});

test('download scan gate fails closed and verifies object metadata before signing', async () => {
  let proof = { required: true, status: 'unverified' },
    object = {},
    signed = 0;
  const doc = {
    id: 'file',
    scanRequired: true,
    storageProvider: 'r2',
    storagePath: file.storage_path,
  };
  const run = createDownloadHandler({
    authorize: async () => ({
      membership: { workspace_id: 'ws' },
      supabase: {
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: doc }) }) }),
        }),
        rpc: async (name) => ({
          data: name === 'api_begin_document_access' ? { enforced: false } : proof,
        }),
      },
    }),
    storage: () => ({
      bucket: 'private',
      client: {
        send: async (cmd) => {
          assert.equal(cmd.input.IfMatch, proof.etag);
          return object;
        },
      },
    }),
    signer: async () => {
      signed++;
      return 'signed';
    },
  });
  const event = { httpMethod: 'POST', body: JSON.stringify({ documentId: 'file' }) };
  assert.equal((await run(event)).statusCode, 423);
  proof = { required: true, status: 'clean', etag: 'etag', size: bytes.length };
  object = { ETag: 'changed', ContentLength: bytes.length };
  assert.equal((await run(event)).statusCode, 423);
  object.ETag = 'etag';
  assert.equal((await run(event)).statusCode, 200);
  assert.equal(signed, 1);
});
