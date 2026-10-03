import { authorizeRequest } from './_shared/auth.js';
import { json, requestBody } from './_shared/responses.js';
export function createIntegrationHandler({ authorize = authorizeRequest } = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    if ((event.body || '').length > 40000) return json(413, { error: 'Request is too large.' });
    try {
      const { supabase } = await authorize(event, { write: true });
      const body = requestBody(event);
      if (
        !body?.candidate ||
        typeof body.source !== 'string' ||
        typeof body.externalId !== 'string'
      )
        return json(400, { error: 'Source, externalId and candidate are required.' });
      const key = event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'];
      if (!key) return json(400, { error: 'Idempotency-Key header is required.' });
      const { data, error } = await supabase.rpc('api_integrate_candidate', {
        p_source: body.source,
        p_external_id: body.externalId,
        p_key: key,
        p_candidate: body.candidate,
        p_version: body.version ?? null,
      });
      if (error)
        return json(
          ['23505', '40001'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 400,
          { error: error.message },
        );
      return json(200, data);
    } catch (error) {
      return json(error.statusCode || 503, {
        error: error.statusCode ? error.message : 'Integration service is unavailable.',
      });
    }
  };
}
export const handler = createIntegrationHandler();
