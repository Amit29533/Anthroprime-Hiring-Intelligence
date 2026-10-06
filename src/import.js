import Papa from 'papaparse';
import { anthroIdFor, candidateIdFromAnthroId } from './anthroId.js';
import { duplicate, skillList, today, uid, validateCandidate } from './domain.js';
import { ENGAGEMENT_TYPES } from './taxonomy.js';
export const IMPORT_FIELDS = [
  'anthroId',
  'name',
  'email',
  'phone',
  'title',
  'company',
  'location',
  'experience',
  'relevantExperience',
  'notice',
  'current',
  'expected',
  'skills',
  'mode',
  'status',
  'source',
  'engagement',
];

function countLineBreaks(text, start, end) {
  let count = 0;
  for (let index = start; index < end; index++) {
    if (text[index] === '\r') {
      count++;
      if (text[index + 1] === '\n' && index + 1 < end) index++;
    } else if (text[index] === '\n') {
      count++;
    }
  }
  return count;
}

function sourceRowNumbers(text, delimiter) {
  const rows = [];
  let firstRecord = true;
  let previousCursor = 0;
  let linesBeforeCursor = 0;
  Papa.parse(text, {
    header: false,
    delimiter,
    skipEmptyLines: false,
    step: ({ data, meta }) => {
      const cursor = meta.cursor ?? previousCursor;
      if (firstRecord) {
        firstRecord = false;
        linesBeforeCursor += countLineBreaks(text, previousCursor, cursor);
      } else {
        const values = Array.isArray(data) ? data : [];
        const isBlank = values.every((value) => String(value ?? '').trim() === '');
        if (!isBlank) rows.push(linesBeforeCursor + 1);
        linesBeforeCursor += countLineBreaks(text, previousCursor, cursor);
      }
      previousCursor = cursor;
    },
  });
  return rows;
}

export function readCSV(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
  });
  if (result.errors.length) throw new Error(`CSV error: ${result.errors[0].message}`);
  if (result.data.length > 5000)
    throw new Error('Import up to 5,000 rows per file. Split larger files into smaller batches.');
  if (!result.meta.fields?.length || !result.data.length)
    throw new Error('Include a header row and at least one candidate.');
  return {
    rows: result.data,
    headers: result.meta.fields,
    rowNumbers: sourceRowNumbers(text, result.meta.delimiter),
  };
}

export function previewImport(raw, mapping, existing, rowNumbers = []) {
  const accepted = [];
  return raw.map((row, index) => {
    const c = Object.fromEntries(
      IMPORT_FIELDS.map((field) => [field, String(row[mapping[field]] ?? '').trim()]),
    );
    const suppliedAnthroId = c.anthroId;
    c.id = uid();
    c.anthroId = anthroIdFor(c);
    c.skills = skillList(c.skills);
    c.skillsDetail = [];
    c.created = today();
    c.verified = today();
    c.owner = 'Recruiter';
    c.summary = '';
    c.linkedin = '';
    c.source = c.source || 'CSV import';
    c.status = c.status || 'Assessing';
    c.mode = c.mode || 'Flexible';
    c.email = c.email.toLowerCase();
    c.engagement = c.engagement || '';
    c.earliestStart = null;
    c.activeStatus = 'Active';
    for (const key of ['experience', 'relevantExperience', 'notice', 'current', 'expected'])
      c[key] = c[key] === '' ? null : Number(c[key]);
    let error = validateCandidate(c);
    if (suppliedAnthroId) {
      const knownId = candidateIdFromAnthroId(suppliedAnthroId, existing);
      const known = existing.find(
        (p) =>
          p.id === knownId ||
          (p.anthroAliases || []).some(
            (alias) => alias.toUpperCase() === suppliedAnthroId.toUpperCase(),
          ),
      );
      error = known
        ? `Duplicate of ${known.name} (${anthroIdFor(known)}); skipped.`
        : 'Anthro-ID is assigned automatically. Leave it blank for a new candidate; supplied ID was not found in this workspace.';
    }
    if (!error && !['Ready', 'Near-ready', 'Assessing', 'Unavailable'].includes(c.status))
      error = 'Status must be Ready, Near-ready, Assessing or Unavailable.';
    if (!error && !['Remote', 'Hybrid', 'Onsite', 'Flexible'].includes(c.mode))
      error = 'Mode must be Remote, Hybrid, Onsite or Flexible.';
    if (!error && c.engagement && !ENGAGEMENT_TYPES.includes(c.engagement))
      error = `Engagement must be one of: ${ENGAGEMENT_TYPES.join(', ')}.`;
    const dupe = duplicate(c, [...existing, ...accepted]);
    if (!error && dupe) error = `Duplicate of ${dupe.name}; skipped.`;
    if (!error) accepted.push(c);
    return { row: rowNumbers[index] ?? index + 2, candidate: c, error };
  });
}

// Review validity is row-specific. Comparing only the valid-row count misses an equal-count
// swap when the repository changes while an import modal is open.
export function sameImportReview(previous, refreshed) {
  if (!Array.isArray(previous) || !Array.isArray(refreshed) || previous.length !== refreshed.length)
    return false;
  return previous.every(
    (entry, index) =>
      entry.row === refreshed[index].row && (entry.error || '') === (refreshed[index].error || ''),
  );
}
