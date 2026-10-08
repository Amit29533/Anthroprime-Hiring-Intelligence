import { getSupabase } from './repository.js';

export async function importRpc(name, args = {}) {
  const client = await getSupabase();
  if (!client) throw new Error('Saved imports require a shared cloud workspace.');
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      ['PGRST202', '42883'].includes(error.code)
        ? 'Apply the resumable_imports migration to enable saved imports.'
        : error.message,
    );
  return data;
}

// Keep the batch UUID in component state before the first network call. A retry
// reuses the manifest and upserts drafts; it never creates another import.
export async function saveImportReview({ id, name, mapping, preview }, rpc = importRpc) {
  if (!id || !preview?.length || preview.length > 5000) throw new Error('Choose 1 to 5,000 rows.');
  let batch = await rpc('api_create_import', {
    p_id: id,
    p_name: name,
    p_total: preview.length,
    p_mapping: mapping,
  });
  for (let offset = 0; offset < preview.length; offset += 50) {
    batch = await rpc('api_stage_import', {
      p_batch: id,
      p_version: batch.version,
      p_rows: preview.slice(offset, offset + 50).map((p, index) => ({
        row: offset + index + 1,
        sourceLine: p.row,
        candidate: p.candidate,
        error: p.error || '',
      })),
    });
  }
  return batch;
}
