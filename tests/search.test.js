import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchWorkspace,
  groupResults,
  scoreField,
  RESULT_TYPES,
  TYPE_LABELS,
  FORBIDDEN_FIELDS,
  isIndexable,
} from '../src/search.js';
import { normalizeData, emptyData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const world = () =>
  normalizeData({
    ...emptyData(),
    candidates: [
      {
        id: 'c1',
        name: 'Aarav Kumar',
        email: 'aarav@example.com',
        title: 'Data Engineer',
        location: 'Bengaluru',
        skills: ['Databricks'],
        status: 'Ready',
        expected: 46,
        current: 38,
      },
      {
        id: 'c2',
        name: 'Bhavna Rao',
        email: 'bhavna@example.com',
        title: 'Analyst',
        location: 'Pune',
        skills: ['SQL'],
        status: 'Screening',
      },
    ],
    demands: [
      {
        id: 'd1',
        title: 'Senior Databricks Architect',
        client: 'Meridian',
        location: 'Bengaluru',
        skills: ['Databricks'],
        status: 'Open',
        budget: 4242,
      },
    ],
    clients: [{ id: 'cl1', name: 'Meridian Technologies', industry: 'Retail', status: 'Active' }],
    clientContacts: [
      {
        id: 'k1',
        clientId: 'cl1',
        name: 'Rohit Nair',
        email: 'rohit@meridian.example',
        title: 'Head of Data',
        isPrimary: true,
      },
    ],
    referrals: [
      {
        id: 'r1',
        refereeName: 'Devika Iyer',
        refereeEmail: 'devika@example.com',
        referrerName: 'Priya Raman',
        status: 'New',
      },
    ],
    notes: [
      {
        id: 'n1',
        candidateId: 'c1',
        text: 'Discussed the Databricks migration in detail.',
        date: '2026-09-01',
      },
    ],
    skills: [{ id: 's1', name: 'Databricks', domain: 'Data', aliases: ['dbx'] }],
    demandCommercials: [
      { id: 'dc1', demandId: 'd1', notes: 'Margin squeeze expected', internalCost: 31 },
    ],
  });

test('search reaches every entity type, not just candidates', () => {
  const data = world();
  const found = (q) => searchWorkspace(data, q).map((r) => r.type);
  assert.ok(found('Aarav').includes('candidate'));
  assert.ok(found('Senior Databricks').includes('demand'));
  assert.ok(found('Meridian Tech').includes('client'));
  assert.ok(found('Rohit').includes('contact'));
  assert.ok(found('Devika').includes('referral'));
  assert.ok(found('migration').includes('note'));
  assert.ok(found('dbx').includes('skill'), 'a skill alias is searchable');
});

test('a query shorter than two characters returns nothing rather than everything', () => {
  const data = world();
  assert.deepEqual(searchWorkspace(data, 'a'), []);
  assert.deepEqual(searchWorkspace(data, ' '), []);
  assert.deepEqual(searchWorkspace(data, ''), []);
  assert.deepEqual(searchWorkspace(null, 'aarav'), []);
});

test('admin-only figures are never searchable, by any role', () => {
  const data = world();
  // Budget 4242 and compensation 46/38 exist in the data but must not be discoverable.
  for (const role of [{ isAdmin: false }, { isAdmin: true }]) {
    for (const q of ['4242', '46', '38']) {
      const hits = searchWorkspace(data, q, role);
      assert.equal(
        hits.length,
        0,
        `"${q}" must not find anything — matching on a commercial figure discloses it`,
      );
    }
  }
  for (const field of ['expected', 'current', 'budget', 'internalCost'])
    assert.equal(isIndexable(field), false, `${field} is on the never-indexed list`);
  assert.ok(FORBIDDEN_FIELDS.includes('statusToken'), 'portal tokens are not searchable either');
});

test('an admin can find a commercial note; a recruiter cannot', () => {
  const data = world();
  const asAdmin = searchWorkspace(data, 'Margin squeeze', { isAdmin: true });
  assert.equal(asAdmin.length, 1, 'the admin is taken to the demand');
  assert.equal(asAdmin[0].type, 'demand');
  assert.equal(asAdmin[0].subtitle, 'Commercial note');
  assert.deepEqual(
    searchWorkspace(data, 'Margin squeeze', { isAdmin: false }),
    [],
    'a recruiter cannot even learn that such a note exists',
  );
});

test('results are ranked so the obvious answer is first', () => {
  const data = world();
  const results = searchWorkspace(data, 'Databricks');
  assert.equal(results[0].title, 'Databricks', 'the exact skill match wins');
  const noteIndex = results.findIndex((r) => r.type === 'note');
  const demandIndex = results.findIndex((r) => r.type === 'demand');
  assert.ok(demandIndex < noteIndex, 'a title match outranks a passing mention in a note');

  assert.ok(scoreField('Aarav Kumar', 'aarav kumar') > scoreField('Aarav Kumar', 'aarav'));
  assert.ok(scoreField('Aarav Kumar', 'aarav') > scoreField('Aarav Kumar', 'kumar'));
  assert.ok(scoreField('Aarav Kumar', 'kumar') > scoreField('Aarav Kumar', 'ara'));
  assert.equal(scoreField('Aarav', 'zzz'), 0);
  assert.equal(scoreField('', 'a'), 0);
  assert.equal(scoreField('Aarav', ''), 0);
});

test('search is case-insensitive and matches partial words', () => {
  const data = world();
  assert.equal(searchWorkspace(data, 'AARAV')[0].title, 'Aarav Kumar');
  assert.equal(searchWorkspace(data, 'aarav@exam')[0].title, 'Aarav Kumar', 'email is searchable');
  assert.ok(searchWorkspace(data, 'bengaluru').length >= 2, 'location finds people and roles');
});

test('results carry what the UI needs to navigate', () => {
  const data = world();
  const contact = searchWorkspace(data, 'Rohit')[0];
  assert.equal(contact.type, 'contact');
  assert.equal(contact.parentId, 'cl1', 'a contact knows its client, so the UI can open it');
  assert.equal(contact.subtitle, 'Head of Data · Meridian Technologies');

  const note = searchWorkspace(data, 'migration')[0];
  assert.equal(note.parentId, 'c1', 'a note knows its candidate');
  assert.equal(note.subtitle, 'Aarav Kumar');

  for (const r of searchWorkspace(data, 'a', { limit: 50 }).concat(searchWorkspace(data, 'ar'))) {
    assert.ok(RESULT_TYPES.includes(r.type));
    assert.ok(r.id && r.title !== undefined);
  }
});

test('the result limit is honoured', () => {
  const many = normalizeData({
    ...emptyData(),
    candidates: Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      name: `Tester ${i}`,
      email: `t${i}@example.com`,
      skills: [],
    })),
  });
  assert.equal(searchWorkspace(many, 'Tester').length, 20, 'defaults to 20');
  assert.equal(searchWorkspace(many, 'Tester', { limit: 5 }).length, 5);
});

test('grouping preserves rank inside each section and skips empty ones', () => {
  const data = world();
  const groups = groupResults(searchWorkspace(data, 'Databricks'));
  assert.ok(groups.length >= 2);
  for (const g of groups) {
    assert.ok(TYPE_LABELS[g.type], 'every section is labelled');
    assert.ok(g.items.length > 0, 'no empty sections are rendered');
    const scores = g.items.map((i) => i.score);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
      'rank order held within a section',
    );
  }
  assert.deepEqual(groupResults([]), []);
});

test('search works against the real seeded workspace', () => {
  const data = normalizeData(makeSeed());
  const someone = data.candidates[0];
  const hit = searchWorkspace(data, someone.name).find((r) => r.type === 'candidate');
  assert.ok(hit, 'a seeded candidate is findable by name');
  assert.equal(hit.id, someone.id);
  assert.ok(searchWorkspace(data, 'Meridian').some((r) => r.type === 'client'));
  assert.ok(
    searchWorkspace(data, String(data.demands[0].budget), { isAdmin: true }).every(
      (r) => r.subtitle !== undefined,
    ),
    'a budget number never produces a budget disclosure',
  );
});
