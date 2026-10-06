import { classifyFile, sha256, storageFunction } from './documents.js';
import { importRpc } from './durableImports.js';

export async function cvManifest(files) {
  if (!files.length || files.length > 20) throw new Error('Choose 1 to 20 CV files.');
  const result = [];
  for (const file of files) {
    const type = classifyFile(file);
    if (!type.ok) throw new Error(`${file.name}: ${type.error}`);
    if (file.name.length > 160) throw new Error('Use filenames with at most 160 characters.');
    const hash = await sha256(await file.arrayBuffer());
    if (!hash) throw new Error('This browser cannot compute a secure file fingerprint.');
    result.push({ name: file.name, ext: type.ext, size: file.size, hash });
  }
  return result;
}
export async function uploadSavedCv(
  batch,
  row,
  file,
  { rpc = importRpc, prepare = storageFunction, send = fetch } = {},
) {
  const manifests = await rpc('api_cv_files', { p_batch: batch });
  const saved = manifests.find((f) => f.row_no === row);
  const [actual] = await cvManifest([file]);
  if (
    !saved ||
    actual.hash !== saved.hash ||
    actual.size !== saved.size ||
    actual.name !== saved.name ||
    actual.ext !== saved.ext
  )
    throw new Error('Choose the original file matching this saved CV.');
  if (['ready', 'manual', 'queued', 'extracting'].includes(saved.state)) return;
  const signed = await prepare('cv-upload-url', { batch, row });
  if (!signed.uploadUrl || signed.headers?.['If-None-Match'] !== '*')
    throw new Error('CV storage returned an invalid upload instruction.');
  const response = await send(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: file,
  });
  // Lost upload acknowledgments are recoverable: the worker verifies the already stored bytes.
  if (!response.ok && response.status !== 412)
    throw new Error(`CV upload failed (${response.status}). Retry with the original file.`);
  await rpc('api_cv_uploaded', { p_batch: batch, p_row: row });
}
