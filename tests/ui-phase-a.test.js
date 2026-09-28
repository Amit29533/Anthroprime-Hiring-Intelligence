// Phase A: cross-entity search, the notification bell, and the personal work queue — driven
// through the real shell, because these are exactly the prop-wiring features a unit test misses.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, act, fireEvent } from './ui-harness.js';
import { navTo, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const NOW = new Date('2026-09-28T09:00:00Z').getTime();
const day = (o) => new Date(NOW + o * 86400000).toISOString().slice(0, 10);

async function boot(seed) {
  localStorage.removeItem('ecod-demo-v1');
  if (seed) localStorage.setItem('ecod-demo-v1', JSON.stringify(seed));
  await mount(M.App, {});
  await settle(6);
}

const searchBox = () => screen.getByLabelText('Search your workspace');
async function typeSearch(text) {
  await act(async () => {
    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: text } });
  });
  await settle(3);
}
const resultTitles = () =>
  [...document.querySelectorAll('.search-result strong')].map((n) => n.textContent);

test('the top-bar search reaches demands and clients, not just candidates', async () => {
  await boot();
  await typeSearch('Meridian');
  const titles = resultTitles();
  assert.ok(titles.length > 0, 'results appear as you type');
  assert.ok(
    titles.some((t) => /Meridian/.test(t)),
    'the client account is findable from anywhere',
  );
  const sections = [...document.querySelectorAll('.search-results h4')].map((h) => h.textContent);
  assert.ok(sections.length >= 1, 'results are grouped by type');
  cleanup();
});

test('choosing a search result opens that record', async () => {
  await boot();
  const person = normalizeData(makeSeed()).candidates[0];
  await typeSearch(person.name);
  const hit = [...document.querySelectorAll('.search-result')].find((b) =>
    b.textContent.includes(person.name),
  );
  assert.ok(hit, 'the candidate is offered');
  await act(async () => {
    fireEvent.click(hit);
  });
  await settle(4);
  assert.ok(
    screen.getAllByText(person.name).length > 0,
    'the profile opened rather than merely filtering a list',
  );
  assert.equal(searchBox().value, '', 'and the box clears, ready for the next search');
  cleanup();
});

test('a search with no matches says so instead of showing an empty panel', async () => {
  await boot();
  await typeSearch('zzzznothingmatches');
  assert.ok(allText(/No matches for/).length);
  assert.equal(resultTitles().length, 0);
  cleanup();
});

test('a single character does not trigger a search', async () => {
  await boot();
  await typeSearch('a');
  assert.equal(document.querySelector('.search-results'), null, 'too short to be useful');
  cleanup();
});

test('a recruiter cannot discover a budget through search', async () => {
  const seed = makeSeed();
  const budget = seed.demands[0].budget;
  await boot(seed);
  await typeSearch(String(budget));
  assert.equal(
    resultTitles().length,
    0,
    'matching on a commercial figure would disclose it, so it is never indexed',
  );
  cleanup();
});

test('the bell reports work that is actually due, and navigates to it', async () => {
  const seed = makeSeed();
  seed.tasks = [
    { id: 't1', title: 'Chase reference', owner: 'Amit Singh', due: day(-3), status: 'Open' },
    { id: 't2', title: 'Call candidate', owner: 'Amit Singh', due: day(0), status: 'Open' },
  ];
  await boot(seed);
  const badge = document.querySelector('.bell-badge');
  assert.ok(badge, 'the bell shows a count');
  assert.ok(Number(badge.textContent) >= 2, 'overdue and due-today are both counted');

  await act(async () => {
    fireEvent.click(document.querySelector('.bell-wrap button'));
  });
  await settle(2);
  assert.ok(allText(/1 overdue task/).length, 'the panel names what is wrong');
  assert.ok(allText(/1 task due today/).length);

  const item = [...document.querySelectorAll('.bell-item')].find((b) =>
    /overdue/.test(b.textContent),
  );
  await act(async () => {
    fireEvent.click(item);
  });
  await settle(4);
  assert.ok(screen.getByText('Every conversation counts.'), 'it took us to Activities');
  cleanup();
});

test('a clear desk shows no badge at all, rather than a zero', async () => {
  const seed = makeSeed();
  seed.tasks = [];
  seed.interviews = [];
  seed.referrals = [];
  await boot(seed);
  assert.equal(document.querySelector('.bell-badge'), null, 'no badge when nothing is due');
  await act(async () => {
    fireEvent.click(document.querySelector('.bell-wrap button'));
  });
  await settle(2);
  assert.ok(allText(/Nothing due today/).length);
  cleanup();
});

test('the dashboard shows a personal work queue', async () => {
  const seed = makeSeed();
  seed.tasks = [
    { id: 't1', title: 'Chase reference', owner: 'Amit Singh', due: day(-3), status: 'Open' },
  ];
  await boot(seed);
  assert.ok(screen.getByText('Your work today'));
  // "Overdue" appears both as a tile label and as a badge on the listed task.
  assert.ok(allText('Overdue').length >= 2);
  assert.ok(screen.getByText('My open demands'));
  assert.ok(allText(/Chase reference/).length, 'the overdue item itself is listed');
  cleanup();
});

test('a user who owns nothing is told why their queue is empty', async () => {
  const seed = makeSeed();
  // Everything is owned by somebody else; the demo user is "Amit Singh".
  seed.candidates = seed.candidates.map((c) => ({ ...c, owner: 'Neha Kulkarni' }));
  seed.demands = seed.demands.map((d) => ({ ...d, owner: 'Neha Kulkarni' }));
  seed.tasks = [
    { id: 't1', title: 'Theirs', owner: 'Neha Kulkarni', due: day(-1), status: 'Open' },
  ];
  // Enrichment plans carry an owner too — leaving one assigned to the demo user would mean the
  // user genuinely does own something, and the hint would correctly not appear.
  seed.enrichment = (seed.enrichment || []).map((e) => ({ ...e, owner: 'Neha Kulkarni' }));
  await boot(seed);
  assert.ok(
    allText(/Nothing is owned by a name matching yours/).length,
    'an empty queue must not read as "no work"',
  );
  cleanup();
});

test('the work queue counts only open demands', async () => {
  const seed = makeSeed();
  seed.demands = seed.demands.map((d) => ({ ...d, owner: 'Amit Singh' }));
  const openCount = seed.demands.filter((d) => d.status === 'Open').length;
  await boot(seed);
  const cell = [...document.querySelectorAll('.my-work-cell')].find((c) =>
    c.textContent.includes('My open demands'),
  );
  assert.equal(cell.querySelector('strong').textContent, String(openCount));
  cleanup();
});

test('the top-bar search still filters the candidate list it always did', async () => {
  await boot();
  await navTo('Candidates');
  await typeSearch('Databricks');
  await settle(2);
  // The shared query still drives the repository table underneath the dropdown.
  assert.ok(searchBox().value === 'Databricks');
  assert.ok(document.querySelectorAll('tbody tr').length >= 1, 'the list is filtered too');
  cleanup();
});
