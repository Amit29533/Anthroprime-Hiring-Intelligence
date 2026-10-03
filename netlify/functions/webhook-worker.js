import { executionClient } from './_shared/execution.js';
import { runWebhookBatch } from './_shared/webhooks.js';
export const config = { schedule: '* * * * *' };
export default async function () {
  const result = await runWebhookBatch(executionClient(3000));
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}
