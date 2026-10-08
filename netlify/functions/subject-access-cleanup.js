import { executionClient } from './_shared/execution.js';

export const config = { schedule: '0 * * * *' };
export function createSubjectAccessCleanup({ client = executionClient } = {}) {
  return async () => {
    const { data, error } = await client().rpc('worker_purge_subject_access_reviews', {
      p_limit: 20,
    });
    if (error)
      throw new Error('Access review cleanup failed. Check migrations and service configuration.');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createSubjectAccessCleanup();
