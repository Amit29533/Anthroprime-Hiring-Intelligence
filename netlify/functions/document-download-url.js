import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authorizeRequest } from './_shared/auth.js';
import { r2Configuration } from './_shared/r2.js';
import { httpError, json, publicError, requestBody } from './_shared/responses.js';

export function createDownloadHandler({
  authorize = authorizeRequest,
  signer = getSignedUrl,
  storage = r2Configuration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      if (!body.documentId) throw httpError(400, 'Document ID is required.');

      const { supabase, membership } = await authorize(event);
      const { data: document, error: documentError } = await supabase
        .from('documents')
        .select('id,storagePath,storageProvider,removed')
        .eq('id', body.documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document || document.removed) throw httpError(404, 'Document was not found.');
      if (document.storageProvider !== 'r2')
        throw httpError(409, 'This document is stored by the legacy storage provider.');
      if (!document.storagePath?.startsWith(`${membership.workspace_id}/`))
        throw httpError(403, 'Document storage path does not belong to your workspace.');

      const { client, bucket } = storage();
      const downloadUrl = await signer(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: document.storagePath }),
        { expiresIn: 300 },
      );
      return json(200, { downloadUrl, expiresIn: 300 });
    } catch (error) {
      return publicError(error);
    }
  };
}

export const handler = createDownloadHandler();
