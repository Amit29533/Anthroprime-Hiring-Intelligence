import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Contacts, Profile;
test.before(async () => {
  Contacts = (await load('/src/CandidateContacts.jsx')).CandidateContacts;
  Profile = (await load('/src/PagedRepository.jsx')).PagedCandidate360;
});
afterEach(cleanup);
test.after(stopVite);
const row = {
  id: 'contact',
  kind: 'email',
  value: 'alternate@e.com',
  source: 'Candidate call',
  label: 'Personal',
  active: true,
  preferred: false,
  version: 1,
  verified_at: null,
};
const page = (rows = [row]) => ({
  candidateId: 'one',
  primaryEmail: 'primary@e.com',
  primaryPhone: '',
  rows,
  events: [],
  more: false,
  eventsMore: false,
});

test('contacts are declared until explicitly confirmed; failed evidence stays and lost acknowledgements reuse intent IDs', async () => {
  const calls = [];
  let first = true,
    confirmed = false;
  await mount(Contacts, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_candidate_contacts')
        return page([
          {
            ...row,
            ...(confirmed
              ? {
                  verified_at: '2026-10-07T09:00:00Z',
                  verified_by: 'reviewer',
                  verification_note: 'Confirmed on candidate call',
                  version: 2,
                }
              : {}),
          },
        ]);
      if (first) {
        first = false;
        throw new Error('Acknowledgement lost. Retry.');
      }
      confirmed = true;
      return { contactId: args.p_contact, version: 2 };
    },
  });
  await settle();
  assert.ok(screen.getByText('Declared'));
  assert.equal(screen.getByRole('button', { name: 'Prefer alternate@e.com' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Verification or change evidence'), {
    target: { value: 'Confirmed on candidate call' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm alternate@e.com' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Acknowledgement lost/);
  assert.equal(
    screen.getByLabelText('Verification or change evidence').value,
    'Confirmed on candidate call',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm alternate@e.com' }));
  await settle();
  const writes = calls.filter(([name]) => name === 'api_change_candidate_contact');
  assert.equal(writes[0][1].p_operation, writes[1][1].p_operation);
  assert.equal(writes[1][1].p_details.reason, 'Confirmed on candidate call');
  assert.ok(screen.getByText('Recruiter confirmed'));
  assert.match(screen.getByText(/Primary email:/).textContent, /primary@e.com/);
});

test('recording alternate contacts keeps sources and never implies confirmation', async () => {
  const writes = [];
  let added = false;
  await mount(Contacts, {
    candidateId: 'one',
    enabled: true,
    editable: true,
    rpc: async (name, args) => {
      if (name === 'api_candidate_contacts') return page(added ? [row] : []);
      writes.push(args);
      added = true;
      return { contactId: args.p_contact, version: 1 };
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Contact value'), {
    target: { value: 'alternate@e.com' },
  });
  fireEvent.change(screen.getByLabelText('Contact source'), {
    target: { value: 'Candidate call' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record declared contact' }));
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p_action, 'add');
  assert.equal(writes[0].p_details.source, 'Candidate call');
  assert.equal(writes[0].p_details.verified_by, undefined);
  assert.ok(screen.getByText('Declared'));
});

test('viewer contact history is read-only and bounded history pagination stays scoped', async () => {
  const calls = [];
  await mount(Contacts, {
    candidateId: 'one',
    enabled: true,
    editable: false,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { ...page(), eventsMore: args.p_events_offset === 0 };
    },
  });
  await settle();
  assert.equal(screen.queryByRole('button', { name: 'Record declared contact' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Confirm alternate@e.com' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Next contact history page' }));
  await settle();
  assert.equal(calls.at(-1)[1].p_events_offset, 50);
  assert.equal(calls.at(-1)[1].p_candidate, 'one');
});

test('paged Candidate 360 opens contact review without a full-table or unsupported section read', async () => {
  const calls = [];
  await mount(Profile, {
    candidateId: 'one',
    onClose: () => {},
    onFull: () => {
      throw new Error('No full reads');
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return name === 'api_candidate_contacts'
        ? page()
        : { candidate: { id: 'one', name: 'Candidate', skills: [] } };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
  await settle();
  assert.ok(screen.getByText('Contacts & verification'));
  assert.ok(calls.some(([name]) => name === 'api_candidate_contacts'));
  assert.equal(
    calls.filter(
      ([name, args]) => name === 'api_candidate_section' && args.p_section === 'contacts',
    ).length,
    0,
  );
});
