import { getSupabase } from './repository.js';

export async function repositoryRead(name, args = {}) {
  const client = await getSupabase();
  if (!client) throw new Error('Paged repository reads require a cloud workspace.');
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      ['42883', 'PGRST202'].includes(error.code)
        ? 'Apply the paged_repository migration to enable this workspace view.'
        : error.message,
    );
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Repository returned an invalid response.');
  if (name === 'api_repository_page' && (!Array.isArray(data.rows) || data.rows.length > 50))
    throw new Error('Repository returned an invalid page.');
  if (
    name === 'api_candidate_section' &&
    args.p_section !== 'profile' &&
    (!Array.isArray(data.rows) || data.rows.length > 50)
  )
    throw new Error('Candidate section returned an invalid page.');
  return data;
}
