import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PUBLIC_ROLE_FIELDS,
  DEFAULT_COUNTRY,
  employmentType,
  isRemote,
  isoDate,
  roleUrl,
  roleSummary,
  jobPostingJsonLd,
  jobListJsonLd,
  pageMeta,
  sitemapXml,
  publishedRoles,
} from '../src/jobPosting.js';
import { normalizeData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const role = (over = {}) => ({
  id: '20000000-0000-4000-8000-000000000001',
  title: 'Senior Databricks Architect',
  client: 'Meridian Technologies',
  location: 'Bengaluru',
  mode: 'Hybrid',
  engagementType: 'Permanent',
  positions: 2,
  description: 'Own the lakehouse platform for a large retail data estate.',
  skills: ['Databricks', 'Azure'],
  created: '2026-09-01',
  target: '2026-12-01',
  ...over,
});

const OPTS = { origin: 'https://careers.example', workspace: 'ws-1' };

test('the public field list matches what the database RPC actually returns', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/023_careers_seo.sql', import.meta.url),
    'utf8',
  );
  const signature = sql.slice(sql.indexOf('returns table ('), sql.indexOf('language sql'));
  const columns = [
    ...signature.matchAll(/^\s+"?([A-Za-z_]+)"?\s+(?:uuid|text|integer|date|text\[\])/gm),
  ].map((m) => m[1]);
  assert.deepEqual(
    columns,
    PUBLIC_ROLE_FIELDS,
    'src/jobPosting.js and migration 023 must agree on the public projection',
  );
  for (const secret of ['budget', 'weights', 'owner', 'approvalStatus', 'workspace_id', 'tags'])
    assert.ok(!columns.includes(secret), `${secret} is never exposed publicly`);
});

test('the emitted JSON-LD can only ever contain public information', () => {
  const internal = role({
    budget: 42,
    owner: 'Amit Singh',
    weights: { skills: 35 },
    approvalStatus: 'Approved',
    businessUnit: 'Data & AI',
    workspace_id: 'ws-secret',
    tags: ['High priority'],
  });
  const text = JSON.stringify(jobPostingJsonLd(internal, OPTS));
  for (const secret of ['42', 'Amit Singh', 'ws-secret', 'High priority', 'Data & AI', 'Approved'])
    assert.ok(!text.includes(secret), `"${secret}" must not reach a public page`);
});

test('a JobPosting carries the fields Google requires and omits what it cannot know', () => {
  const json = jobPostingJsonLd(role(), OPTS);
  assert.equal(json['@context'], 'https://schema.org/');
  assert.equal(json['@type'], 'JobPosting');
  assert.equal(json.title, 'Senior Databricks Architect');
  assert.equal(json.datePosted, '2026-09-01', 'datePosted is required by Google');
  assert.equal(json.validThrough, '2026-12-01', 'so a stale posting drops out of search');
  assert.equal(json.hiringOrganization.name, 'Meridian Technologies');
  assert.equal(json.jobLocation.address.addressLocality, 'Bengaluru');
  assert.equal(json.jobLocation.address.addressCountry, DEFAULT_COUNTRY);
  assert.equal(json.employmentType, 'FULL_TIME');
  assert.equal(json.totalJobOpenings, 2);
  assert.equal(json.identifier.value, role().id);
  assert.equal(json.directApply, true, 'applicants apply on our own page');
  assert.match(json.url, /^https:\/\/careers\.example\/careers\.html\?ws=ws-1&role=/);
  assert.equal(
    json.baseSalary,
    undefined,
    'salary is never asserted — a wrong figure in a rich result is worse than none',
  );
  assert.equal(json.jobLocationType, undefined, 'a hybrid role is not telecommute');
});

test('missing or unusable dates are omitted rather than invented', () => {
  const noDates = jobPostingJsonLd(role({ created: null, target: '' }), OPTS);
  assert.equal(noDates.datePosted, undefined);
  assert.equal(noDates.validThrough, undefined);
  assert.equal(jobPostingJsonLd(role({ created: 'not a date' }), OPTS).datePosted, undefined);
  assert.equal(isoDate('2026-09-01T10:30:00Z'), '2026-09-01', 'timestamps are narrowed to a date');
  assert.equal(isoDate(''), '');
  assert.equal(isoDate(null), '');
});

test('employment type is mapped, and never guessed when unrecorded', () => {
  assert.equal(employmentType(role({ engagementType: 'Contract' })), 'CONTRACTOR');
  assert.equal(employmentType(role({ engagementType: 'Contract to hire' })), 'CONTRACTOR');
  assert.equal(employmentType(role({ engagementType: 'Part time' })), 'PART_TIME');
  assert.equal(employmentType(role({ engagementType: 'Internship' })), 'INTERN');
  assert.equal(employmentType(role({ engagementType: 'Permanent' })), 'FULL_TIME');
  assert.equal(
    employmentType(role({ engagementType: 'Any' })),
    '',
    '"Any" means unrecorded — asserting FULL_TIME would be a lie to job seekers',
  );
  assert.equal(jobPostingJsonLd(role({ engagementType: 'Any' }), OPTS).employmentType, undefined);
});

test('a remote role is marked telecommute, as Google Jobs requires', () => {
  assert.equal(isRemote(role({ mode: 'Remote' })), true);
  assert.equal(isRemote(role({ mode: 'Hybrid' })), false);
  const json = jobPostingJsonLd(role({ mode: 'Remote' }), OPTS);
  assert.equal(json.jobLocationType, 'TELECOMMUTE');
  assert.equal(json.applicantLocationRequirements.name, DEFAULT_COUNTRY);
  assert.ok(json.jobLocation, 'the office city is still given, which Google accepts alongside');
});

test('a role with no usable data produces nothing rather than broken markup', () => {
  assert.equal(jobPostingJsonLd(null, OPTS), null);
  assert.equal(jobPostingJsonLd({ id: 'x' }, OPTS), null, 'a role with no title is not a posting');
  assert.equal(jobPostingJsonLd({ title: 'x' }, OPTS), null);
  assert.deepEqual(jobListJsonLd([{ id: 'x' }], OPTS).itemListElement, []);
});

test('the description falls back to a factual summary instead of an empty string', () => {
  assert.match(roleSummary(role()), /^Own the lakehouse/);
  assert.equal(
    roleSummary(role({ description: '' })),
    'Meridian Technologies · Bengaluru · Hybrid · 2 positions',
  );
  assert.equal(
    roleSummary(role({ description: '  \n  ' })),
    roleSummary(role({ description: '' })),
  );
  const long = roleSummary(role({ description: 'x'.repeat(500) }));
  assert.equal(long.length, 298, 'a very long description is truncated for a meta description');
  assert.ok(long.endsWith('…'));
  assert.equal(
    jobPostingJsonLd(
      role({ description: '', client: '', location: '', mode: '', positions: 0 }),
      OPTS,
    ).description,
    'Senior Databricks Architect',
    'there is always a description, because Google requires one',
  );
});

test('an item list numbers the postings for a listing page', () => {
  const list = jobListJsonLd([role(), role({ id: 'r2', title: 'Cloud Engineer' })], OPTS);
  assert.equal(list['@type'], 'ItemList');
  assert.equal(list.itemListElement.length, 2);
  assert.deepEqual(
    list.itemListElement.map((i) => i.position),
    [1, 2],
  );
  assert.equal(list.itemListElement[1].item.title, 'Cloud Engineer');
  assert.match(list.itemListElement[1].url, /role=r2/);
  assert.deepEqual(jobListJsonLd(null, OPTS).itemListElement, []);
});

test('each role gets its own canonical URL and page metadata', () => {
  assert.equal(
    roleUrl(role(), OPTS),
    `https://careers.example/careers.html?ws=ws-1&role=${role().id}`,
  );
  assert.equal(
    roleUrl(role(), {}),
    `/careers.html?role=${role().id}`,
    'a relative URL when no origin is known',
  );

  const listing = pageMeta(null, OPTS);
  assert.equal(listing.title, 'Open roles — AnthroPrime');
  assert.equal(listing.canonical, 'https://careers.example/careers.html?ws=ws-1');
  assert.equal(listing.ogType, 'website');

  const single = pageMeta(role(), OPTS);
  assert.equal(single.title, 'Senior Databricks Architect — Bengaluru · Hybrid | AnthroPrime');
  assert.match(single.description, /^Own the lakehouse/);
  assert.equal(single.canonical, roleUrl(role(), OPTS));
  assert.equal(single.ogType, 'article');
});

test('the sitemap lists the listing page and every published role', () => {
  const xml = sitemapXml(
    [role(), role({ id: 'r2', title: 'Cloud Engineer', created: '2026-08-02' })],
    OPTS,
  );
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url>/g) || []).length, 3, 'the listing plus two roles');
  assert.ok(xml.includes('<loc>https://careers.example/careers.html?ws=ws-1</loc>'));
  assert.ok(xml.includes('<lastmod>2026-08-02</lastmod>'));
  assert.ok(xml.trim().endsWith('</urlset>'));

  // A role with no created date simply has no lastmod, rather than a fabricated one.
  const undated = sitemapXml([role({ created: null })], OPTS);
  assert.equal((undated.match(/<lastmod>/g) || []).length, 0);

  // XML special characters in a title or id cannot break the document.
  const nasty = sitemapXml([role({ id: 'a&b<c>"d' })], OPTS);
  assert.ok(!nasty.includes('a&b<c>'), 'ampersands and angle brackets are escaped');
  assert.ok(nasty.includes('&amp;'));
});

test('only open, explicitly published roles are treated as public', () => {
  const data = normalizeData(makeSeed());
  const published = publishedRoles(data);
  assert.ok(
    published.every((d) => d.status === 'Open' && d.careersVisible === true),
    'the client-side rule matches the RPC exactly',
  );
  assert.equal(
    publishedRoles({
      demands: [
        { id: '1', status: 'Open', careersVisible: false },
        { id: '2', status: 'Closed', careersVisible: true },
        { id: '3', status: 'Open', careersVisible: true },
      ],
    })
      .map((d) => d.id)
      .join(),
    '3',
  );
  assert.deepEqual(publishedRoles(null), []);
});
