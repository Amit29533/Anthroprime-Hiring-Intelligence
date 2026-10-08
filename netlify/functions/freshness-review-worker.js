import { executionClient } from './_shared/execution.js';
export const config = { schedule: '15 * * * *' };
export function createFreshnessReviewWorker({ client = executionClient } = {}) {
  return async () => {
    const { data, error } = await client().rpc('worker_run_freshness_reviews', { p_limit: 20 });
    if (error)
      throw new Error('Freshness review batch failed. Check migrations and service configuration.');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createFreshnessReviewWorker();
