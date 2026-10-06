import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupVirusTotal } from '../netlify/functions/_shared/virustotal.js';
import { createReputationHandler } from '../netlify/functions/document-reputation.js';
const hash = 'a'.repeat(64),
  now = Date.parse('2026-10-06T12:00:00Z');
const config = { key: 'server-secret', licensed: true };
const report = (stats, date = now / 1000) => ({
  data: {
    type: 'file',
    id: hash,
    attributes: { last_analysis_stats: stats, last_analysis_date: date },
  },
});
const fetchReport =
  (body, status = 200) =>
  async () => ({ ok: status === 200, status, json: async () => body });
test('VirusTotal sends only a validated hash to a fixed endpoint and requires licensed configuration', async () => {
  let calls = 0;
  const fetcher = async (url, opts) => {
    calls++;
    assert.equal(url, `https://www.virustotal.com/api/v3/files/${hash}`);
    assert.equal(opts.headers['x-apikey'], config.key);
    assert.equal(opts.body, undefined);
    assert.equal(opts.redirect, 'error');
    return { ok: false, status: 404 };
  };
  assert.equal(
    (await lookupVirusTotal(hash, { configuration: config, fetcher, now })).status,
    'unknown',
  );
  await assert.rejects(
    lookupVirusTotal(hash, { configuration: { ...config, licensed: false }, fetcher }),
    /commercial-use license/,
  );
  await assert.rejects(
    lookupVirusTotal('https://internal/file', { configuration: config, fetcher }),
    /valid SHA-256/,
  );
  assert.equal(calls, 1);
});
test('missing, stale, incomplete and detected reports never become a clean verdict', async () => {
  const lookup = (body) =>
    lookupVirusTotal(hash, { configuration: config, fetcher: fetchReport(body), now });
  assert.equal((await lookup(report({ undetected: 60 }))).status, 'no_known_detections');
  assert.equal((await lookup(report({ undetected: 60 }, now / 1000 - 31 * 86400))).status, 'stale');
  assert.equal((await lookup(report({ failure: 60 }))).status, 'incomplete');
  assert.equal((await lookup(report({ malicious: 1, undetected: 59 }))).status, 'detections');
  assert.equal((await lookup(report({ malicious: 'bad', undetected: 59 }))).status, 'incomplete');
  await assert.rejects(lookup({ data: { type: 'file', id: 'b'.repeat(64) } }), /invalid report/);
  await assert.rejects(
    lookupVirusTotal(hash, { configuration: config, fetcher: fetchReport(null, 429) }),
    /quota/,
  );
  await assert.rejects(
    lookupVirusTotal(hash, {
      configuration: config,
      fetcher: async () => {
        throw new Error(config.key);
      },
    }),
    /temporarily unavailable/,
  );
});
test('reputation endpoint is admin-only, tenant-bound, redacted and never accepts arbitrary hashes', async () => {
  const docId = '00000000-0000-4000-8000-000000000001';
  let role = 'admin',
    workspace = 'team',
    removed = false,
    lookups = 0;
  const filters = [];
  const table = {
    select: () => table,
    eq: (...args) => {
      filters.push(args);
      return table;
    },
    maybeSingle: async () => ({ data: { id: docId, hash, workspace_id: workspace, removed } }),
  };
  const handler = createReputationHandler({
    authorize: async () => ({
      membership: { role, workspace_id: 'team' },
      supabase: { from: () => table },
    }),
    configuration: () => config,
    lookup: async (value) => {
      lookups++;
      assert.equal(value, hash);
      return { status: 'unknown' };
    },
  });
  const event = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });
  const status = await handler(event({ action: 'status' }));
  assert.equal(status.statusCode, 200);
  assert.ok(!status.body.includes(config.key));
  assert.equal((await handler(event({ action: 'lookup', hash }))).statusCode, 400);
  assert.equal((await handler(event({ action: 'lookup', documentId: docId }))).statusCode, 200);
  assert.ok(filters.some(([key, value]) => key === 'workspace_id' && value === 'team'));
  workspace = 'other';
  assert.equal((await handler(event({ action: 'lookup', documentId: docId }))).statusCode, 404);
  workspace = 'team';
  removed = true;
  assert.equal((await handler(event({ action: 'lookup', documentId: docId }))).statusCode, 404);
  role = 'recruiter';
  assert.equal((await handler(event({ action: 'status' }))).statusCode, 403);
  assert.equal(lookups, 1);
});
