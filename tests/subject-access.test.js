import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { downloadSubjectAccess, prepareSubjectAccess } from '../src/subjectAccess.js';
import { config, createSubjectAccessCleanup } from '../netlify/functions/subject-access-cleanup.js';
const content = JSON.stringify({
  schemaVersion: 1,
  caseId: 'case',
  packageId: 'package',
  workspaceId: 'one',
  records: [],
});
const receipt = {
  id: 'case',
  version: 5,
  packageId: 'package',
  content,
  sha256: createHash('sha256').update(content).digest('hex'),
};
const digest = (bytes) => webcrypto.subtle.digest('SHA-256', bytes);
test('access downloads verify exact content and case before writing a JSON file', async () => {
  const writes = [];
  const options = { digest, download: (...args) => writes.push(args) };
  await downloadSubjectAccess(receipt, 'case', options);
  assert.equal(writes[0][0], content);
  assert.equal(writes[0][2], 'application/json;charset=utf-8');
  await assert.rejects(
    downloadSubjectAccess({ ...receipt, content: content + ' ' }, 'case', options),
    /checksum/,
  );
  await assert.rejects(downloadSubjectAccess(receipt, 'another', options), /incomplete/);
  assert.equal(writes.length, 1);
});
test('workspace changes during preparation or checksum calculation prevent download', async () => {
  let workspace = 'one',
    written = false;
  await assert.rejects(
    prepareSubjectAccess(
      { p_id: 'case' },
      {
        rpc: async () => {
          workspace = 'two';
          return receipt;
        },
        context: () => workspace,
        digest,
        download: () => {
          written = true;
        },
      },
    ),
    /Workspace changed/,
  );
  workspace = 'one';
  await assert.rejects(
    prepareSubjectAccess(
      { p_id: 'case' },
      {
        rpc: async () => receipt,
        context: () => workspace,
        digest: async (bytes) => {
          workspace = 'two';
          return digest(bytes);
        },
        download: () => {
          written = true;
        },
      },
    ),
    /Workspace changed/,
  );
  assert.equal(written, false);
});
test('hourly cleanup uses a bounded service RPC and conceals raw server errors', async () => {
  assert.equal(config.schedule, '0 * * * *');
  const handler = createSubjectAccessCleanup({
    client: () => ({
      rpc: async (name, args) => {
        assert.equal(name, 'worker_purge_subject_access_reviews');
        assert.deepEqual(args, { p_limit: 20 });
        return { data: { purged: 2 } };
      },
    }),
  });
  assert.deepEqual(await (await handler()).json(), { purged: 2 });
  await assert.rejects(
    createSubjectAccessCleanup({
      client: () => ({ rpc: async () => ({ error: { message: 'private storage credential' } }) }),
    })(),
    (e) => /cleanup failed/.test(e.message) && !/credential/.test(e.message),
  );
});
