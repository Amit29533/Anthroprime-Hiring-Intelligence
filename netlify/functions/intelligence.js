import { authorizeRequest } from './_shared/auth.js';
import { executionClient } from './_shared/execution.js';
import { providerRequest } from './_shared/intelligence.js';
import { json, requestBody } from './_shared/responses.js';

export function createIntelligenceHandler({
  authorize = authorizeRequest,
  service = executionClient,
  provider = providerRequest,
} = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
    if ((event.body || '').length > 12000) return json(413, { error: 'Request is too large.' });
    let job, worker;
    try {
      const { supabase } = await authorize(event, { write: true });
      const body = requestBody(event);
      if (!['embedding', 'draft', 'query'].includes(body?.action))
        return json(400, { error: 'Invalid intelligence action.' });
      if (
        body.action === 'query' &&
        (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 4000)
      )
        return json(400, { error: 'Enter a query of up to 4000 characters.' });
      worker = service(3000);
      const reservation = await supabase.rpc('api_intelligence_reserve', {
        p_kind: body.action,
        p_id: body.action === 'query' ? null : body.candidateId,
      });
      if (reservation.error)
        return json(reservation.error.code === '42501' ? 403 : 400, {
          error: reservation.error.message,
        });
      job = reservation.data;
      const result = await provider(body.action, body.action === 'query' ? body.query : job.text);
      const completion = await worker.rpc('worker_intelligence_complete', {
        p_id: job.id,
        p_model: result.model,
        p_content: result.content || '',
        p_vector: body.action === 'embedding' ? result.embedding : null,
      });
      if (completion.error) throw new Error('Could not save AI result.');
      if (body.action === 'query') {
        const matches = await supabase.rpc('api_hosted_search', {
          p_vector: result.embedding,
          p_namespace: `openai:${result.model}:384:v1`,
        });
        if (matches.error) throw new Error('Hosted retrieval failed.');
        return json(200, { matches: matches.data });
      }
      return json(200, { id: job.id, status: body.action === 'draft' ? 'draft' : 'completed' });
    } catch (error) {
      if (job && worker) {
        try {
          await worker.rpc('worker_intelligence_complete', {
            p_id: job.id,
            p_model: '',
            p_failed: true,
          });
        } catch {
          /* Keep the reserved request counted if cleanup is unavailable. */
        }
      }
      return json(error.statusCode || 503, {
        error: error.statusCode
          ? error.message
          : 'Intelligence is unavailable. Check provider settings or refresh changed candidates.',
      });
    }
  };
}
export const handler = createIntelligenceHandler();
