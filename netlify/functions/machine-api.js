import { createHash } from 'node:crypto';
import { executionClient } from './_shared/execution.js';
import { json, requestBody } from './_shared/responses.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createMachineHandler({ client = executionClient } = {}) {
  return async (event) => {
    const action = event.queryStringParameters?.action;
    const read = ['events', 'jobs', 'mappings'].includes(action);
    if (!['candidate', 'demand', 'events', 'jobs', 'mappings'].includes(action))
      return json(400, { error: 'Unknown action.' });
    if (event.httpMethod !== (read ? 'GET' : 'POST'))
      return json(405, { error: 'Method not allowed.' });
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(
      /^Bearer /,
      '',
    );
    if (!/^anthro_m_[0-9a-f]{64}$/.test(token))
      return json(401, { error: 'Machine credential required.' });
    if (Buffer.byteLength(event.body || '', 'utf8') > 40000 || event.isBase64Encoded)
      return json(413, { error: 'Request is too large or encoded.' });
    let request;
    if (read) {
      const value = event.queryStringParameters?.[action === 'events' ? 'after' : 'offset'] || '0';
      if (
        !/^\d{1,19}$/.test(value) ||
        (action === 'events' ? BigInt(value) > 9223372036854775807n : Number(value) > 10000)
      )
        return json(400, { error: 'Invalid page cursor.' });
      request = action === 'events' ? { after: value } : { offset: Number(value) };
    } else {
      const body = requestBody(event);
      const operationId = event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'];
      if (
        !uuid.test(operationId || '') ||
        typeof body?.externalId !== 'string' ||
        !body.body ||
        Array.isArray(body.body) ||
        typeof body.body !== 'object' ||
        (body.version != null && (!Number.isInteger(body.version) || body.version < 0))
      )
        return json(400, {
          error: 'UUID Idempotency-Key, externalId, body and valid version required.',
        });
      request = {
        operationId,
        externalId: body.externalId,
        body: body.body,
        version: body.version ?? null,
      };
    }
    try {
      const { data, error } = await client().rpc('api_machine_dispatch', {
        p_hash: createHash('sha256').update(token).digest('hex'),
        p_action: action,
        p_request: request,
      });
      if (error)
        return json(
          error.code === '42501'
            ? 403
            : ['40001', '23505'].includes(error.code)
              ? 409
              : /rate limit/i.test(error.message)
                ? 429
                : 400,
          { error: error.code === '42501' ? 'Credential or scope unavailable.' : error.message },
        );
      return json(200, data);
    } catch {
      return json(503, { error: 'Machine API is unavailable.' });
    }
  };
}
export const handler = createMachineHandler();
