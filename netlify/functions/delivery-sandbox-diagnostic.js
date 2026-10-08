import { authorizeRequest } from './_shared/auth.js';
import { executionClient } from './_shared/execution.js';
import { deliveryRpc } from './_shared/delivery-sandbox.js';
import { json } from './_shared/responses.js';
export function createSandboxDiagnostic({
  authorize = authorizeRequest,
  client = () => executionClient(4000),
  secret = () => process.env.DELIVERY_SANDBOX_CALLBACK_SECRET,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    try {
      const { supabase, user, membership } = await authorize(event, { write: true });
      if (membership.role !== 'admin') return json(403, { error: 'Administrator required.' });
      const { data, error } = await supabase.rpc('api_delivery_sandbox', {
        p_action: 'diagnostic-token',
      });
      if (error || !data)
        return json(403, {
          error: 'Current administrator access, MFA and configured sandbox required.',
        });
      const key = secret();
      return json(
        200,
        await deliveryRpc(client(), 'diagnose', {
          ...data,
          actor: user.id,
          callbackConfigured: typeof key === 'string' && key.length >= 32,
        }),
      );
    } catch {
      return json(403, { error: 'Sandbox diagnostic failed; refresh access and configuration.' });
    }
  };
}
export const handler = createSandboxDiagnostic();
