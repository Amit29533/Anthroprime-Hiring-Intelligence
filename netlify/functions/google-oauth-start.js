import { authorizeRequest } from './_shared/auth.js';
import { json, requestBody } from './_shared/responses.js';
import { authorizationUrl, googleConfiguration } from './_shared/google-workspace.js';
export function createGoogleOAuthStart({
  authorize = authorizeRequest,
  configuration = googleConfiguration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required.' });
    if (event.isBase64Encoded || Buffer.byteLength(event.body || '', 'utf8') > 2000)
      return json(400, { error: 'Choose a configured Google capability.' });
    try {
      const config = configuration(),
        body = requestBody(event);
      if (
        !body ||
        !['mailbox', 'calendar'].includes(body.kind) ||
        JSON.stringify(body).length > 2000
      )
        return json(400, { error: 'Choose a configured Google capability.' });
      const { supabase, membership } = await authorize(event, { write: true });
      if (membership.role !== 'admin') return json(403, { error: 'Administrator required.' });
      const { data, error } = await supabase.rpc('api_google_collaboration', {
        p_action: 'oauth-start',
        p_operation: body.operation,
        p_head: body.head,
        p_payload: { kind: body.kind },
      });
      if (error || !data?.ticket) throw Error('OAuth owner gate failed.');
      return json(200, { url: authorizationUrl(data, config) });
    } catch {
      return json(403, {
        error: 'Google authorization could not start. Review configuration, owner access and MFA.',
      });
    }
  };
}
export const handler = createGoogleOAuthStart();
