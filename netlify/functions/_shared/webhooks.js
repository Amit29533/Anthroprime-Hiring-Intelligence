import { createHmac, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export function publicAddress(address) {
  // Reject private/reserved/mapped/tunnel addresses, including IPv6 6to4 and Teredo.
  return isIP(address) !== 0 && ipaddr.parse(address).range() === 'unicast';
}
export async function webhookTarget(raw, resolve = lookup) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash ||
    url.hostname.length > 253
  )
    throw new Error('Webhook requires a public HTTPS URL on port 443.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let timer;
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await Promise.race([
        resolve(host, { all: true }),
        new Promise((_done, reject) => {
          timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), 2000);
        }),
      ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
    throw new Error('Webhook target must resolve only to public addresses.');
  return { url, address: addresses[0] };
}
export function webhookSignature(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
export function verifyWebhook(
  secret,
  timestamp,
  body,
  signature,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    !/^\d{10}$/.test(String(timestamp)) ||
    Math.abs(now - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(signature || '')
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(webhookSignature(secret, timestamp, body), 'hex'),
  );
}
// Pin DNS to the validated address and reject redirects; do not log signed bodies/secrets.
export async function deliverWebhook(job, { resolve = lookup, request = https.request } = {}) {
  const { url, address } = await webhookTarget(job.url, resolve);
  const body = JSON.stringify(job.event),
    timestamp = String(Math.floor(Date.now() / 1000));
  return new Promise((resolveResult, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        family: address.family,
        lookup: (_hostname, options, cb) =>
          options.all ? cb(null, [address]) : cb(null, address.address, address.family),
        timeout: 5000,
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Anthroprime-Event-Id': job.event.id,
          'Anthroprime-Timestamp': timestamp,
          'Anthroprime-Signature': `v1=${webhookSignature(job.secret, timestamp, body)}`,
        },
      },
      (res) => {
        res.resume();
        resolveResult(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook timed out.')));
    req.on('error', reject);
    req.end(body);
  });
}
export async function runWebhookBatch(client, deliver = deliverWebhook) {
  const { data: jobs, error } = await client.rpc('worker_claim_webhooks', { p_limit: 2 });
  if (error) throw new Error('Webhook queue is unavailable.');
  for (const job of jobs || []) {
    let ok = false;
    try {
      ok = await deliver(job);
    } catch {
      /* bounded retry; no receiver content or credentials in logs */
    }
    const { error: finishError } = await client.rpc('worker_finish_webhook', {
      p_id: job.id,
      p_lease: job.lease,
      p_ok: ok,
      p_error: ok ? '' : 'Target rejected the delivery or could not be reached.',
    });
    if (finishError) throw new Error('Webhook completion could not be recorded.');
  }
  return { attempted: (jobs || []).length };
}
