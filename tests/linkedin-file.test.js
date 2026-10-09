import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localLinkedinDraft,
  readLinkedinExport,
  LINKEDIN_EXPORT_LIMIT,
} from '../src/linkedinFile.js';
const profile = 'https://www.linkedin.com/in/mira-testcandidate';
const fixture = {
  format: 'anthro-linkedin-profile',
  version: 1,
  url: `${profile}/?isSelfProfile=true`,
  name: 'Mira Testcandidate',
  headline: 'Developer',
  company: 'Example Labs',
  location: 'Example City',
  about: 'Fictional professional summary.',
  sections: {
    experience: [['Developer', 'Example Labs', '2022–2026']],
    education: [['Example University', 'BTech', '2018–2022']],
    skills: [['React', '4 endorsements'], ['React', '4 endorsements'], ['Node.js']],
    licenses_and_certifications: [['Example Certification', 'Example Vendor']],
  },
  warnings: ['education: additional entries are collapsed; visible entries only'],
  raw_text: 'Unrelated person\nother@example.invalid\nphone 1234567890\nPython',
};
test('local export maps only professional fields, retains reviewable evidence and ignores unrelated raw content', () => {
  const result = localLinkedinDraft(JSON.stringify(fixture), 'mira-testcandidate');
  assert.equal(result.draft.linkedin, profile);
  assert.equal(result.draft.company, 'Example Labs');
  assert.equal(result.draft.email, '');
  assert.equal(result.draft.phone, '');
  assert.deepEqual(result.draft.skills, ['React', 'Node.js']);
  assert.ok(result.draft.cvEvidence.items.some((item) => item.section === 'employment'));
  assert.ok(result.draft.cvEvidence.items.every((item) => item.reviewed === false));
  assert.ok(!JSON.stringify(result).includes('other@example.invalid'));
  assert.match(result.warnings[0], /collapsed/);
});
test('original script format remains compatible and sections are optional', () => {
  const result = localLinkedinDraft(
    JSON.stringify({
      url: profile,
      name: 'Mira',
      experience: [['Developer']],
      education: [],
      skills: [['React']],
      certifications: [],
    }),
  );
  assert.equal(result.draft.name, 'Mira');
  assert.deepEqual(result.draft.skills, ['React']);
  assert.ok(result.warnings.some((warning) => warning.includes('no entries')));
});
test('invalid, conflicting, overlarge and wrong-profile exports fail closed', () => {
  for (const data of [
    [],
    {},
    { ...fixture, name: '' },
    { ...fixture, name: true },
    { ...fixture, version: 2 },
    { ...fixture, format: 'unrelated' },
    { ...fixture, experience: [] },
    { ...fixture, sections: { contacts: [['Other']] } },
    { ...fixture, sections: { skills: 'React' } },
    { ...fixture, sections: { education: Array(16).fill(['School']) } },
    { ...fixture, warnings: 'all good' },
    { ...fixture, requires_review: 'yes' },
    { ...fixture, headline: 'x'.repeat(255) },
    { ...fixture, sections: { skills: [[42]] } },
  ])
    assert.throws(() => localLinkedinDraft(JSON.stringify(data)));
  assert.throws(() => localLinkedinDraft(JSON.stringify(fixture), 'another-person'), /different/);
  assert.throws(() => localLinkedinDraft('not json'), /valid JSON/);
  assert.throws(() => localLinkedinDraft('x'.repeat(LINKEDIN_EXPORT_LIMIT + 1)), /200 KiB/);
});
test('session credentials and prototype fields cannot enter the import', () => {
  assert.equal(
    localLinkedinDraft(
      JSON.stringify({ ...fixture, about: 'Authorization: RBAC design and access control.' }),
    ).draft.summary,
    'Authorization: RBAC design and access control.',
  );
  for (const data of [
    { ...fixture, li_at: 'secret' },
    { ...fixture, sections: { experience: [{ cookies: 'secret' }] } },
    { ...fixture, raw_text: 'li_at=secret' },
    { ...fixture, about: 'Authorization: bearer secret' },
  ])
    assert.throws(() => localLinkedinDraft(JSON.stringify(data)), /[Cc]redential/);
  assert.throws(
    () => localLinkedinDraft('{"url":"' + profile + '","name":"Mira","__proto__":{}}'),
    /unsafe/,
  );
});
test('bounded evidence omissions are disclosed rather than silently accepted', () => {
  const result = localLinkedinDraft(
    JSON.stringify({
      ...fixture,
      sections: {
        education: Array.from({ length: 15 }, (_, index) => [
          `School ${index}`,
          'Qualification',
          '2018–2022',
        ]),
      },
    }),
  );
  assert.equal(result.draft.cvEvidence.truncated, true);
  assert.ok(result.warnings.some((warning) => warning.includes('bounded evidence')));
});
test('file boundary rejects wrong types and sizes before reading, supports BOM and surfaces read failures', async () => {
  for (const file of [
    { name: 'profile.html', size: 100 },
    { name: 'profile.json', size: 0 },
    { name: 'profile.json', size: LINKEDIN_EXPORT_LIMIT + 1 },
  ])
    await assert.rejects(
      readLinkedinExport({ ...file, text: () => assert.fail('Must not read rejected file') }),
    );
  const result = await readLinkedinExport(
    { name: 'profile.JSON', size: 500, text: async () => '\uFEFF' + JSON.stringify(fixture) },
    profile,
  );
  assert.equal(result.draft.name, 'Mira Testcandidate');
  await assert.rejects(
    readLinkedinExport({
      name: 'profile.json',
      size: 100,
      text: async () => {
        throw new Error('disk unavailable');
      },
    }),
    /disk unavailable/,
  );
});
