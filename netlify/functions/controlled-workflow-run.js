import { authorizeRequest } from './_shared/auth.js';
import { executionClient } from './_shared/execution.js';
import { json, requestBody } from './_shared/responses.js';
import { runControlledWorkflow } from './_shared/controlled-workflows.js';
export function createControlledRunner({
  authorize = authorizeRequest,
  service = () => executionClient(3000),
  run = runControlledWorkflow,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    if ((event.body || '').length > 2000)
      return json(413, { error: 'Bounded reviewed operation required.' });
    try {
      const { supabase } = await authorize(event, { write: true }),
        p = requestBody(event);
      if (!p || Object.keys(p).some((k) => !['id', 'operation', 'head'].includes(k)))
        throw Error('Invalid dispatch.');
      const { data, error } = await supabase.rpc('api_controlled_workflows', {
        p_action: 'dispatch',
        p_operation: p.operation,
        p_head: p.head,
        p_payload: { id: p.id },
      });
      if (error || !data) throw Error('Current review required.');
      return json(200, await run(service(), data));
    } catch {
      return json(409, {
        error:
          'Controlled workflow unavailable. Refresh current authorization, policy and history.',
      });
    }
  };
}
export default createControlledRunner();
