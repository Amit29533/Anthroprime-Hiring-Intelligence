import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { React, load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Console;
test.before(async () => {
  Console = (await load('/src/GoogleWorkspace.jsx')).default;
});
afterEach(cleanup);
test.after(stopVite);
const context = {
  connections: [
    {
      kind: 'mailbox',
      head: 'generation-one',
      generation: 1,
      state: 'configured',
      authorized: true,
      body: {
        owner: 'admin',
        account: 'admin@example.invalid',
        calendarId: 'primary',
        purpose: 'Fictional recruiting',
        costDecision: 'Reviewed fictional quota',
        evidence: 'Fictional local fixture',
      },
    },
  ],
  defaultHead: 'empty',
  paused: false,
};
const fixture = async (name, args) =>
  name === 'api_test_communications'
    ? args.p_action === 'browse'
      ? { rows: [], more: false }
      : { templates: [{ id: 'template', key: 'welcome', version: 1 }], demands: [], interviews: [] }
    : args.p_action === 'context'
      ? context
      : { rows: [], more: false };
test('Google configuration freezes exact operation and reviewed head after an uncertain acknowledgement', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (name, args) => {
      if (name === 'api_google_collaboration' && args.p_action === 'configure') {
        writes.push(args);
        throw Error('Acknowledgement lost');
      }
      return fixture(name, args);
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Review existing Google configuration'));
  fireEvent.click(screen.getByText('Save Google configuration'));
  await settle();
  assert.equal(screen.getByLabelText('Google capability').matches(':disabled'), true);
  fireEvent.click(screen.getByText('Retry exact Google request'));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_head, 'generation-one');
  fireEvent.click(screen.getByText('Discard retry and refresh'));
  await settle();
  assert.equal(screen.getByLabelText('Google capability').matches(':disabled'), false);
});
test('Google controls hide in local mode and for viewer or limited roles', async () => {
  for (const role of ['viewer', 'assessor', 'sales']) {
    await mount(Console, { isCloud: true, role, scope: 'one', rpc: fixture });
    assert.equal(screen.queryByLabelText('Google Workspace communication and scheduling'), null);
    cleanup();
  }
  await mount(Console, { isCloud: false, role: 'admin', scope: 'one', rpc: fixture });
  assert.equal(screen.queryByText('Stage 3 Google Workspace'), null);
});
test('Google authorization validates the fixed destination and keeps a usable link after popup blocking', async () => {
  let opened;
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: fixture,
    server: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture' }),
    openAuthorization: (url) => {
      opened = url;
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Authorize configured Google account'));
  await settle();
  assert.equal(opened, 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture');
  assert.equal(
    screen.getByText('Open Google authorization').getAttribute('rel'),
    'noopener noreferrer',
  );
});
test('Google preview and queue use a frozen candidate scope and no client-supplied message body', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    candidateId: 'candidate',
    rpc: async (name, args) => {
      if (args.p_action === 'preview')
        return {
          eligible: true,
          head: 'source-head',
          preview: {
            recipient: 'fixture@example.invalid',
            subject: 'Fixture',
            text: 'Reviewed fixture',
          },
        };
      if (args.p_action === 'prepare') {
        writes.push(args);
        return { status: 'Queued' };
      }
      return fixture(name, args);
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Google reviewed template'), {
    target: { value: 'template' },
  });
  fireEvent.click(screen.getByText('Review Google operation'));
  await settle();
  fireEvent.click(screen.getByText('Queue reviewed Google operation'));
  await settle();
  assert.equal(writes[0].p_candidate, 'candidate');
  assert.equal(writes[0].p_head, 'source-head');
  assert.deepEqual(writes[0].p_payload, { operation: 'send', template: 'template', context: {} });
  assert.ok(!screen.queryByText('Save Google configuration'));
});
