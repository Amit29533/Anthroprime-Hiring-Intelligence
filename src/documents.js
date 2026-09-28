// Blueprint §4.1/§11 — documents and CV handling: allowlisted uploads with randomized storage
// names and hashes, best-effort text extraction (txt/md/csv natively, DOCX via zip inflate,
// PDF heuristic), and a heuristic CV parser that always produces a reviewable draft.
// No AI dependency: extraction failures fall back to recruiter-entered text.
import { uid } from './domain.js';
import { scanSkills } from './taxonomy.js';
import { cloud, getSupabase } from './repository.js';

export const ALLOWED_EXTENSIONS = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
};
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEMO_INLINE_LIMIT = 1024 * 1024;

export function classifyFile(file) {
  const ext = String(file?.name || '')
    .split('.')
    .pop()
    .toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext])
    return { ok: false, error: 'Upload PDF, DOCX, TXT, MD or CSV files only.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'Choose a file smaller than 5 MB.' };
  if (!file.size) return { ok: false, error: 'That file is empty.' };
  return { ok: true, ext, mime: ALLOWED_EXTENSIONS[ext] };
}

export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

export async function sha256(buffer) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  }
  return '';
}

// Bound inflated XML, not just the uploaded ZIP: a tiny DOCX can expand to hundreds of MB.
export const MAX_DOCX_XML_BYTES = 1024 * 1024;

async function inflateDocxXml(compressed) {
  const stream = new Response(compressed).body.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;
  let oversized = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > MAX_DOCX_XML_BYTES) {
        oversized = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (oversized) return null;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Minimal ZIP reader for DOCX: find word/document.xml and inflate it with DecompressionStream.
export async function docxText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let off = 0;
  while (off < bytes.length - 30) {
    if (view.getUint32(off, true) !== 0x04034b50) {
      off++;
      continue;
    }
    const method = view.getUint16(off + 8, true);
    let compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const name = decoder.decode(bytes.slice(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    if (name === 'word/document.xml') {
      if (!compSize || start + compSize > bytes.length) return '';
      const comp = bytes.slice(start, start + compSize);
      let xml;
      if (method === 0) {
        if (compSize > MAX_DOCX_XML_BYTES) return '';
        xml = decoder.decode(comp);
      } else if (method === 8 && globalThis.DecompressionStream) {
        try {
          xml = await inflateDocxXml(comp);
        } catch {
          return '';
        }
        if (xml === null) return '';
      } else return '';
      return xml
        .replace(/<w:p [^>]*>|<w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
    }
    if (!compSize) break;
    off = start + compSize;
  }
  return '';
}

// PDF best-effort: pull readable literal strings from uncompressed content streams.
export async function pdfText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  const literals = [...raw.matchAll(/\((?:\\.|[^()\\]){2,}\)/g)].map((m) =>
    m[0].slice(1, -1).replace(/\\([()\\])/g, '$1'),
  );
  const text = literals.join(' ');
  return /[A-Za-z]{3}/.test(text) ? text : '';
}

export async function extractText(buffer, ext) {
  if (ext === 'txt' || ext === 'md' || ext === 'csv')
    return new TextDecoder().decode(buffer).slice(0, 40000);
  if (ext === 'docx') return (await docxText(buffer)).slice(0, 40000);
  if (ext === 'pdf') return (await pdfText(buffer)).slice(0, 40000);
  return '';
}

// Blueprint §11 — heuristic parse into a reviewable draft. Never auto-saved.
export function parseCVText(text) {
  const clean = String(text || '').replace(/\r/g, '');
  if (!clean.trim())
    return {
      name: '',
      email: '',
      phone: '',
      linkedin: '',
      title: '',
      skills: [],
      experience: null,
      summary: '',
    };
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const email = (clean.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
  const phone = (clean.match(/\+?\d[\d\s().-]{7,}\d/) || [''])[0].trim();
  const linkedin = (clean.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9._-]+/i) || [
    '',
  ])[0];
  const years = clean.match(/(\d{1,2})\+?\s*(?:years|yrs)\b/i);
  const name =
    lines
      .slice(0, 6)
      .find(
        (l) =>
          /^[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){1,3}$/.test(l) &&
          !l.includes('@') &&
          !/\d/.test(l),
      ) || '';
  const title =
    lines
      .slice(0, 8)
      .find(
        (l) =>
          l.length < 60 &&
          /engineer|architect|developer|consultant|analyst|manager|lead|specialist|scientist/i.test(
            l,
          ) &&
          !l.includes('@'),
      ) || '';
  return {
    name,
    email: email.toLowerCase(),
    phone,
    linkedin,
    title,
    skills: scanSkills(clean),
    experience: years ? Number(years[1]) : null,
    summary: lines.slice(0, 3).join(' ').slice(0, 240),
  };
}

export function buildDocumentRecord({
  file,
  ext,
  hash,
  extracted,
  candidateId = null,
  kind,
  uploadedBy = 'Recruiter',
}) {
  return {
    id: uid(),
    candidateId,
    kind: kind || (ext === 'pdf' || ext === 'docx' ? 'CV' : 'Other'),
    name: file.name || 'document',
    mime: ALLOWED_EXTENSIONS[ext] || '',
    size: file.size || 0,
    version: 1,
    hash: hash || '',
    storagePath: `${uid()}/${(file.name || 'document').replace(/[^\w.-]+/g, '_')}`,
    dataUrl: '',
    stored: false,
    storageError: '',
    parserStatus: extracted ? 'parsed' : 'manual',
    extracted: extracted || '',
    removed: false,
    uploadedBy,
    uploaded: new Date().toISOString(),
  };
}

// Cloud mode: binary goes to the private Supabase Storage bucket; demo keeps small files inline.
export async function persistBinary(record, file) {
  if (!cloud) {
    if (file.size <= DEMO_INLINE_LIMIT) record.dataUrl = await fileToDataUrl(file);
    record.stored = true;
    return record;
  }
  const supabase = await getSupabase();
  const { error } = await supabase.storage.from('documents').upload(record.storagePath, file, {
    contentType: file.mime || record.mime || 'application/octet-stream',
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  record.stored = true;
  return record;
}

// Defense-in-depth (§12): verify the first bytes actually look like the claimed type.
// This is signature sniffing, NOT antivirus — real malware scanning needs a server-side
// scanner in the storage pipeline and is documented as an open item.
export async function contentSignatureOk(file, ext) {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (ext === 'pdf')
      return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    if (ext === 'docx') return head[0] === 0x50 && head[1] === 0x4b; // OOXML is a ZIP container (PK)
    return true; // txt/md/csv are text; extraction validates readability anyway
  } catch {
    return false;
  }
}
// Batch 10 — resume-inbox groundwork: pull the readable body out of a forwarded
// application email (headers stripped, HTML reduced to text). IMAP/POP inbox
// ingestion remains server-side work.
export function emailBodyText(raw) {
  const s = String(raw || '').replace(/\r\n/g, '\n');
  const cut = s.indexOf('\n\n');
  let body = cut >= 0 ? s.slice(cut + 2) : s;
  const plain = body.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?:\n--\s|\n*$)/i);
  if (plain) body = plain[1];
  else if (/<[a-z!][\s\S]*>/i.test(body)) {
    body = body
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  return body.replace(/\n{3,}/g, '\n\n').trim();
}

// Batch 13 — Blueprint §13: private storage reads go through short-lived signed URLs
// (no public objects). Demo mode falls back to the inline data URL.
export async function signedUrlFor(record, ttlSeconds = 300) {
  if (!record) return null;
  if (cloud && record.storagePath) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(record.storagePath, ttlSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  }
  return record.dataUrl || null;
}
