import { createClient } from '@supabase/supabase-js';

export function executionClient(timeout = 15000) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server execution configuration is missing.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) }),
    },
  });
}

export async function runExecutionBatch(client, limit = 20) {
  const { data, error } = await client.rpc('worker_run_execution_jobs', { p_limit: limit });
  if (error)
    throw new Error(
      'Background workflow batch failed. Check database migrations and service credentials.',
    );
  return data;
}
