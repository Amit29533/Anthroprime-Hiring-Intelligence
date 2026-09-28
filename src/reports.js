// Custom report builder (Zoho Recruit K2, blueprint §17).
//
// A report is a *definition* — entity, filters, grouping, measure — evaluated against the data
// already in memory. Nothing is cached, because a stale number is worse than no number.
//
// Two rules run through the whole module:
//   1. Permissions are applied where the data is read, not where it is saved. A report shared by
//      an admin renders through the reader's own permissions, so a recruiter opening it can never
//      see admin-only commercials. `FIELDS` marks those fields `adminOnly`.
//   2. A measure with no denominator returns `null`, never 0 or 100%. An empty average is "no
//      data", and the UI must say so rather than draw a zero.

export const OPERATORS = {
  is: { label: 'is', types: ['text', 'enum', 'number', 'date', 'boolean'] },
  'is not': { label: 'is not', types: ['text', 'enum', 'number', 'date', 'boolean'] },
  contains: { label: 'contains', types: ['text', 'list'] },
  'is any of': { label: 'is any of', types: ['enum', 'list'] },
  'is empty': { label: 'is empty', types: ['text', 'enum', 'list', 'date'] },
  'is not empty': { label: 'is not empty', types: ['text', 'enum', 'list', 'date'] },
  '>': { label: 'greater than', types: ['number', 'date'] },
  '<': { label: 'less than', types: ['number', 'date'] },
  'in the last': { label: 'in the last (days)', types: ['date'] },
};

const field = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

/**
 * The reportable surface. Deliberately a curated allowlist rather than "every column": a report
 * builder that can reach any field is also a data-exfiltration tool, and free-text notes,
 * document hashes and portal tokens have no business in a grouped report.
 */
export const FIELDS = {
  candidates: [
    field('name', 'Name', 'text'),
    field('title', 'Current title', 'text'),
    field('status', 'Status', 'enum'),
    field('source', 'Source', 'enum'),
    field('location', 'Location', 'enum'),
    field('experience', 'Years of experience', 'number'),
    field('noticePeriod', 'Notice period (days)', 'number'),
    field('skills', 'Skills', 'list'),
    field('created', 'Added on', 'date'),
    field('verified', 'Last verified', 'date'),
    field('expectedCtc', 'Expected CTC', 'number', { adminOnly: true }),
  ],
  demands: [
    field('title', 'Role title', 'text'),
    field('client', 'Client', 'enum'),
    field('businessUnit', 'Business unit', 'enum'),
    field('status', 'Status', 'enum'),
    field('priority', 'Priority', 'enum'),
    field('approvalStatus', 'Approval status', 'enum'),
    field('location', 'Location', 'enum'),
    field('mode', 'Work mode', 'enum'),
    field('engagementType', 'Engagement', 'enum'),
    field('positions', 'Open positions', 'number'),
    field('minExperience', 'Minimum experience', 'number'),
    field('skills', 'Must-have skills', 'list'),
    field('created', 'Raised on', 'date'),
    field('target', 'Target start', 'date'),
    field('budget', 'Budget (LPA)', 'number', { adminOnly: true }),
  ],
  submissions: [
    field('clientStatus', 'Client decision', 'enum'),
    field('submittedOn', 'Submitted on', 'date'),
    field('submittedBy', 'Submitted by', 'enum'),
  ],
  interviews: [
    field('stage', 'Stage', 'enum'),
    field('status', 'Status', 'enum'),
    field('mode', 'Mode', 'enum'),
    field('outcome', 'Outcome', 'enum'),
    field('scheduledAt', 'Scheduled for', 'date'),
    field('score', 'Score', 'number'),
  ],
  offers: [
    field('status', 'Status', 'enum'),
    field('role', 'Role', 'text'),
    field('location', 'Location', 'enum'),
    field('sentDate', 'Sent on', 'date'),
    field('joining', 'Joining date', 'date'),
    field('ctc', 'CTC', 'number', { adminOnly: true }),
  ],
  considerations: [
    field('stage', 'Pipeline stage', 'enum'),
    field('created', 'Shortlisted on', 'date'),
    field('score', 'Match score', 'number'),
  ],
  clients: [
    field('name', 'Client', 'text'),
    field('status', 'Status', 'enum'),
    field('tier', 'Tier', 'enum'),
    field('industry', 'Industry', 'enum'),
    field('location', 'Location', 'enum'),
    field('owner', 'Account owner', 'enum'),
    field('created', 'Added on', 'date'),
  ],
};

export const ENTITIES = Object.keys(FIELDS);
export const ENTITY_LABELS = {
  candidates: 'Candidates',
  demands: 'Demands',
  submissions: 'Submissions',
  interviews: 'Interviews',
  offers: 'Offers',
  considerations: 'Pipeline entries',
  clients: 'Clients',
};

export const MEASURES = {
  count: { label: 'Count of records', needsField: false },
  sum: { label: 'Sum of', needsField: true },
  average: { label: 'Average of', needsField: true },
  min: { label: 'Minimum of', needsField: true },
  max: { label: 'Maximum of', needsField: true },
  'distinct count': { label: 'Distinct values of', needsField: true },
};

/** Fields this reader is allowed to report on. Applied at read time, never at save time. */
export function fieldsFor(entity, { isAdmin = false } = {}) {
  return (FIELDS[entity] || []).filter((f) => !f.adminOnly || isAdmin);
}

export const findField = (entity, key) => (FIELDS[entity] || []).find((f) => f.key === key) || null;

export const blankReport = (entity = 'candidates') => ({
  name: '',
  description: '',
  entity,
  shared: true,
  config: {
    filters: [],
    groupBy: '',
    measure: 'count',
    measureField: '',
    sort: 'value',
    limit: 25,
  },
});

// ------------------------------------------------------------------ evaluation

const asNumber = (value) => {
  // Number(null), Number('') and Number([]) are all 0. Treating a missing value as zero would
  // silently drag every average down, so absence is mapped to null and excluded instead.
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const asDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const asText = (value) => (value == null ? '' : String(value));
const isBlank = (value) =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'string' && value.trim() === '');

/** Evaluate one filter clause against one record. Unknown operators never silently pass. */
export function matchesFilter(row, filter, meta) {
  const raw = row?.[filter.field];
  const op = filter.operator;
  const wanted = filter.value;

  if (op === 'is empty') return isBlank(raw);
  if (op === 'is not empty') return !isBlank(raw);

  if (meta?.type === 'list' || Array.isArray(raw)) {
    const list = (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((v) => asText(v).toLowerCase());
    if (op === 'contains') return list.some((v) => v.includes(asText(wanted).toLowerCase()));
    if (op === 'is any of') {
      const any = (Array.isArray(wanted) ? wanted : asText(wanted).split(','))
        .map((v) => asText(v).trim().toLowerCase())
        .filter(Boolean);
      return list.some((v) => any.includes(v));
    }
    if (op === 'is') return list.includes(asText(wanted).toLowerCase());
    if (op === 'is not') return !list.includes(asText(wanted).toLowerCase());
    return false;
  }

  if (meta?.type === 'number') {
    const a = asNumber(raw);
    const b = asNumber(wanted);
    if (a === null || b === null) return false;
    if (op === 'is') return a === b;
    if (op === 'is not') return a !== b;
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    return false;
  }

  if (meta?.type === 'date') {
    const a = asDate(raw);
    if (!a) return false;
    if (op === 'in the last') {
      const days = asNumber(wanted);
      if (days === null) return false;
      return a.getTime() >= Date.now() - days * 86400000;
    }
    const b = asDate(wanted);
    if (!b) return false;
    if (op === 'is') return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    if (op === 'is not') return a.toISOString().slice(0, 10) !== b.toISOString().slice(0, 10);
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    return false;
  }

  const a = asText(raw).toLowerCase();
  const b = asText(wanted).toLowerCase();
  if (op === 'is') return a === b;
  if (op === 'is not') return a !== b;
  if (op === 'contains') return b !== '' && a.includes(b);
  if (op === 'is any of')
    return (Array.isArray(wanted) ? wanted : asText(wanted).split(','))
      .map((v) => asText(v).trim().toLowerCase())
      .filter(Boolean)
      .includes(a);
  return false;
}

function aggregate(rows, measure, key, type) {
  if (measure === 'count') return rows.length;
  if (measure === 'distinct count') {
    const seen = new Set();
    for (const r of rows) {
      const v = r?.[key];
      if (Array.isArray(v)) v.forEach((x) => !isBlank(x) && seen.add(asText(x)));
      else if (!isBlank(v)) seen.add(asText(v));
    }
    return seen.size;
  }
  const numbers =
    type === 'date'
      ? rows
          .map((r) => asDate(r?.[key]))
          .filter(Boolean)
          .map((d) => d.getTime())
      : rows.map((r) => asNumber(r?.[key])).filter((n) => n !== null);
  // No values means no answer. Returning 0 here would invent a data point.
  if (!numbers.length) return null;
  if (measure === 'sum') return Math.round(numbers.reduce((a, b) => a + b, 0) * 100) / 100;
  if (measure === 'min') return Math.min(...numbers);
  if (measure === 'max') return Math.max(...numbers);
  if (measure === 'average')
    return Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100;
  return null;
}

/**
 * Run a report definition. Returns grouped rows when `groupBy` is set, otherwise a single total,
 * plus everything the UI needs to render honestly: which rows were considered, whether a measure
 * was undefined, and whether admin-only fields were dropped for this reader.
 */
export function runReport(data, report, { isAdmin = false, now = Date.now } = {}) {
  const entity = report?.entity;
  const problems = validateReport(report, { isAdmin });
  if (problems.length) return { error: problems[0], groups: [], total: null, considered: 0 };

  const config = report.config || {};
  const allowed = new Set(fieldsFor(entity, { isAdmin }).map((f) => f.key));
  // A shared report authored by an admin may reference a field this reader cannot see. Drop the
  // clause and say so, rather than silently returning the admin's numbers.
  const dropped = (config.filters || []).filter((f) => f.field && !allowed.has(f.field));
  const filters = (config.filters || []).filter((f) => f.field && allowed.has(f.field));

  const source = data?.[entity] || [];
  const rows = source.filter((row) =>
    filters.every((f) => matchesFilter(row, f, findField(entity, f.field))),
  );

  const measure = config.measure || 'count';
  const measureKey = MEASURES[measure]?.needsField ? config.measureField : '';
  const measureMeta = measureKey ? findField(entity, measureKey) : null;
  const measureHidden = !!(measureKey && !allowed.has(measureKey));

  if (measureHidden)
    return {
      error: 'This report measures a field your role cannot see.',
      groups: [],
      total: null,
      considered: rows.length,
      droppedFilters: dropped.map((f) => f.field),
    };

  const base = {
    considered: rows.length,
    droppedFilters: dropped.map((f) => f.field),
    measureLabel:
      measure === 'count'
        ? 'Records'
        : `${MEASURES[measure].label} ${measureMeta?.label || measureKey}`,
    groupLabel: findField(entity, config.groupBy)?.label || '',
    rows,
  };

  if (!config.groupBy) {
    return {
      ...base,
      groups: [],
      total: aggregate(rows, measure, measureKey, measureMeta?.type),
    };
  }

  const groupMeta = findField(entity, config.groupBy);
  const buckets = new Map();
  for (const row of rows) {
    const raw = row[config.groupBy];
    // A list field groups a record into every value it holds, so one candidate with three skills
    // counts once under each. The row total therefore exceeds the record count by design.
    const keys =
      groupMeta?.type === 'list' && Array.isArray(raw)
        ? raw.length
          ? raw.map((v) => asText(v))
          : ['(none)']
        : [isBlank(raw) ? '(none)' : formatGroupKey(raw, groupMeta)];
    for (const key of keys) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
  }

  let groups = [...buckets.entries()].map(([key, groupRows]) => ({
    key,
    count: groupRows.length,
    value: aggregate(groupRows, measure, measureKey, measureMeta?.type),
  }));

  const sort = config.sort || 'value';
  groups.sort((a, b) => {
    if (sort === 'label') return String(a.key).localeCompare(String(b.key));
    // Nulls sort last: "no data" is not a small number.
    if (a.value === null && b.value === null) return String(a.key).localeCompare(String(b.key));
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return sort === 'ascending' ? a.value - b.value : b.value - a.value;
  });

  const limit = Number(config.limit) > 0 ? Number(config.limit) : 25;
  const truncated = Math.max(0, groups.length - limit);
  groups = groups.slice(0, limit);

  const max = groups.reduce((m, g) => Math.max(m, g.value === null ? 0 : g.value), 0);
  return {
    ...base,
    groups: groups.map((g) => ({ ...g, share: max > 0 && g.value !== null ? g.value / max : 0 })),
    truncated,
    total: aggregate(rows, measure, measureKey, measureMeta?.type),
    now: now(),
  };
}

function formatGroupKey(value, meta) {
  if (meta?.type === 'date') {
    const d = asDate(value);
    return d ? d.toISOString().slice(0, 7) : '(none)';
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return asText(value);
}

export function validateReport(report, { isAdmin = false } = {}) {
  const problems = [];
  if (!report) return ['There is no report to run.'];
  if (!ENTITIES.includes(report.entity)) problems.push('Choose what this report is about.');
  const config = report.config || {};
  const measure = config.measure || 'count';
  if (!MEASURES[measure]) problems.push('Choose a measure.');
  else if (MEASURES[measure].needsField && !config.measureField)
    problems.push(`Choose the field to ${measure}.`);
  if (config.groupBy && !findField(report.entity, config.groupBy))
    problems.push('That grouping field does not exist on this record type.');
  for (const f of config.filters || []) {
    if (!f.field) continue;
    const meta = findField(report.entity, f.field);
    if (!meta) problems.push('A filter refers to a field that no longer exists.');
    else if (!OPERATORS[f.operator]) problems.push('A filter has no comparison chosen.');
    else if (!OPERATORS[f.operator].types.includes(meta.type))
      problems.push(`"${OPERATORS[f.operator].label}" cannot be used with ${meta.label}.`);
    else if (
      !['is empty', 'is not empty'].includes(f.operator) &&
      (f.value === '' || f.value == null)
    )
      problems.push(`Enter a value for the ${meta.label} filter.`);
  }
  if (!isAdmin && MEASURES[measure]?.needsField && config.measureField) {
    const meta = findField(report.entity, config.measureField);
    if (meta?.adminOnly) problems.push('This report measures a field your role cannot see.');
  }
  return problems;
}

/** Name validation, mirroring the unique index on the table. */
export function validateReportName(report, reports = [], id = null) {
  const name = String(report?.name || '').trim();
  if (!name) return 'Give the report a name.';
  if (
    reports.some(
      (r) =>
        r.id !== id &&
        String(r.name || '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    )
  )
    return 'A report with that name already exists.';
  return '';
}

/** Distinct values for a field, so the builder can offer real choices instead of a blank box. */
export function suggestValues(data, entity, key, limit = 40) {
  const seen = new Map();
  for (const row of data?.[entity] || []) {
    const raw = row?.[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (isBlank(v)) continue;
      const text = asText(v);
      seen.set(text, (seen.get(text) || 0) + 1);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

/**
 * A CSV cell that cannot become a formula. Report values include candidate and client names,
 * and a name can arrive from a public careers application — i.e. from an attacker. A leading
 * `=`, `+`, `-`, `@`, tab or CR is executed by Excel and Sheets on open, so it is prefixed with
 * an apostrophe. This matches `escapeFormulae: true`, which every other export here already uses.
 */
const csvCell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV of a report result, carrying the provenance an audited export needs. */
export function reportCsv(report, result, { actor = '', at = new Date() } = {}) {
  const when = at instanceof Date ? at.toISOString() : String(at);
  const lines = [
    `# ${report.name || 'Report'}`,
    `# ${ENTITY_LABELS[report.entity] || report.entity} · ${result.measureLabel || ''}`,
    `# Generated ${when}${actor ? ` by ${actor}` : ''} · ${result.considered} record(s) considered`,
  ];
  if (result.droppedFilters?.length)
    lines.push(`# Filters skipped for your role: ${result.droppedFilters.join(', ')}`);
  if (result.groups?.length) {
    lines.push([csvCell(result.groupLabel || 'Group'), csvCell(result.measureLabel)].join(','));
    for (const g of result.groups)
      lines.push([csvCell(g.key), csvCell(g.value === null ? 'No data' : g.value)].join(','));
  } else {
    lines.push([csvCell(result.measureLabel), ''].join(','));
    lines.push([csvCell(result.total === null ? 'No data' : result.total), ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}
