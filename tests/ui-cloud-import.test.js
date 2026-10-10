// Exercise cloud staging recovery without a hosted Supabase project. The browser still
// uses the real App, repository adapter and Supabase JS client; fetch fakes the HTTP boundary.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, change, click, screen, cleanup, stopVite, settle } from './ui-harness.js';
import { byPlaceholder, navTo, press, type } from './ui-drivers.js';

process.env.VITE_SUPABASE_URL = 'https://cloud-conflict-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'cloud-conflict-test-anon-key';

const EMAIL = 'recruiter@example.com';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000123';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000456';
const HEADER =
  'name,email,phone,title,company,location,experience,relevantExperience,notice,current,expected,skills,mode,status,source,engagement';

let M;
let realFetch;
let requests;
let candidates;
let upsertCount;
let batch;
let stagedRow;
let stageCount = 0;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function cloudFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || input.method || 'GET';
  if (!init.fixtureProjection) requests.push({ method, path: url.pathname, query: url.search });
  if (url.pathname === '/rest/v1/rpc/api_legacy_rows') {
    const parameters = JSON.parse(init.body);
    const response = await cloudFetch(new URL('/rest/v1/' + parameters.p_table, url).href, {
      method: 'GET',
      fixtureProjection: true,
    });
    return json({ rows: await response.json() });
  }
  if (url.pathname === '/rest/v1/rpc/api_server_execution_status') return json(false);
  const args = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/rest/v1/rpc/api_create_import') {
    batch ||= {
      id: args.p_id,
      name: args.p_name,
      total: args.p_total,
      version: 1,
      status: 'draft',
      mapping: args.p_mapping,
    };
    return json({ id: batch.id, version: batch.version, status: batch.status });
  }
  if (url.pathname === '/rest/v1/rpc/api_stage_import') {
    stageCount++;
    assert.equal(args.p_version, batch.version);
    stagedRow = { ...args.p_rows[0], status: 'draft' };
    batch.version++;
    // The server saved the draft, but the browser did not receive its receipt.
    if (stageCount === 1)
      return json({ code: 'XX000', message: 'Connection interrupted after save' }, 503);
    return json({ id: batch.id, version: batch.version, status: batch.status });
  }
  if (url.pathname === '/rest/v1/rpc/api_import_action') {
    assert.equal(args.p_version, batch.version);
    assert.equal(args.p_action, 'approve');
    batch.version++;
    batch.status = 'completed';
    // Simulate the background worker finding a contact added after review.
    stagedRow.status = 'duplicate';
    stagedRow.error = 'Duplicate candidate contact; skipped.';
    return json({ id: batch.id });
  }
  if (url.pathname === '/rest/v1/rpc/api_import_page') {
    if (args.p_batch)
      return json({ batch, saved: 1, rows: [stagedRow], counts: { [stagedRow.status]: 1 } });
    return json({ batches: batch ? [batch] : [], total: batch ? 1 : 0 });
  }

  if (url.pathname.endsWith('/auth/v1/token')) {
    const user = {
      id: '00000000-0000-4000-8000-000000000789',
      aud: 'authenticated',
      role: 'authenticated',
      email: EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Test Recruiter' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    return json({
      access_token: 'test-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
      user,
    });
  }

  if (url.pathname === '/rest/v1/memberships')
    return json({ workspace_id: WORKSPACE_ID, role: 'recruiter' });

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (table === 'candidates' && method === 'POST') {
      upsertCount++;
      candidates = [
        {
          id: CANDIDATE_ID,
          name: 'Already Here',
          email: 'conflict@example.com',
          phone: '',
          title: 'Data Engineer',
          location: 'Delhi',
          skills: ['Python'],
          status: 'Assessing',
        },
      ];
      return json(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
          details: 'A candidate with matching contact details already exists.',
          hint: null,
        },
        409,
      );
    }
    return json(table === 'candidates' ? candidates : []);
  }

  return json({});
}

test.before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = cloudFetch;
  requests = [];
  candidates = [];
  upsertCount = 0;
  localStorage.clear();
  M = await loadApp();
});

test.after(async () => {
  cleanup();
  await stopVite();
  globalThis.fetch = realFetch;
});

afterEach(() => cleanup());

test('cloud import recovers a lost staging receipt and reports a later duplicate without direct upserts', async () => {
  await mount(M.App, {});
  assert.ok(
    await screen.findByRole('heading', { name: 'Good to have you here.' }, { timeout: 30000 }),
  );

  await type('Work email', EMAIL);
  await type('Password', 'not-a-real-password');
  await press('Sign in');
  await settle(12);
  assert.ok(screen.getByText('Your next great hire is already here.'));

  await navTo('Candidates');
  await press('Import candidates');
  await click(screen.getByRole('button', { name: /^Spreadsheet/ }));
  await click(screen.getByText('Paste CSV instead'));
  await settle();
  await change(
    byPlaceholder('name,email,title,skills…'),
    [
      HEADER,
      'Conflict Person,conflict@example.com,+91 90000 11111,Data Engineer,Example Co,Delhi,6,5,30,20,26,Python,Hybrid,Assessing,Referral,Permanent',
    ].join('\n'),
  );
  await press('Read pasted CSV');
  await press('Review import');
  await settle(3);
  assert.equal(
    screen.getByRole('button', { name: 'Save review for background import' }).disabled,
    false,
  );

  await press('Save review for background import');
  await settle(16);
  assert.ok(screen.getByText('Connection interrupted after save'));
  const originalId = batch.id;
  await press('Save review for background import');
  await settle(16);
  assert.equal(batch.id, originalId);
  assert.equal(stageCount, 2);
  assert.equal(upsertCount, 0);
  await press('Open saved imports');
  await press('Refresh saved imports');
  await settle(8);
  await press('Pasted CSV');
  await settle(8);
  await press('Approve background import');
  await settle(8);
  assert.ok(screen.getByText(/Duplicate candidate contact; skipped/));
  assert.equal(upsertCount, 0, 'the cloud browser never directly writes candidate rows');
  assert.equal(
    requests.filter((r) => r.path === '/rest/v1/rpc/api_create_import').length,
    2,
    'retry reuses the same manifest',
  );
});
