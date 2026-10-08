import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentPrefix } from '../netlify/functions/_shared/cv-extraction.js';
import { createScanWorker } from '../scanner/worker.js';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
test('legacy key widening is explicit and verified bytes remain tenant/owner bound', async () => {
  const bytes = Buffer.from('Legacy original');
  let scanned = false,
    finished;
  const file = {
    id: 'doc',
    workspace_id: 'ws',
    candidate_id: 'candidate',
    legacy: true,
    storage_path: 'ws/candidates/candidate/random/old.txt',
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
    scan_lease: 'lease',
  };
  const run = (value) =>
    createScanWorker({
      execution: () => ({
        rpc: async (name, args) =>
          name === 'worker_claim_cv_scan'
            ? { data: null }
            : name === 'worker_claim_attachment_scan'
              ? { data: value }
              : { data: true, ...((finished = args), {}) },
      }),
      storage: () => ({
        bucket: 'private',
        client: {
          send: async () => ({
            ETag: 'etag',
            ContentLength: bytes.length,
            Body: Readable.from([bytes]),
          }),
        },
      }),
      scan: async () => {
        scanned = true;
        return { status: 'clean', engine: 'ClamAV/test' };
      },
    })();
  assert.equal((await run(file)).status, 'clean');
  assert.equal(scanned, true);
  assert.equal(finished.p_etag, 'etag');
  scanned = false;
  assert.equal((await run({ ...file, legacy: false })).status, 'error');
  assert.equal(scanned, false);
  assert.equal(
    (await run({ ...file, storage_path: 'other/candidates/candidate/random/old.txt' })).status,
    'error',
  );
  assert.throws(
    () => attachmentPrefix({ ...file, storage_path: 'ws/candidates/candidate/../old.txt' }),
    /Invalid/,
  );
});
