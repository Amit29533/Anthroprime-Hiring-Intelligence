import { executionClient } from './_shared/execution.js';
import { verifySandboxCallback, deliveryRpc } from './_shared/delivery-sandbox.js';
import { json } from './_shared/responses.js';
export function createSandboxCallback({
  client = () => executionClient(4000),
  secret = () => process.env.DELIVERY_SANDBOX_CALLBACK_SECRET,
  clock = Date.now,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    if (event.isBase64Encoded) return json(400, { error: 'Plain JSON callback required.' });
    const key = secret();
    if (typeof key !== 'string' || key.length < 32)
      return json(503, { error: 'Sandbox callback verification is not configured.' });
    let body;
    try {
      body = verifySandboxCallback(event.body, event.headers || {}, key, clock());
    } catch {
      return json(401, { error: 'Invalid sandbox callback.' });
    }
    try {
      return json(200, await deliveryRpc(client(), 'event', body));
    } catch {
      return json(409, {
        error: 'Sandbox callback could not be recorded; reconcile server history.',
      });
    }
  };
}
export default createSandboxCallback();
