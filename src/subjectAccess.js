import { getWorkspace } from './repository.js';
import { downloadFile } from './downloads.js';

export async function downloadSubjectAccess(
  receipt,
  caseId,
  { download = downloadFile, digest = (bytes) => crypto.subtle.digest('SHA-256', bytes) } = {},
) {
  if (
    receipt?.id !== caseId ||
    !Number.isInteger(receipt.version) ||
    !receipt.packageId ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    typeof receipt.content !== 'string'
  )
    throw new Error('Access package receipt is incomplete.');
  const data = JSON.parse(receipt.content);
  if (
    data.schemaVersion !== 1 ||
    data.caseId !== caseId ||
    data.packageId !== receipt.packageId ||
    !Array.isArray(data.records)
  )
    throw new Error('Access package does not match this case.');
  const bytes = new TextEncoder().encode(receipt.content);
  const hash = Array.from(new Uint8Array(await digest(bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== receipt.sha256) throw new Error('Access package checksum does not match.');
  download(
    receipt.content,
    `anthro-access-${receipt.packageId}.json`,
    'application/json;charset=utf-8',
  );
}

export async function prepareSubjectAccess(
  args,
  { rpc, context = () => getWorkspace()?.id, ...options },
) {
  const workspace = context();
  const receipt = await rpc('api_prepare_subject_access_package', args);
  // Check again after checksum verification, immediately before creating the download.
  await downloadSubjectAccess(receipt, args.p_id, {
    ...options,
    download: (...parameters) => {
      if (context() !== workspace)
        throw new Error('Workspace changed. Prepare a new access package.');
      if (workspace && JSON.parse(receipt.content).workspaceId !== workspace)
        throw new Error('Access package belongs to another workspace.');
      return (options.download || downloadFile)(...parameters);
    },
  });
  return receipt;
}
