// Blueprint §4.1/§11 — documents and CV handling: allowlisted uploads with randomized storage
// names and hashes, best-effort text extraction (txt/md/csv natively, DOCX via zip inflate,
// PDF.js), and a heuristic CV parser that always produces a reviewable draft.
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

export async function pdfText(buffer) {
  const { extractPdf } = await import('./pdfExtraction.js');
  return (await extractPdf(buffer)).text;
}

export async function extractDocumentText(buffer, ext) {
  if (ext === 'pdf') {
    const { extractPdf } = await import('./pdfExtraction.js');
    return extractPdf(buffer);
  }
  const text = await extractText(buffer, ext);
  return {
    text,
    status: text ? 'parsed' : 'manual',
    warning: text ? '' : 'No readable text found. Enter candidate details manually.',
  };
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
  clientId = null,
  kind,
  uploadedBy = 'Recruiter',
  parserStatusHint,
}) {
  return {
    id: uid(),
    candidateId,
    ...(clientId ? { clientId } : {}),
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
    parserStatus: parserStatusHint === 'manual' ? 'manual' : extracted ? 'parsed' : 'manual',
    extracted: extracted || '',
    removed: false,
    uploadedBy,
    uploaded: new Date().toISOString(),
  };
}

async function storageFunction(name, body) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  const response = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Keep the stable fallback below for proxy and platform errors that return HTML.
  }
  if (!response.ok)
    throw new Error(payload.error || `Document storage failed (${response.status}).`);
  return payload;
}

// Cloud mode: originals go to private Cloudflare R2 through an authenticated, five-minute
// presigned URL. Demo mode keeps small files inline in this browser.
export async function persistBinary(record, file) {
  if (!cloud) {
    if (file.size <= DEMO_INLINE_LIMIT) record.dataUrl = await fileToDataUrl(file);
    record.storageProvider = 'inline';
    record.stored = true;
    return record;
  }
  const { uploadUrl, storagePath } = await storageFunction('document-upload-url', {
    candidateId: record.candidateId,
    ...(record.clientId ? { clientId: record.clientId } : {}),
    filename: record.name,
    contentType: record.mime || 'application/octet-stream',
    size: file.size,
  });
  if (!uploadUrl || !storagePath) throw new Error('Document storage did not return an upload URL.');
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': record.mime || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) throw new Error(`Document upload failed (${upload.status}).`);
  record.storagePath = storagePath;
  record.storageProvider = 'r2';
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
    if (record.storageProvider === 'r2') {
      const { downloadUrl } = await storageFunction('document-download-url', {
        documentId: record.id,
      });
      return downloadUrl || null;
    }
    // Existing installations may already have files in Supabase Storage. Keep those records
    // readable while every new upload is written to R2.
    const supabase = await getSupabase();
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(record.storagePath, ttlSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  }
  return record.dataUrl || null;
}
