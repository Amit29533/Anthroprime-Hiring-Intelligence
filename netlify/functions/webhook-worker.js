import { executionClient } from './_shared/execution.js';
import { runWebhookBatch } from './_shared/webhooks.js';
export const config = { schedule: '* * * * *' };
export function createWebhookWorker({
  client = () => executionClient(3000),
  run = runWebhookBatch,
} = {}) {
  return async function () {
    try {
      const result = await run(client());
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json(
        { error: 'Webhook worker unavailable; inspect configuration and retained job history.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  };
}
export default createWebhookWorker();
