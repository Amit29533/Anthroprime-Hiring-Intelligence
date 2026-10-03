import { executionClient } from './_shared/execution.js';
import { runIndexBatch } from './_shared/indexing.js';
export const config = { schedule: '* * * * *' };
export default async function () {
  return new Response(JSON.stringify(await runIndexBatch(executionClient(2000))), {
    headers: { 'Content-Type': 'application/json' },
  });
}
