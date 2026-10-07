import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Review, Portal, Keys;
test.before(async () => {
  Review = (await load('/src/ClientCollaboration.jsx')).default;
  Portal = (await load('/src/ClientPortal.jsx')).ClientPortalView;
  Keys = (await load('/src/MachineCredentials.jsx')).default;
});
afterEach(cleanup);
test.after(stopVite);
const pack = {
  id: 'pack',
  version: 1,
  state: 'Draft',
  content: {
    name: 'Candidate One',
    anthroId: 'ANTHRO-00001',
    title: 'Developer',
    skills: ['Python'],
    demandTitle: 'Platform',
    profileStatus: 'Assessing',
    profileVerified: '2026-10-01',
  },
};
const view = {
  packs: [pack],
  members: [],
  submissions: [{ id: 'sub', name: 'Candidate One', title: 'Platform' }],
  feedback: [],
  more: false,
};
test('recruiter prepares a version, administrator reviews snapshot and failed approvals retain intent', async () => {
  const writes = [];
  let fail = true;
  await mount(Review, {
    clientId: 'client',
    isCloud: true,
    role: 'admin',
    rpc: async (name, args) => {
      if (name === 'api_client_review') return view;
      writes.push(args);
      if (fail) {
        fail = false;
        throw new Error('Acknowledgement lost');
      }
      return { id: 'pack' };
    },
  });
  await settle();
  assert.match(screen.getByText(/Profile verification date/).textContent, /2026-10-01/);
  fireEvent.change(screen.getByLabelText('Approval evidence'), {
    target: { value: 'Reviewed the correct client and profile facts' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve version 1' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Approve version 1' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.equal(writes[1].p_id, 'pack');
});
test('viewers see feedback and aging without share mutation or client provisioning', async () => {
  await mount(Review, {
    clientId: 'client',
    isCloud: true,
    role: 'viewer',
    rpc: async () => ({
      ...view,
      packs: [{ ...pack, state: 'Approved', feedbackAgeDays: 8 }],
      feedback: [
        {
          id: 'feedback',
          pack_id: 'pack',
          kind: 'interview',
          comment: 'Please arrange an interview',
          proposed_at: '2026-11-01T10:00:00Z',
          at: '2026-10-07T10:00:00Z',
        },
      ],
    }),
  });
  await settle();
  assert.ok(screen.getByText(/Awaiting feedback for 8 days/));
  assert.ok(screen.getByText(/recruiter must confirm and schedule/));
  assert.equal(screen.queryByRole('button', { name: 'Revoke share' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Grant client access' }), null);
});
test('client decisions retry the same operation and a client switch clears prior shortlist', async () => {
  const writes = [];
  let fail = true;
  await mount(Portal, {
    rpc: async (name, args) => {
      if (name === 'api_client_portal_clients')
        return [
          { id: 'a', name: 'Client A' },
          { id: 'b', name: 'Client B' },
        ];
      if (name === 'api_client_portal')
        return {
          packs: args.p_client === 'a' ? [pack] : [],
          demands: [],
          more: false,
          demandsMore: false,
        };
      writes.push(args);
      if (fail) {
        fail = false;
        throw new Error('Network acknowledgement lost');
      }
      return { id: 'feedback' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Feedback type'), { target: { value: 'decision' } });
  fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'Hold' } });
  fireEvent.change(screen.getByLabelText('Rating (optional)'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Review notes'), {
    target: { value: 'Review again after the next interview' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
  await settle();
  assert.match(screen.getByRole('status').textContent, /acknowledgement lost/);
  assert.equal(
    screen.getByLabelText('Review notes').value,
    'Review again after the next interview',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
  await settle();
  assert.equal(writes[0].p_operation, writes[1].p_operation);
  assert.equal(writes[1].p_decision, 'Hold');
  assert.equal(writes[1].p_rating, 4);
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'b' } });
  await settle();
  assert.equal(screen.queryByText(/Candidate One/), null);
  assert.ok(screen.getByText(/No current approved versions/));
});
test('machine credentials expose one-time secret, retain issuance intent after failures and allow hiding', async () => {
  const calls = [];
  let fail = true;
  await mount(Keys, {
    isCloud: true,
    rpc: async (name, args) => {
      if (name === 'api_machine_overview')
        return { mappings: [], cursor: '9007199254740993', more: false };
      if (name === 'api_webhook_admin') return { deliveries: [] };
      if (args.p_action === 'list') return { credentials: [] };
      calls.push(args);
      if (fail) {
        fail = false;
        throw new Error('Acknowledgement lost');
      }
      return { credentials: [], token: 'one-time-secret' };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Credential name'), { target: { value: 'Operations' } });
  fireEvent.change(screen.getByLabelText('External source'), { target: { value: 'HR' } });
  fireEvent.click(screen.getByRole('button', { name: 'Issue credential' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Issue credential' }));
  await settle();
  assert.equal(calls[0].p_id, calls[1].p_id);
  assert.deepEqual(calls[1].p_scopes, ['events:read']);
  assert.equal(screen.getByLabelText(/Save this secret now/).value, 'one-time-secret');
  fireEvent.click(screen.getByRole('button', { name: 'Hide secret' }));
  assert.equal(screen.queryByLabelText(/Save this secret now/), null);
});
