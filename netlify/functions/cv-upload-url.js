import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authorizeRequest } from './_shared/auth.js';
import { r2Configuration } from './_shared/r2.js';
import { json, requestBody } from './_shared/responses.js';

export function createCvUploadHandler({
  authorize = authorizeRequest,
  signer = getSignedUrl,
  storage = r2Configuration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const body = requestBody(event);
      if (!body?.batch || !Number.isInteger(body.row))
        return json(400, { error: 'Choose a saved CV row.' });
      const { supabase, membership } = await authorize(event, { write: true });
      const { data: file, error } = await supabase
        .from('importFiles')
        .select('*')
        .eq('batch_id', body.batch)
        .eq('row_no', body.row)
        .maybeSingle();
      if (error) throw error;
      if (!file || file.workspace_id !== membership.workspace_id)
        return json(404, { error: 'CV was not found in your workspace.' });
      const { data: batch, error: batchError } = await supabase
        .from('importBatches')
        .select('status')
        .eq('id', body.batch)
        .maybeSingle();
      if (batchError) throw batchError;
      if (batch?.status !== 'draft' || !['uploading', 'failed'].includes(file.state))
        return json(409, { error: 'This CV is no longer awaiting upload.' });
      const prefix = `${membership.workspace_id}/imports/${body.batch}/`;
      if (!file.storage_path.startsWith(prefix)) throw new Error('Invalid storage metadata');
      const { client, bucket } = storage();
      // A signed conditional write cannot overwrite the original after its hash is verified.
      const uploadUrl = await signer(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.storage_path,
          ContentType: file.mime,
          IfNoneMatch: '*',
        }),
        { expiresIn: 300, signableHeaders: new Set(['content-type', 'if-none-match']) },
      );
      return json(200, {
        uploadUrl,
        headers: { 'Content-Type': file.mime, 'If-None-Match': '*' },
        expiresIn: 300,
      });
    } catch (error) {
      // Provider details, file paths and credentials must not reach responses or logs.
      return json(error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : 'Could not prepare CV upload. Check server storage configuration.',
      });
    }
  };
}
export const handler = createCvUploadHandler();
