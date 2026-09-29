import { createClient } from '@supabase/supabase-js';
import { httpError } from './responses.js';

function bearerToken(headers = {}) {
  const authorization = headers.authorization || headers.Authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function supabaseConfiguration() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase server environment variables are missing.');
  return { url, anonKey };
}

export async function authorizeRequest(event, { write = false } = {}) {
  const token = bearerToken(event.headers);
  if (!token) throw httpError(401, 'Sign in to access documents.');

  const { url, anonKey } = supabaseConfiguration();
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user)
    throw httpError(401, 'Your session has expired. Sign in again.');

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('workspace_id,role')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw httpError(403, 'Your account is not assigned to a workspace.');
  if (write && !['admin', 'recruiter'].includes(membership.role))
    throw httpError(403, 'Your workspace role cannot upload documents.');

  return { supabase, user: authData.user, membership };
}
