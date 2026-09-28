import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { matchCandidate, skillList, canonical } from '../src/domain.js';
import { setCustomTaxonomy, customTaxonomy, scanSkills } from '../src/taxonomy.js';
import {
  parseCVText,
  classifyFile,
  extractText,
  buildDocumentRecord,
  docxText,
  MAX_DOCX_XML_BYTES,
} from '../src/documents.js';
import { duplicatePairs, mergePreview, MERGE_FIELDS, MERGE_FOLLOW_TABLES } from '../src/dedupe.js';
import { deriveGaps } from '../src/gaps.js';
import { changesSince } from '../src/sync.js';
import { makeSeed } from '../src/seed.js';

const data = makeSeed(),
  candidate = data.candidates[0],
  demand = data.demands[0];

function localDocxEntry(compressed, uncompressedSize) {
  const name = new TextEncoder().encode('word/document.xml');
  const bytes = new Uint8Array(30 + name.length + compressed.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, 8, true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, uncompressedSize, true);
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);
  bytes.set(compressed, 30 + name.length);
  return bytes;
}

function compressedDocx(xml) {
  const source = new TextEncoder().encode(xml);
  return localDocxEntry(deflateRawSync(source), source.length);
}

test('workspace taxonomy extensions participate in canonicalization and scanning', () => {
  setCustomTaxonomy({
    skills: ['Apache Iceberg'],
    aliases: { iceberg: 'Apache Iceberg' },
    domains: { 'Apache Iceberg': 'Data platform' },
  });
  try {
    assert.equal(canonical('iceberg'), 'Apache Iceberg');
    assert.equal(canonical('Apache Iceberg'), 'Apache Iceberg');
    assert.deepEqual(
      scanSkills('Need Iceberg and Spark folks'),
      ['Apache Iceberg', 'Apache Spark'],
      'longer terms scan first',
    );
    assert.deepEqual(skillList('iceberg, Iceberg, PYSPARK'), ['Apache Iceberg', 'Apache Spark']);
  } finally {
    setCustomTaxonomy({});
  }
  assert.equal(canonical('iceberg'), 'iceberg', 'reset restores base vocabulary');
  assert.equal(customTaxonomy().skills.length, 0);
});

test('CV parser extracts contact, title, years and skills from plain text', () => {
  const text = `Priya Sample\nDatabricks Consultant at Accenture\npriya.sample@example.com  +91 98765 43210\nhttps://www.linkedin.com/in/priya-sample\n7+ years of experience. Skilled in Pyspark, Azure and Genie.`;
  const p = parseCVText(text);
  assert.equal(p.name, 'Priya Sample');
  assert.equal(p.email, 'priya.sample@example.com');
  assert.ok(p.phone.replace(/\D/g, '').length >= 7);
  assert.equal(p.linkedin, 'https://www.linkedin.com/in/priya-sample');
  assert.equal(p.experience, 7);
  assert.ok(p.skills.includes('Apache Spark'), 'pyspark alias normalized');
  assert.ok(p.skills.includes('Databricks Genie'));
  assert.ok(p.skills.includes('Azure'));
});

test('parser stays safe on empty or noisy input', () => {
  const p = parseCVText('   ');
  assert.equal(p.name, '');
  assert.equal(p.email, '');
  assert.deepEqual(p.skills, []);
  const junk = parseCVText('!!! ??? ###');
  assert.equal(junk.name, '');
});

test('file classification enforces the allowlist and size cap', () => {
  assert.equal(classifyFile({ name: 'cv.pdf', size: 1000 }).ok, true);
  assert.equal(classifyFile({ name: 'resume.DOCX', size: 1000 }).ok, true);
  assert.equal(classifyFile({ name: 'virus.exe', size: 1000 }).error.includes('PDF, DOCX'), true);
  assert.equal(
    classifyFile({ name: 'big.pdf', size: 6 * 1024 * 1024 }).error.includes('smaller than 5 MB'),
    true,
  );
  assert.equal(classifyFile({ name: 'empty.pdf', size: 0 }).ok, false);
});

test('text extraction covers txt natively and DOCX through the zip reader', async () => {
  assert.equal(
    (await extractText(new TextEncoder().encode('hello world'), 'txt')).trim(),
    'hello world',
  );
  const emptyDocx = new Uint8Array([1, 2, 3, 4]);
  assert.equal(await extractText(emptyDocx, 'docx'), '');
  const rec = buildDocumentRecord({
    file: { name: 'My CV.pdf', size: 10 },
    ext: 'pdf',
    hash: 'abc',
    extracted: '',
  });
  assert.match(rec.storagePath, /^[0-9a-f-]+\/My_CV\.pdf$/);
  assert.equal(rec.kind, 'CV');
  assert.equal(rec.parserStatus, 'manual');
  const parsed = buildDocumentRecord({
    file: { name: 'a.txt', size: 5 },
    ext: 'txt',
    hash: '',
    extracted: 'x',
  });
  assert.equal(parsed.parserStatus, 'parsed');
});

test('DOCX extraction bounds inflated XML and treats corrupt entries as manual-review input', async () => {
  const regular = compressedDocx(
    '<w:document><w:p><w:r><w:t>Ada Lovelace</w:t></w:r></w:p></w:document>',
  );
  assert.equal(await docxText(regular), 'Ada Lovelace');

  const oversized = compressedDocx(
    `<w:document>${'x'.repeat(MAX_DOCX_XML_BYTES * 2)}</w:document>`,
  );
  assert.equal(await docxText(oversized), '', 'expanded content over the cap is not parsed');

  const malformed = localDocxEntry(new Uint8Array([0xff, 0x00, 0x7f]), 20);
  assert.equal(await docxText(malformed), '', 'corrupt compressed content falls back safely');
});

test('probable duplicates include hard and fuzzy pairs, skipping merged rows', () => {
  const list = [
    {
      id: '1',
      name: 'Same Person',
      email: 'a@x.com',
      phone: '',
      linkedin: '',
      company: 'Corp',
      location: 'Pune',
      mergedInto: null,
    },
    {
      id: '2',
      name: 'same person',
      email: 'b@x.com',
      phone: '',
      linkedin: '',
      company: 'Corp',
      location: 'Pune',
      mergedInto: null,
    },
    {
      id: '3',
      name: 'Other',
      email: 'a@x.com',
      phone: '',
      linkedin: '',
      company: '',
      location: '',
      mergedInto: null,
    },
    {
      id: '4',
      name: 'Hidden',
      email: 'h@x.com',
      phone: '',
      linkedin: '',
      company: '',
      location: '',
      mergedInto: '1',
    },
  ];
  const pairs = duplicatePairs(list);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.some((p) => p.reason === 'Same name and employer'));
  assert.ok(pairs.some((p) => p.reason === 'Same email'));
});

test('merge preview combines fields by pick, unions skills, keeps stronger evidence', () => {
  const a = {
    ...candidate,
    id: 'a',
    name: 'A Person',
    company: '',
    expected: 40,
    skills: ['Python', 'SQL'],
    skillsDetail: [{ skill: 'SQL', proficiency: 'Working', validated: false }],
    email: 'a@x.com',
  };
  const b = {
    ...candidate,
    id: 'b',
    name: 'B Person',
    company: 'NewCo',
    expected: 44,
    notice: 10,
    skills: ['SQL', 'Databricks'],
    skillsDetail: [{ skill: 'SQL', proficiency: 'Advanced', validated: true }],
    email: 'b@x.com',
  };
  const auto = mergePreview({ candidates: [a, b] }, 'a', 'b', {});
  assert.equal(auto.company, 'NewCo', 'empty-winner fields fall back to B');
  assert.equal(auto.expected, 40, 'A kept by default');
  assert.equal(auto.name, 'A Person');
  assert.deepEqual(auto.skills, ['Python', 'SQL', 'Databricks']);
  const sql = auto.skillsDetail.find((r) => r.skill === 'SQL');
  assert.equal(sql.proficiency, 'Advanced', 'stronger evidence row wins');
  const picked = mergePreview({ candidates: [a, b] }, 'a', 'b', { expected: 'b', name: 'b' });
  assert.equal(picked.expected, 44);
  assert.equal(picked.name, 'B Person');
  assert.ok(MERGE_FIELDS.includes('linkedin'));
  assert.ok(MERGE_FOLLOW_TABLES.includes('documents'));
});

test('gap map classifies critical, trainable and contextual with derived status', () => {
  const c = {
    ...candidate,
    skills: ['Databricks', 'Unity Catalog', 'Azure', 'SQL'],
    skillsDetail: [
      { skill: 'Databricks', proficiency: 'Working', validated: true, lastUsed: '2026-08' },
      { skill: 'Unity Catalog', proficiency: 'Exposure', validated: false, lastUsed: '2026-08' },
      { skill: 'Azure', proficiency: 'Proficient', validated: true, lastUsed: '2024-01' },
    ],
  };
  const d = {
    ...demand,
    skills: ['Databricks', 'Unity Catalog', 'Azure', 'Databricks Genie'],
    minProficiency: 'Proficient',
  };
  const m = matchCandidate(c, d, []);
  const gaps = deriveGaps(c, d, m, { assessments: [], enrichment: [] });
  const by = Object.fromEntries(gaps.map((g) => [g.skill, g]));
  assert.equal(by['Databricks Genie'].severity, 'critical');
  assert.equal(by['Unity Catalog'].severity, 'trainable');
  assert.equal(
    by['Databricks'].severity,
    'trainable',
    'present but below the required proficiency',
  );
  assert.equal(
    by['Azure'].severity,
    'contextual',
    'passing proficiency but stale last-used evidence',
  );
  const planned = deriveGaps(c, d, m, {
    assessments: [],
    enrichment: [
      { candidateId: c.id, demandId: d.id, gapSkill: 'Databricks Genie', status: 'In progress' },
    ],
  });
  assert.equal(planned.find((g) => g.skill === 'Databricks Genie').status, 'Enrichment planned');
  const closed = deriveGaps(c, d, m, {
    assessments: [
      {
        candidateId: c.id,
        skill: 'Databricks Genie',
        demandId: d.id,
        date: new Date().toISOString().slice(0, 10),
      },
    ],
    enrichment: [],
  });
  assert.equal(closed.find((g) => g.skill === 'Databricks Genie').status, 'Closed');
});

test('changesSince returns only rows touched on or after the day', () => {
  const snap = {
    candidates: [
      { id: '1', verified: '2026-09-26' },
      { id: '2', verified: '2026-09-27' },
      { id: '3', verified: '2026-09-20' },
    ],
    notes: [
      { id: 'n1', date: '2026-09-27T10:00:00Z' },
      { id: 'n2', date: '2026-09-01T10:00:00Z' },
    ],
    emptyNotInSchemaIgnore: undefined,
  };
  const out = changesSince(snap, '2026-09-27');
  assert.deepEqual(
    out.candidates.map((c) => c.id),
    ['2'],
  );
  assert.deepEqual(
    out.notes.map((n) => n.id),
    ['n1'],
  );
  const all = changesSince(snap, '2026-09-01');
  assert.equal(all.candidates.length, 3);
});
