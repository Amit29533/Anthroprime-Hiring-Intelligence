import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { executionClient } from './_shared/execution.js';
import { r2Configuration } from './_shared/r2.js';
import { readCvBytes, attachmentPrefix } from './_shared/cv-extraction.js';

export const config = { schedule: '* * * * *' };
export function isolatedExtraction(bytes, file, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(process.cwd(), 'cv-extraction-worker.mjs'), {
      workerData: { bytes, file },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true,
      stderr: true,
    });
    // Parser diagnostics may contain document strings; discard them instead of inheriting logs.
    worker.stdout.resume();
    worker.stderr.resume();
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Extraction timed out'));
    }, timeoutMs);
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.once('message', (message) => {
      stop();
      message.error ? reject(new Error('Extraction failed')) : resolve(message.result);
    });
    worker.once('error', () => {
      stop();
      reject(new Error('Extraction failed'));
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Extraction stopped'));
    });
  });
}
export function createCvWorker({
  execution = executionClient,
  storage = r2Configuration,
  extract = isolatedExtraction,
  objectTimeoutMs = 10000,
  claimCv = 'worker_claim_cv',
  claimAttachment = 'worker_claim_attachment_extract',
  finishCv = 'worker_finish_cv',
  finishAttachment = 'worker_finish_attachment_extract',
  provenance = () => ({}),
} = {}) {
  return async () => {
    try {
      const client = execution();
      let { data: file, error } = await client.rpc(claimCv);
      let source = 'cv';
      if (!error && !file) {
        ({ data: file, error } = await client.rpc(claimAttachment));
        source = 'attachment';
      }
      if (error) throw error;
      if (!file) return new Response(JSON.stringify({ processed: 0 }));
      let result;
      try {
        if (file.scan_status !== 'clean' || !file.scan_etag) throw new Error('CV quarantined');
        const prefix =
          source === 'cv'
            ? `${file.workspace_id}/imports/${file.batch_id}/`
            : attachmentPrefix(file);
        if (!file.storage_path.startsWith(prefix)) throw new Error('Invalid key');
        const { client: r2, bucket } = storage();
        const object = await r2.send(
          new GetObjectCommand({ Bucket: bucket, Key: file.storage_path, IfMatch: file.scan_etag }),
          { abortSignal: AbortSignal.timeout(objectTimeoutMs) },
        );
        try {
          if (object.ETag !== file.scan_etag || object.ContentLength !== file.size)
            throw new Error('Invalid original size');
          const bytes = await readCvBytes(object.Body, file.size);
          result = await extract(bytes, file);
        } finally {
          object.Body?.destroy?.();
        }
      } catch {
        result = { state: 'failed', text: '', draft: {} };
      }
      const { data: accepted, error: finishError } = await client.rpc(
        source === 'cv' ? finishCv : finishAttachment,
        {
          p_file: file.id,
          p_lease: file.lease,
          p_state: result.state,
          p_text: result.text,
          ...(source === 'cv' ? { p_draft: result.draft } : {}),
          ...provenance(result),
        },
      );
      if (finishError) throw finishError;
      return new Response(JSON.stringify({ processed: accepted ? 1 : 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(
        JSON.stringify({ error: 'CV processing failed. Check server configuration.' }),
        { status: 500 },
      );
    }
  };
}
// Two queue claims, one fetch, parsing and completion must fit the 30-second schedule.
export default createCvWorker({
  execution: () => executionClient(2000),
  objectTimeoutMs: 5000,
  extract: (bytes, file) => isolatedExtraction(bytes, file, { timeoutMs: 12000 }),
});
