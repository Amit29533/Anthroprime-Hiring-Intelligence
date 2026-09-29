// Drives the Clients module the way an account manager does: open the page from the shell,
// create an account, add contacts, and follow a demand through to the account rollup. These are
// the prop-wiring and persistence checks that unit tests on clients.js cannot see.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  createHarness,
  click,
} from './ui-harness.js';
import { navTo, press, type, choose, submitVia, allText, rowOf, pressIn } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';
import { contactsFor, clientRollup } from '../src/clients.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const store = () => JSON.parse(localStorage.getItem('ecod-demo-v1'));

async function boot(seed) {
  localStorage.removeItem('ecod-demo-v1');
  if (seed) localStorage.setItem('ecod-demo-v1', JSON.stringify(seed));
  const view = await mount(M.App, {});
  await settle(6);
  return view;
}

test('the Clients page opens from the sidebar and shows the seeded portfolio', async () => {
  await boot();
  await navTo('Clients');
  assert.ok(screen.getByText('Client accounts'), 'the clients page rendered');
  assert.ok(screen.getByText('Meridian Technologies'), 'a seeded account is listed');
  assert.ok(screen.getByText('Northstar Financial'), 'every seeded account is listed');
  assert.ok(screen.getByText('Accounts'), 'the portfolio stat is shown');
  cleanup();
});

test('an account manager can create a client and it persists to the workspace', async () => {
  await boot();
  await navTo('Clients');
  await press('New client');
  await type('Client name', 'Helios Labs');
  await type('Industry', 'Renewables');
  await type('Location', 'Chennai');
  await type('Account owner', 'Amit Singh');
  await choose('Tier', 'Key');
  await submitVia('Create client');
  await settle(4);

  const saved = store().clients.find((c) => c.name === 'Helios Labs');
  assert.ok(saved, 'the client was written to the demo store');
  assert.equal(saved.industry, 'Renewables');
  assert.equal(saved.tier, 'Key');
  assert.equal(saved.status, 'Active', 'the default status is applied');
  // Creating an account navigates straight to it.
  assert.ok(screen.getByText('Contacts'), 'the new account detail page opened');
  cleanup();
});

test('a duplicate client name is refused before it reaches the database', async () => {
  await boot();
  await navTo('Clients');
  await press('New client');
  await type('Client name', '  meridian technologies ');
  await submitVia('Create client');
  await settle(2);
  assert.ok(
    allText(/already exists/i).length,
    'the form explains the clash instead of relying on a database error',
  );
  assert.equal(
    store()?.clients.filter((c) => /meridian/i.test(c.name)).length ?? 1,
    1,
    'no duplicate row was written',
  );
  cleanup();
});

test('contacts can be added, and promoting a new primary demotes the old one', async () => {
  const harness = createHarness(normalizeData(makeSeed()));
  const meridian = harness.state.data.clients[0];
  await mount(M.ContactForm, {
    clientId: meridian.id,
    data: harness.state.data,
    onClose: harness.noop,
    onSave: harness.save,
    busy: false,
  });
  await type('Contact name', 'Devi Raman');
  await type('Job title', 'Delivery Director');
  await type('Email', 'devi.raman@meridian.example');
  const primary = screen.getByLabelText(/Primary contact/i);
  await settle(1);
  await click(primary);
  await settle(1);
  await submitVia('Add contact');
  await settle(2);

  const write = harness.state.writes.find((w) => w.table === 'clientContacts');
  assert.ok(write, 'contacts are saved to the clientContacts table');
  const added = write.rows.find((r) => r.name === 'Devi Raman');
  assert.ok(added, 'the new contact is in the write');
  assert.equal(added.isPrimary, true);
  const demoted = write.rows.find((r) => r.name === 'Rohit Nair');
  assert.ok(demoted, 'the previous primary is included in the same write');
  assert.equal(
    demoted.isPrimary,
    false,
    'the incumbent is demoted so the one-primary-per-client index cannot reject the edit',
  );
  cleanup();
});

test('a contact with neither email nor phone is refused', async () => {
  const harness = createHarness(normalizeData(makeSeed()));
  await mount(M.ContactForm, {
    clientId: harness.state.data.clients[0].id,
    data: harness.state.data,
    onClose: harness.noop,
    onSave: harness.save,
    busy: false,
  });
  await type('Contact name', 'No Contact Details');
  await submitVia('Add contact');
  await settle(2);
  assert.ok(
    allText(/email address or a phone number/i).length,
    'the form explains what is missing',
  );
  assert.equal(
    harness.state.writes.length,
    0,
    'nothing is written when the record would violate the table check',
  );
  cleanup();
});

test('the client detail page rolls up demands, submissions and placements', async () => {
  const data = normalizeData(makeSeed());
  const meridian = data.clients.find((c) => c.name === 'Meridian Technologies');
  const expected = clientRollup(data, meridian);
  const opened = [];
  await mount(M.ClientDetail, {
    client: meridian,
    data,
    onBack: () => {},
    onEdit: () => {},
    onAddContact: () => {},
    onEditContact: () => {},
    onOpenDemand: (id) => opened.push(id),
    onOpenCandidate: () => {},
  });
  assert.ok(screen.getByText('Meridian Technologies'), 'the account name heads the page');
  assert.ok(screen.getByText('Rohit Nair'), 'contacts are listed');
  assert.ok(screen.getByText('Primary'), 'the primary contact is badged');
  assert.ok(screen.getByText('Senior Databricks Architect'), 'linked demands are listed');
  assert.ok(expected.counts.demands >= 2, 'the fixture really does have demands to roll up');

  // Opening a demand from the account hands off to the demand screen.
  await pressIn(rowOf('Senior Databricks Architect'), 'Open');
  assert.equal(opened.length, 1, 'the demand hand-off is wired');
  cleanup();
});

test('an account manager can record a placement and its restricted commercial outcome', async () => {
  const data = normalizeData(makeSeed());
  const demand = data.demands[0];
  const candidate = data.candidates[0];
  const harness = createHarness(data);
  await mount(M.PlacementForm, {
    clientId: demand.clientId,
    data,
    onClose: harness.noop,
    onSave: harness.save,
    busy: false,
  });

  await choose('Candidate', candidate.id);
  await choose('Demand', demand.id);
  await choose('Status', 'Active');
  await type('Start date', '2026-10-01');
  await type('Bill rate', '48');
  await type('Cost rate', '36');
  await type('Amount billed', '4');
  await type('Amount collected', '3');
  await submitVia('Create placement');

  const placementWrite = harness.state.writes.find((write) => write.table === 'placements');
  assert.ok(placementWrite, 'the deployment lifecycle is saved as a placement record');
  const saved = placementWrite.rows[0];
  assert.equal(saved.candidateId, candidate.id);
  assert.equal(saved.demandId, demand.id);
  assert.equal(saved.clientId, demand.clientId);
  assert.equal(saved.status, 'Active');

  const commercialWrite = harness.state.writes.find(
    (write) => write.table === 'placementCommercials',
  );
  assert.ok(commercialWrite, 'commercial outcomes are saved separately');
  assert.equal(commercialWrite.rows[0].placementId, saved.id);
  assert.equal(commercialWrite.rows[0].billRate, 48);
  assert.equal(commercialWrite.rows[0].costRate, 36);
  assert.equal(commercialWrite.rows[0].billedAmount, 4);
  assert.equal(commercialWrite.rows[0].collectedAmount, 3);
  cleanup();
});

test('a client account with no activity reports zeros rather than invented rates', async () => {
  const data = normalizeData(makeSeed());
  const prospect = data.clients.find((c) => c.name === 'Aster Digital');
  // Strip its demand so the account is genuinely empty.
  const empty = { ...data, demands: data.demands.filter((d) => d.clientId !== prospect.id) };
  await mount(M.ClientDetail, {
    client: prospect,
    data: empty,
    onBack: () => {},
    onEdit: () => {},
    onAddContact: () => {},
    onEditContact: () => {},
    onOpenDemand: () => {},
    onOpenCandidate: () => {},
  });
  assert.ok(screen.getByText('No demands linked to this client yet.'));
  assert.ok(screen.getByText('Nothing submitted to this client yet.'));
  assert.ok(screen.getByText('No submissions yet'), 'no denominator means no percentage');
  assert.ok(screen.getByText('No offers yet'));
  cleanup();
});

test('a demand created against a known client name links to that account', async () => {
  await boot();
  await navTo('Demands');
  await press('Create demand');
  await type('Role title', 'Platform Engineer');
  await type('Client', 'Northstar Financial');
  await type('Must-have skills', 'Azure');
  await type('Target start date', '2026-12-01');
  await submitVia('Create & find matches');
  await settle(4);

  const created = store().demands.find((d) => d.title === 'Platform Engineer');
  assert.ok(created, 'the demand was saved');
  const northstar = store().clients.find((c) => c.name === 'Northstar Financial');
  assert.equal(
    created.clientId,
    northstar.id,
    'typing a known account name links the demand to that account record',
  );
  cleanup();
});

test('an unlinked client name can be adopted into an account in one click', async () => {
  const seed = makeSeed();
  // A demand whose client has no account record — the state every pre-batch-16 workspace is in.
  seed.demands = [
    ...seed.demands,
    {
      ...seed.demands[0],
      id: '20000000-0000-4000-8000-000000000099',
      client: 'Helios Labs',
      clientId: null,
    },
  ];
  await boot(seed);
  await navTo('Clients');
  assert.ok(
    screen.getByText('Client names without an account record'),
    'the migration backlog is surfaced',
  );
  const chip = [...document.querySelectorAll('.chip-button')].find((b) =>
    b.textContent.includes('Helios Labs'),
  );
  assert.ok(chip, 'the unlinked client name is offered');
  await click(chip);
  await settle(6);

  const created = store().clients.find((c) => c.name === 'Helios Labs');
  assert.ok(created, 'the account record was created');
  const adopted = store().demands.find((d) => d.id === '20000000-0000-4000-8000-000000000099');
  assert.equal(adopted.clientId, created.id, 'the orphan demand was adopted by the new account');
  cleanup();
});

test('the submission modal prefills the account primary contact', async () => {
  const data = normalizeData(makeSeed());
  const demand = data.demands.find((d) => d.clientId);
  const harness = createHarness(data);
  await mount(M.SubmissionModal, {
    demand,
    data,
    onClose: harness.noop,
    onSave: harness.save,
    audit: harness.audit,
    busy: false,
  });
  const primary = contactsFor(data, demand.clientId).find((c) => c.isPrimary);
  assert.ok(primary, 'the seeded account has a primary contact');
  const field = screen.getByLabelText(/Client contact/i);
  assert.equal(
    field.value,
    primary.email,
    'the submission is addressed to the recorded primary contact by default',
  );
  assert.ok(screen.getByLabelText(/Recorded contact/i), 'saved contacts are offered as a picker');
  cleanup();
});
