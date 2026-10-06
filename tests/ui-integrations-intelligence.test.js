import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Hosted, Settings, Integrations, Mappings, Health;
test.before(async () => {
  ({ HostedIntelligence: Hosted, IntelligenceSettings: Settings } = await load(
    '/src/HostedIntelligence.jsx',
  ));
  Integrations = (await load('/src/Integrations.jsx')).IntegrationsPanel;
  Mappings = (await load('/src/Integrations.jsx')).ExternalMappingsPanel;
  Health = (await load('/src/HostedIntelligence.jsx')).IndexHealthPanel;
});

test('mapping reconciliation uses the displayed version and pagination is bounded', async () => {
  const calls = [];
  await mount(Mappings, {
    isCloud: true,
    candidates: [{ id: 'new', name: 'Replacement' }],
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        total: 26,
        rows:
          args?.p_offset === 25
            ? []
            : [
                {
                  source: 'crm',
                  externalId: 'one',
                  candidateId: 'old',
                  name: 'Old candidate',
                  version: 4,
                },
              ],
      };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Candidate link for one'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile candidate link' }));
  await settle();
  const reconcile = calls.find(([name]) => name === 'api_reconcile_mapping')[1];
  assert.equal(reconcile.p_version, 4);
  assert.equal(reconcile.p_candidate, 'new');
  fireEvent.click(screen.getByRole('button', { name: 'Next mappings' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_offset, 25);
  assert.equal(screen.getByRole('button', { name: 'Next mappings' }).disabled, true);
});
test('paused subscription exposes key rotation and clears the new key after saving', async () => {
  const calls = [];
  await mount(Integrations, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        subscriptions: [{ id: 's', name: 'Receiver', url: 'https://example.com', enabled: false }],
        deliveries: [],
      };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('New signing secret for Receiver'), {
    target: { value: 'b'.repeat(40) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Rotate signing key' }));
  await settle();
  assert.equal(calls[1][0], 'api_rotate_webhook');
  assert.equal(screen.getByLabelText('New signing secret for Receiver').value, '');
});
test('index health shows failed work and lets an administrator retry it', async () => {
  const calls = [];
  await mount(Health, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { indexed: 10, pending: 2, processing: 0, failed: args?.p_retry_failed ? 0 : 1 };
    },
  });
  await settle();
  assert.match(screen.getByText(/10 indexed/).textContent, /1 failed/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed indexing' }));
  await settle();
  assert.equal(calls[1][1].p_retry_failed, true);
  assert.equal(screen.getByRole('button', { name: 'Retry failed indexing' }).disabled, true);
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

test('hosted retrieval sends database filters and opens the returned candidate ID', async () => {
  const calls = [],
    opened = [];
  await mount(Hosted, {
    isCloud: true,
    candidates: [],
    rpc: async (name, args) => {
      calls.push([name, args]);
      return [
        {
          id: 'c1',
          anthroNumber: 1,
          name: 'Candidate',
          title: 'Engineer',
          location: 'Delhi',
          similarity: 0.8,
        },
      ];
    },
    onOpen: (id) => opened.push(id),
  });
  fireEvent.change(screen.getByLabelText('Hosted talent query'), { target: { value: 'React' } });
  fireEvent.change(screen.getByLabelText('Hosted location'), { target: { value: 'Delhi' } });
  fireEvent.change(screen.getByLabelText('Hosted minimum experience'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search shared index' }));
  await settle();
  assert.equal(calls[0][1].p_location, 'Delhi');
  assert.equal(calls[0][1].p_min_experience, 3);
  fireEvent.click(screen.getByRole('button', { name: 'Candidate · ANTHRO-00001' }));
  assert.deepEqual(opened, ['c1']);
});

test('shared indexing uses source fingerprints and shows completion without any provider calls', async () => {
  const calls = [];
  await mount(Hosted, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'api_index_candidates'
        ? [{ id: 'c1', text: 'React engineer', fingerprint: 'fp' }]
        : null;
    },
    request: async () => {
      throw new Error('Provider must not run');
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh shared index' }));
  await settle();
  assert.equal(calls[1][0], 'api_index_candidate');
  assert.equal(calls[1][1].p_fingerprint, 'fp');
  assert.equal(calls[1][1].p_vector.length, 384);
  assert.match(screen.getByRole('status').textContent, /Index pass complete/);
});

test('review approval sends edited text; stale drafts cannot be approved', async () => {
  let approved;
  const draft = {
    id: 'd1',
    candidate_id: 'c1',
    name: 'Candidate',
    status: 'draft',
    content: 'Original',
    current: true,
    model: 'test-model',
    version: 'v1',
  };
  await mount(Hosted, {
    isCloud: true,
    rpc: async (name, args) => {
      if (name === 'api_review_intelligence') approved = args;
      return [draft];
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load drafts' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Draft for Candidate'), {
    target: { value: 'Reviewed facts' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve reviewed draft' }));
  await settle();
  assert.equal(approved.p_content, 'Reviewed facts');
  assert.equal(approved.p_approve, true);
  cleanup();
  await mount(Hosted, { isCloud: true, rpc: async () => [{ ...draft, current: false }] });
  fireEvent.click(screen.getByRole('button', { name: 'Load drafts' }));
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Approve reviewed draft' }).disabled, true);
});

test('admin opt-in starts disabled and carries the chosen request limit', async () => {
  const calls = [];
  await mount(Settings, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { enabled: args?.p_enabled || false, dailyLimit: 20, usedToday: 0 };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Daily AI request limit'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enable external AI' }));
  await settle();
  assert.equal(calls[1][1].p_enabled, true);
  assert.equal(calls[1][1].p_daily_limit, 10);
  assert.ok(screen.getByRole('button', { name: 'Disable external AI' }));
});

test('subscriptions are created paused; signing secrets are cleared after saving', async () => {
  const calls = [];
  await mount(Integrations, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push(args);
      return { subscriptions: [], deliveries: [] };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Subscription name'), { target: { value: 'CRM' } });
  fireEvent.change(screen.getByLabelText('Webhook URL'), {
    target: { value: 'https://example.com/hooks' },
  });
  fireEvent.change(screen.getByLabelText('Webhook signing secret'), {
    target: { value: 'a'.repeat(40) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create paused subscription' }));
  await settle();
  assert.equal(calls[1].p_operation, 'create');
  assert.equal(calls[1].p_enabled, undefined);
  assert.equal(screen.getByLabelText('Webhook signing secret').value, '');
});
