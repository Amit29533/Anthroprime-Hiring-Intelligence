import { parseCVText } from '../src/cvParser.js';
import { createCvWorker, isolatedExtraction } from '../netlify/functions/cv-extract-worker.js';

export async function privateOcr(
  bytes,
  { send = fetch, token = process.env.OCR_SHARED_TOKEN } = {},
) {
  if (!token || token.length < 32) throw new Error('Private OCR is not configured');
  const response = await send('http://ocr:8080/extract', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
    body: bytes,
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok || !response.body) throw new Error('Private OCR unavailable');
  const chunks = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 250000) throw new Error('OCR response exceeded limit');
    chunks.push(Buffer.from(part));
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid OCR response');
  }
  if (
    typeof data.text !== 'string' ||
    data.text.length > 40000 ||
    typeof data.engine !== 'string' ||
    !data.engine.length ||
    data.engine.length > 200
  )
    throw new Error('Invalid OCR response');
  return data;
}
export function createOcrExtraction({ text = isolatedExtraction, ocr = privateOcr } = {}) {
  return async (bytes, file) => {
    const result = await text(bytes, file);
    if (result.state !== 'manual' || file.ext !== 'pdf')
      return { ...result, method: 'text', engine: 'Anthroprime text extraction v1' };
    const parsed = await ocr(bytes);
    return {
      state: parsed.text.trim() ? 'ready' : 'manual',
      text: parsed.text,
      draft: parseCVText(parsed.text),
      method: 'ocr',
      engine: parsed.engine,
    };
  };
}
export function createOcrWorker(options = {}) {
  return createCvWorker({
    ...options,
    extract: options.extract || createOcrExtraction(),
    claimCv: 'worker_claim_ocr_cv',
    claimAttachment: 'worker_claim_ocr_attachment',
    finishCv: 'worker_finish_ocr_cv',
    finishAttachment: 'worker_finish_ocr_attachment',
    provenance: (result) => ({
      p_method: result.method || 'text',
      p_engine: result.engine || 'Anthroprime text extraction v1',
    }),
  });
}
