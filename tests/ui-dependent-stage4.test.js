import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { React, load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Console;
test.before(async () => {
  Console = (await load('/src/ControlledWorkflows.jsx')).default;
});
test('Strict Mode remount keeps controlled source review usable', async () => {
  const Strict = (props) =>
    React.createElement(React.StrictMode, null, React.createElement(Console, props));
  await mount(Strict, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    candidateId: 'candidate',
    rpc: async (n, p) =>
      p.p_action === 'preview'
        ? { eligible: true, head: 'current', snapshot: { fields: { title: 'Engineer' } } }
        : fixture(n, p),
  });
  await settle();
  fireEvent.click(screen.getByText('Review controlled source'));
  await settle();
  assert.ok(screen.getByText('Prepare reviewed controlled workflow'));
  assert.equal(screen.getByText('Review controlled source').closest('fieldset').disabled, false);
});
afterEach(cleanup);
test.after(stopVite);
const context = {
  actor: 'reviewer',
  policies: [],
  defaultHead: 'empty',
  paused: false,
  evaluations: [],
};
const fixture = async (n, p) => (p.p_action === 'context' ? context : { rows: [], more: false });
test('controlled workflows hide from local, viewer and limited-role contexts', async () => {
  for (const props of [
    { isCloud: false, role: 'admin' },
    { isCloud: true, role: 'viewer' },
    { isCloud: true, role: 'assessor' },
  ]) {
    await mount(Console, { ...props, scope: 'one', rpc: fixture });
    assert.equal(screen.queryByText('Stage 4 controlled workflows'), null);
    cleanup();
  }
});
test('lost policy acknowledgements retain the exact operation/head and lock dependent controls', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (n, p) => {
      if (p.p_action === 'configure') {
        writes.push(p);
        throw Error('Lost acknowledgement');
      }
      return fixture(n, p);
    },
  });
  await settle();
  fireEvent.click(screen.getByText('Save reviewed controlled policy'));
  await settle();
  assert.ok(screen.getByRole('alert').textContent.includes('Lost'));
  assert.ok(screen.getByLabelText('Controlled workflow').closest('fieldset').disabled);
  fireEvent.click(screen.getByText('Retry exact controlled operation'));
  await settle();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_head, 'empty');
  fireEvent.click(screen.getByText('Discard controlled retry and refresh'));
  await settle();
  assert.equal(screen.getByLabelText('Controlled workflow').closest('fieldset').disabled, false);
});
test('preview and preparation freeze candidate, permitted locators and exact reviewed source', async () => {
  const writes = [];
  await mount(Console, {
    isCloud: true,
    role: 'recruiter',
    scope: 'one',
    candidateId: 'candidate',
    rpc: async (n, p) => {
      if (p.p_action === 'preview')
        return { eligible: true, head: 'source-head', snapshot: { fields: { title: 'Engineer' } } };
      if (p.p_action === 'prepare') {
        writes.push(p);
        return { status: 'Queued' };
      }
      return fixture(n, p);
    },
  });
  await settle();
  assert.ok(!screen.queryByText('Administrator policy and baseline evaluation'));
  fireEvent.click(screen.getByText('Review controlled source'));
  await settle();
  fireEvent.click(screen.getByText('Prepare reviewed controlled workflow'));
  await settle();
  assert.equal(writes[0].p_candidate, 'candidate');
  assert.equal(writes[0].p_head, 'source-head');
  assert.deepEqual(writes[0].p_payload, { kind: 'ai' });
  assert.equal(screen.getByLabelText('Controlled candidate UUID').disabled, true);
});
test('fixture labels, independent review and version history do not claim legal signing or automatic fact changes', async () => {
  const row = {
    id: 'work',
    kind: 'ai',
    status: 'Review',
    actor: 'reviewer',
    head: 'work-head',
    source: { source: 'Curated assertions' },
    content: {
      highlights: [{ field: 'title', quote: 'Engineer' }],
      unknowns: ['Certification unknown'],
      notes: '',
    },
  };
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    scope: 'one',
    rpc: async (n, p) =>
      p.p_action === 'context'
        ? context
        : p.p_action === 'browse'
          ? { rows: [row], more: false }
          : p.p_action === 'versions'
            ? {
                rows: [
                  { id: 'version', version: 1, origin: 'provider-original', content: row.content },
                ],
                more: false,
              }
            : fixture(n, p),
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Controlled review reason'), {
    target: { value: 'Independent exact citation review' },
  });
  assert.equal(screen.getByText('Accept independently reviewed draft').disabled, true);
  assert.match(
    screen.getByText(/Signing fixtures are fictional/).textContent,
    /cannot provide a legal signature/,
  );
  fireEvent.click(screen.getByText('Review retained workflow versions'));
  await settle();
  assert.ok(screen.getByRole('complementary', { name: 'Retained workflow versions' }));
});
