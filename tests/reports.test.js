import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITIES,
  ENTITY_LABELS,
  FIELDS,
  MEASURES,
  OPERATORS,
  fieldsFor,
  findField,
  blankReport,
  matchesFilter,
  runReport,
  validateReport,
  validateReportName,
  suggestValues,
  reportCsv,
} from '../src/reports.js';
import { normalizeData, emptyData, TABLES } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';

const report = (over = {}) => ({
  ...blankReport('candidates'),
  name: 'Test report',
  ...over,
  config: { ...blankReport('candidates').config, ...(over.config || {}) },
});

const people = () =>
  normalizeData({
    ...emptyData(),
    candidates: [
      {
        id: 'p1',
        name: 'Aarav',
        status: 'Ready',
        source: 'Referral',
        location: 'Bengaluru',
        experience: 8,
        skills: ['Azure', 'Databricks'],
        created: '2026-01-10',
        expectedCtc: 40,
      },
      {
        id: 'p2',
        name: 'Bhavna',
        status: 'Ready',
        source: 'Referral',
        location: 'Pune',
        experience: 4,
        skills: ['Azure'],
        created: '2026-02-10',
        expectedCtc: 20,
      },
      {
        id: 'p3',
        name: 'Chetan',
        status: 'Screening',
        source: 'Job board',
        location: 'Bengaluru',
        experience: 12,
        skills: [],
        created: '2026-03-10',
        expectedCtc: null,
      },
    ],
  });

test('every entity is labelled and every field is well formed', () => {
  for (const entity of ENTITIES) {
    assert.ok(ENTITY_LABELS[entity], `${entity} has a human label`);
    assert.ok(TABLES.includes(entity), `${entity} is a real table, not an invention`);
    for (const f of FIELDS[entity]) {
      assert.ok(f.key && f.label, `${entity}.${f.key} is named`);
      assert.ok(
        ['text', 'enum', 'number', 'date', 'list', 'boolean'].includes(f.type),
        `${entity}.${f.key} has a known type`,
      );
    }
  }
  // The allowlist must not have grown to include free-text or credential-ish fields.
  const keys = ENTITIES.flatMap((e) => FIELDS[e].map((f) => f.key));
  for (const forbidden of ['notes', 'email', 'phone', 'resume', 'hash', 'token', 'custom'])
    assert.ok(!keys.includes(forbidden), `${forbidden} is not reportable`);
});

test('every operator and measure in the catalogue is usable', () => {
  for (const [key, op] of Object.entries(OPERATORS)) {
    assert.ok(op.label, `${key} has a label`);
    assert.ok(op.types.length, `${key} applies to at least one field type`);
  }
  for (const [key, m] of Object.entries(MEASURES)) {
    assert.ok(m.label, `${key} has a label`);
    assert.equal(typeof m.needsField, 'boolean');
  }
  // Every field type in use must be reachable by at least one operator, or it could be grouped
  // but never filtered.
  const types = new Set(ENTITIES.flatMap((e) => FIELDS[e].map((f) => f.type)));
  for (const type of types)
    assert.ok(
      Object.values(OPERATORS).some((o) => o.types.includes(type)),
      `${type} fields can be filtered`,
    );
});

test('admin-only fields are withheld from non-admin readers', () => {
  const asAdmin = fieldsFor('candidates', { isAdmin: true }).map((f) => f.key);
  const asRecruiter = fieldsFor('candidates', { isAdmin: false }).map((f) => f.key);
  assert.ok(asAdmin.includes('expectedCtc'));
  assert.ok(!asRecruiter.includes('expectedCtc'), 'compensation is not reportable by a recruiter');
  assert.ok(
    !fieldsFor('demands')
      .map((f) => f.key)
      .includes('budget'),
  );
  assert.ok(
    fieldsFor('demands', { isAdmin: true })
      .map((f) => f.key)
      .includes('budget'),
  );
  assert.deepEqual(fieldsFor('nonsense'), [], 'an unknown entity has no fields');
});

test('text, enum and list filters behave the way a user would expect', () => {
  const row = { name: 'Aarav Sharma', status: 'Ready', skills: ['Azure', 'Databricks'] };
  const meta = (k) => findField('candidates', k);
  assert.equal(
    matchesFilter(row, { field: 'status', operator: 'is', value: 'ready' }, meta('status')),
    true,
  );
  assert.equal(
    matchesFilter(row, { field: 'status', operator: 'is not', value: 'Ready' }, meta('status')),
    false,
  );
  assert.equal(
    matchesFilter(row, { field: 'name', operator: 'contains', value: 'sharma' }, meta('name')),
    true,
  );
  assert.equal(
    matchesFilter(row, { field: 'name', operator: 'contains', value: 'patel' }, meta('name')),
    false,
  );
  assert.equal(
    matchesFilter(row, { field: 'skills', operator: 'contains', value: 'azure' }, meta('skills')),
    true,
    'a list contains a value case-insensitively',
  );
  assert.equal(
    matchesFilter(
      row,
      { field: 'skills', operator: 'is any of', value: 'Snowflake, Databricks' },
      meta('skills'),
    ),
    true,
  );
  assert.equal(
    matchesFilter(
      row,
      { field: 'skills', operator: 'is any of', value: 'Snowflake' },
      meta('skills'),
    ),
    false,
  );
  assert.equal(
    matchesFilter({ skills: [] }, { field: 'skills', operator: 'is empty' }, meta('skills')),
    true,
  );
  assert.equal(
    matchesFilter(row, { field: 'skills', operator: 'is empty' }, meta('skills')),
    false,
  );
  assert.equal(
    matchesFilter({ status: '   ' }, { field: 'status', operator: 'is empty' }, meta('status')),
    true,
  );
  assert.equal(
    matchesFilter(row, { field: 'status', operator: 'nonsense', value: 'Ready' }, meta('status')),
    false,
    'an unknown operator excludes the row rather than silently passing it',
  );
});

test('number and date filters compare properly, not as strings', () => {
  const meta = (k) => findField('candidates', k);
  const row = { experience: 9, created: '2026-01-10' };
  assert.equal(
    matchesFilter(row, { field: 'experience', operator: '>', value: 10 }, meta('experience')),
    false,
  );
  assert.equal(
    matchesFilter(row, { field: 'experience', operator: '>', value: '8' }, meta('experience')),
    true,
  );
  assert.equal(
    matchesFilter(
      { experience: 10 },
      { field: 'experience', operator: '>', value: 9 },
      meta('experience'),
    ),
    true,
    '10 is greater than 9 — a string comparison would get this wrong',
  );
  assert.equal(
    matchesFilter(row, { field: 'experience', operator: 'is', value: 9 }, meta('experience')),
    true,
  );
  assert.equal(
    matchesFilter(
      { experience: null },
      { field: 'experience', operator: '>', value: 1 },
      meta('experience'),
    ),
    false,
    'a missing number never satisfies a comparison',
  );
  assert.equal(
    matchesFilter(row, { field: 'created', operator: '<', value: '2026-02-01' }, meta('created')),
    true,
  );
  assert.equal(
    matchesFilter(row, { field: 'created', operator: 'is', value: '2026-01-10' }, meta('created')),
    true,
  );

  const recent = new Date(Date.now() - 3 * 86400000).toISOString();
  assert.equal(
    matchesFilter(
      { created: recent },
      { field: 'created', operator: 'in the last', value: 7 },
      meta('created'),
    ),
    true,
  );
  assert.equal(
    matchesFilter(
      { created: recent },
      { field: 'created', operator: 'in the last', value: 1 },
      meta('created'),
    ),
    false,
  );
});

test('an ungrouped report returns a single measured total', () => {
  const data = people();
  assert.equal(runReport(data, report()).total, 3, 'count of all candidates');
  assert.equal(
    runReport(data, report({ config: { measure: 'average', measureField: 'experience' } })).total,
    8,
    '(8 + 4 + 12) / 3',
  );
  assert.equal(
    runReport(data, report({ config: { measure: 'sum', measureField: 'experience' } })).total,
    24,
  );
  assert.equal(
    runReport(data, report({ config: { measure: 'min', measureField: 'experience' } })).total,
    4,
  );
  assert.equal(
    runReport(data, report({ config: { measure: 'max', measureField: 'experience' } })).total,
    12,
  );
  assert.equal(
    runReport(data, report({ config: { measure: 'distinct count', measureField: 'skills' } }))
      .total,
    2,
    'Azure and Databricks',
  );
});

test('a measure with nothing to measure reports no data, never zero', () => {
  const empty = normalizeData(emptyData());
  const result = runReport(
    empty,
    report({ config: { measure: 'average', measureField: 'experience' } }),
  );
  assert.equal(result.total, null, 'an average over no records is unknown, not 0');
  assert.equal(result.considered, 0);
  assert.equal(runReport(empty, report()).total, 0, 'but a count of nothing genuinely is zero');
  // A group where every value is missing is also "no data".
  const data = people();
  const withNulls = {
    ...data,
    candidates: data.candidates.map((c) => ({ ...c, experience: null })),
  };
  const grouped = runReport(
    withNulls,
    report({ config: { groupBy: 'status', measure: 'average', measureField: 'experience' } }),
  );
  assert.ok(grouped.groups.every((g) => g.value === null));
  assert.ok(
    grouped.groups.every((g) => g.count > 0),
    'the records are still counted',
  );
});

test('grouping buckets records, and a list field counts under every value it holds', () => {
  const data = people();
  const bySource = runReport(data, report({ config: { groupBy: 'source' } }));
  assert.deepEqual(
    bySource.groups.map((g) => [g.key, g.value]),
    [
      ['Referral', 2],
      ['Job board', 1],
    ],
    'sorted by value, descending, by default',
  );
  assert.equal(bySource.groupLabel, 'Source');
  assert.equal(bySource.measureLabel, 'Records');
  assert.equal(bySource.total, 3);

  const bySkill = runReport(data, report({ config: { groupBy: 'skills' } }));
  assert.deepEqual(
    bySkill.groups.map((g) => [g.key, g.value]),
    [
      ['Azure', 2],
      ['Databricks', 1],
      ['(none)', 1],
    ],
    'a candidate with two skills appears under both; one with none is bucketed explicitly',
  );
  assert.equal(bySkill.total, 3, 'the total still counts records, not bucket memberships');
});

test('grouping by a date rolls up to the month', () => {
  const groups = runReport(
    people(),
    report({ config: { groupBy: 'created', sort: 'label' } }),
  ).groups;
  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-01', '2026-02', '2026-03'],
  );
});

test('sorting, limiting and truncation are explicit', () => {
  const data = people();
  const asc = runReport(data, report({ config: { groupBy: 'source', sort: 'ascending' } }));
  assert.deepEqual(
    asc.groups.map((g) => g.key),
    ['Job board', 'Referral'],
  );
  const byLabel = runReport(data, report({ config: { groupBy: 'location', sort: 'label' } }));
  assert.deepEqual(
    byLabel.groups.map((g) => g.key),
    ['Bengaluru', 'Pune'],
  );

  const limited = runReport(data, report({ config: { groupBy: 'name', limit: 2 } }));
  assert.equal(limited.groups.length, 2);
  assert.equal(limited.truncated, 1, 'the UI is told something was left out');

  // "No data" groups sort last, because unknown is not a small number.
  const mixed = runReport(
    {
      candidates: [
        { id: 'a', status: 'Ready', experience: 5 },
        { id: 'b', status: 'Screening', experience: null },
        { id: 'c', status: 'Placed', experience: 9 },
      ],
    },
    report({ config: { groupBy: 'status', measure: 'average', measureField: 'experience' } }),
  );
  assert.equal(mixed.groups.at(-1).value, null);
  assert.equal(mixed.groups[0].value, 9);
});

test('filters narrow the population before the measure is applied', () => {
  const data = people();
  const result = runReport(
    data,
    report({
      config: {
        filters: [{ field: 'status', operator: 'is', value: 'Ready' }],
        measure: 'average',
        measureField: 'experience',
      },
    }),
  );
  assert.equal(result.considered, 2);
  assert.equal(result.total, 6, '(8 + 4) / 2 — Chetan is excluded');

  const combined = runReport(
    data,
    report({
      config: {
        filters: [
          { field: 'status', operator: 'is', value: 'Ready' },
          { field: 'location', operator: 'is', value: 'Bengaluru' },
        ],
      },
    }),
  );
  assert.equal(combined.total, 1, 'filters combine with AND');
});

test('a shared report cannot leak an admin-only field to a recruiter', () => {
  const data = people();
  const salaryReport = report({
    config: { groupBy: 'location', measure: 'average', measureField: 'expectedCtc' },
  });

  const asAdmin = runReport(data, salaryReport, { isAdmin: true });
  assert.equal(asAdmin.error, undefined);
  assert.equal(asAdmin.total, 30, 'an admin sees the figure');

  const asRecruiter = runReport(data, salaryReport, { isAdmin: false });
  assert.match(asRecruiter.error, /your role cannot see/i);
  assert.equal(asRecruiter.total, null, 'and no number is returned at all');

  // A filter on a hidden field is dropped and declared, not silently honoured.
  const filtered = report({
    config: { filters: [{ field: 'expectedCtc', operator: '>', value: 30 }] },
  });
  const recruiterView = runReport(data, filtered, { isAdmin: false });
  assert.equal(recruiterView.total, 3, 'the hidden filter is not applied');
  assert.deepEqual(recruiterView.droppedFilters, ['expectedCtc']);
  assert.equal(runReport(data, filtered, { isAdmin: true }).total, 1, 'an admin gets the filter');
});

test('an invalid report explains itself instead of returning wrong numbers', () => {
  assert.deepEqual(validateReport(null), ['There is no report to run.']);
  assert.match(
    validateReport(report({ entity: 'unicorns' }))[0],
    /Choose what this report is about/,
  );
  assert.match(
    validateReport(report({ config: { measure: 'average' } }))[0],
    /Choose the field to average/,
  );
  assert.match(
    validateReport(report({ config: { groupBy: 'nope' } }))[0],
    /does not exist on this record type/,
  );
  assert.match(
    validateReport(
      report({ config: { filters: [{ field: 'experience', operator: 'contains', value: 'x' }] } }),
    )[0],
    /cannot be used with Years of experience/,
    'a text operator on a number is refused rather than quietly returning nothing',
  );
  assert.match(
    validateReport(
      report({ config: { filters: [{ field: 'status', operator: 'is', value: '' }] } }),
    )[0],
    /Enter a value for the Status filter/,
  );
  // "is empty" legitimately needs no value.
  assert.deepEqual(
    validateReport(report({ config: { filters: [{ field: 'status', operator: 'is empty' }] } })),
    [],
  );
  const bad = runReport(people(), report({ config: { measure: 'sum' } }));
  assert.match(bad.error, /Choose the field to sum/);
  assert.deepEqual(bad.groups, []);
});

test('report names are unique per workspace, like the database index', () => {
  const saved = [{ id: 'r1', name: 'Open roles by client' }];
  assert.equal(validateReportName({ name: 'Something else' }, saved), '');
  assert.match(validateReportName({ name: '   ' }, saved), /Give the report a name/);
  assert.match(validateReportName({ name: ' open ROLES by client ' }, saved), /already exists/);
  assert.equal(validateReportName({ name: 'Open roles by client' }, saved, 'r1'), '');
});

test('value suggestions come from the data, most common first', () => {
  const data = people();
  assert.deepEqual(suggestValues(data, 'candidates', 'source'), ['Referral', 'Job board']);
  assert.deepEqual(suggestValues(data, 'candidates', 'skills'), ['Azure', 'Databricks']);
  assert.deepEqual(suggestValues(data, 'candidates', 'nothing'), []);
  assert.equal(suggestValues(data, 'candidates', 'name', 2).length, 2, 'the list is capped');
});

test('the CSV carries provenance and never prints a fabricated zero', () => {
  const data = people();
  const def = report({ name: 'Candidates by source', config: { groupBy: 'source' } });
  const csv = reportCsv(def, runReport(data, def), {
    actor: 'amit@x.example',
    at: new Date('2026-09-28T10:00:00Z'),
  });
  assert.match(csv, /^# Candidates by source/m);
  assert.match(csv, /# Candidates · Records/);
  assert.match(
    csv,
    /# Generated 2026-09-28T10:00:00\.000Z by amit@x\.example · 3 record\(s\) considered/,
  );
  assert.match(csv, /^Source,Records$/m);
  assert.match(csv, /^Referral,2$/m);

  const undefinedMeasure = report({
    name: 'Avg experience',
    config: { groupBy: 'status', measure: 'average', measureField: 'experience' },
  });
  const nulls = { ...data, candidates: data.candidates.map((c) => ({ ...c, experience: null })) };
  const csv2 = reportCsv(undefinedMeasure, runReport(nulls, undefinedMeasure));
  assert.match(csv2, /,No data$/m, 'an undefined measure says so rather than printing 0');

  // A value containing a comma or quote cannot break the file.
  const nasty = reportCsv(
    report({ name: 'x', config: { groupBy: 'location' } }),
    runReport(
      {
        candidates: [
          { id: 'a', location: 'Pune, MH' },
          { id: 'b', location: 'He said "hi"' },
        ],
      },
      report({ config: { groupBy: 'location' } }),
    ),
  );
  assert.match(nasty, /"Pune, MH",1/);
  assert.match(nasty, /"He said ""hi""",1/);
});

test('a recruiter-facing CSV declares the filters that were skipped', () => {
  const def = report({
    name: 'Filtered',
    config: { filters: [{ field: 'expectedCtc', operator: '>', value: 10 }] },
  });
  const csv = reportCsv(def, runReport(people(), def, { isAdmin: false }));
  assert.match(csv, /# Filters skipped for your role: expectedCtc/);
});

test('a shared report cannot group a recruiter by an admin-only field', () => {
  const data = people();
  const shared = report({
    entity: 'demands',
    config: { groupBy: 'budget', measure: 'count' },
  });
  const result = runReport(data, shared, { isAdmin: false });
  assert.match(result.error, /groups by a field your role cannot see/i);
  assert.deepEqual(result.groups, []);
  assert.equal(result.rows, undefined);
  assert.equal(JSON.stringify(result).includes('budget'), false);
  assert.ok(
    validateReport(shared, { isAdmin: false }).some((problem) => /groups by/i.test(problem)),
  );
});

test('placement reports join operational labels and keep commercial reports role- and unit-safe', () => {
  const data = normalizeData({
    ...emptyData(),
    candidates: [
      { id: 'c1', name: 'Aarav Sharma' },
      { id: 'c2', name: 'Bhavna Rao' },
    ],
    demands: [
      { id: 'd1', title: 'Platform Engineer', client: 'Acme' },
      { id: 'd2', title: 'Data Analyst', client: 'Globex' },
    ],
    clients: [
      { id: 'cl1', name: 'Acme' },
      { id: 'cl2', name: 'Globex' },
    ],
    placements: [
      {
        id: 'p1',
        candidateId: 'c1',
        demandId: 'd1',
        clientId: 'cl1',
        status: 'Active',
        startDate: '2026-01-01',
        engagementType: 'Permanent',
        workMode: 'Remote',
        recruiter: 'Mira',
        notes: 'must never enter the report projection',
      },
      {
        id: 'p2',
        candidateId: 'c2',
        demandId: 'd2',
        clientId: 'cl2',
        status: 'Completed',
        startDate: '2026-02-01',
        engagementType: 'Contract',
        workMode: 'Hybrid',
        recruiter: 'Dev',
      },
    ],
    placementCommercials: [
      {
        placementId: 'p1',
        billRate: 200,
        costRate: 150,
        currency: 'INR',
        basis: 'Annual',
        billedAmount: 1000,
        collectedAmount: 800,
      },
      {
        placementId: 'p2',
        billRate: 300,
        costRate: 220,
        currency: 'USD',
        basis: 'Annual',
        billedAmount: 500,
        collectedAmount: 400,
      },
    ],
  });

  const byStatus = report({
    entity: 'placements',
    config: { groupBy: 'status', measure: 'count' },
  });
  const operational = runReport(data, byStatus, { isAdmin: false });
  assert.equal(operational.error, undefined);
  assert.deepEqual(operational.groups.map(({ key, value }) => [key, value]).sort(), [
    ['Active', 1],
    ['Completed', 1],
  ]);
  assert.equal(operational.rows[0].candidateName, 'Aarav Sharma');
  assert.equal(operational.rows[0].clientName, 'Acme');
  assert.equal(operational.rows[0].notes, undefined, 'free-text placement notes are not projected');
  assert.equal(operational.rows[0].billRate, undefined, 'non-admin rows omit commercial fields');
  assert.deepEqual(suggestValues(data, 'placements', 'clientName'), ['Acme', 'Globex']);
  assert.ok(!fieldsFor('placements').some((f) => f.key === 'currency'));

  const collections = report({
    entity: 'placements',
    config: { measure: 'sum', measureField: 'collectedAmount' },
  });
  assert.match(
    runReport(data, collections, { isAdmin: true }).error,
    /multiple or missing currencies.*filter Currency/i,
    'a cross-currency total is refused rather than numerically misleading',
  );
  assert.match(
    runReport(data, collections, { isAdmin: false }).error,
    /role cannot see/i,
    'a recruiter cannot read admin-only collections',
  );

  const inrCollections = report({
    entity: 'placements',
    config: {
      filters: [{ field: 'currency', operator: 'is', value: 'INR' }],
      measure: 'sum',
      measureField: 'collectedAmount',
    },
  });
  const filtered = runReport(data, inrCollections, { isAdmin: true });
  assert.equal(filtered.total, 800);
  assert.match(filtered.measureLabel, /Collected amount \(INR\)/);

  const mixedBasis = {
    ...data,
    placementCommercials: data.placementCommercials.map((row, index) =>
      index === 0 ? { ...row, currency: 'INR', basis: 'Hourly' } : row,
    ),
  };
  const rateReport = report({
    entity: 'placements',
    config: { measure: 'average', measureField: 'billRate' },
  });
  assert.match(
    runReport(mixedBasis, rateReport, { isAdmin: true }).error,
    /multiple or missing currencies or billing bases/i,
  );
  assert.ok(fieldsFor('placements', { isAdmin: true }).some((f) => f.key === 'marginAmount'));
});

test('reports run against the real seeded workspace', () => {
  const data = normalizeData(makeSeed());
  const byClient = runReport(data, {
    ...blankReport('demands'),
    name: 'Open roles by client',
    config: {
      filters: [{ field: 'status', operator: 'is', value: 'Open' }],
      groupBy: 'client',
      measure: 'sum',
      measureField: 'positions',
    },
  });
  assert.equal(byClient.error, undefined);
  assert.ok(byClient.groups.length >= 1, 'the seeded demands group by client');
  assert.ok(byClient.groups.every((g) => g.value > 0));
  assert.equal(
    byClient.total,
    data.demands.filter((d) => d.status === 'Open').reduce((n, d) => n + d.positions, 0),
    'the total matches a hand calculation over the same rows',
  );
});

test('exported report cells can never become spreadsheet formulas', () => {
  // Candidate and client names reach reports, and a name can arrive from a public careers
  // application — i.e. from an attacker. Excel and Sheets execute a leading =, +, -, @, tab or
  // CR on open, so every one must be neutralised, exactly as `escapeFormulae` does elsewhere.
  const hostile = [
    '=HYPERLINK("http://evil.example","Click")',
    "+cmd|' /C calc'!A0",
    '@SUM(1+1)*cmd',
    '-2+3+cmd',
    '\tleading tab',
  ];
  const data = {
    candidates: hostile.map((name, i) => ({ id: String(i), name })),
  };
  const def = report({ name: 'Hostile', config: { groupBy: 'name', sort: 'label' } });
  const csv = reportCsv(def, runReport(data, def));
  for (const line of csv.split('\n').slice(3)) {
    if (!line || line.startsWith('Name,')) continue;
    const firstChar = line.startsWith('"') ? line[1] : line[0];
    assert.equal(
      firstChar,
      "'",
      `a cell beginning "${line.slice(0, 12)}" must be prefixed so it is not executed`,
    );
  }
  // An ordinary value is left completely alone.
  const plain = reportCsv(
    report({ name: 'Plain', config: { groupBy: 'name' } }),
    runReport(
      { candidates: [{ id: '1', name: 'Aarav Sharma' }] },
      report({ config: { groupBy: 'name' } }),
    ),
  );
  assert.match(plain, /^Aarav Sharma,1$/m, 'a normal name is not mangled');
  // Quoting still applies on top of the prefix.
  assert.match(csv, /^"'=HYPERLINK/m);
});
