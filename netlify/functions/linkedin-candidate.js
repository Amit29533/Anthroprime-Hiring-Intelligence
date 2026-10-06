import { authorizeRequest } from './_shared/auth.js';
import { httpError, json, requestBody } from './_shared/responses.js';
import { linkedinLookup } from '../../src/linkedin.js';
import { enrichLinkedin, linkedinConfiguration } from './_shared/linkedin.js';
export function createLinkedinHandler({
  authorize = authorizeRequest,
  lookup = enrichLinkedin,
  configuration = linkedinConfiguration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const { supabase, membership } = await authorize(event, { write: true });
      if (!['admin', 'recruiter'].includes(membership.role))
        throw httpError(403, 'Candidate import requires an editor role.');
      if ((event.body || '').length > 2000) throw httpError(400, 'Request is too large.');
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      const config = configuration();
      if (body.action === 'status') {
        const { data, error } = await supabase.rpc('api_linkedin_import_status');
        if (error)
          throw httpError(
            409,
            'Apply the LinkedIn import migration before enabling provider lookup.',
          );
        return json(200, {
          ...data,
          configured: Boolean(config.enabled && config.key),
          provider: 'People Data Labs',
        });
      }
      if (body.action !== 'lookup') throw httpError(400, 'Choose a LinkedIn lookup action.');
      let profile;
      try {
        const input = linkedinLookup(body.profile);
        profile = input.id || input.profile;
      } catch (err) {
        throw httpError(400, err.message);
      }
      if (!config.enabled || !config.key)
        throw httpError(
          409,
          'LinkedIn lookup is not configured. Use pasted profile text or configure the provider.',
        );
      const { data: allowed, error } = await supabase.rpc('api_reserve_linkedin_lookup');
      if (error)
        throw httpError(
          403,
          'Lookup permission could not be verified. Verify MFA if required and check workspace access.',
        );
      if (!allowed?.enabled)
        throw httpError(409, 'An administrator must enable LinkedIn lookup for this workspace.');
      if (!allowed.allowed)
        throw httpError(
          429,
          'Workspace lookup limit reached (20 attempts per UTC day). Paste profile text instead.',
        );
      return json(200, await lookup(profile, { configuration: config }));
    } catch (err) {
      const code = Number(err?.statusCode) || 500;
      return json(code, {
        error:
          code >= 500
            ? 'LinkedIn lookup is temporarily unavailable or returned an invalid profile.'
            : err.message,
      });
    }
  };
}
export const handler = createLinkedinHandler();
