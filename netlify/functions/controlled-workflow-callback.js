import { executionClient } from './_shared/execution.js';
import { json } from './_shared/responses.js';
import { verifyFixtureCallback, workflowRpc } from './_shared/controlled-workflows.js';
export function createControlledCallback({
  service = () => executionClient(3000),
  secret = () => process.env.CONTROLLED_FIXTURE_CALLBACK_SECRET,
  now = Date.now,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    try {
      const p = verifyFixtureCallback(event, secret(), now());
      return json(200, await workflowRpc(service(), 'fixture-event', p));
    } catch {
      return json(403, {
        error:
          'Fixture callback rejected. This endpoint accepts no live signing-provider evidence.',
      });
    }
  };
}
export default createControlledCallback();
