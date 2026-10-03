import test from 'node:test';
import assert from 'node:assert/strict';
import { load, loadApp, mount, change, screen, cleanup, stopVite, settle } from './ui-harness.js';
import { byPlaceholder, navTo, press, type } from './ui-drivers.js';
process.env.VITE_SUPABASE_URL = 'https://execution-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'execution-public-test-key';
const ws = '00000000-0000-4000-8000-000000000011';
let M,
  realFetch,
  mode = true;
const writes = [],
  candidates = [];
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url),
    method = init.method || input.method || 'GET';
  if (url.pathname.endsWith('/auth/v1/token'))
    return json({
      access_token: 'fake-token',
      refresh_token: 'fake-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'recruiter@example.com',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
      },
    });
  if (url.pathname === '/rest/v1/rpc/api_my_workspaces')
    return json({
      activeWorkspace: ws,
      workspaces: [{ id: ws, name: 'Execution test', role: 'recruiter' }],
    });
  if (url.pathname === '/rest/v1/rpc/api_server_execution_status')
    return mode === 'unavailable'
      ? json({ code: 'XX000', message: 'Connection failed' }, 500)
      : json(mode);
  if (url.pathname === '/rest/v1/memberships') return json({ workspace_id: ws, role: 'recruiter' });
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (method === 'POST') {
      const rows = JSON.parse(init.body);
      writes.push({ table, rows });
      const saved = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
        ...row,
        workspace_id: ws,
        ...(table === 'candidates' && mode === true && !row.owner?.trim()
          ? { owner: 'Server desk' }
          : {}),
      }));
      if (table === 'candidates') candidates.push(...saved);
      return json(saved);
    }
    if (table === 'candidates') return json(candidates);
    if (table === 'workflowRules')
      return json([
        {
          id: 'rule1',
          name: 'Ready task',
          enabled: true,
          triggerTable: 'candidates',
          triggerField: 'status',
          op: 'eq',
          value: 'Ready',
          actions: [{ type: 'task', title: 'Ready review', dueDays: 1 }],
        },
      ]);
    if (table === 'assignmentRules')
      return json([
        {
          id: 'assignment1',
          name: 'React desk',
          enabled: true,
          entity: 'candidates',
          field: 'skills',
          op: 'eq',
          value: 'React',
          assignTo: 'Browser desk',
          priority: 1,
        },
      ]);
    return json([]);
  }
  return json({});
}
test.before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  localStorage.clear();
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
  globalThis.fetch = realFetch;
});
async function importRow(name, email) {
  await press('Import candidates');
  await change(
    byPlaceholder('name,email,title,skills…'),
    `name,email,title,skills,status\n${name},${email},Engineer,React,Ready`,
  );
  await press('Read pasted CSV');
  await press('Review import');
  await settle();
  await press('Import 1 candidates');
  await settle(12);
}
test('cloud saves skip duplicate browser effects in server mode, retain legacy behavior, and block uncertain mode', async () => {
  await mount(M.App, {});
  await screen.findByRole('heading', { name: 'Good to have you here.' }, { timeout: 30000 });
  await type('Work email', 'recruiter@example.com');
  await type('Password', 'fake-password');
  await press('Sign in');
  await settle(12);
  await navTo('Candidates');
  await importRow('Server Candidate', 'server@example.com');
  assert.equal(writes.filter((w) => w.table === 'candidates').length, 1);
  assert.equal(writes.filter((w) => w.table === 'tasks').length, 0);
  assert.notEqual(writes.find((w) => w.table === 'candidates').rows[0].owner, 'Browser desk');
  assert.equal(candidates[0].owner, 'Recruiter');
  mode = false;
  await importRow('Legacy Candidate', 'legacy@example.com');
  assert.equal(writes.filter((w) => w.table === 'tasks').length, 1);
  assert.equal(candidates[1].owner, 'Recruiter');
  mode = 'unavailable';
  const count = writes.length;
  await importRow('Blocked Candidate', 'blocked@example.com');
  assert.equal(writes.length, count);
  assert.ok(screen.getByText('Could not verify workflow execution mode. Please retry.'));
  const repository = await load('/src/repository.js');
  const staleSettings = { id: 'workspace', custom: {}, serverAutomation: false };
  await repository.saveRows('settings', [staleSettings], { history: [] });
  assert.equal(Object.hasOwn(writes.at(-1).rows[0], 'serverAutomation'), false);
  assert.equal(staleSettings.serverAutomation, false, 'saving does not mutate the caller snapshot');
  const execution = await load('/src/execution.js');
  mode = 'invalid';
  await assert.rejects(execution.serverExecutionEnabled(), /invalid response/);
});
