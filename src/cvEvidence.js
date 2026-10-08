export const CV_SECTIONS = ['employment', 'education', 'certifications', 'projects'];
const headings = {
  employment: /^(?:work|professional|employment|career)\s+(?:experience|history)$|^experience$/i,
  education: /^(?:education|academic(?: qualifications| background)?|qualifications)$/i,
  certifications:
    /^(?:certifications?|certificates?|licenses?(?: and certifications)?|professional certifications)$/i,
  projects: /^(?:(?:selected|personal|professional|key)\s+)?projects?$/i,
};
const otherHeading =
  /^(?:skills|technical skills|summary|profile|objective|achievements|awards|interests|languages|references|contact(?: details)?)$/i;

// Preserve cited lines; do not infer employers, qualifications, dates or credentials.
export function extractCvEvidence(text) {
  const items = [];
  let section = null,
    truncated = false;
  const lines = String(text || '')
    .replace(/\r/g, '')
    .slice(0, 40000)
    .split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    const heading = raw.replace(/[:：]\s*$/, '').trim();
    const matched = CV_SECTIONS.find((key) => headings[key].test(heading));
    if (matched) {
      section = matched;
      continue;
    }
    if (otherHeading.test(heading)) {
      section = null;
      continue;
    }
    if (!section || !raw) continue;
    if (items.length >= 16) {
      truncated = true;
      continue;
    }
    const evidence = raw.slice(0, 400);
    if (raw.length > 400) truncated = true;
    const period = (raw.match(
      /\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)\b/i,
    ) || [''])[0];
    const item = {
      section,
      label: evidence.replace(/^[•*-]\s*/, '').slice(0, 160),
      period,
      evidence,
      sourceLine: index + 1,
      reviewed: false,
    };
    if (!item.label.trim()) continue;
    if (new TextEncoder().encode(JSON.stringify([...items, item])).length > 9000) {
      truncated = true;
      continue;
    }
    items.push(item);
  }
  return { version: 1, items, truncated };
}

export function evidenceReady(value) {
  if (value?.items === undefined) return value?.records === undefined;
  return (
    Array.isArray(value.items) &&
    value.items.every(readableCvExcerpt) &&
    value.items.every((item) => item?.reviewed === true) &&
    (value.records === undefined ||
      (validateCvRecords(value) === '' &&
        value.records.every((record) => record.reviewed === true)))
  );
}

export function readableCvExcerpt(item) {
  return Boolean(
    item &&
      CV_SECTIONS.includes(item.section) &&
      ['label', 'period', 'evidence'].every((field) => typeof item[field] === 'string') &&
      Number.isInteger(item.sourceLine) &&
      item.sourceLine > 0,
  );
}

// Keep date errors editable, but never render fields from a malformed imported grouping.
export function readableCvRecords(value) {
  return (
    Array.isArray(value?.records) &&
    value.records.length <= 16 &&
    value.records.every(
      (record) =>
        record &&
        CV_SECTIONS.includes(record.section) &&
        ['label', 'organization', 'start', 'end'].every(
          (field) => typeof record[field] === 'string',
        ) &&
        typeof record.ongoing === 'boolean' &&
        typeof record.reviewed === 'boolean' &&
        Array.isArray(record.sourceLines) &&
        record.sourceLines.every(Number.isInteger),
    )
  );
}

// Begin with cited excerpts; grouping and unknown dates require explicit review.
export function groupCvEvidence(value) {
  return {
    ...value,
    records: (value.items || []).map((item) => ({
      section: item.section,
      label: item.label,
      organization: '',
      start: (item.period.match(/^(\d{4})/) || ['', ''])[1],
      end: (item.period.match(/[-–—]\s*(\d{4})$/) || ['', ''])[1],
      ongoing: /[-–—]\s*(present|current)$/i.test(item.period),
      sourceLines: [item.sourceLine],
      reviewed: false,
    })),
  };
}
export function mergeCvRecords(value, index) {
  const left = value.records?.[index],
    right = value.records?.[index + 1];
  if (!left || !right || left.section !== right.section) return value;
  return {
    ...value,
    records: value.records.flatMap((record, i) =>
      i === index
        ? [
            {
              ...left,
              sourceLines: [...new Set([...left.sourceLines, ...right.sourceLines])].sort(
                (a, b) => a - b,
              ),
              reviewed: false,
            },
          ]
        : i === index + 1
          ? []
          : [record],
    ),
  };
}
export function validateCvRecords(value) {
  if (!Array.isArray(value.records) || value.records.length > 16)
    return 'Use up to 16 cited records.';
  const date = (v) =>
    typeof v === 'string' &&
    (v === '' ||
      (/^(19|20)\d{2}(-(?:0[1-9]|1[0-2]))?(-(?:0[1-9]|[12]\d|3[01]))?$/.test(v) &&
        (v.length < 10 ||
          (!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v))));
  if (new TextEncoder().encode(JSON.stringify(value)).length > 24000)
    return 'CV evidence exceeds its size limit.';
  for (const r of value.records) {
    if (!r || typeof r !== 'object') return 'Each record must be an object.';
    if (
      !CV_SECTIONS.includes(r.section) ||
      typeof r.label !== 'string' ||
      !r.label.trim() ||
      r.label.length > 160 ||
      typeof r.organization !== 'string' ||
      r.organization.length > 160 ||
      typeof r.ongoing !== 'boolean' ||
      typeof r.reviewed !== 'boolean' ||
      !date(r.start) ||
      !date(r.end)
    )
      return 'Check record labels, organization and dates (YYYY, YYYY-MM or YYYY-MM-DD).';
    if (r.ongoing && r.end) return 'An ongoing record cannot have an end date.';
    if (r.start && r.end && r.start > r.end && !r.start.startsWith(r.end))
      return 'The end date must not precede the start date.';
    if (
      !Array.isArray(r.sourceLines) ||
      !r.sourceLines.length ||
      r.sourceLines.length > 16 ||
      new Set(r.sourceLines).size !== r.sourceLines.length ||
      r.sourceLines.some(
        (line) =>
          !Number.isInteger(line) ||
          !value.items?.some((item) => item.sourceLine === line && item.section === r.section),
      )
    )
      return 'Every record needs distinct cited lines from its section.';
  }
  return '';
}
export function duplicateCvRecords(value) {
  if (!readableCvRecords(value)) return [];
  const seen = new Set(),
    duplicates = [];
  for (const [index, r] of (value.records || []).entries()) {
    const key = [
      r.section,
      r.label.trim().toLowerCase(),
      r.organization.trim().toLowerCase(),
      r.start,
      r.end,
      r.ongoing,
    ].join('|');
    if (seen.has(key)) duplicates.push(index + 1);
    seen.add(key);
  }
  return duplicates;
}
