import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Comms;
test.before(async () => {
  Comms = (await load('/src/CandidateCommunications.jsx')).CandidateCommunications;
});
afterEach(cleanup);
test.after(stopVite);
const page = {
  transport: 'test-only',
  policyHead: 'a'.repeat(32),
  policy: { enabled: true, outcome: 'success', daily_limit: 3 },
  rows: [],
  more: false,
  templates: [
    {
      id: 'template',
      key: 'welcome',
      version: 1,
      body: { kind: 'custom', purpose: 'recruiting-contact', enabled: true },
    },
  ],
  preferences: [],
  demands: [],
  interviews: [],
};
const preview = {
  head: 'b'.repeat(32),
  eligible: true,
  reason: '',
  preview: {
    recipient: 'fictional@example.com',
    subject: 'Hello Person',
    text: 'Test content only',
  },
};
test('reviewed intents freeze schedule, source and operation after lost acknowledgement', async () => {
  const writes = [];
  await mount(Comms, {
    candidateId: 'candidate',
    role: 'recruiter',
    rpc: async (_name, args) => {
      if (args.p_action === 'context') return page;
      if (args.p_action === 'preview') return preview;
      writes.push(args);
      throw new Error('Acknowledgement lost');
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Message template'), { target: { value: 'template' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review test preview' }));
  await settle();
  assert.ok(screen.getByText('Hello Person'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed test intent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed communication queue' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed communication queue' }));
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_head, preview.head);
  assert.ok(writes[0].p_payload.availableAt);
});
test('viewer cannot queue or configure and suppressed previews cannot be confirmed', async () => {
  await mount(Comms, { candidateId: 'candidate', role: 'viewer', rpc: async () => page });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Configure test transport' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Review test preview' }), null);
  cleanup();
  await mount(Comms, {
    candidateId: 'candidate',
    role: 'recruiter',
    rpc: async (_name, args) =>
      args.p_action === 'context'
        ? page
        : { ...preview, eligible: false, reason: 'Consent revoked' },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Message template'), { target: { value: 'template' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review test preview' }));
  await settle();
  assert.ok(screen.getByText('Suppressed: Consent revoked'));
  assert.equal(screen.getByRole('button', { name: 'Confirm reviewed test intent' }).disabled, true);
});
test('administrator policy preserves reviewed policy head and failed draft', async () => {
  const writes = [];
  await mount(Comms, {
    candidateId: 'candidate',
    role: 'admin',
    rpc: async (_name, args) => {
      if (args.p_action === 'context') return page;
      writes.push(args);
      throw new Error('Policy changed');
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Configure test transport' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed communication policy' }));
  await settle();
  assert.equal(writes[0].p_head, page.policyHead);
  assert.ok(screen.getByRole('form', { name: 'Communication policy' }));
});
