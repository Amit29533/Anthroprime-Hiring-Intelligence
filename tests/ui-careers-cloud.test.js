// Cloud-mode careers journey against the real Supabase JS client and mocked PostgREST boundary.
// This verifies the browser sends the workspace scope and private status code introduced by
// migration 019, without claiming a live hosted Supabase project was provisioned.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, click, screen, cleanup, stopVite, settle } from './ui-harness.js';
import { press, type, submitVia } from './ui-drivers.js';

process.env.VITE_SUPABASE_URL = 'https://careers-cloud-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'careers-cloud-test-anon-key';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000011';
const APPLICATION_ID = '00000000-0000-4000-8000-000000000031';
const STATUS_TOKEN = '00000000-0000-4000-8000-000000000091';
const ROLE_ID = '00000000-0000-4000-8000-000000000021';
const EMAIL = 'priya.applicant@example.com';
let M;
let originalFetch;
let requests;

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || input.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ method, path: url.pathname, body });

  if (url.pathname.endsWith('/api_public_open_roles'))
    return json([
      {
        id: ROLE_ID,
        title: 'Cloud Privacy Role',
        client: 'Published Client',
        location: 'Remote',
        mode: 'Remote',
        engagementType: 'Permanent',
        positions: 1,
        description: 'A role published for this workspace.',
        skills: ['SQL'],
      },
    ]);
  if (url.pathname.endsWith('/api_public_apply'))
    return json({ applicationId: APPLICATION_ID, statusToken: STATUS_TOKEN });
  if (url.pathname.endsWith('/api_public_application_status')) {
    if (
      body?.p_workspace === WORKSPACE_ID &&
      body?.p_email?.toLowerCase() === EMAIL &&
      body?.p_status_token === STATUS_TOKEN
    )
      return json([
        {
          ref: APPLICATION_ID.slice(0, 8),
          role: 'Cloud Privacy Role',
          location: 'Remote',
          status: 'pending',
          submittedOn: '2026-09-28',
        },
      ]);
    return json([]);
  }
  return json({ message: `Unexpected request: ${method} ${url.pathname}` }, 404);
}

test.before(async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  requests = [];
  localStorage.clear();
  history.replaceState({}, '', `/careers.html?ws=${WORKSPACE_ID}`);
  M = await loadApp();
});

test.after(async () => {
  cleanup();
  await stopVite();
  globalThis.fetch = originalFetch;
  history.replaceState({}, '', '/');
});

afterEach(() => cleanup());

test('cloud careers sends the workspace scope and private status code through PostgREST', async () => {
  await mount(M.CareersApp, {});
  await settle(8);
  assert.ok(screen.getByText('Cloud Privacy Role'), 'the scoped public RPC feeds the role card');

  await press('Apply');
  await type('Full name', 'Priya Applicant');
  await type('Email', EMAIL);
  await click(screen.getByLabelText(/consent to AnthroPrime contacting me/));
  await submitVia('Submit application');
  assert.ok(screen.getByText(STATUS_TOKEN), 'the RPC status code is shown on confirmation');

  await type('Your email', EMAIL);
  await type('Private application code', STATUS_TOKEN);
  await submitVia('Check status');
  assert.ok(screen.getByText('Received — in review'));

  const listing = requests.find((request) => request.path.endsWith('/api_public_open_roles'));
  const apply = requests.find((request) => request.path.endsWith('/api_public_apply'));
  const status = requests.find((request) =>
    request.path.endsWith('/api_public_application_status'),
  );
  assert.equal(listing.body.p_workspace, WORKSPACE_ID);
  assert.equal(apply.body.ws, WORKSPACE_ID);
  assert.equal(apply.body.payload.demandId, ROLE_ID);
  assert.equal(apply.body.payload.consentContact, true);
  assert.equal(status.body.p_workspace, WORKSPACE_ID);
  assert.equal(status.body.p_email, EMAIL);
  assert.equal(status.body.p_status_token, STATUS_TOKEN);
});
