// The report builder, driven the way an analyst uses it. The important cases are the honest
// ones: a measure with no data must say "No data", and a shared report must render through the
// reader's permissions rather than the author's.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  createHarness,
  downloaded,
  resetDownloads,
  blobText,
} from './ui-harness.js';
import { navTo, press, type, choose, allText, withWindow } from './ui-drivers.js';
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
  resetDownloads();
});

function harnessWith(extra = {}) {
  const data = normalizeData({ ...makeSeed(), reports: [], ...extra });
  const harness = createHarness(data);
  harness.deleted = [];
  harness.remove = async (table, ids) => {
    harness.deleted.push({ table, ids });
    harness.state.data = {
      ...harness.state.data,
      [table]: harness.state.data[table].filter((r) => !ids.includes(r.id)),
    };
    return true;
  };
  return harness;
}

async function builder(harness, props = {}) {
  await mount(M.Reports, {
    data: harness.state.data,
    onSave: harness.save,
    onDelete: harness.remove,
    notify: (m) => harness.state.toasts.push(m),
    audit: harness.audit,
    busy: false,
    ...props,
  });
  await settle(4);
}

test('the builder opens with a live total and no saved reports', async () => {
  const harness = harnessWith();
  await builder(harness);
  assert.ok(screen.getByText('Ask your own questions.'));
  assert.ok(allText(/Nothing saved yet/).length);
  assert.ok(allText(/record.* considered/).length, 'the population is stated up front');
  const demands = harness.state.data.demands.length;
  assert.ok(screen.getByText(String(demands)), 'the default report counts every demand');
  cleanup();
});

test('grouping produces a table and a chart that agree with each other', async () => {
  const harness = harnessWith();
  await builder(harness);
  await choose('Group by', 'client');
  await settle(3);
  const rows = [...document.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
  );
  assert.ok(rows.length >= 2, 'the seeded demands span several clients');
  const fromTable = rows.reduce((n, r) => n + Number(r[2]), 0);
  assert.equal(
    fromTable,
    harness.state.data.demands.length,
    'every demand is accounted for in exactly one group',
  );
  assert.equal(
    document.querySelectorAll('.horizontal-chart > div').length,
    rows.length,
    'the chart has one bar per table row',
  );
  cleanup();
});

test('placement reports are available and recruiters never get commercial field options', async () => {
  const data = {
    ...makeSeed(),
    reports: [],
    candidates: [{ id: 'c1', name: 'Aarav Sharma' }],
    clients: [{ id: 'cl1', name: 'Acme' }],
    demands: [{ id: 'd1', title: 'Platform Engineer', clientId: 'cl1', client: 'Acme' }],
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
    ],
  };
  const harness = harnessWith(data);
  await builder(harness, { role: 'recruiter' });
  await choose('About', 'placements');
  await settle(3);
  assert.ok(screen.getByText('Placements'), 'placements are a first-class report entity');
  await choose('Group by', 'status');
  await settle(3);
  assert.ok(allText(/Active/).length, 'operational placement status is reportable');

  await choose('Measure', 'sum');
  await settle(2);
  const options = [...screen.getByLabelText('Measure field').querySelectorAll('option')].map(
    (option) => option.value,
  );
  assert.ok(!options.includes('billRate'));
  assert.ok(!options.includes('billedAmount'));
  assert.ok(!options.includes('collectedAmount'));
  cleanup();
});

test('a measure with nothing to measure says so instead of showing zero', async () => {
  const data = normalizeData({ ...makeSeed(), reports: [] });
  // Strip every score, so "average score" genuinely has no data.
  data.interviews = data.interviews.map((i) => ({ ...i, score: null }));
  const harness = createHarness(data);
  await builder(harness, { data });
  await choose('About', 'interviews');
  await settle(2);
  await choose('Measure', 'average');
  await settle(2);
  await choose('Measure field', 'score');
  await settle(3);
  assert.ok(screen.getByText('No data'), 'the result is "No data", not 0');
  assert.ok(
    allText(/there is no answer — not zero/i).length,
    'and the reason is explained rather than left to interpretation',
  );
  cleanup();
});

test('an incomplete definition explains what is missing rather than guessing', async () => {
  const harness = harnessWith();
  await builder(harness);
  await choose('Measure', 'sum');
  await settle(3);
  assert.ok(allText(/Choose the field to sum/i).length);
  assert.equal(screen.queryByText('Records'), null, 'no numbers are shown while it is invalid');
  cleanup();
});

test('filters narrow the population and offer real values from the data', async () => {
  const harness = harnessWith();
  await builder(harness);
  const before = Number(screen.getByText(String(harness.state.data.demands.length)).textContent);
  await press('Add filter');
  await choose('Filter 1 field', 'status');
  await settle(2);
  await type('Filter 1 value', 'Open');
  await settle(3);
  const open = harness.state.data.demands.filter((d) => d.status === 'Open').length;
  assert.ok(allText(new RegExp(`${open} records? considered`)).length, 'the population shrank');
  assert.ok(open < before || open === before);

  // The value box is backed by a datalist of values that actually occur.
  const options = [...document.querySelectorAll('#report-values-0 option')].map((o) => o.value);
  assert.ok(options.includes('Open'), 'suggestions come from the records themselves');
  cleanup();
});

test('a recruiter cannot build a report on admin-only compensation', async () => {
  const harness = harnessWith();
  await builder(harness, { role: 'recruiter' });
  await choose('About', 'demands');
  await settle(2);
  await choose('Measure', 'average');
  await settle(2);
  const options = [...screen.getByLabelText('Measure field').querySelectorAll('option')].map(
    (o) => o.value,
  );
  assert.ok(!options.includes('budget'), 'budget is not offered to a recruiter');
  assert.ok(options.includes('positions'), 'but ordinary numbers are');
  cleanup();
});

test('a shared report authored by an admin renders through the reader’s permissions', async () => {
  const salaryReport = {
    id: 'r-salary',
    name: 'Average budget by client',
    entity: 'demands',
    description: '',
    shared: true,
    config: {
      filters: [],
      groupBy: 'client',
      measure: 'average',
      measureField: 'budget',
      sort: 'value',
      limit: 25,
    },
  };
  const harness = harnessWith({ reports: [salaryReport] });

  await builder(harness, { role: 'admin' });
  await press('Average budget by client');
  await settle(3);
  assert.ok(document.querySelectorAll('tbody tr').length > 0, 'an admin sees the figures');
  cleanup();

  const harness2 = harnessWith({ reports: [salaryReport] });
  await builder(harness2, { role: 'recruiter' });
  await press('Average budget by client');
  await settle(3);
  assert.ok(
    allText(/your role cannot see/i).length,
    'a recruiter opening the same saved report is refused',
  );
  assert.equal(document.querySelectorAll('tbody tr').length, 0, 'and gets no numbers at all');
  cleanup();
});

test('a report can be named, saved, reopened and deleted', async () => {
  const harness = harnessWith();
  await builder(harness);
  await choose('Group by', 'client');
  await type('Report name', 'Demands by client');
  await type('Description', 'Where the work is');
  await press('Save report');
  await settle(4);

  const write = harness.state.writes.find((w) => w.table === 'reports');
  assert.ok(write, 'the definition was saved');
  const row = write.rows[0];
  assert.equal(row.name, 'Demands by client');
  assert.equal(row.entity, 'demands');
  assert.equal(row.config.groupBy, 'client');
  assert.equal(row.rows, undefined, 'no results were saved with it');
  assert.equal(row.groups, undefined);
  assert.ok(harness.state.audits.some((a) => a.action === 'saved'));

  // Deleting asks first.
  cleanup();
  const harness2 = harnessWith({ reports: [row] });
  await builder(harness2);
  await withWindow(
    'confirm',
    () => false,
    async () => {
      await press('Delete');
    },
  );
  assert.equal(harness2.deleted.length, 0, 'declining keeps the report');
  await withWindow(
    'confirm',
    () => true,
    async () => {
      await press('Delete');
    },
  );
  assert.deepEqual(harness2.deleted, [{ table: 'reports', ids: [row.id] }]);
  cleanup();
});

test('a duplicate report name is refused before saving', async () => {
  const existing = {
    id: 'r1',
    name: 'Demands by client',
    entity: 'demands',
    description: '',
    shared: true,
    config: {
      filters: [],
      groupBy: 'client',
      measure: 'count',
      measureField: '',
      sort: 'value',
      limit: 25,
    },
  };
  const harness = harnessWith({ reports: [existing] });
  await builder(harness);
  await type('Report name', '  demands BY client ');
  await press('Save report');
  await settle(2);
  assert.ok(allText(/already exists/i).length);
  assert.equal(harness.state.writes.length, 0, 'nothing was written');
  cleanup();
});

test('exporting produces a CSV with provenance and an audit event', async () => {
  const harness = harnessWith();
  await builder(harness);
  await choose('Group by', 'client');
  await type('Report name', 'Demands by client');
  await settle(2);
  await press('Export CSV');
  await settle(3);
  assert.equal(downloaded.length, 1, 'a file was produced');
  assert.equal(downloaded[0].name, 'demands-by-client.csv');
  const csv = await blobText(downloaded[0].blob);
  assert.match(csv, /^# Demands by client/m);
  assert.match(csv, /# Generated /);
  assert.match(csv, /^Client,Records$/m, 'the grouped result is the body of the file');
  assert.ok(
    harness.state.audits.some((a) => a.action === 'exported'),
    'exports are audited, as §12 requires',
  );
  cleanup();
});

test('the Reports page is reachable from the sidebar', async () => {
  localStorage.removeItem('ecod-demo-v1');
  await mount(M.App, {});
  await settle(6);
  await navTo('Reports');
  assert.ok(screen.getByText('Ask your own questions.'), 'the page rendered from the shell');
  cleanup();
});
