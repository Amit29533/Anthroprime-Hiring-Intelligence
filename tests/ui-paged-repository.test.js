import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Candidates, Profile;
test.before(async () => {
  const module = await load('/src/PagedRepository.jsx');
  Candidates = module.PagedCandidates;
  Profile = module.PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
test('server candidate pages reuse cursors and reset them on filter changes without full-table reads', async () => {
  const calls = [];
  const onFull = [];
  await mount(Candidates, {
    onFull: (...args) => onFull.push(args),
    rpc: async (name, args) => {
      if (name === 'api_repository_views') return { views: [] };
      calls.push([name, args]);
      return {
        rows: [
          {
            id: 'one',
            anthroId: 'ANTHRO-00001',
            name: args.p_cursor ? 'Second page' : 'First page',
            skills: [],
            status: 'Ready',
          },
        ],
        next: args.p_cursor ? null : { id: 'cursor', name: 'first', filters: args.p_filters },
      };
    },
  });
  await settle();
  assert.ok(screen.getByRole('button', { name: 'First page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next candidate page' }));
  await settle();
  assert.ok(screen.getByRole('button', { name: 'Second page' }));
  assert.equal(calls[1][1].p_cursor.id, 'cursor');
  fireEvent.change(screen.getByLabelText('Search profiles or Anthro-ID'), {
    target: { value: 'ANTHRO-00009' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search repository' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_cursor, null);
  assert.equal(calls.at(-1)[1].p_filters.query, 'ANTHRO-00009');
  fireEvent.click(screen.getByRole('button', { name: 'More filters & bulk actions' }));
  assert.equal(onFull.length, 1);
  assert.ok(calls.every(([name, args]) => name === 'api_repository_page' && args.p_limit === 50));
});
test('Candidate 360 fetches only selected sections and pages, and opens originals through existing authorization', async () => {
  const calls = [];
  const downloads = [];
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    onFull: () => {},
    openDocument: async (doc) => {
      downloads.push(doc.id);
      return null;
    },
    rpc: async (name, args) => {
      calls.push(args);
      return args.p_section === 'profile'
        ? {
            candidate: {
              id: 'one',
              name: 'Candidate',
              anthroId: 'ANTHRO-00001',
              skills: ['React'],
            },
          }
        : {
            rows:
              args.p_section === 'documents'
                ? [{ id: 'doc', name: 'CV.pdf', parserStatus: 'parsed' }]
                : [],
            more: false,
          };
    },
  });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_section, 'profile');
  fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
  await settle();
  assert.equal(calls[1].p_section, 'documents');
  fireEvent.click(screen.getByRole('button', { name: 'Open CV.pdf' }));
  await settle();
  assert.deepEqual(downloads, ['doc']);
  assert.match(screen.getByRole('alert').textContent, /not available/);
});
