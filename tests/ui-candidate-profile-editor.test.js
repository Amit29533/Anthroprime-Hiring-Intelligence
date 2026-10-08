import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Editor, Profile;
test.before(async () => {
  Editor = (await load('/src/CandidateProfileEditor.jsx')).default;
  Profile = (await load('/src/PagedRepository.jsx')).PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
const fields = {
  name: 'Candidate',
  title: 'Developer',
  company: 'Employer',
  location: 'Pune',
  summary: '',
  experience: 5,
  relevantExperience: 3,
  notice: null,
};
test('paged profile exposes the facts editor and refreshes the displayed candidate without full-table reads', async () => {
  const calls = [],
    updated = [];
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    onUpdated: () => updated.push(true),
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'api_candidate_section')
        return { candidate: { id: 'one', anthroId: 'ANTHRO-00001', skills: [], ...fields } };
      return {
        candidateId: 'one',
        token: 'a'.repeat(32),
        fields: name === 'api_candidate_profile_edit' ? args.p_fields : { ...fields },
      };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile facts' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Candidate name'), {
    target: { value: 'Corrected name' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit profile facts' }));
  await settle();
  assert.ok(screen.getByText('Corrected name'));
  assert.ok(screen.getByText('ANTHRO-00001'));
  assert.deepEqual(calls, [
    'api_candidate_section',
    'api_candidate_profile_context',
    'api_candidate_profile_edit',
  ]);
  assert.equal(updated.length, 1);
});
test('facts editor preserves conflicts, reloads explicitly, and sends known zero and unknown values', async () => {
  const calls = [],
    updated = [];
  let failure = true,
    reads = 0;
  await mount(Editor, {
    candidateId: 'one',
    onUpdated: (value) => updated.push(value),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_candidate_profile_context')
        return {
          candidateId: 'one',
          token: (++reads === 1 ? 'a' : 'b').repeat(32),
          fields: { ...fields },
        };
      if (failure) {
        failure = false;
        throw new Error('Candidate changed. Reload profile fields before saving.');
      }
      return { candidateId: 'one', token: 'c'.repeat(32), fields: args.p_fields };
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile facts' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Candidate name'), { target: { value: 'Revised' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit profile facts' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /changed/);
  assert.equal(screen.getByLabelText('Candidate name').value, 'Revised');
  assert.equal(updated.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Reload profile fields' }));
  await settle();
  assert.equal(screen.getByLabelText('Candidate name').value, 'Candidate');
  fireEvent.change(screen.getByLabelText('Notice period (days)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Relevant experience (years)'), { target: { value: '' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit profile facts' }));
  await settle();
  const save = calls.at(-1)[1];
  assert.equal(save.p_token, 'b'.repeat(32));
  assert.equal(save.p_fields.notice, 0);
  assert.equal(save.p_fields.relevantExperience, null);
  assert.equal(updated.length, 1);
  assert.equal(screen.queryByRole('form'), null);
});
test('editor rejects wrong candidate responses and ignores saves after closing', async () => {
  const updated = [];
  let resolveSave,
    wrong = true;
  await mount(Editor, {
    candidateId: 'one',
    onUpdated: (value) => updated.push(value),
    rpc: async (name) => {
      if (name === 'api_candidate_profile_context')
        return { candidateId: wrong ? 'another' : 'one', token: 'a'.repeat(32), fields };
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile facts' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /invalid response/);
  wrong = false;
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile facts' }));
  await settle();
  fireEvent.submit(screen.getByRole('form', { name: 'Edit profile facts' }));
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Save profile facts' }).disabled, true);
  cleanup();
  resolveSave({ candidateId: 'one', token: 'b'.repeat(32), fields });
  await settle();
  assert.equal(updated.length, 0);
});
