import { createHash } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { executionClient } from '../netlify/functions/_shared/execution.js';
import { r2Configuration } from '../netlify/functions/_shared/r2.js';
import { readCvBytes, attachmentPrefix } from '../netlify/functions/_shared/cv-extraction.js';
import { scanPrivateBytes } from './clamd.js';

export function createScanWorker({
  execution = executionClient,
  storage = r2Configuration,
  scan = scanPrivateBytes,
} = {}) {
  return async () => {
    const client = execution();
    let { data: file, error } = await client.rpc('worker_claim_cv_scan');
    let source = 'cv';
    if (!error && !file) {
      ({ data: file, error } = await client.rpc('worker_claim_attachment_scan'));
      source = 'attachment';
    }
    if (error) throw new Error('Scan queue unavailable');
    if (!file) return { processed: 0 };
    let result, etag;
    try {
      const prefix =
        source === 'cv' ? `${file.workspace_id}/imports/${file.batch_id}/` : attachmentPrefix(file);
      if (!file.storage_path.startsWith(prefix)) throw new Error('Invalid original key');
      const { client: r2, bucket } = storage();
      const object = await r2.send(
        new GetObjectCommand({ Bucket: bucket, Key: file.storage_path }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      try {
        if (object.ContentLength !== file.size || !object.ETag || object.ETag.length > 200)
          throw new Error('Invalid original metadata');
        const bytes = await readCvBytes(object.Body, file.size);
        if (createHash('sha256').update(bytes).digest('hex') !== file.hash)
          throw new Error('Original fingerprint changed');
        result = await scan(bytes);
        etag = object.ETag;
      } finally {
        object.Body?.destroy?.();
      }
    } catch {
      result = { status: 'error' };
    }
    const { data: accepted, error: finishError } = await client.rpc(
      source === 'cv' ? 'worker_finish_cv_scan' : 'worker_finish_attachment_scan',
      {
        p_file: file.id,
        p_lease: file.scan_lease,
        p_status: result.status,
        p_etag: result.status === 'clean' ? etag : null,
        p_engine: result.status === 'clean' ? result.engine : null,
      },
    );
    if (finishError) throw new Error('Scan receipt unavailable');
    return { processed: accepted ? 1 : 0, status: result.status };
  };
}
