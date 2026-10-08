import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authorizeRequest } from './_shared/auth.js';
import { r2Configuration } from './_shared/r2.js';
import { executionClient } from './_shared/execution.js';
import { httpError, json, publicError, requestBody } from './_shared/responses.js';

export function createDownloadHandler({
  authorize = authorizeRequest,
  signer = getSignedUrl,
  storage = r2Configuration,
  execution = () => executionClient(5000),
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    let access;
    let reason = 'storage_unavailable';
    async function finish(outcome) {
      if (!access?.enforced || !access.requestId) return;
      const { data, error } = await execution().rpc('worker_finish_document_access', {
        p_request: access.requestId,
        p_outcome: outcome,
        p_reason: outcome === 'issued' ? 'none' : reason,
      });
      if (error || data !== true) throw new Error('Signing receipt unavailable');
    }
    try {
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      if (!body.documentId) throw httpError(400, 'Document ID is required.');

      const { supabase, membership } = await authorize(event);
      const { data: visible, error: documentError } = await supabase
        .from('documents')
        .select('id,storagePath,storageProvider,removed,scanRequired')
        .eq('id', body.documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!visible || visible.removed) throw httpError(404, 'Document was not found.');
      const { data: gate, error: gateError } = await supabase.rpc('api_begin_document_access', {
        p_document: visible.id,
      });
      if (gateError || typeof gate?.enforced !== 'boolean')
        throw new Error('Signing gate unavailable');
      access = gate;
      if (access.enforced && access.allowed === false) {
        const result = json(429, { error: 'Document download limit reached. Try again shortly.' });
        return {
          ...result,
          headers: { ...result.headers, 'retry-after': String(access.retryAfter || 60) },
        };
      }
      if (access.enforced && (!access.allowed || !access.requestId || !access.document))
        throw new Error('Invalid signing gate');
      const document = access.enforced ? access.document : visible;
      if (!document.storagePath?.startsWith(`${membership.workspace_id}/`)) {
        reason = 'invalid_path';
        throw httpError(403, 'Document storage path does not belong to your workspace.');
      }
      if (/(^|\/)\.{1,2}(\/|$)/.test(document.storagePath) || document.storagePath.includes('\\')) {
        reason = 'invalid_path';
        throw httpError(403, 'Document storage path is invalid.');
      }
      if (document.storageProvider === 'supabase') {
        if (document.scanRequired) {
          reason = 'quarantined';
          throw httpError(423, 'Legacy original requires private migration before download.');
        }
        const source = access.enforced ? execution() : supabase;
        const { data, error } = await source.storage
          .from('documents')
          .createSignedUrl(document.storagePath, 300);
        if (error || !data?.signedUrl) throw new Error('Legacy signing unavailable');
        await finish('issued');
        return json(200, { downloadUrl: data.signedUrl, expiresIn: 300 });
      }
      if (document.storageProvider !== 'r2') {
        reason = 'invalid_provider';
        throw httpError(409, 'Document provider is unsupported.');
      }

      const { client, bucket } = storage();
      if (document.scanRequired) {
        const { data: scan, error: scanError } = await supabase.rpc('api_document_scan', {
          p_document: document.id,
        });
        if (scanError || !scan?.required || scan.status !== 'clean' || !scan.etag) {
          reason = 'quarantined';
          throw httpError(423, 'CV is quarantined pending antivirus verification.');
        }
        let object;
        try {
          object = await client.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: document.storagePath,
              IfMatch: scan.etag,
            }),
            { abortSignal: AbortSignal.timeout(10000) },
          );
        } catch {
          reason = 'changed_original';
          throw httpError(423, 'Scanned original could not be verified.');
        }
        if (object.ETag !== scan.etag || object.ContentLength !== scan.size) {
          reason = 'changed_original';
          throw httpError(423, 'Scanned original changed. Download blocked.');
        }
      }
      const downloadUrl = await signer(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: document.storagePath }),
        { expiresIn: 300 },
      );
      await finish('issued');
      return json(200, { downloadUrl, expiresIn: 300 });
    } catch (error) {
      try {
        await finish('failed');
      } catch {
        /* Do not log URLs, object keys or credentials. */
      }
      return publicError(
        error?.statusCode ? error : httpError(503, 'Document storage is temporarily unavailable.'),
      );
    }
  };
}

export const handler = createDownloadHandler();
