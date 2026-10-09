import { linkedinProfile } from './linkedin.js';
import { extractCvEvidence } from './cvEvidence.js';

export const LINKEDIN_EXPORT_LIMIT = 200 * 1024;
const fields = new Set([
  'format',
  'version',
  'url',
  'name',
  'headline',
  'company',
  'location',
  'about',
  'experience',
  'education',
  'skills',
  'certifications',
  'sections',
  'raw_text',
  'warnings',
  'requires_review',
  'completeness',
]);
const sectionNames = ['experience', 'education', 'skills', 'licenses_and_certifications'];
const secretKey =
  /^(?:li_at|jsessionid|cookies?|tokens?|access_token|authorization|password|session)$/i;
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function string(value, field, max = 254) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Export ${field} must be text of at most ${max} characters.`);
  if (
    Array.from(value).some((char) => {
      const code = char.codePointAt(0);
      return code < 32 && ![9, 10, 13].includes(code);
    })
  )
    throw new Error(`Export ${field} contains invalid control characters.`);
  if (/\b(?:li_at|JSESSIONID|Authorization)\s*[:=]/i.test(value))
    throw new Error(
      'This export may contain session credentials. Remove them locally before importing.',
    );
  return value.trim();
}
function noSecrets(value) {
  const stack = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop();
    if (item.depth > 6) throw new Error('The export structure is too deeply nested.');
    if (!item.value || typeof item.value !== 'object') continue;
    for (const [key, child] of Object.entries(item.value)) {
      if (secretKey.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('Credential or unsafe fields are not allowed in a profile export.');
      stack.push({ value: child, depth: item.depth + 1 });
    }
  }
}
function section(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 15)
    throw new Error(`Export ${name} must contain at most 15 entries.`);
  const seen = new Set();
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length > 40)
      throw new Error(`Export ${name} entries must contain at most 40 text lines.`);
    const lines = entry.map((line) => string(line, name, 2000)).filter(Boolean);
    const key = JSON.stringify(lines);
    if (!lines.length || seen.has(key)) return [];
    seen.add(key);
    return [lines];
  });
}
export function localLinkedinDraft(input, expectedProfile = '') {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > LINKEDIN_EXPORT_LIMIT)
    throw new Error('Choose a LinkedIn JSON export of at most 200 KiB.');
  let data;
  try {
    data = JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('This file is not valid JSON. Export the profile again.');
  }
  if (!object(data)) throw new Error('The export must contain one profile object.');
  noSecrets(data);
  if (Object.keys(data).some((key) => !fields.has(key)))
    throw new Error('Unrecognized export fields. Use the downloadable LinkedIn extractor.');
  if (
    (data.format !== undefined && data.format !== 'anthro-linkedin-profile') ||
    (data.version !== undefined && data.version !== 1)
  )
    throw new Error('Unsupported LinkedIn export version. Use the current extractor.');
  const profile = linkedinProfile(string(data.url, 'URL', 500));
  if (expectedProfile.trim() && linkedinProfile(expectedProfile) !== profile)
    throw new Error('The export belongs to a different LinkedIn profile. Check the URL and file.');
  const name = string(data.name, 'name');
  if (!name) throw new Error('The export has no profile name. Extract the profile again.');
  const modern = data.sections !== undefined;
  if (
    modern &&
    (!object(data.sections) ||
      Object.keys(data.sections).some((key) => !sectionNames.includes(key)))
  )
    throw new Error('Unrecognized export sections.');
  if (
    modern &&
    ['experience', 'education', 'skills', 'certifications'].some((key) => data[key] !== undefined)
  )
    throw new Error('The export contains conflicting section formats. Export the profile again.');
  const source = modern
    ? data.sections
    : {
        experience: data.experience,
        education: data.education,
        skills: data.skills,
        licenses_and_certifications: data.certifications,
      };
  const sections = Object.fromEntries(sectionNames.map((key) => [key, section(source[key], key)]));
  const warnings = data.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.length > 30)
    throw new Error('Export warnings must contain at most 30 messages.');
  const notes = warnings.map((value) => string(value, 'warning', 400));
  const about = string(data.about, 'About', 10000);
  // Validate raw text, but never use it to infer contacts, skills, or identity.
  // It may contain recommendations or activity from older extractor versions.
  string(data.raw_text, 'raw text', 50000);
  const completeness = string(data.completeness, 'completeness', 400);
  if (data.requires_review !== undefined && typeof data.requires_review !== 'boolean')
    throw new Error('Export requires_review must be a boolean.');
  for (const key of sectionNames)
    if (!sections[key].length)
      notes.push(
        `${key.replaceAll('_', ' ')}: no entries captured; this does not prove the section is empty.`,
      );
  const evidenceText = [
    ['Work experience', sections.experience],
    ['Education', sections.education],
    ['Certifications', sections.licenses_and_certifications],
  ]
    .flatMap(([heading, entries]) =>
      entries.length ? [heading, ...entries.map((lines) => lines.join('\n'))] : [],
    )
    .join('\n\n');
  if (evidenceText.length > 50000)
    throw new Error('Profile sections are too large. Export fewer entries.');
  const evidence = extractCvEvidence(evidenceText);
  if (evidence.truncated)
    notes.push('Only bounded evidence excerpts will be saved. Check the export for omitted lines.');
  return {
    draft: {
      name,
      title: string(data.headline, 'headline'),
      company: string(data.company, 'company'),
      location: string(data.location, 'location'),
      summary: about,
      linkedin: profile,
      email: '',
      phone: '',
      skills: [...new Set(sections.skills.map((lines) => lines[0]))],
      cvEvidence: evidence,
    },
    provider: 'Local LinkedIn export',
    lookedUpAt: new Date().toISOString(),
    warnings: [...new Set(notes)],
    completeness: completeness || 'Visible sections only; completeness is not guaranteed.',
    evidenceText,
  };
}

export async function readLinkedinExport(file, expectedProfile = '') {
  if (
    !file ||
    !/\.json$/i.test(file.name) ||
    !Number.isInteger(file.size) ||
    file.size <= 0 ||
    file.size > LINKEDIN_EXPORT_LIMIT
  )
    throw new Error('Choose a nonempty .json profile export of at most 200 KiB.');
  let timer;
  let reader;
  try {
    const reading =
      typeof file.text === 'function'
        ? file.text()
        : new Promise((resolve, reject) => {
            reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(new Error('The export file could not be read. Choose it again.'));
            reader.readAsText(file);
          });
    const text = await Promise.race([
      reading,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reader?.abort();
          reject(new Error('Reading the export timed out. Choose it again.'));
        }, 10000);
      }),
    ]);
    return localLinkedinDraft(text, expectedProfile);
  } finally {
    clearTimeout(timer);
  }
}
