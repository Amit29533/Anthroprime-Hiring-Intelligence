import { executionClient } from './_shared/execution.js';
import { runCollaborationJob } from './_shared/collaboration-worker.js';
import { json } from './_shared/responses.js';
export const config = { schedule: '* * * * *' };
export function createGoogleWorker({
  client = () => executionClient(2000),
  run = runCollaborationJob,
} = {}) {
  return async () => {
    try {
      return json(200, await run(client()));
    } catch {
      return json(503, {
        error: 'Google worker unavailable; inspect server configuration and operation history.',
      });
    }
  };
}
export default createGoogleWorker();
