// Minimal XLSX reader — blueprint §8 ("Import: CSV/XLSX and CV bulk upload with field mapping,
// preview, duplicate resolution and error report") and §16 acceptance scenario N91 ("Recruiter
// uploads 200 CVs + spreadsheet metadata").
//
// Recruiters work in Excel. Telling them to "export as CSV first" pushes a conversion step — and
// its encoding and date-format failures — onto the user. This reads the workbook directly.
//
// No new dependency: an .xlsx file is a ZIP of XML parts, and the codebase already reads DOCX the
// same way (`documents.js → docxText`). This reuses that approach and adds the two things a
// spreadsheet needs that a Word file does not: the shared-string table, and date detection.
//
// Deliberate limits, all surfaced to the user rather than silently applied:
//   * the FIRST worksheet only — a multi-sheet workbook is ambiguous, and guessing is worse than
//     asking;
//   * formulas are read as their last-calculated value, which is what Excel stores;
//   * inflated parts are capped, so a zip bomb cannot exhaust the browser tab.

export const MAX_XLSX_PART_BYTES = 12 * 1024 * 1024;
export const MAX_XLSX_ROWS = 5000;

/** Inflate one deflate-raw member, refusing anything that expands past the cap. */
async function inflate(compressed, cap = MAX_XLSX_PART_BYTES) {
  const stream = new Response(compressed).body.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Read the ZIP local-file headers and return the text of every entry whose name `wanted`
 * accepts. One pass, because a workbook's parts are needed together.
 */
export async function zipEntries(buffer, wanted) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map();
  let off = 0;
  while (off < bytes.length - 30) {
    if (view.getUint32(off, true) !== 0x04034b50) {
      off += 1;
      continue;
    }
    const method = view.getUint16(off + 8, true);
    const compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const name = decoder.decode(bytes.slice(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    if (!compSize || start + compSize > bytes.length) break;
    if (wanted(name)) {
      const part = bytes.slice(start, start + compSize);
      if (method === 0) {
        if (part.byteLength <= MAX_XLSX_PART_BYTES) out.set(name, decoder.decode(part));
      } else if (method === 8 && globalThis.DecompressionStream) {
        try {
          const text = await inflate(part);
          if (text !== null) out.set(name, text);
        } catch {
          /* a damaged member is skipped, not fatal */
        }
      }
    }
    off = start + compSize;
  }
  return out;
}

const unescapeXml = (value) =>
  String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

/** All text inside an element, ignoring rich-text run markup. */
const textOf = (xml) =>
  unescapeXml(
    (xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [])
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join(''),
  );

export function parseSharedStrings(xml) {
  if (!xml) return [];
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(textOf);
}

/** "BC12" → 54 (zero-based column index). */
export function columnIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0] || '';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Built-in numeric formats that mean "date". */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Which style indexes represent dates. Without this every date arrives as an Excel serial
 * number — "45930" instead of "2025-09-01" — which is the classic spreadsheet-import failure.
 */
export function dateStyleIndexes(stylesXml) {
  const dates = new Set();
  if (!stylesXml) return dates;
  const customDateIds = new Set();
  for (const fmt of stylesXml.match(/<numFmt[^>]*\/>/g) || []) {
    const id = Number(fmt.match(/numFmtId="(\d+)"/)?.[1]);
    const code = unescapeXml(fmt.match(/formatCode="([^"]*)"/)?.[1] || '');
    // A format containing y/d, or m not immediately after a currency symbol, is a date format.
    if (Number.isFinite(id) && /[yd]/i.test(code.replace(/\[[^\]]*\]/g, ''))) customDateIds.add(id);
  }
  const cellXfs = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] || '';
  const xfs = cellXfs.match(/<xf[^>]*\/?>/g) || [];
  xfs.forEach((xf, index) => {
    const id = Number(xf.match(/numFmtId="(\d+)"/)?.[1]);
    if (Number.isFinite(id) && (BUILTIN_DATE_FORMATS.has(id) || customDateIds.has(id)))
      dates.add(index);
  });
  return dates;
}

/**
 * Excel's day serial → ISO date. Epoch is 1899-12-30 because Excel deliberately reproduces a
 * 1900 leap-year bug — its serial 60 is a 29 February 1900 that never existed.
 *
 * Consequence, accepted rather than special-cased: serials below that boundary (before
 * 1900-03-01) come out one day early. No availability date, joining date or verification date in
 * a recruitment workbook falls in January 1900, and the correction would add a branch that is
 * harder to reason about than the defect.
 */
export function serialToISO(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = Math.round((n - 25569) * 86400000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Parse one worksheet into a grid of trimmed strings. */
export function parseSheet(xml, shared = [], dateStyles = new Set()) {
  const grid = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
    const rowNumber = Number(rowXml.match(/\sr="(\d+)"/)?.[1]) || grid.length + 1;
    const cells = [];
    for (const cellXml of rowXml.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || []) {
      const ref = cellXml.match(/\sr="([A-Z]+\d+)"/i)?.[1] || '';
      const type = cellXml.match(/\st="([^"]+)"/)?.[1] || 'n';
      const styleIndex = Number(cellXml.match(/\ss="(\d+)"/)?.[1]);
      const index = ref ? columnIndex(ref) : cells.length;
      let value;
      if (type === 's') {
        const at = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
        value = shared[at] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(cellXml);
      } else if (type === 'str') {
        value = unescapeXml(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '').replace(/<[^>]+>/g, '');
      } else if (type === 'b') {
        value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        // A formula error cell (#N/A, #REF!) is not data. Treat it as blank so it becomes a
        // "missing field" error in the normal preview rather than the literal text "#REF!".
        value = '';
      } else if (type === 'n') {
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        value =
          raw !== '' && Number.isFinite(styleIndex) && dateStyles.has(styleIndex)
            ? serialToISO(raw) || raw
            : raw;
      } else {
        // An unfamiliar cell type is read as text rather than dropped silently.
        value = textOf(cellXml) || (cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      cells[index] = String(value ?? '').trim();
    }
    grid[rowNumber - 1] = cells;
  }
  // Fill holes left by skipped rows so row numbers stay meaningful in the error report.
  for (let i = 0; i < grid.length; i += 1) if (!grid[i]) grid[i] = [];
  return grid;
}

const rowIsEmpty = (row) => !row.some((cell) => String(cell ?? '').trim() !== '');

/** Disambiguate repeated headers so two "Email" columns do not silently overwrite each other. */
export function normaliseHeaders(cells) {
  const seen = new Map();
  return cells.map((cell, index) => {
    const base =
      String(cell ?? '')
        .trim()
        .replace(/^\uFEFF/, '') || `Column ${index + 1}`;
    const count = seen.get(base.toLowerCase()) || 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/**
 * Read an .xlsx workbook into the same `{ rows, headers, rowNumbers }` shape `readCSV` returns,
 * so the existing mapping, preview, duplicate-check and error-report pipeline is reused
 * unchanged. Throws a message meant to be shown to a recruiter.
 */
export async function readXLSX(buffer) {
  const parts = await zipEntries(
    buffer,
    (name) =>
      name === 'xl/sharedStrings.xml' ||
      name === 'xl/styles.xml' ||
      name === 'xl/workbook.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );
  if (!parts.size)
    throw new Error(
      'That file could not be read as an Excel workbook. If it is password-protected or an older .xls file, save it as .xlsx first.',
    );

  const sheetNames = [...parts.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (!sheetNames.length) throw new Error('That workbook has no readable worksheet.');

  const shared = parseSharedStrings(parts.get('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIndexes(parts.get('xl/styles.xml'));
  const grid = parseSheet(parts.get(sheetNames[0]), shared, dateStyles);

  const headerIndex = grid.findIndex((row) => !rowIsEmpty(row));
  if (headerIndex === -1) throw new Error('That worksheet is empty.');
  const headers = normaliseHeaders(grid[headerIndex]);
  if (!headers.length) throw new Error('Include a header row and at least one candidate.');

  const rows = [];
  const rowNumbers = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i];
    if (rowIsEmpty(cells)) continue;
    const record = {};
    headers.forEach((header, column) => {
      record[header] = cells[column] ?? '';
    });
    rows.push(record);
    // 1-based spreadsheet row number, so an error report points at the row the user can see.
    rowNumbers.push(i + 1);
    if (rows.length > MAX_XLSX_ROWS)
      throw new Error(
        `Import up to ${MAX_XLSX_ROWS.toLocaleString()} rows per file. Split larger workbooks into smaller batches.`,
      );
  }
  if (!rows.length) throw new Error('Include a header row and at least one candidate.');

  return {
    rows,
    headers,
    rowNumbers,
    sheet: sheetNames[0].replace('xl/worksheets/', ''),
    sheetCount: sheetNames.length,
  };
}

export const isXlsxName = (name) => /\.xlsx$/i.test(String(name || ''));
