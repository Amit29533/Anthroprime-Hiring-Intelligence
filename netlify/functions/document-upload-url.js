import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authorizeRequest } from './_shared/auth.js';
import { r2Configuration } from './_shared/r2.js';
import { httpError, json, publicError, requestBody } from './_shared/responses.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILES = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain'],
  ['md', 'text/plain'],
  ['csv', 'text/csv'],
]);

export function safeFilename(value) {
  const basename = String(value || 'document')
    .split(/[\\/]/)
    .pop();
  return (
    basename
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'document'
  );
}

export function documentObjectKey(workspaceId, candidateId, filename, id = randomUUID()) {
  return `${workspaceId}/candidates/${candidateId}/${id}/${safeFilename(filename)}`;
}

export function createUploadHandler({
  authorize = authorizeRequest,
  signer = getSignedUrl,
  storage = r2Configuration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      const { candidateId, filename, contentType, size } = body;
      if (!candidateId || !filename) throw httpError(400, 'Candidate and filename are required.');
      const extension = String(filename).split('.').pop().toLowerCase();
      if (ALLOWED_FILES.get(extension) !== contentType)
        throw httpError(400, 'That document type is not allowed.');
      if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES)
        throw httpError(400, 'Document size must be between 1 byte and 5 MB.');

      const { supabase, membership } = await authorize(event, { write: true });
      const { data: candidate, error: candidateError } = await supabase
        .from('candidates')
        .select('id')
        .eq('id', candidateId)
        .maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate) throw httpError(404, 'Candidate was not found in your workspace.');

      const { client, bucket } = storage();
      const storagePath = documentObjectKey(membership.workspace_id, candidateId, filename);
      const uploadUrl = await signer(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          ContentType: contentType,
          Metadata: {
            workspace: membership.workspace_id,
            candidate: candidateId,
          },
        }),
        { expiresIn: 300, signableHeaders: new Set(['content-type']) },
      );
      return json(200, { uploadUrl, storagePath, expiresIn: 300 });
    } catch (error) {
      return publicError(error);
    }
  };
}

export const handler = createUploadHandler();
