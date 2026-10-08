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

test('personal views save entered filters, reuse lost-ack IDs and apply without full workspace loads', async (t) => {
  const calls = [],
    full = [];
  let firstSave = true,
    saved;
  const confirm = window.confirm;
  window.confirm = () => true;
  t.after(() => {
    window.confirm = confirm;
  });
  await mount(Candidates, {
    onFull: (...args) => full.push(args),
    rpc: async (name, args = {}) => {
      calls.push([name, args]);
      if (name === 'api_repository_views') {
        if (args.p_action === 'save') {
          saved = { id: args.p_id, name: args.p_name, filters: args.p_filters };
          if (firstSave) {
            firstSave = false;
            throw new Error('Acknowledgement lost. Retry.');
          }
          return { views: [saved] };
        }
        return { views: [] };
      }
      return {
        rows: [{ id: 'one', name: 'Candidate', skills: [] }],
        next: args.p_cursor ? null : { id: 'cursor', filters: args.p_filters },
      };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Minimum experience'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('Maximum experience'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Sort candidates'), { target: { value: 'experience' } });
  fireEvent.change(screen.getByLabelText('New view name'), {
    target: { value: 'Experienced talent' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save personal view' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement/);
  fireEvent.click(screen.getByRole('button', { name: 'Save personal view' }));
  await settle();
  const saves = calls.filter(
    ([name, args]) => name === 'api_repository_views' && args.p_action === 'save',
  );
  assert.equal(saves[0][1].p_id, saves[1][1].p_id);
  assert.equal(saved.filters.maxExperience, '10');
  assert.equal(saved.filters.sort, 'experience');
  fireEvent.click(screen.getByRole('button', { name: 'Next candidate page' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Saved repository view'), { target: { value: saved.id } });
  await settle();
  const pages = calls.filter(([name]) => name === 'api_repository_page');
  assert.equal(pages.at(-1)[1].p_cursor, null);
  assert.equal(pages.at(-1)[1].p_filters.minExperience, '7');
  assert.equal(full.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected view' }));
  await settle();
  assert.equal(screen.queryByRole('option', { name: 'Experienced talent' }), null);
});

test('restricted saved compensation views do not silently broaden the active search', async () => {
  const pages = [];
  await mount(Candidates, {
    onFull: () => {},
    rpc: async (name, args) =>
      name === 'api_repository_views'
        ? { views: [{ id: 'restricted', name: 'Private budget', filters: {}, restricted: true }] }
        : (pages.push(args), { rows: [], next: null }),
  });
  await settle();
  const before = pages.length;
  fireEvent.change(screen.getByLabelText('Saved repository view'), {
    target: { value: 'restricted' },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /administrator compensation access/);
  assert.equal(pages.length, before);
});

test('quick editing keeps failed drafts, reloads conflicts and updates context without full reads', async () => {
  const calls = [],
    updated = [];
  let fail = true;
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    onFull: () => {
      throw new Error('Must not expand');
    },
    onUpdated: () => updated.push(true),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_candidate_section')
        return {
          candidate: {
            id: 'one',
            name: 'Candidate',
            skills: [],
            owner: 'Owner',
            nextAction: 'Call',
            verified: '2026-09-02',
          },
        };
      if (name === 'api_candidate_quick_context')
        return {
          candidateId: 'one',
          owner: 'Owner',
          nextAction: 'Call',
          token: fail ? 'old' : 'fresh',
        };
      if (fail) {
        fail = false;
        throw new Error('Candidate changed. Reload quick-edit fields before saving.');
      }
      return {
        candidateId: 'one',
        owner: args.p_owner,
        nextAction: args.p_next_action,
        token: 'saved',
      };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Edit owner & next action' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Next action'), {
    target: { value: 'Schedule assessment' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save quick edit' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /changed/);
  assert.equal(screen.getByLabelText('Next action').value, 'Schedule assessment');
  assert.equal(updated.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Reload quick-edit fields' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Revised action' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save quick edit' }));
  await settle();
  assert.equal(updated.length, 1);
  assert.ok(screen.getByText('Revised action'));
  const edits = calls.filter(([name]) => name === 'api_candidate_quick_edit');
  assert.equal(edits.at(-1)[1].p_token, 'fresh');
  assert.ok(
    calls.every(([name]) =>
      ['api_candidate_section', 'api_candidate_quick_context', 'api_candidate_quick_edit'].includes(
        name,
      ),
    ),
  );
  assert.ok(screen.getByText('2026-09-02'));
});
