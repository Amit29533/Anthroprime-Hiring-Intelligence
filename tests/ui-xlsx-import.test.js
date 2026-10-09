// Importing an Excel workbook through the real Import screen — blueprint §8 asks for
// "CSV/XLSX ... with field mapping, preview, duplicate resolution and error report", so the
// point of these tests is that a workbook reaches the *same* pipeline a CSV does.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { loadApp, mount, screen, cleanup, stopVite, settle, act, fireEvent } from './ui-harness.js';
import { press, allText } from './ui-drivers.js';
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
afterEach(() => cleanup());

function zip(entries) {
  const chunks = [];
  for (const [name, text] of Object.entries(entries)) {
    const source = new TextEncoder().encode(text);
    const body = new Uint8Array(deflateRawSync(source));
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 8, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, source.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    chunks.push(header, body);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const sheetXml = (grid) =>
  `<worksheet><sheetData>${grid
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map(
            (v, c) =>
              `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`;

const workbook = (grid, extra = {}) =>
  new File([zip({ 'xl/worksheets/sheet1.xml': sheetXml(grid), ...extra })], 'candidates.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

async function openImport() {
  const data = normalizeData(makeSeed());
  const writes = [];
  await mount(M.ImportModal, {
    data,
    onClose: () => {},
    onSave: async (table, rows) => {
      writes.push({ table, rows });
      return true;
    },
    notify: () => {},
    audit: () => {},
    busy: false,
  });
  await settle(3);
  return { data, writes };
}

/** Select the intended import route; LinkedIn and CVs also have file pickers. */
const sheetInput = () => screen.getByLabelText('Candidate spreadsheet file');

async function upload(file) {
  await act(async () => {
    fireEvent.change(sheetInput(), { target: { files: [file] } });
  });
  // Reading a workbook is async (unzip + inflate), so give it a few frames.
  for (let i = 0; i < 30 && !document.body.textContent.includes('Map your columns'); i += 1)
    await settle(2);
  await settle(2);
}

test('the import screen offers a spreadsheet, not only a CSV', async () => {
  await openImport();
  assert.ok(screen.getByText('Choose a candidate spreadsheet'));
  assert.ok(allText(/Excel \.xlsx or UTF-8 \.csv/).length, 'both formats are advertised');
  assert.match(
    sheetInput().getAttribute('accept'),
    /\.xlsx/,
    'the file picker actually accepts workbooks',
  );
  cleanup();
});

test('an Excel workbook reaches the mapping, preview and save pipeline', async () => {
  const { writes } = await openImport();
  await upload(
    workbook([
      ['Name', 'Email', 'Title', 'Location', 'Skills'],
      ['Devika Iyer', 'devika.iyer@example.com', 'Data Engineer', 'Chennai', 'Azure'],
      ['Farhan Qureshi', 'farhan.q@example.com', 'Platform Engineer', 'Pune', 'Kubernetes'],
    ]),
  );
  assert.ok(allText(/Map your columns/i).length, 'the workbook advanced to the mapping step');
  assert.ok(allText(/2 rows detected/).length, 'with the right row count');

  await press('Review import');
  await settle(3);
  assert.ok(allText(/Devika Iyer/).length, 'and its rows are previewed before anything is saved');

  const importButton = [...document.querySelectorAll('button')].find((b) =>
    /^Import \d+ candidates$/.test(b.textContent.trim()),
  );
  assert.ok(importButton, 'the import button reports how many rows will be written');
  await act(async () => importButton.click());
  await settle(6);
  const write = writes.find((w) => w.table === 'candidates');
  assert.ok(write, 'the workbook saved through the same path a CSV uses');
  const names = write.rows.map((r) => r.name);
  assert.ok(names.includes('Devika Iyer') && names.includes('Farhan Qureshi'));
  const devika = write.rows.find((r) => r.name === 'Devika Iyer');
  assert.equal(devika.email, 'devika.iyer@example.com', 'columns mapped by header name');
  assert.equal(devika.location, 'Chennai');
  cleanup();
});

test('duplicate detection still applies to a workbook', async () => {
  const { data } = await openImport();
  const existing = data.candidates[0];
  await upload(
    workbook([
      ['Name', 'Email', 'Title', 'Location'],
      [existing.name, existing.email, existing.title, existing.location],
      ['Brand New Person', 'brand.new@example.com', 'Engineer', 'Pune'],
    ]),
  );
  await press('Review import');
  await settle(3);
  assert.ok(
    allText(/duplicate/i).length,
    'the existing candidate is flagged, exactly as with a CSV',
  );
  assert.ok(allText(/Brand New Person/).length, 'while the genuinely new row is accepted');
  cleanup();
});

test('a multi-sheet workbook says which sheet it used', async () => {
  await openImport();
  const file = new File(
    [
      zip({
        'xl/worksheets/sheet1.xml': sheetXml([
          ['Name', 'Email'],
          ['Devika Iyer', 'devika.iyer@example.com'],
        ]),
        'xl/worksheets/sheet2.xml': sheetXml([['Ignored'], ['Nobody']]),
      }),
    ],
    'two-sheets.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  await upload(file);
  assert.ok(
    allText(/this workbook has 2 sheets, and the rest were ignored/i).length,
    'the user is told rather than left to assume all sheets were read',
  );
  await press('Review import');
  await settle(3);
  assert.ok(allText(/Devika Iyer/).length, 'the first sheet was the one imported');
  assert.equal(allText(/Nobody/).length, 0, 'and the second sheet contributed nothing');
  cleanup();
});

test('an unreadable workbook explains itself instead of failing silently', async () => {
  await openImport();
  const notAWorkbook = new File([new TextEncoder().encode('just some text')], 'broken.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await act(async () => {
    fireEvent.change(sheetInput(), { target: { files: [notAWorkbook] } });
  });
  for (let i = 0; i < 20 && !document.body.textContent.includes('password-protected'); i += 1)
    await settle(2);
  assert.ok(
    allText(/password-protected or an older \.xls file/i).length,
    'the error names the two likely causes',
  );
  cleanup();
});

test('an unsupported file type is refused by name', async () => {
  await openImport();
  const odt = new File([new TextEncoder().encode('x')], 'candidates.ods', {
    type: 'application/vnd.oasis.opendocument.spreadsheet',
  });
  await act(async () => {
    fireEvent.change(sheetInput(), { target: { files: [odt] } });
  });
  await settle(3);
  assert.ok(allText(/Choose a \.csv or \.xlsx file/).length);
  cleanup();
});
