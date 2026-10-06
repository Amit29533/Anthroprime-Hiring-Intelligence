// A separate process can be terminated even if a parser blocks its event loop.
// Netlify includes this runner and source dependencies explicitly (see netlify.toml).
import { parentPort, workerData } from 'node:worker_threads';
import { extractCvOriginal } from './netlify/functions/_shared/cv-extraction.js';
try {
  const result = await extractCvOriginal(Buffer.from(workerData.bytes), workerData.file);
  parentPort.postMessage({ result });
} catch {
  parentPort.postMessage({ error: true });
}
