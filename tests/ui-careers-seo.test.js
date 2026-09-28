// The careers page must publish correct schema.org markup and per-role URLs, and must never
// leak an internal field into <head> where a crawler would read it.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, createHarness } from './ui-harness.js';
import { allText } from './ui-drivers.js';
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
afterEach(() => {
  cleanup();
  document.head.querySelectorAll('[data-careers-seo]').forEach((n) => n.remove());
  history.pushState({}, '', '/careers.html');
});

const seoTag = (key) => document.head.querySelector(`[data-careers-seo="${key}"]`);
const jsonLd = () => JSON.parse(seoTag('jsonld')?.textContent || 'null');

const published = () => normalizeData(makeSeed()).demands.filter((d) => d.careersVisible === true);

async function careers(search = '') {
  localStorage.removeItem('ecod-demo-v1');
  history.pushState({}, '', `/careers.html${search}`);
  await mount(M.CareersApp, {});
  await settle(6);
}

test('the listing page publishes an ItemList of every open role', async () => {
  await careers();
  const json = jsonLd();
  assert.ok(json, 'structured data was injected');
  assert.equal(json['@type'], 'ItemList');
  assert.ok(json.itemListElement.length >= 1, 'the seeded published roles are listed');
  assert.equal(json.itemListElement[0].item['@type'], 'JobPosting');
  assert.equal(document.title, 'Open roles — AnthroPrime');
  assert.ok(seoTag('canonical'), 'a canonical URL is declared');
  assert.equal(seoTag('robots').getAttribute('content'), 'index, follow');
  assert.ok(seoTag('og:title'), 'Open Graph tags are present for link previews');
  cleanup();
});

test('a role deep link renders that role alone with its own JobPosting and title', async () => {
  const role = published()[0];
  await careers(`?role=${role.id}`);
  const json = jsonLd();
  assert.equal(json['@type'], 'JobPosting', 'a single posting, not a list');
  assert.equal(json.title, role.title);
  assert.equal(json.hiringOrganization.name, role.client);
  assert.ok(json.datePosted, 'Google requires datePosted');
  assert.ok(document.title.startsWith(role.title), 'the tab title is the role');
  assert.match(seoTag('canonical').getAttribute('href'), new RegExp(`role=${role.id}`));
  assert.ok(screen.getByText('← All open roles'), 'there is a way back to the listing');
  cleanup();
});

test('a deep link to an unpublished role falls back to the listing instead of a dead page', async () => {
  await careers('?role=00000000-0000-4000-8000-0000000000ff');
  await settle(4);
  assert.equal(jsonLd()['@type'], 'ItemList', 'the page recovers to the full listing');
  assert.equal(document.title, 'Open roles — AnthroPrime');
  cleanup();
});

test('no internal field ever reaches the page head', async () => {
  await careers();
  const head = document.head.innerHTML;
  const role = published()[0];
  for (const secret of [
    String(role.budget),
    role.owner,
    'careersVisible',
    'weights',
    'approvalStatus',
    'workspace_id',
  ]) {
    if (!secret) continue;
    assert.ok(!head.includes(secret), `"${secret}" must not appear in <head>`);
  }
  const json = JSON.stringify(jsonLd());
  assert.ok(!json.includes('budget'), 'the posting carries no commercial data');
  cleanup();
});

test('switching between roles replaces the markup rather than stacking it', async () => {
  await careers();
  assert.equal(document.head.querySelectorAll('[data-careers-seo="jsonld"]').length, 1);
  const role = published()[0];
  const link = [...document.querySelectorAll('.careers-role-head a')].find((a) =>
    a.textContent.includes(role.title),
  );
  assert.ok(link, 'each role title is a permalink');
  link.click();
  await settle(4);
  assert.equal(
    document.head.querySelectorAll('[data-careers-seo="jsonld"]').length,
    1,
    'exactly one JSON-LD block at any time',
  );
  assert.equal(jsonLd()['@type'], 'JobPosting');
  assert.match(location.search, new RegExp(`role=${role.id}`), 'the URL is a shareable permalink');
  cleanup();
});

test('the settings panel reports what is published and builds a sitemap', async () => {
  const data = normalizeData(makeSeed());
  const harness = createHarness(data);
  const files = [];
  await mount(M.CareersSeoPanel, {
    data,
    workspace: 'ws-123',
    origin: 'https://jobs.example',
    notify: (m) => harness.state.toasts.push(m),
    download: (content, name, type) => files.push({ content, name, type }),
  });
  await settle(2);
  assert.ok(
    screen.getByText('https://jobs.example/careers.html?ws=ws-123'),
    'the real URL is shown',
  );
  assert.ok(allText(/Careers page & search visibility/).length);

  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Download sitemap.xml'),
  );
  assert.ok(button, 'the sitemap control is available');
  button.click();
  await settle(2);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'sitemap.xml');
  assert.equal(files[0].type, 'application/xml;charset=utf-8');
  assert.match(files[0].content, /<urlset/);
  assert.match(files[0].content, /ws=ws-123&amp;role=/, 'role URLs are included and escaped');
  assert.equal(
    (files[0].content.match(/<url>/g) || []).length,
    published().length + 1,
    'the listing plus every published role',
  );
  cleanup();
});

test('the sitemap control is unavailable when nothing is published', async () => {
  const data = normalizeData(makeSeed());
  data.demands = data.demands.map((d) => ({ ...d, careersVisible: false }));
  await mount(M.CareersSeoPanel, { data, workspace: 'ws-123', origin: 'https://jobs.example' });
  await settle(2);
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Download sitemap.xml'),
  );
  assert.equal(button.disabled, true, 'there is nothing to put in a sitemap');
  assert.ok(allText(/No roles are published yet/).length, 'and the panel says so');
  cleanup();
});
