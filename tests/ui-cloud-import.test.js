// Exercise the cloud-only recovery path without a hosted Supabase project. The browser still
// uses the real App, repository adapter and Supabase JS client; fetch fakes the HTTP boundary.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, change, screen, cleanup, stopVite, settle } from './ui-harness.js';
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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function cloudFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || input.method || 'GET';
  requests.push({ method, path: url.pathname, query: url.search });

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

test('a cloud unique-index conflict reloads candidates and reclassifies the CSV row', async () => {
  await mount(M.App, {});
  await settle(8);
  assert.ok(screen.getByRole('heading', { name: 'Good to have you here.' }));

  await type('Work email', EMAIL);
  await type('Password', 'not-a-real-password');
  await press('Sign in');
  await settle(12);
  assert.ok(screen.getByText('Your next great hire is already here.'));

  await navTo('Candidates');
  await press('Import candidates');
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
  assert.equal(screen.getByText('Import 1 candidates').disabled, false);

  await press('Import 1 candidates');
  await settle(16);

  assert.equal(upsertCount, 1, 'the row was attempted once and was not retried automatically');
  assert.ok(
    requests.filter((request) => request.path === '/rest/v1/candidates').length >= 2,
    'candidate records were loaded again after the failed upsert',
  );
  assert.ok(screen.getByText('Duplicate of Already Here; skipped.'));
  assert.ok(screen.getByText('The repository changed. Review the updated duplicate check.'));
  assert.ok(
    screen.getByText(/Could not save: A candidate with matching contact details already exists/),
  );
  assert.equal(screen.getByRole('button', { name: 'Import 0 candidates' }).disabled, true);
});
