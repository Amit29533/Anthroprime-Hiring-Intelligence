import { createClient } from '@supabase/supabase-js';
import { json } from './_shared/responses.js';
function publicClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing public configuration');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
    },
  });
}
export function createJobFeedHandler({ client = publicClient } = {}) {
  return async (event) => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
    const { ws, offset = '0', source = 'Approved job feed' } = event.queryStringParameters || {};
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ws || '') ||
      !/^\d{1,5}$/.test(offset) ||
      Number(offset) > 10000 ||
      !/^[A-Za-z0-9 ._-]{1,100}$/.test(source)
    )
      return json(400, { error: 'Valid workspace, offset and source required.' });
    try {
      const { data, error } = await client().rpc('api_approved_job_feed', {
        p_workspace: ws,
        p_offset: Number(offset),
      });
      if (error) return json(400, { error: 'Job feed unavailable.' });
      return json(200, {
        ...data,
        jobs: data.jobs.map((job) => ({
          ...job,
          applyUrl: `/careers.html?ws=${encodeURIComponent(ws)}&role=${encodeURIComponent(job.id)}&source=${encodeURIComponent(source)}`,
        })),
      });
    } catch {
      return json(503, { error: 'Job feed unavailable.' });
    }
  };
}
export const handler = createJobFeedHandler();
