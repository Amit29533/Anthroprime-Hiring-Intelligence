import { executionClient } from './_shared/execution.js';
import { deliveryRpc, dispatchFictional } from './_shared/delivery-sandbox.js';
export const config = { schedule: '*/5 * * * *' };
export function createDeliverySandboxWorker({
  client = () => executionClient(4000),
  clock = Date.now,
} = {}) {
  return async () => {
    const db = client(),
      deadline = clock() + 40000;
    let examined = 0,
      reconciled = 0,
      uncertain = 0;
    const claimed = await deliveryRpc(db, 'claim', { limit: 1 });
    if (!Array.isArray(claimed?.rows) || claimed.rows.length > 1)
      throw Error('Invalid bounded sandbox claim.');
    for (const lease of claimed.rows) {
      if (clock() > deadline - 24000) break;
      const gate = await deliveryRpc(db, 'gate', lease);
      if (!gate.allowed) continue;
      let outcome;
      try {
        outcome = await dispatchFictional(db, lease, gate);
      } catch {
        outcome = 'ambiguous';
      }
      try {
        await deliveryRpc(db, 'finish', { ...lease, outcome });
      } catch {
        uncertain++;
      }
      examined++;
      if (outcome === 'accepted' && ['duplicate', 'reordered'].includes(gate.scenario)) {
        // The fictional adapter generated receipt events; settle their evidence after completion.
        await deliveryRpc(db, 'reconcile', { id: lease.id });
      }
    }
    if (clock() < deadline - 8000) {
      const next = await deliveryRpc(db, 'reconcile-list', {});
      if (!Array.isArray(next?.rows) || next.rows.length > 3)
        throw Error('Invalid bounded reconciliation list.');
      for (const row of next.rows) {
        if (clock() > deadline - 4000) break;
        await deliveryRpc(db, 'reconcile', row);
        reconciled++;
      }
    }
    return new Response(
      JSON.stringify({ transport: 'fictional sandbox', examined, reconciled, uncertain }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
}
export default createDeliverySandboxWorker();
