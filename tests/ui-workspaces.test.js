import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, click } from './ui-harness.js';
import { type, press, navTo } from './ui-drivers.js';

process.env.VITE_SUPABASE_URL = 'https://workspace-switch-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'workspace-switch-test-anon-key';

const USER = '00000000-0000-4000-8000-000000000001';
const FIRST = '00000000-0000-4000-8000-000000000011';
const SECOND = '00000000-0000-4000-8000-000000000012';
const THIRD = '00000000-0000-4000-8000-000000000013';

let M;
let realFetch;
let activeWorkspace;
let workspaces;
let logoutCalls = 0;
const filterCalls = [];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function workspaceFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || input.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.pathname === '/rest/v1/rpc/api_filter_candidates') {
    filterCalls.push(body);
    return json({ ids: ['00000000-0000-4000-8000-000000000101'] });
  }
  if (url.pathname === '/auth/v1/logout') {
    logoutCalls++;
    return json({});
  }

  if (url.pathname.endsWith('/auth/v1/token'))
    return json({
      access_token: 'test-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
      user: {
        id: USER,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'owner@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: 'Workspace Owner' },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });

  if (url.pathname === '/rest/v1/rpc/api_my_workspaces')
    return json({ activeWorkspace, workspaces });
  if (url.pathname === '/rest/v1/rpc/api_switch_workspace' && method === 'POST') {
    const selected = workspaces.find((workspace) => workspace.id === body.p_workspace);
    if (!selected) return json({ error: 'workspace access required' });
    activeWorkspace = selected.id;
    return json({ ok: true, ...selected });
  }
  if (url.pathname === '/rest/v1/rpc/api_create_workspace' && method === 'POST') {
    const created = { id: THIRD, name: body.p_name, role: 'admin' };
    workspaces.push(created);
    activeWorkspace = THIRD;
    return json({ ok: true, ...created });
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (table === 'candidates' && activeWorkspace === SECOND)
      return json([
        {
          id: '00000000-0000-4000-8000-000000000101',
          name: 'Client Candidate',
          email: 'client@example.com',
          company: 'Example',
          location: 'Remote',
          verified: '2026-10-01',
          skills: ['Python'],
          status: 'Ready',
          mode: 'Remote',
        },
      ]);
    return json([]);
  }
  return json({});
}

test.before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = workspaceFetch;
  localStorage.clear();
  M = await loadApp();
});

test.after(async () => {
  cleanup();
  await stopVite();
  globalThis.fetch = realFetch;
});

test.beforeEach(() => {
  activeWorkspace = FIRST;
  workspaces = [
    { id: FIRST, name: 'AnthroPrime', role: 'admin' },
    { id: SECOND, name: 'Client Desk', role: 'viewer' },
  ];
});

test('a signed-in user switches and creates isolated workspaces from the sidebar', async () => {
  await mount(M.App);
  await screen.findByRole('heading', { name: 'Good to have you here.' }, { timeout: 30000 });
  await type('Work email', 'owner@example.com');
  await type('Password', 'not-a-real-password');
  await press('Sign in');
  await settle(12);

  const selector = screen.getByRole('button', { name: /AnthroPrime.*Admin access/i });
  assert.ok(selector, 'the active workspace name and role are visible');
  await click(selector);
  await click(screen.getByRole('menuitemradio', { name: /Client Desk.*viewer/i }));
  await settle(12);
  assert.ok(screen.getByRole('button', { name: /Client Desk.*Viewer access/i }));
  assert.ok(screen.getByText(/Viewer access is read-only/i));
  await navTo('Candidates');
  await press('Filters');
  assert.equal(screen.queryByLabelText('Maximum expected CTC (₹ LPA)'), null);
  await type('Current employer', 'Example');
  await screen.findByText('Client Candidate', {}, { timeout: 5000 });
  assert.ok(
    filterCalls.some((call) => call.p_employer === 'Example' && call.p_max_expected === null),
  );
  assert.ok(screen.getByText('Client Candidate'));

  await click(screen.getByRole('button', { name: /Client Desk.*Viewer access/i }));
  await press('Create workspace');
  await type('Workspace name', 'Growth Practice');
  await press('Create workspace');
  await settle(12);

  assert.equal(activeWorkspace, THIRD);
  assert.ok(screen.getByRole('button', { name: /Growth Practice.*Admin access/i }));
  assert.equal(screen.queryByText(/Viewer access is read-only/i), null);
  await click(screen.getByRole('button', { name: 'Open your account', exact: true }));
  assert.ok(screen.getByRole('dialog', { name: 'Your account' }));
  assert.ok(screen.getByRole('heading', { name: 'Workspace Owner' }));
  assert.ok(screen.getByText('owner@example.com'));
  await press('Sign out');
  await settle(12);
  assert.equal(logoutCalls, 1, 'sign-out reaches the authentication service');
  assert.ok(screen.getByRole('heading', { name: 'Good to have you here.' }));
  assert.equal(screen.queryByRole('button', { name: 'Open your account', exact: true }), null);
  cleanup();
});
