import test from 'node:test';
import assert from 'node:assert/strict';
import { load, stopVite } from './ui-harness.js';
import { normalizeData } from '../src/schema.js';
import { anthroIdFor } from '../src/anthroId.js';

process.env.VITE_SUPABASE_URL = 'https://anthro-adapter-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'anthro-adapter-test-key';

test('cloud upserts omit generated identity and derived aliases while retaining returned identity', async (t) => {
  const realFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    let data = [];
    if (url.pathname === '/rest/v1/rpc/api_save_candidates') {
      const rows = JSON.parse(init.body).p_rows;
      bodies.push(rows);
      data = { rows: rows.map((row) => ({ ...row, anthroNumber: 41, anthroId: anthroIdFor(41) })) };
    }
    if (url.pathname === '/rest/v1/rpc/api_legacy_rows') data = { rows: [] };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(async () => {
    globalThis.fetch = realFetch;
    await stopVite();
  });
  const repository = await load('/src/repository.js');
  assert.equal(repository.cloud, true);
  const candidate = {
    id: '12345678-1234-4321-8123-123456789abc',
    name: 'Candidate',
    email: 'candidate@example.com',
    skills: [],
  };
  const data = normalizeData({ candidates: [candidate] });
  const result = await repository.saveRows(
    'candidates',
    [
      {
        ...data.candidates[0],
        name: 'Changed',
        anthroNumber: 99999,
        anthroId: 'forged',
        anthroAliases: ['forged-alias'],
      },
    ],
    data,
  );
  assert.equal(bodies.length, 1);
  assert.equal(Object.hasOwn(bodies[0][0], 'anthroId'), false);
  assert.equal(Object.hasOwn(bodies[0][0], 'anthroNumber'), false);
  assert.equal(Object.hasOwn(bodies[0][0], 'anthroAliases'), false);
  assert.equal(bodies[0][0].id, candidate.id);
  assert.equal(result.rows[0].anthroId, anthroIdFor(41));
  assert.equal(result.rows[0].name, 'Changed');
});
