import { authorizeRequest } from './_shared/auth.js';
import { executionClient } from './_shared/execution.js';
import { collaborationRpc } from './_shared/collaboration-worker.js';
import {
  createGoogleAdapter,
  googleConfiguration,
  credentialAad,
  unseal,
} from './_shared/google-workspace.js';
import { json, requestBody } from './_shared/responses.js';
export function createGoogleDiagnostic({
  authorize = authorizeRequest,
  client = () => executionClient(4000),
  configuration = googleConfiguration,
  adapter = createGoogleAdapter,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    try {
      const body = requestBody(event),
        { supabase, user, membership } = await authorize(event, { write: true });
      if (membership.role !== 'admin' || !['mailbox', 'calendar'].includes(body?.kind))
        return json(403, { error: 'Configured administrator capability required.' });
      const { data, error } = await supabase.rpc('api_google_collaboration', {
        p_action: 'diagnostic-token',
        p_payload: { kind: body.kind },
      });
      if (error || !data) throw Error('Current MFA/owner gate failed.');
      const db = client(),
        config = configuration(),
        context = { ...data, actor: user.id, mode: 'diagnostic' };
      const gate = () => collaborationRpc(db, 'gate', context),
        g = await gate(),
        provider = adapter({ config, before: gate });
      try {
        await provider.refresh(unseal(g.credentials, credentialAad(g), config.key));
        await provider.diagnostic(g);
      } catch {
        await collaborationRpc(db, 'diagnostic', { ...context, status: 'unavailable' });
        throw Error('Google diagnostic failed.');
      }
      await collaborationRpc(db, 'diagnostic', { ...context, status: 'passed' });
      return json(200, {
        status: 'Authenticated diagnostic passed',
        activation: 'Review acceptance and enable separately.',
      });
    } catch {
      return json(403, {
        error:
          'Google diagnostic unavailable. Refresh access, credentials and server configuration.',
      });
    }
  };
}
export default createGoogleDiagnostic();
