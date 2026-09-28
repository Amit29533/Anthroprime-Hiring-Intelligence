// XLSX import (blueprint §8 Import screen, §16 scenario N91). The workbooks here are built
// byte-by-byte as real ZIP archives, so these exercise the actual reader rather than a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  readXLSX,
  parseSharedStrings,
  parseSheet,
  columnIndex,
  serialToISO,
  dateStyleIndexes,
  normaliseHeaders,
  isXlsxName,
  MAX_XLSX_ROWS,
} from '../src/xlsx.js';

/** Build a real ZIP archive from `{ name: text }`, compressing when asked. */
function zip(entries, { compress = true } = {}) {
  const chunks = [];
  for (const [name, text] of Object.entries(entries)) {
    const source = new TextEncoder().encode(text);
    const body = compress ? new Uint8Array(deflateRawSync(source)) : source;
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, compress ? 8 : 0, true);
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

const sheet = (rows) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

/** A workbook whose cells are inline strings — the simplest valid shape. */
function book(grid, extra = {}) {
  const rows = grid
    .map((cells, r) => {
      const cs = cells
        .map((value, c) =>
          value === null
            ? ''
            : `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');
  return zip({ 'xl/worksheets/sheet1.xml': sheet(rows), ...extra });
}

test('a simple workbook reads into the same shape as a CSV', async () => {
  const wb = book([
    ['Name', 'Email', 'Location'],
    ['Aarav Sharma', 'aarav@example.com', 'Bengaluru'],
    ['Bhavna Rao', 'bhavna@example.com', 'Pune'],
  ]);
  const result = await readXLSX(wb);
  assert.deepEqual(result.headers, ['Name', 'Email', 'Location']);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    Name: 'Aarav Sharma',
    Email: 'aarav@example.com',
    Location: 'Bengaluru',
  });
  assert.deepEqual(
    result.rowNumbers,
    [2, 3],
    'row numbers are the spreadsheet rows the user can actually see',
  );
  assert.equal(result.sheet, 'sheet1.xml');
  assert.equal(result.sheetCount, 1);
});

test('shared strings, the normal Excel encoding, are resolved', async () => {
  const shared = `<?xml version="1.0"?><sst><si><t>Name</t></si><si><t>Aarav Sharma</t></si><si><t>R &amp; D</t></si></sst>`;
  const rows =
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>2</v></c></row>';
  const wb = zip({ 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': sheet(rows) });
  const result = await readXLSX(wb);
  assert.deepEqual(result.headers, ['Name']);
  assert.deepEqual(
    result.rows.map((r) => r.Name),
    ['Aarav Sharma', 'R & D'],
  );

  assert.deepEqual(parseSharedStrings(shared), ['Name', 'Aarav Sharma', 'R & D']);
  assert.deepEqual(parseSharedStrings(''), []);
  // Rich text is split across runs inside one <si>; it must come back as one string.
  assert.deepEqual(
    parseSharedStrings('<sst><si><r><t>Data</t></r><r><t> Engineer</t></r></si></sst>'),
    ['Data Engineer'],
  );
});

test('dates become ISO dates rather than Excel serial numbers', async () => {
  const styles = `<styleSheet><numFmts><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/><xf numFmtId="2"/></cellXfs></styleSheet>`;
  const rows =
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Available from</t></is></c><c r="B1" t="inlineStr"><is><t>Custom</t></is></c><c r="C1" t="inlineStr"><is><t>Salary</t></is></c></row>' +
    '<row r="2"><c r="A2" s="1"><v>45901</v></c><c r="B2" s="2"><v>45901</v></c><c r="C2" s="3"><v>42.5</v></c></row>';
  const wb = zip({ 'xl/styles.xml': styles, 'xl/worksheets/sheet1.xml': sheet(rows) });
  const result = await readXLSX(wb);
  assert.equal(result.rows[0]['Available from'], '2025-09-01');
  assert.equal(result.rows[0].Custom, result.rows[0]['Available from'], 'custom date formats too');
  assert.equal(result.rows[0].Salary, '42.5', 'a decimal format is left alone');

  const dates = dateStyleIndexes(styles);
  assert.ok(dates.has(1), 'built-in format 14 is a date');
  assert.ok(dates.has(2), 'a custom dd/mm/yyyy format is a date');
  assert.ok(!dates.has(0), 'general is not');
  assert.ok(!dates.has(3), 'and neither is a two-decimal number');
  assert.equal(dateStyleIndexes('').size, 0, 'a workbook with no styles has no date columns');
});

test('serial-to-date conversion handles the epoch and rejects nonsense', () => {
  assert.equal(serialToISO(45901), '2025-09-01');
  assert.equal(serialToISO(44927), '2023-01-01');
  // Known and accepted: dates before 1900-03-01 land a day early, because Excel's serial 60 is
  // a 29 February 1900 that never existed. No recruitment date falls there, and inventing a
  // special case for it would be more risk than the bug.
  assert.equal(serialToISO(2), '1900-01-01');
  assert.equal(serialToISO(1), '1899-12-31', 'documented off-by-one below the leap-bug boundary');
  assert.equal(serialToISO(0), '');
  assert.equal(serialToISO(-5), '');
  assert.equal(serialToISO('not a number'), '');
  assert.equal(serialToISO(null), '');
});

test('column letters map to positions, including two-letter columns', () => {
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('C7'), 2);
  assert.equal(columnIndex('Z1'), 25);
  assert.equal(columnIndex('AA1'), 26);
  assert.equal(columnIndex('BC12'), 54);
  assert.equal(columnIndex(''), -1);
});

test('gaps in the grid do not shift data into the wrong column', async () => {
  // B is empty on row 2; without reference-based placement "Pune" would slide into Email.
  const rows =
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Email</t></is></c><c r="C1" t="inlineStr"><is><t>Location</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Aarav</t></is></c><c r="C2" t="inlineStr"><is><t>Pune</t></is></c></row>';
  const result = await readXLSX(zip({ 'xl/worksheets/sheet1.xml': sheet(rows) }));
  assert.deepEqual(result.rows[0], { Name: 'Aarav', Email: '', Location: 'Pune' });
});

test('blank rows are skipped but row numbers stay truthful', async () => {
  const rows =
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t> </t></is></c></row>' +
    '<row r="5"><c r="A5" t="inlineStr"><is><t>Bhavna</t></is></c></row>';
  const result = await readXLSX(zip({ 'xl/worksheets/sheet1.xml': sheet(rows) }));
  assert.equal(result.rows.length, 1);
  assert.deepEqual(
    result.rowNumbers,
    [5],
    'the error report must point at row 5, which is where the user will look',
  );
});

test('numbers, booleans and formula errors are read sensibly', async () => {
  const rows =
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Experience</t></is></c><c r="B1" t="inlineStr"><is><t>Active</t></is></c><c r="C1" t="inlineStr"><is><t>Computed</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>8</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="str"><v>Lead Engineer</v></c></row>' +
    '<row r="3"><c r="A3"><v>12.5</v></c><c r="B3" t="b"><v>0</v></c><c r="C3" t="e"><v>#REF!</v></c></row>';
  const result = await readXLSX(zip({ 'xl/worksheets/sheet1.xml': sheet(rows) }));
  assert.equal(result.rows[0].Experience, '8');
  assert.equal(result.rows[0].Active, 'TRUE');
  assert.equal(result.rows[0].Computed, 'Lead Engineer', 'a formula reads as its stored value');
  assert.equal(result.rows[1].Active, 'FALSE');
  assert.equal(
    result.rows[1].Computed,
    '',
    'a #REF! error is not data — it becomes blank so the normal missing-field check catches it',
  );
});

test('duplicate headers are disambiguated instead of overwriting each other', async () => {
  const result = await readXLSX(
    book([
      ['Email', 'Email', 'Name'],
      ['work@example.com', 'personal@example.com', 'Aarav'],
    ]),
  );
  assert.deepEqual(result.headers, ['Email', 'Email (2)', 'Name']);
  assert.equal(result.rows[0].Email, 'work@example.com');
  assert.equal(result.rows[0]['Email (2)'], 'personal@example.com');

  assert.deepEqual(normaliseHeaders(['A', 'A', 'A']), ['A', 'A (2)', 'A (3)']);
  assert.deepEqual(normaliseHeaders(['  Name ', '']), ['Name', 'Column 2']);
});

test('leading blank rows above the header are tolerated', async () => {
  const rows =
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Name</t></is></c></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Aarav</t></is></c></row>';
  const result = await readXLSX(zip({ 'xl/worksheets/sheet1.xml': sheet(rows) }));
  assert.deepEqual(result.headers, ['Name']);
  assert.deepEqual(result.rowNumbers, [4]);
});

test('an uncompressed (stored) workbook reads too', async () => {
  const wb = zip(
    {
      'xl/worksheets/sheet1.xml': sheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Aarav</t></is></c></row>',
      ),
    },
    { compress: false },
  );
  const result = await readXLSX(wb);
  assert.equal(result.rows[0].Name, 'Aarav');
});

test('only the first worksheet is read, and the count is reported so the UI can say so', async () => {
  const one = sheet(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>First sheet</t></is></c></row>',
  );
  const two = sheet(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Second sheet</t></is></c></row>',
  );
  const result = await readXLSX(
    zip({ 'xl/worksheets/sheet2.xml': two, 'xl/worksheets/sheet1.xml': one }),
  );
  assert.equal(result.rows[0].Name, 'First sheet', 'sheet order, not ZIP order, decides');
  assert.equal(result.sheetCount, 2, 'so the user can be told the others were ignored');
});

test('unreadable files fail with a message a recruiter can act on', async () => {
  await assert.rejects(
    readXLSX(new TextEncoder().encode('this is not a zip at all')),
    /password-protected or an older \.xls file/,
  );
  await assert.rejects(
    readXLSX(zip({ 'xl/styles.xml': '<styleSheet/>' })),
    /no readable worksheet/,
  );
  await assert.rejects(readXLSX(zip({ 'xl/worksheets/sheet1.xml': sheet('') })), /empty/);
  await assert.rejects(
    readXLSX(book([['Name', 'Email']])),
    /at least one candidate/,
    'a header with no data rows is not an import',
  );
});

test('an oversized workbook is refused rather than hanging the tab', async () => {
  const many = [['Name']];
  for (let i = 0; i < MAX_XLSX_ROWS + 5; i += 1) many.push([`Person ${i}`]);
  await assert.rejects(readXLSX(book(many)), /Split larger workbooks/);
});

test('XML entities in cells are decoded exactly once', async () => {
  const result = await readXLSX(
    book([
      ['Name', 'Note'],
      ['Ridge &amp; Co', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ]),
  );
  assert.equal(result.rows[0].Name, 'Ridge & Co');
  assert.equal(
    result.rows[0].Note,
    '<script>alert(1)</script>',
    'decoded to text — React escapes it on render, and it never becomes markup here',
  );
});

test('the file-name check is case-insensitive', () => {
  assert.equal(isXlsxName('candidates.xlsx'), true);
  assert.equal(isXlsxName('CANDIDATES.XLSX'), true);
  assert.equal(isXlsxName('candidates.csv'), false);
  assert.equal(isXlsxName('candidates.xls'), false, 'the old binary format is not supported');
  assert.equal(isXlsxName(''), false);
  assert.equal(isXlsxName(null), false);
});

test('parseSheet is usable directly and is defensive about odd input', () => {
  assert.deepEqual(parseSheet('<sheetData></sheetData>'), []);
  const grid = parseSheet(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row r="2"/>',
  );
  assert.deepEqual(grid[0], ['x']);
  assert.deepEqual(grid[1], [], 'a self-closing empty row is a real, empty row');
});
