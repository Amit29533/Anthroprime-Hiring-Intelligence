import { executionClient } from './_shared/execution.js';
export const config = { schedule: '*/5 * * * *' };
export function createTestCommunicationWorker({ client = executionClient } = {}) {
  return async () => {
    const { data, error } = await client().rpc('worker_run_test_communications', { p_limit: 20 });
    if (error)
      throw new Error(
        'Communication test batch failed. Check migrations and service configuration.',
      );
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createTestCommunicationWorker();
