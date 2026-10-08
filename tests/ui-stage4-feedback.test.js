import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let M;
test.before(async () => {
  M = await load('/src/FeedbackLoops.jsx');
});
afterEach(cleanup);
test.after(stopVite);
const fields = {
  name: 'Person',
  title: 'Engineer',
  company: 'Team',
  location: 'Remote',
  summary: 'Profile',
  experience: 2,
  relevantExperience: 1,
  notice: 0,
  earliestStart: null,
  activeStatus: 'Active',
  mode: 'Remote',
  engagement: 'Permanent',
  preferredLocations: 'Remote',
};
const page = {
  fields,
  head: 'a'.repeat(32),
  held: false,
  grants: [{ id: 'grant', user_id: 'user', expires_at: '2090-01-01', revoked_at: null }],
  proposals: [],
  prompts: [],
  responses: [],
  preferences: [],
  recipients: [],
  demands: [],
  more: false,
};
test('viewer feedback review displays journal without access, invitation or approval controls', async () => {
  await mount(M.FeedbackReview, {
    candidateId: 'candidate',
    role: 'viewer',
    rpc: async () => page,
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Grant portal access' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Review invitation' }), null);
  assert.equal(screen.queryByLabelText('Review reason'), null);
});
test('lost grant acknowledgement freezes operation, payload and expiry for explicit retry', async () => {
  const writes = [];
  await mount(M.FeedbackReview, {
    candidateId: 'candidate',
    role: 'admin',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return page;
      writes.push(structuredClone(args));
      throw new Error('Acknowledgement lost');
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Review reason'), {
    target: { value: 'Verified candidate account ownership' },
  });
  fireEvent.change(screen.getByLabelText('Candidate Auth user UUID'), {
    target: { value: 'registered-account' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Grant portal access' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  assert.equal(screen.getByLabelText('Candidate Auth user UUID').disabled, false);
  assert.equal(screen.getByRole('button', { name: 'Grant portal access' }).disabled, false);
  // The parent fieldset disables edits and submission while a retry draft exists.
  assert.equal(
    screen.getByLabelText('Candidate Auth user UUID').closest('fieldset').disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry pending request' }));
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
});
test('candidate profile form submits an explicit reviewed proposal with frozen baseline and no direct profile write', async () => {
  const writes = [];
  await mount(M.FeedbackPortal, {
    candidateId: 'candidate',
    rpc: async (name, args) => {
      assert.equal(name, 'api_feedback_portal');
      if (args.p_action === 'context') return page;
      writes.push(args);
      return { status: 'Pending' };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Propose profile changes' }));
  fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'New title' } });
  fireEvent.change(screen.getByLabelText('Update explanation'), {
    target: { value: 'My title changed after promotion' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit profile proposal' }));
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p_action, 'propose');
  assert.equal(writes[0].p_head, page.head);
  assert.equal(writes[0].p_payload.fields.title, 'New title');
  assert.equal(
    'notice' in writes[0].p_payload.fields,
    false,
    'unchanged zero notice is not overwritten',
  );
  assert.equal('current' in writes[0].p_payload.fields, false);
  assert.ok(screen.getByRole('button', { name: 'Propose profile changes' }));
});
test('held candidate retains immediate communication preference controls while profile proposals are disabled', async () => {
  const writes = [];
  await mount(M.FeedbackPortal, {
    candidateId: 'candidate',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return { ...page, held: true };
      writes.push(args);
      return { status: 'Recorded', consentGranted: false };
    },
  });
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Propose profile changes' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Save communication preferences' }));
  await settle();
  assert.equal(writes[0].p_action, 'preference');
  assert.equal(writes[0].p_payload.optOut, true);
  assert.equal(writes[0].p_payload.windowEnd, 24);
});
test('account surveys expose no candidate editor and retain exact response after acknowledgement loss', async () => {
  const writes = [];
  const prompt = {
    id: 'invitation',
    kind: 'survey',
    question: 'How was the experience?',
    state: 'Open',
    head: 'b'.repeat(32),
    expires_at: '2090-01-01',
  };
  await mount(M.FeedbackPortal, {
    clientId: 'client',
    rpc: async (_, args) => {
      if (args.p_action === 'context') return { ...page, fields: null, prompts: [prompt] };
      writes.push(structuredClone(args));
      throw new Error('Acknowledgement lost');
    },
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Propose profile changes' }), null);
  fireEvent.change(screen.getByLabelText('Survey rating'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Feedback comment'), {
    target: { value: 'Responsive process' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record invitation response' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Retry pending request' }));
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_client, 'client');
  assert.equal(writes[0].p_payload.rating, 5);
});
test('changing candidate scope discards local drafts and ignores a late previous-scope result', async () => {
  let resolveOld;
  const rpc = async (_, args) =>
    args.p_candidate === 'old'
      ? new Promise((r) => {
          resolveOld = r;
        })
      : { ...page, fields: { ...fields, name: 'New person' } };
  const view = await mount(M.FeedbackReview, { candidateId: 'old', role: 'viewer', rpc });
  await settle();
  view.rerender(React.createElement(M.FeedbackReview, { candidateId: 'new', role: 'viewer', rpc }));
  await settle();
  resolveOld({
    ...page,
    proposals: [
      { id: 'old-proposal', fields: { name: 'Old result' }, base: fields, status: 'Pending' },
    ],
  });
  await settle();
  assert.equal(screen.queryByText('Old result'), null);
});
test('feedback queue switches filters from page zero and opens the scoped candidate', async () => {
  const calls = [],
    opened = [];
  await mount(M.FeedbackQueue, {
    rpc: async (_, args) => {
      calls.push(args);
      return {
        rows: [{ id: 'row', candidateId: 'candidate', name: 'Person', label: 'Proposal' }],
        more: true,
      };
    },
    onOpen: (id) => opened.push(id),
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Next queue page' }));
  await settle();
  assert.equal(calls.at(-1).p_offset, 25);
  fireEvent.change(screen.getByLabelText('Feedback queue'), { target: { value: 'responses' } });
  await settle();
  assert.equal(calls.at(-1).p_offset, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Open candidate feedback' }));
  assert.deepEqual(opened, ['candidate']);
});

test('a scoped invitation link selects its authorized account and filters history to the exact request', async () => {
  const request = '79000000-0000-4000-8000-000000000999';
  history.replaceState({}, '', `/portal.html#request=${request}`);
  const calls = [];
  try {
    await mount(M.FeedbackPortal, {
      rpc: async (_, args) => {
        calls.push(args);
        if (args.p_action === 'accounts')
          return {
            candidates: [
              { id: 'first', name: 'First', anthroId: 'ANTHRO-00001' },
              { id: 'linked', name: 'Linked', anthroId: 'ANTHRO-00002' },
            ],
          };
        if (args.p_action === 'open') return { candidateId: 'linked', requestId: request };
        return page;
      },
    });
    await settle(5);
    assert.equal(screen.getByLabelText('Linked candidate account').value, 'linked');
    assert.equal(calls.find((c) => c.p_action === 'context').p_payload.request, request);
    assert.equal(calls.find((c) => c.p_action === 'context').p_candidate, 'linked');
  } finally {
    history.replaceState({}, '', '/');
  }
});

test('accepted proposal refreshes surrounding profile once after exact lost-ack retry', async () => {
  const writes = [],
    updates = [];
  let saved = false;
  await mount(M.FeedbackReview, {
    candidateId: 'candidate',
    role: 'recruiter',
    onUpdated: () => updates.push('refreshed'),
    rpc: async (_, args) => {
      if (args.p_action === 'context')
        return {
          ...page,
          proposals: [
            {
              id: 'proposal',
              fields: { ...fields, name: 'Changed' },
              base: fields,
              status: saved ? 'Accepted' : 'Pending',
              reviewHead: 'head',
              at: '2026-10-08',
            },
          ],
        };
      writes.push(structuredClone(args));
      if (writes.length === 1) throw Error('Acknowledgement lost');
      saved = true;
      return { id: 'proposal', status: 'Accepted' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Review reason'), {
    target: { value: 'Reviewed sourced changes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept proposed fields' }));
  await settle();
  assert.deepEqual(updates, []);
  fireEvent.click(screen.getByRole('button', { name: 'Retry pending request' }));
  await settle(6);
  assert.deepEqual(writes[1], writes[0]);
  assert.deepEqual(updates, ['refreshed']);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh feedback' }));
  await settle();
  assert.deepEqual(updates, ['refreshed']);
});

test('failed profile refresh preserves accepted receipt without offering another write retry', async () => {
  await mount(M.FeedbackReview, {
    candidateId: 'candidate',
    role: 'recruiter',
    onUpdated: async () => {
      throw Error('Read offline');
    },
    rpc: async (_, args) =>
      args.p_action === 'context'
        ? {
            ...page,
            proposals: [
              { id: 'proposal', fields, base: fields, status: 'Pending', reviewHead: 'head' },
            ],
          }
        : { id: 'proposal', status: 'Accepted' },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Review reason'), {
    target: { value: 'Reviewed sourced changes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept proposed fields' }));
  await settle(6);
  assert.match(screen.getByRole('alert').textContent, /Proposal accepted.*reopen/);
  assert.equal(screen.queryByRole('button', { name: 'Retry pending request' }), null);
});
