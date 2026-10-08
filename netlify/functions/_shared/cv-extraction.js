import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { parseCVText } from '../../../src/cvParser.js';

const MAX_BYTES = 5 * 1024 * 1024;
export function attachmentPrefix(file) {
  const owner = `${file.workspace_id}/${file.client_id ? 'clients' : 'candidates'}/${file.client_id || file.candidate_id}/`;
  if (/(^|\/)\.{1,2}(\/|$)/.test(file.storage_path) || file.storage_path.includes('\\'))
    throw new Error('Invalid original key');
  return file.legacy === true ? owner : `${owner}${file.id}/`;
}
export async function readCvBytes(body, expectedSize) {
  const chunks = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.length;
    if (length > MAX_BYTES || length > expectedSize) throw new Error('Invalid original size');
    chunks.push(Buffer.from(chunk));
  }
  if (length !== expectedSize) throw new Error('Original size mismatch');
  return Buffer.concat(chunks);
}

// Use the ZIP central directory: ordinary DOCX writers use streaming data descriptors.
// Only document.xml is inflated; no filesystem writes, external entities or embedded assets.
export function serverDocxText(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0)
    throw new Error('Invalid DOCX');
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  const centralEnd = offset + centralSize;
  if (count > 2000 || centralEnd > end) throw new Error('Invalid DOCX directory');
  let found;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > centralEnd || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid DOCX entry');
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      size = bytes.readUInt32LE(offset + 20),
      inflated = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + nameSize + extra + comment > centralEnd)
      throw new Error('Invalid DOCX directory');
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (name === 'word/document.xml') {
      if (
        found ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        inflated > 1024 * 1024 ||
        local + 30 > bytes.length ||
        bytes.readUInt32LE(local) !== 0x04034b50
      )
        throw new Error('Unsupported DOCX entry');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + size > bytes.readUInt32LE(end + 16)) throw new Error('Invalid DOCX content');
      const compressed = bytes.subarray(start, start + size);
      const xmlBytes =
        method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 1024 * 1024 });
      if (xmlBytes.length !== inflated || xmlBytes.length > 1024 * 1024)
        throw new Error('Invalid DOCX XML size');
      found = xmlBytes.toString('utf8');
    }
    offset += 46 + nameSize + extra + comment;
  }
  if (found === undefined) throw new Error('Missing DOCX document');
  return found
    .replace(/<w:p(?:\s[^>]*)?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
    .slice(0, 40000);
}

export async function extractCvOriginal(
  bytes,
  file,
  { loadPdf = () => import('pdfjs-dist/legacy/build/pdf.mjs') } = {},
) {
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.hash)
    throw new Error('Original fingerprint mismatch');
  let text = '';
  if (file.ext === 'pdf') {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF signature');
    const { getDocument } = await loadPdf();
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: false,
      isImageDecoderSupported: false,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages <= 50) {
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let y;
          for (const item of content.items) {
            if (typeof item.str !== 'string') continue;
            if (y !== undefined && Math.abs(y - item.transform?.[5]) > 3) text += '\n';
            text += item.str + (item.hasEOL ? '\n' : ' ');
            y = item.transform?.[5];
            if (text.length > 40000) break;
          }
          page.cleanup();
          if (text.length > 40000) {
            text = '';
            break;
          }
        }
      }
    } catch {
      text = '';
    } finally {
      await task.destroy().catch(() => {});
    }
  } else if (file.ext === 'docx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Invalid DOCX signature');
    // Unreadable/encrypted/oversized text still leaves a verified original and a manual draft.
    try {
      text = serverDocxText(bytes);
    } catch {
      text = '';
    }
  } else {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Invalid text file');
    text = text.slice(0, 40000);
  }
  text = text.trim();
  return { state: text ? 'ready' : 'manual', text, draft: parseCVText(text) };
}
