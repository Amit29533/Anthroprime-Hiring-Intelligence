import { executionClient } from './_shared/execution.js';

export const config = { schedule: '* * * * *' };
export function createImportWorker({ client = executionClient } = {}) {
  return async () => {
    const { data, error } = await client().rpc('worker_run_imports', { p_limit: 20 });
    if (error) throw new Error('Import worker failed. Check migrations and server credentials.');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createImportWorker();
