import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { extractPdf, textFromItems } from '../src/pdfExtraction.js';
import { parseCVText, buildDocumentRecord } from '../src/documents.js';

// A real cross-reference PDF with compressed page content and misleading metadata.
function fixture(
  content = 'BT /F1 12 Tf 50 750 Td (Jane Smith) Tj 0 -20 Td (jane@example.com) Tj 0 -20 Td (React developer) Tj ET',
) {
  const compressed = deflateSync(Buffer.from(content));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    '<< /Author (Not The Candidate) >>',
  ];
  const parts = [Buffer.from('%PDF-1.7\n')],
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(objects[i]), Buffer.from('\nendobj\n'));
  }
  const xref = Buffer.concat(parts).length;
  parts.push(
    Buffer.from(
      `xref\n0 7\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
        .join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}
const loadEngine = () => import('pdfjs-dist/legacy/build/pdf.mjs');

test('compressed PDF extracts page text and CV fields without metadata or detached originals', async () => {
  const bytes = fixture(),
    before = bytes.slice();
  const result = await extractPdf(bytes, { loadEngine });
  assert.equal(result.status, 'parsed');
  assert.match(result.text, /Jane Smith\njane@example.com/);
  assert.ok(!result.text.includes('Not The Candidate'));
  assert.deepEqual(bytes, before);
  assert.equal(parseCVText(result.text).name, 'Jane Smith');
  assert.equal(parseCVText(result.text).email, 'jane@example.com');
});
test('image-only/empty PDF needs manual review and does not parse its metadata', async () => {
  const result = await extractPdf(fixture(''), { loadEngine });
  assert.equal(result.status, 'manual');
  assert.equal(result.text, '');
  assert.match(result.warning, /OCR is not available/);
});
test('invalid and protected PDF errors become actionable manual-review results', async () => {
  assert.equal((await extractPdf(new Uint8Array([1, 2]), { loadEngine })).status, 'manual');
  let destroyed = false;
  const result = await extractPdf(fixture(), {
    loadEngine: async () => ({
      getDocument: () => ({
        promise: Promise.reject(Object.assign(new Error(), { name: 'PasswordException' })),
        destroy: async () => {
          destroyed = true;
        },
      }),
    }),
  });
  assert.match(result.warning, /password protected/);
  assert.equal(destroyed, true);
});
test('page and character limits require review rather than silently importing partial text', async () => {
  for (const limits of [
    { pages: 0, characters: 40000, timeoutMs: 20000 },
    { pages: 50, characters: 5, timeoutMs: 20000 },
  ]) {
    const result = await extractPdf(fixture(), { loadEngine, limits });
    assert.equal(result.status, 'manual');
    assert.equal(result.text, '');
    assert.match(result.warning, /parsing limit/);
  }
});
test('timeout cancels the loading task', async () => {
  let destroyed = false;
  const result = await extractPdf(fixture(), {
    limits: { timeoutMs: 10 },
    loadEngine: async () => ({
      getDocument: () => ({
        promise: new Promise(() => {}),
        destroy: async () => {
          destroyed = true;
        },
      }),
    }),
  });
  assert.equal(destroyed, true);
  assert.match(result.warning, /timed out/);
});
test('Unicode and explicit line breaks survive; manual parser status is retained', () => {
  assert.equal(
    textFromItems([{ str: 'José García', hasEOL: true }, { str: '工程师' }]),
    'José García\n工程师',
  );
  assert.equal(
    buildDocumentRecord({
      file: { name: 'a.pdf' },
      ext: 'pdf',
      extracted: 'partial',
      parserStatusHint: 'manual',
    }).parserStatus,
    'manual',
  );
});
