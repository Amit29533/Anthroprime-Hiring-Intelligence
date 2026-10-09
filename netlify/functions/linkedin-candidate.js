import { authorizeRequest } from './_shared/auth.js';
import { httpError, json, requestBody } from './_shared/responses.js';
import { linkedinLookup } from '../../src/linkedin.js';
import {
  enrichLinkedin,
  linkedinConfiguration,
  scrapeLinkedinSession,
  sessionScraperConfiguration,
} from './_shared/linkedin.js';
import { executionClient } from './_shared/execution.js';
import { workflowRpc } from './_shared/controlled-workflows.js';
export function createLinkedinHandler({
  authorize = authorizeRequest,
  lookup = enrichLinkedin,
  configuration = linkedinConfiguration,
  sessionLookup = scrapeLinkedinSession,
  sessionConfiguration = sessionScraperConfiguration,
  service = () => executionClient(3000),
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const { supabase, membership, user } = await authorize(event, { write: true });
      if (!['admin', 'recruiter'].includes(membership.role))
        throw httpError(403, 'Candidate import requires an editor role.');
      if ((event.body || '').length > 2000) throw httpError(400, 'Request is too large.');
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      const config = configuration(),
        session = sessionConfiguration();
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
          sessionWorker: session.enabled,
          provider: 'People Data Labs',
        });
      }
      const viaSession = body.action === 'session-lookup';
      if (body.action !== 'lookup' && !viaSession)
        throw httpError(400, 'Choose a LinkedIn lookup action.');
      let profile;
      try {
        const input = linkedinLookup(body.profile);
        profile = input.id || input.profile;
      } catch (err) {
        throw httpError(400, err.message);
      }
      if (viaSession) {
        if (!session.enabled)
          throw httpError(
            409,
            'The LinkedIn session worker is not configured. Use pasted profile text instead.',
          );
        if (linkedinLookup(profile).id)
          throw httpError(400, 'Session lookup needs a profile URL or handle, not a numeric ID.');
      } else if (!config.enabled || !config.key)
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
      const worker = service(),
        gateRequest = { workspace: membership.workspace_id, actor: user.id, profile };
      const gate = await workflowRpc(worker, 'legacy-enrichment-gate', gateRequest);
      await workflowRpc(worker, 'legacy-enrichment-gate', {
        ...gateRequest,
        generation: gate.generation,
      });
      const result = viaSession
        ? await sessionLookup(profile, { configuration: session })
        : await lookup(profile, { configuration: config });
      await workflowRpc(worker, 'legacy-enrichment-gate', {
        ...gateRequest,
        generation: gate.generation,
      });
      return json(200, result);
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
