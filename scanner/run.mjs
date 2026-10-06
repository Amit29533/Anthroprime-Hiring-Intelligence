import { setTimeout } from 'node:timers/promises';
import { createOcrWorker } from './ocr.js';
import { createScanWorker } from './worker.js';
const run = createScanWorker();
const extract = createOcrWorker();
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
while (!stopping) {
  let processed = false;
  try {
    const result = await run();
    processed = result.processed > 0;
    const extracted = await extract();
    const detail = await extracted.json();
    if (extracted.status !== 200) throw new Error('Private extraction unavailable');
    if (detail.processed) {
      processed = true;
      console.log(JSON.stringify({ event: 'private_extraction', processed: detail.processed }));
    }
    if (result.processed) console.log(JSON.stringify({ event: 'cv_scan', ...result }));
  } catch {
    console.error('Private scan worker unavailable; originals remain quarantined.');
  }
  if (!processed && !stopping) await setTimeout(10000);
}
