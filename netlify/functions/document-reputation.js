import { authorizeRequest } from './_shared/auth.js';
import { httpError, json, requestBody } from './_shared/responses.js';
import { lookupVirusTotal, virusTotalConfiguration } from './_shared/virustotal.js';

export function createReputationHandler({
  authorize = authorizeRequest,
  lookup = lookupVirusTotal,
  configuration = virusTotalConfiguration,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    try {
      const { supabase, membership } = await authorize(event);
      if (membership.role !== 'admin')
        throw httpError(403, 'Only workspace administrators can check document reputation.');
      const body = requestBody(event);
      if (!body) throw httpError(400, 'Request body must be valid JSON.');
      const config = configuration();
      if (body.action === 'status')
        return json(200, {
          configured: Boolean(config.key),
          licensed: config.licensed,
          mode: 'hash-only',
        });
      if (
        body.action !== 'lookup' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.documentId || '')
      )
        throw httpError(400, 'Choose a document to check.');
      const { data: document, error } = await supabase
        .from('documents')
        .select('id,hash,removed,workspace_id')
        .eq('id', body.documentId)
        .eq('workspace_id', membership.workspace_id)
        .maybeSingle();
      if (error) throw httpError(502, 'Document metadata could not be loaded.');
      if (!document || document.removed || document.workspace_id !== membership.workspace_id)
        throw httpError(404, 'Document was not found.');
      return json(200, await lookup(document.hash, { configuration: config }));
    } catch (error) {
      // Never log provider responses, API keys, tokens or document metadata.
      const code = Number(error?.statusCode) || 500;
      return json(code, {
        error:
          code >= 500 ? 'Document reputation lookup is temporarily unavailable.' : error.message,
      });
    }
  };
}
export const handler = createReputationHandler();
