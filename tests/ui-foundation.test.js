import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let M;
test.before(async () => {
  M = await load('/src/FoundationWorkbench.jsx');
});
afterEach(cleanup);
test.after(stopVite);
const field = { id: 'rating', version: 'v1', name: 'Rating', type: 'number', archived: false };
const context = {
  fields: [field],
  views: [],
  members: [{ id: 'editor', label: 'Editor' }],
  demands: [{ id: 'demand', title: 'React role' }],
};
const emptyPage = { rows: [], more: false, next: null, count: 0 };

test('typed custom filters preserve zero and filter-bound cursor paging', async () => {
  const calls = [];
  await mount(M.default, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    rpc: async (_, args) => {
      calls.push(args);
      if (args.p_action === 'context') return context;
      return {
        ...emptyPage,
        rows: [{ id: 'person', name: 'Person', anthroId: 'ANTHRO-00001' }],
        next: args.p_payload.cursor
          ? null
          : { id: 'person', head: 'bound', name: 'Person', rank: 0 },
      };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Add custom criterion' }));
  fireEvent.change(screen.getByLabelText('Value 1'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Maximum notice days'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run advanced filters' }));
  await settle();
  assert.equal(calls.at(-1).p_payload.filters.custom[0].value, 0);
  assert.equal(calls.at(-1).p_payload.filters.base.maxNotice, '0');
  fireEvent.click(screen.getByRole('button', { name: 'Next foundation page' }));
  await settle();
  assert.equal(calls.at(-1).p_payload.cursor.head, 'bound');
  fireEvent.change(screen.getByLabelText('Minimum experience'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run advanced filters' }));
  await settle();
  assert.equal(calls.at(-1).p_payload.cursor, undefined);
  assert.equal(screen.queryByLabelText('Confirmed expected pay ceiling'), null);
});

test('lost save acknowledgement freezes all tools and retries the exact request', async () => {
  const writes = [];
  await mount(M.default, {
    isCloud: true,
    role: 'viewer',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      writes.push(structuredClone(args));
      if (writes.length === 1) throw Error('Acknowledgement lost');
      return { status: 'Saved' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Foundation view name'), { target: { value: 'My view' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save foundation view' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /lost/);
  assert.equal(screen.getByLabelText('Foundation view name').closest('fieldset').disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry foundation request' }));
  await settle();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(screen.queryByRole('button', { name: 'Retry foundation request' }), null);
});

test('obsolete saved definitions stay visible and cannot silently broaden a search', async () => {
  let reads = 0;
  const filters = {
    version: 1,
    base: {},
    custom: [{ id: 'rating', version: 'old', op: 'eq', value: 0 }],
  };
  await mount(M.default, {
    isCloud: true,
    role: 'recruiter',
    rpc: async (_, args) => {
      if (args.p_action === 'context')
        return { ...context, views: [{ id: 'view', name: 'Old definition', filters }] };
      reads++;
      return emptyPage;
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Saved foundation or legacy view'), {
    target: { value: 'view' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run advanced filters' }));
  await settle();
  assert.equal(reads, 0);
  assert.ok(screen.getAllByRole('alert').some((e) => /changed or.*archived/.test(e.textContent)));
  fireEvent.click(screen.getByRole('button', { name: 'Remove criterion 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run advanced filters' }));
  await settle();
  assert.equal(reads, 1);
});

test('quality decisions carry frozen source and history, with correction required for resolution', async () => {
  const writes = [];
  const row = {
    kind: 'taxonomy',
    target: 'workspace:Bad',
    label: 'Alias Bad',
    status: 'Reviewed',
    head: 'source',
  };
  await mount(M.default, {
    isCloud: true,
    role: 'recruiter',
    initialTab: 'quality',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'quality') return { rows: [row], more: false };
      if (args.p_action === 'quality-history')
        return { rows: [], more: false, head: 'reviewed', canResolve: false };
      writes.push(args);
      return { status: 'Deferred' };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Run quality resolution' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review Alias Bad' }));
  await settle();
  assert.equal(screen.queryByRole('option', { name: 'Resolved' }), null);
  fireEvent.change(screen.getByLabelText('Foundation review reason'), {
    target: { value: 'Reviewed alias source' },
  });
  fireEvent.change(screen.getByLabelText('Quality decision'), { target: { value: 'Deferred' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record quality decision' }));
  await settle();
  assert.equal(writes[0].p_payload.head, 'reviewed');
  assert.equal(writes[0].p_payload.target, row.target);
});

test('discovery distinguishes score, unknown eligibility and readiness; result navigation uses UUID', async () => {
  const opened = [];
  await mount(M.default, {
    isCloud: true,
    role: 'viewer',
    initialTab: 'discovery',
    initialDemandId: 'demand',
    onOpen: (id) => opened.push(id),
    rpc: async (_, args) =>
      args.p_action === 'context'
        ? context
        : {
            rows: [
              {
                id: 'person',
                name: 'Person',
                anthroId: 'ANTHRO-00001',
                score: 90,
                matchedSkills: 1,
                skillTotal: 1,
                eligibility: 'unknown',
                readiness: 'Not validated',
              },
            ],
            more: false,
            evaluated: 1,
            total: 5,
            bounded: true,
          },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Run demand discovery' }));
  await settle();
  assert.ok(screen.getByText(/Hard requirements: unknown/));
  assert.ok(screen.getByText(/Evaluated 1 of 5.*bounded sample/));
  fireEvent.click(screen.getByRole('button', { name: 'Open candidate ANTHRO-00001' }));
  assert.deepEqual(opened, ['person']);
});

test('aggregate report needs an audited preparation before download and never exports local candidate rows', async () => {
  const writes = [],
    downloads = [];
  const report = {
    head: 'source',
    evaluated: 2,
    total: 2,
    cohorts: { unknown: 2 },
    groups: [{ value: 'Unknown', count: 2 }],
    heatmap: [],
    groupsOmitted: 0,
  };
  await mount(M.default, {
    isCloud: true,
    role: 'recruiter',
    initialTab: 'report',
    download: (x) => downloads.push(x),
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'report') return report;
      writes.push(args);
      return { ...report, status: 'Export prepared' };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Run foundation reports' }));
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Download foundation report' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare audited foundation report' }));
  await settle();
  assert.equal(writes[0].p_payload.head, 'source');
  assert.equal(downloads.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Download foundation report' }));
  assert.equal(downloads[0].rows, undefined);
});

test('task handoff preserves explicit assignee, state, reason and original source head', async () => {
  const writes = [];
  const row = {
    id: 'task',
    title: 'Call',
    head: 'task-v1',
    assignee: 'editor',
    owner: 'Editor',
    done: false,
  };
  await mount(M.default, {
    isCloud: true,
    role: 'recruiter',
    initialTab: 'tasks',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return context;
      if (args.p_action === 'tasks') return { rows: [row], more: false };
      if (args.p_action === 'task-history') return emptyPage;
      writes.push(args);
      return { status: 'Saved' };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Run task ownership' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review Call' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Foundation review reason'), {
    target: { value: 'Completed reviewed task' },
  });
  fireEvent.click(screen.getByLabelText('Task completed'));
  fireEvent.click(screen.getByRole('button', { name: 'Record task handoff' }));
  await settle();
  assert.equal(writes[0].p_payload.head, 'task-v1');
  assert.equal(writes[0].p_payload.assignee, 'editor');
  assert.equal(writes[0].p_payload.done, true);
});

test('scope changes discard late replies and demo/limited accounts never mount the tools', async () => {
  let resolveOld;
  const view = await mount(M.default, {
    isCloud: true,
    role: 'viewer',
    scope: 'old',
    rpc: () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  });
  view.rerender(
    React.createElement(M.default, {
      isCloud: true,
      role: 'viewer',
      scope: 'new',
      rpc: async () => context,
    }),
  );
  await settle();
  resolveOld({ ...context, views: [{ id: 'old', name: 'Prior workspace data', filters: {} }] });
  await settle();
  assert.equal(screen.queryByText('Prior workspace data'), null);
  cleanup();
  for (const props of [
    { isCloud: false, role: 'admin' },
    { isCloud: true, role: 'assessor' },
    { isCloud: true, role: 'sales' },
  ]) {
    await mount(M.default, { ...props, rpc: () => assert.fail('Excluded surface called RPC') });
    assert.equal(screen.queryByRole('heading', { name: 'Foundation workbench' }), null);
    cleanup();
  }
});
