import { cloud, getSupabase } from './repository.js';

// Resolve the authoritative mode for each rule-bearing save, rather than trusting
// a stale browser snapshot after another administrator changes workspace settings.
export async function serverExecutionEnabled() {
  if (!cloud) return false;
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_server_execution_status');
  if (error?.code === 'PGRST202' || error?.code === '42883') return false;
  if (error) throw new Error('Could not verify workflow execution mode. Please retry.');
  if (typeof data !== 'boolean')
    throw new Error('Workflow execution mode returned an invalid response. Please retry.');
  return data === true;
}

export async function executionRpc(name, args = {}) {
  const client = await getSupabase();
  if (!client) throw new Error('Background jobs require a cloud workspace.');
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      error.code === 'PGRST202' || error.code === '42883'
        ? 'Apply migration 035 to enable server execution.'
        : error.message,
    );
  return data;
}
