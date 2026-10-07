import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  load,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  fireEvent,
} from './ui-harness.js';
import { type, press, navTo } from './ui-drivers.js';
process.env.VITE_SUPABASE_URL = 'https://paged-startup-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'paged-startup-key';
const USER = '20000000-0000-4000-8000-000000000001',
  WS = '20000000-0000-4000-8000-000000000011',
  PERSON = '20000000-0000-4000-8000-000000000101';
const json = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
test('cloud startup skips all candidate/document tables and explicitly expands for existing workflows', async (t) => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push(url.pathname);
    const projected = url.pathname.endsWith('/rpc/api_legacy_rows');
    if (projected) url.pathname = '/rest/v1/' + body.p_table;
    const tableJson = (value) => json(projected ? { rows: value } : value);
    if (url.pathname.endsWith('/auth/v1/token'))
      return json({
        access_token: 'fake-token',
        refresh_token: 'fake-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user: {
          id: USER,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'editor@example.com',
          user_metadata: { full_name: 'Editor' },
          app_metadata: { provider: 'email', providers: ['email'] },
        },
      });
    if (url.pathname.endsWith('/rpc/api_my_workspaces'))
      return json({
        activeWorkspace: WS,
        workspaces: [{ id: WS, name: 'Paged team', role: 'admin' }],
      });
    if (url.pathname.endsWith('/rpc/api_repository_overview'))
      return json({ candidates: 150, ready: 50, fresh: 100, stale: 20, openDemands: 2 });
    if (url.pathname.endsWith('/rpc/api_repository_quality'))
      return json({ rows: [], counts: {}, affectedCandidates: 0, nextCursor: null });
    if (url.pathname.endsWith('/rpc/api_anthro_id_capacity'))
      return json({ limit: 99999, consumed: 150, remaining: 99849, level: 'healthy' });
    if (url.pathname.endsWith('/rpc/api_repository_page'))
      return json({
        rows: [
          { id: PERSON, name: 'Paged candidate', anthroId: 'ANTHRO-00101', skills: ['React'] },
        ],
        next: null,
      });
    if (url.pathname.endsWith('/rpc/api_candidate_section'))
      return json(
        body.p_section === 'profile'
          ? {
              candidate: {
                id: PERSON,
                name: 'Paged candidate',
                anthroId: 'ANTHRO-00101',
                email: 'person@example.com',
                skills: ['React'],
              },
            }
          : { rows: [], more: false },
      );
    if (url.pathname === '/rest/v1/settings')
      return tableJson([{ id: 'workspace', custom: { pagedRepository: true } }]);
    if (url.pathname === '/rest/v1/candidates')
      return tableJson([
        {
          id: PERSON,
          name: 'Full candidate',
          email: 'person@example.com',
          anthroId: 'ANTHRO-00101',
          skills: ['React'],
          status: 'Ready',
          verified: '2020-01-01',
        },
      ]);
    if (url.pathname.includes('/rpc/'))
      return new Response(
        JSON.stringify({
          code: 'PGRST202',
          message: 'Optional panel RPC unavailable in this fixture',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    return tableJson([]);
  };
  t.after(async () => {
    cleanup();
    await stopVite();
    globalThis.fetch = realFetch;
  });
  localStorage.clear();
  const { App } = await loadApp();
  await mount(App, {});
  await screen.findByRole('heading', { name: 'Good to have you here.' }, { timeout: 30000 });
  await type('Work email', 'editor@example.com');
  await type('Password', 'test-password');
  await press('Sign in');
  await settle(12);
  assert.ok(screen.getByRole('heading', { name: 'Repository overview' }));
  assert.ok(screen.getByRole('heading', { name: 'Repository quality review' }));
  assert.ok(calls.includes('/rest/v1/rpc/api_repository_quality'));
  assert.equal(
    calls.filter((p) => p === '/rest/v1/candidates' || p === '/rest/v1/documents').length,
    0,
  );
  const loadedTables = calls.filter((p) => p.startsWith('/rest/v1/') && !p.includes('/rpc/'));
  assert.ok(loadedTables.every((p) => ['/rest/v1/settings', '/rest/v1/taxonomy'].includes(p)));
  const repository = await load('/src/repository.js');
  await assert.rejects(
    repository.saveRows('candidates', [], { repositoryPartial: true }),
    /full workspace/,
  );
  await assert.rejects(
    repository.deleteRows('candidates', [], { repositoryPartial: true }),
    /full workspace/,
  );
  await navTo('Candidates');
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Paged candidate' }));
  await settle();
  assert.ok(screen.getByRole('heading', { name: 'Paged candidate' }));
  assert.equal(calls.filter((p) => p === '/rest/v1/documents').length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'More filters & bulk actions' }));
  await settle(10);
  assert.ok(calls.includes('/rest/v1/rpc/api_legacy_rows'));
  assert.equal(calls.includes('/rest/v1/candidates'), false);
  assert.ok(calls.includes('/rest/v1/documents'));
  assert.ok(await screen.findByText('Full candidate', {}, { timeout: 10000 }));
  assert.equal(screen.queryByRole('button', { name: 'More filters & bulk actions' }), null);
  fireEvent.click(screen.getByRole('button', { name: /Workspace settings/ }));
  await settle(10);
  assert.ok(screen.getByText(/Cloud profile anonymization is unavailable/));
  const scrub = screen.getByRole('button', { name: 'Anonymize' });
  assert.equal(scrub.disabled, true);
  const before = calls.filter((p) => p === '/rest/v1/candidates').length;
  fireEvent.click(scrub);
  await settle();
  assert.equal(calls.filter((p) => p === '/rest/v1/candidates').length, before);
});
