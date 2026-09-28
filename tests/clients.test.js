import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateClient,
  validateContact,
  contactsFor,
  primaryContact,
  demandsFor,
  unlinkedDemandNames,
  clientRollup,
  clientSummaries,
  clientPortfolio,
  applyClientToDemand,
  linkDemandsByName,
  blankClient,
  blankContact,
} from '../src/clients.js';
import { normalizeData, emptyData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const MERIDIAN = 'a0000000-0000-4000-8000-000000000001';

const fixture = () =>
  normalizeData({
    ...emptyData(),
    clients: [
      { id: 'c1', name: 'Meridian Technologies', status: 'Active' },
      { id: 'c2', name: 'Aster Digital', status: 'Prospect' },
    ],
    clientContacts: [
      { id: 'k1', clientId: 'c1', name: 'Zara', email: 'z@m.example' },
      { id: 'k2', clientId: 'c1', name: 'Rohit', email: 'r@m.example', isPrimary: true },
    ],
    demands: [
      {
        id: 'd1',
        clientId: 'c1',
        client: 'Meridian Technologies',
        status: 'Open',
        positions: 2,
        created: '2026-01-10',
      },
      {
        id: 'd2',
        clientId: null,
        client: 'meridian technologies',
        status: 'Closed',
        positions: 1,
        created: '2026-02-01',
      },
      {
        id: 'd3',
        clientId: null,
        client: 'Helios Labs',
        status: 'Open',
        positions: 3,
        created: '2026-03-01',
      },
    ],
    candidates: [{ id: 'p1', name: 'Aarav' }],
    submissions: [
      {
        id: 's1',
        candidateId: 'p1',
        demandId: 'd1',
        submittedOn: '2026-03-04',
        clientStatus: 'Shortlisted',
      },
      {
        id: 's2',
        candidateId: 'p1',
        demandId: 'd1',
        submittedOn: '2026-03-06',
        clientStatus: 'Pending',
      },
    ],
    interviews: [
      { id: 'i1', candidateId: 'p1', demandId: 'd1', scheduledAt: '2026-03-09T10:00:00Z' },
    ],
    offers: [
      { id: 'o1', candidateId: 'p1', demandId: 'd1', status: 'Accepted', sentDate: '2026-03-12' },
      { id: 'o2', candidateId: 'p1', demandId: 'd1', status: 'Rejected', sentDate: '2026-03-11' },
    ],
    considerations: [{ id: 'x1', candidateId: 'p1', demandId: 'd1', stage: 'Deployed' }],
    placements: [
      {
        id: 'p1d1',
        candidateId: 'p1',
        demandId: 'd1',
        clientId: 'c1',
        status: 'Active',
        startDate: '2026-03-10',
      },
    ],
  });

test('client validation mirrors the database constraints', () => {
  const clients = [{ id: 'c1', name: 'Meridian Technologies' }];
  assert.equal(validateClient({ ...blankClient(), name: 'Fresh Co' }, clients).name, undefined);
  assert.match(validateClient({ ...blankClient(), name: '  ' }, clients).name, /required/i);
  assert.match(
    validateClient({ ...blankClient(), name: ' meridian TECHNOLOGIES ' }, clients).name,
    /already exists/i,
    'duplicate detection is case- and whitespace-insensitive, like the unique index',
  );
  assert.equal(
    validateClient({ ...blankClient(), name: 'Meridian Technologies' }, clients, 'c1').name,
    undefined,
    'editing a client does not collide with itself',
  );
  assert.match(
    validateClient({ ...blankClient(), name: 'X', website: 'meridian.example' }, []).website,
    /http/,
  );
  assert.equal(
    validateClient({ ...blankClient(), name: 'X', website: 'https://ok.example' }, []).website,
    undefined,
  );
  assert.match(
    validateClient({ ...blankClient(), name: 'X', status: 'Archived' }, []).status,
    /Unknown/,
  );
});

test('contact validation requires an owner client and a way to make contact', () => {
  const existing = [{ id: 'k1', clientId: 'c1', name: 'Rohit', email: 'r@m.example' }];
  assert.match(validateContact({ ...blankContact('c1'), name: '' }, existing).name, /required/i);
  assert.match(
    validateContact({ ...blankContact(null), name: 'A' }, existing).clientId,
    /Select the client/i,
  );
  assert.match(
    validateContact({ ...blankContact('c1'), name: 'A' }, existing).email,
    /email address or a phone number/i,
    'matches the table check constraint',
  );
  assert.equal(
    validateContact({ ...blankContact('c1'), name: 'A', phone: '+91 99999 00000' }, existing).email,
    undefined,
    'a phone number alone is enough',
  );
  assert.match(
    validateContact({ ...blankContact('c1'), name: 'A', email: 'R@M.example' }, existing).email,
    /already has a contact/i,
  );
  assert.equal(
    validateContact({ ...blankContact('c2'), name: 'A', email: 'r@m.example' }, existing).email,
    undefined,
    'the same address may exist at a different client',
  );
  assert.match(
    validateContact({ ...blankContact('c1'), name: 'A', email: 'nope' }, []).email,
    /valid email/i,
  );
});

test('contacts sort primary-first and expose the primary contact', () => {
  const data = fixture();
  assert.deepEqual(
    contactsFor(data, 'c1').map((c) => c.name),
    ['Rohit', 'Zara'],
    'the primary contact leads, then alphabetical',
  );
  assert.equal(primaryContact(data, 'c1').name, 'Rohit');
  assert.equal(primaryContact(data, 'c2'), null, 'a client with no contacts has no primary');
});

test('demands roll up by explicit link and by legacy free-text name', () => {
  const data = fixture();
  const meridian = data.clients[0];
  assert.deepEqual(
    demandsFor(data, meridian).map((d) => d.id),
    ['d1', 'd2'],
    'the linked demand and the pre-migration name match both roll up',
  );
  assert.deepEqual(
    demandsFor(data, data.clients[1]).map((d) => d.id),
    [],
  );
  assert.deepEqual(demandsFor(data, null), [], 'no client means no demands');
});

test('unlinked demand names surface only genuinely unknown accounts', () => {
  const data = fixture();
  const names = unlinkedDemandNames(data);
  assert.deepEqual(
    names.map((n) => n.name),
    ['Helios Labs'],
    'a name already covered by a client record is not reported as unlinked',
  );
});

test('the client rollup counts real rows and never invents a rate', () => {
  const data = fixture();
  const roll = clientRollup(data, data.clients[0]);
  assert.equal(roll.counts.demands, 2);
  assert.equal(roll.counts.openDemands, 1);
  assert.equal(roll.counts.openPositions, 2);
  assert.equal(roll.counts.submissions, 2);
  assert.equal(roll.counts.interviews, 1);
  assert.equal(roll.counts.offers, 2);
  assert.equal(roll.counts.accepted, 1);
  assert.equal(roll.counts.placements, 1);
  assert.equal(roll.counts.contacts, 2);
  assert.equal(roll.submissionToInterview, 50);
  assert.equal(roll.offerAcceptance, 50);
  assert.equal(
    roll.lastActivity,
    '2026-03-12',
    'the latest dated activity across all record types',
  );

  const quiet = clientRollup(data, data.clients[1]);
  assert.equal(quiet.counts.submissions, 0);
  assert.equal(quiet.submissionToInterview, null, 'no denominator means no percentage, not 0%');
  assert.equal(quiet.offerAcceptance, null);
  assert.equal(quiet.lastActivity, null);
});

test('the rollup never reads restricted commercial figures', () => {
  const data = fixture();
  data.demandCommercials = [{ id: 'dc1', demandId: 'd1', internalCost: 22, notes: 'secret' }];
  const roll = clientRollup(data, data.clients[0]);
  assert.equal(
    JSON.stringify(roll).includes('secret'),
    false,
    'admin-only commercials stay out of the account rollup',
  );
});

test('client list search, filter and sort behave predictably', () => {
  const data = fixture();
  assert.equal(clientSummaries(data, { query: 'rohit' }).length, 1, 'contacts are searchable');
  assert.equal(clientSummaries(data, { query: 'aster' })[0].client.name, 'Aster Digital');
  assert.equal(clientSummaries(data, { status: 'Prospect' }).length, 1);
  assert.deepEqual(
    clientSummaries(data, { sort: 'name' }).map((r) => r.client.name),
    ['Aster Digital', 'Meridian Technologies'],
  );
  assert.equal(
    clientSummaries(data, { sort: 'placements' })[0].client.name,
    'Meridian Technologies',
  );
  assert.equal(clientSummaries(data, { query: 'nothing matches this' }).length, 0);
});

test('portfolio totals summarise the whole workspace', () => {
  const totals = clientPortfolio(fixture());
  assert.deepEqual(totals, {
    clients: 2,
    active: 1,
    openDemands: 1,
    openPositions: 2,
    placements: 1,
    unlinked: 1,
  });
});

test('linking a demand keeps the display name in step and back-fills by name', () => {
  const data = fixture();
  const linked = applyClientToDemand({ id: 'd3', client: 'Helios Labs' }, data.clients[0]);
  assert.equal(linked.clientId, 'c1');
  assert.equal(linked.client, 'Meridian Technologies', 'the free-text name follows the link');
  assert.equal(applyClientToDemand({ id: 'd3', client: 'x' }, null).clientId, null);

  const adopt = linkDemandsByName(data, data.clients[0]);
  assert.deepEqual(
    adopt.map((d) => d.id),
    ['d2'],
    'only unlinked name matches are adopted',
  );
  assert.equal(adopt[0].clientId, 'c1');
});

test('the seeded workspace opens with linked client accounts', () => {
  const data = normalizeData(makeSeed());
  assert.ok(data.clients.length >= 3, 'sample accounts exist');
  assert.ok(data.clientContacts.length >= 3, 'sample contacts exist');
  const meridian = data.clients.find((c) => c.id === MERIDIAN);
  const roll = clientRollup(data, meridian);
  assert.ok(roll.counts.demands >= 2, 'the seeded demands roll up to their account');
  assert.equal(primaryContact(data, MERIDIAN).name, 'Rohit Nair');
  assert.equal(
    data.clientContacts.filter((c) => c.clientId === MERIDIAN && c.isPrimary).length,
    1,
    'the seed respects the one-primary-per-client rule the database enforces',
  );
  assert.deepEqual(unlinkedDemandNames(data), [], 'every seeded demand is linked to an account');
});
