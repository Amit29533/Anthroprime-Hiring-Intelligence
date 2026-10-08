import { executionClient } from './_shared/execution.js';
import { collaborationRpc } from './_shared/collaboration-worker.js';
import { validChannelHeaders } from './_shared/google-workspace.js';
import { json } from './_shared/responses.js';
export function createGoogleCalendarCallback({ client = () => executionClient(4000) } = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    if (event.body && Buffer.byteLength(event.body) > 8192)
      return json(413, { error: 'Notification too large.' });
    try {
      await collaborationRpc(client(), 'hint', validChannelHeaders(event.headers));
      return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
    } catch {
      return json(403, { error: 'Calendar notification rejected.' });
    }
  };
}
export default createGoogleCalendarCallback();
