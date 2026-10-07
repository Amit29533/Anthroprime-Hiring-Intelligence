import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Quality;
test.before(async () => {
  Quality = (await load('/src/RepositoryQuality.jsx')).RepositoryQuality;
});
afterEach(cleanup);
test.after(stopVite);
const row = {
  id: 'one',
  name: 'Review person',
  anthroId: 'ANTHRO-00001',
  verified: '2020-01-01',
  flags: ['stale-profile'],
};
const page = (rows = [row], nextCursor = null) => ({
  rows,
  nextCursor,
  counts: { 'stale-profile': 31 },
  affectedCandidates: 40,
});
test('quality review uses global counts, traverses bounded cursors and resets on filter changes', async () => {
  const calls = [],
    opened = [];
  const next = { kind: 'stale-profile', day: '2026-10-07', name: 'review person', id: 'one' };
  await mount(Quality, {
    admin: false,
    onOpen: (id) => opened.push(id),
    rpc: async (name, args) => {
      calls.push([name, args]);
      return page([row], args.p_cursor ? null : next);
    },
  });
  await settle();
  assert.ok(screen.getByText('40 candidates have at least one finding. Queue counts overlap.'));
  assert.ok(screen.getByText('Profile date older than 120 days or unknown: 31'));
  fireEvent.click(screen.getByRole('button', { name: 'Review candidate ANTHRO-00001' }));
  assert.deepEqual(opened, ['one']);
  fireEvent.click(screen.getByRole('button', { name: 'Next quality page' }));
  await settle();
  assert.deepEqual(calls.at(-1)[1].p_cursor, next);
  assert.equal(screen.getByRole('button', { name: 'Next quality page' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Quality queue'), { target: { value: 'missing-phone' } });
  await settle();
  assert.deepEqual(calls.at(-1)[1], { p_kind: 'missing-phone', p_cursor: null });
  assert.equal(
    calls.some(([name]) => name === 'api_anthro_id_capacity'),
    false,
  );
});
test('admin sees actionable namespace exhaustion, and failure clears prior findings', async () => {
  await mount(Quality, {
    admin: true,
    rpc: async (name, args) => {
      if (name === 'api_anthro_id_capacity')
        return { limit: 99999, consumed: 99999, remaining: 0, level: 'exhausted' };
      if (args.p_kind === 'missing-email') throw new Error('Quality queue unavailable');
      return page();
    },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /0 allocations remain.*exhausted/);
  fireEvent.change(screen.getByLabelText('Quality queue'), { target: { value: 'missing-email' } });
  await settle();
  assert.ok(screen.getByText('Quality queue unavailable'));
  assert.equal(screen.queryByText('Review person'), null);
  assert.equal(screen.queryByText('No matching findings on this page.'), null);
});
test('malformed quality/capacity responses never claim a healthy or empty repository', async () => {
  await mount(Quality, {
    admin: true,
    rpc: async (name) =>
      name === 'api_anthro_id_capacity'
        ? { limit: 99999, consumed: 99999, remaining: 100, level: 'healthy' }
        : { ...page(), rows: null },
  });
  await settle();
  assert.equal(screen.getAllByRole('alert').length, 2);
  assert.equal(screen.queryByText(/allocations remain out/), null);
  assert.equal(screen.queryByText('No matching findings on this page.'), null);
});

test('quality review provides correction navigation and import/taxonomy handoffs', async () => {
  let settings = 0;
  const opened = [];
  await mount(Quality, {
    admin: true,
    onOpen: (...args) => opened.push(args),
    onSettings: () => settings++,
    rpc: async (name, args) =>
      name === 'api_anthro_id_capacity'
        ? { limit: 99999, consumed: 0, remaining: 99999, level: 'healthy' }
        : page([{ ...row, flags: [args.p_kind] }]),
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Quality queue'), {
    target: { value: 'employment-fact-review' },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review candidate ANTHRO-00001' }));
  assert.deepEqual(opened.at(-1), ['one', 'Employment']);
  fireEvent.click(screen.getByRole('button', { name: 'Review saved import errors' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review taxonomy aliases' }));
  assert.equal(settings, 2);
});
