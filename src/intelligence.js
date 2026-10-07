import { getSupabase } from './repository.js';

export { localVector } from './localVector.js';

export async function intelligenceRpc(name, args = {}) {
  const client = await getSupabase();
  if (!client) throw new Error('This feature requires a shared cloud workspace.');
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      ['PGRST202', '42883'].includes(error.code)
        ? /^api_(operations|sla_worklist)$/.test(name)
          ? 'Apply all migrations through 20261007190524_stage5_operations_governance.sql to enable operations and SLA review.'
          : /^api_(recruiter_worklist|worklist_)/.test(name)
            ? 'Apply all migrations through 20261007114511_recruiter_worklist.sql to enable the recruiter worklist.'
            : /^api_(client_|machine_|approved_job_|reconcile_)/.test(name)
              ? 'Apply all migrations through 20261007095813_phase4_privacy_scope.sql to enable Phase 4 client collaboration and APIs.'
              : 'Apply migrations 036, 037 and 039 to enable integrations, intelligence and index maintenance.'
        : error.message,
    );
  return data;
}

export async function intelligenceRequest(action, candidateId, query = '') {
  const client = await getSupabase();
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Sign in again to use intelligence.');
  const response = await fetch('/.netlify/functions/intelligence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ action, candidateId, query }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Intelligence request failed.');
  return body;
}
