import { executionClient, runExecutionBatch } from './_shared/execution.js';

// Netlify scheduled functions have no public HTTP route. Database locks own claims.
export const config = { schedule: '* * * * *' };
export function createExecutionWorker({ client = executionClient, run = runExecutionBatch } = {}) {
  return async () => {
    const result = await run(client());
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createExecutionWorker();
