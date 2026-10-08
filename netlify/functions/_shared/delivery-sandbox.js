// Fictional provider only. No recipient, message text, URL or credentials enter this adapter.
import { createHmac, timingSafeEqual } from 'node:crypto';
export const deliveryCapabilities = Object.freeze({
  mode: 'fictional',
  idempotency: true,
  callback: 'hmac-sha256',
  deliveryEvidence: 'fictional receipt',
  live: false,
});
export async function deliveryRpc(client, action, payload) {
  const { data, error } = await client.rpc('worker_delivery_sandbox', {
    p_action: action,
    p_payload: payload,
  });
  if (error) throw Error('Sandbox operation failed; inspect redacted server history.');
  return data;
}
export async function dispatchFictional(client, lease, gate) {
  if (gate.adapter !== 'fictional') throw Error('Unsupported delivery adapter.');
  const result = await deliveryRpc(client, 'sink', lease);
  if (gate.scenario === 'accepted-timeout' && result.outcome === 'accepted') return 'ambiguous';
  if (result.outcome === 'unknown') return 'ambiguous';
  if (result.outcome === 'accepted' && ['duplicate', 'reordered'].includes(gate.scenario)) {
    const delivered = {
      workspace: gate.workspace,
      intent: lease.id,
      generation: gate.generation,
      eventId: `fixture:${lease.id}:delivered`,
      messageId: result.messageId,
      type: 'Delivered',
      at: new Date().toISOString(),
    };
    await deliveryRpc(client, 'event', delivered);
    if (gate.scenario === 'duplicate') await deliveryRpc(client, 'event', delivered);
    else
      await deliveryRpc(client, 'event', {
        ...delivered,
        eventId: `fixture:${lease.id}:accepted-late`,
        type: 'Provider accepted',
        at: new Date(Date.parse(delivered.at) - 1000).toISOString(),
      });
  }
  return result.outcome;
}
export function verifySandboxCallback(raw, headers, secret, now = Date.now()) {
  const timestamp = headers['x-delivery-timestamp'],
    signature = headers['x-delivery-signature'];
  if (typeof secret !== 'string' || secret.length < 32)
    throw Error('Callback verification is not configured.');
  if (
    typeof raw !== 'string' ||
    Buffer.byteLength(raw) > 8192 ||
    !/^\d{10}$/.test(timestamp || '') ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature || '')
  )
    throw Error('Invalid sandbox callback authentication.');
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.' + raw)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw Error('Invalid sandbox callback authentication.');
  const body = JSON.parse(raw),
    keys = ['workspace', 'intent', 'generation', 'eventId', 'messageId', 'type', 'at'];
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== keys.length ||
    Object.keys(body).some((k) => !keys.includes(k)) ||
    !Number.isInteger(body.generation) ||
    body.generation < 1 ||
    body.generation > 2147483647 ||
    !['Provider accepted', 'Delivered', 'Bounced'].includes(body.type) ||
    typeof body.eventId !== 'string' ||
    body.eventId.length < 1 ||
    body.eventId.length > 100 ||
    typeof body.messageId !== 'string' ||
    body.messageId !== `sandbox:${body.intent}` ||
    typeof body.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.at) ||
    !Number.isFinite(Date.parse(body.at)) ||
    ![body.workspace, body.intent].every((x) =>
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x),
    )
  )
    throw Error('Invalid normalized sandbox callback.');
  return body;
}
