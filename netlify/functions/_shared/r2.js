import { S3Client } from '@aws-sdk/client-s3';

export function r2Configuration() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || 'anthroprime-documents';
  if (!accountId || !accessKeyId || !secretAccessKey)
    throw new Error('Cloudflare R2 server environment variables are missing.');
  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // Newer AWS SDK releases otherwise attach an empty-body CRC32 value to a presigned PUT.
      // The browser supplies the body later, so that checksum would reject every non-empty CV.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
}
