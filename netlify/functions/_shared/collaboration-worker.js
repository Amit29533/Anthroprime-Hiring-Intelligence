import { createHash } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Configuration } from './r2.js';
import {
  createGoogleAdapter,
  googleConfiguration,
  credentialAad,
  unseal,
} from './google-workspace.js';

export async function collaborationRpc(client, action, payload) {
  const { data, error } = await client.rpc('worker_google_collaboration', {
    p_action: action,
    p_payload: payload,
  });
  if (error || !data)
    throw Error('Google collaboration transition failed; refresh server history.');
  return data;
}
export async function quarantineAttachment(
  bytes,
  manifest,
  { storage = r2Configuration, before = async () => {} } = {},
) {
  const { client, bucket } = storage();
  await before();
  try {
    const r = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifest.path,
        Body: bytes,
        ContentType: manifest.mime,
        IfNoneMatch: '*',
        Metadata: { sha256: manifest.hash },
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
    if (!r.ETag) throw Error('Immutable upload receipt missing.');
    return r.ETag;
  } catch (e) {
    if (e.$metadata?.httpStatusCode !== 412 && e.name !== 'PreconditionFailed') throw e;
    // A lost acknowledgement can leave the original in place. Verify its bytes, never overwrite it.
    await before();
    const old = await client.send(new GetObjectCommand({ Bucket: bucket, Key: manifest.path }), {
      abortSignal: AbortSignal.timeout(5000),
    });
    if (old.ContentLength !== bytes.length || old.Metadata?.sha256 !== manifest.hash || !old.ETag)
      throw Error('Immutable original conflict.', { cause: e });
    let size = 0;
    const chunks = [];
    for await (const chunk of old.Body) {
      size += chunk.length;
      if (size > 5242880) {
        old.Body.destroy();
        throw Error('Immutable original exceeds limit.', { cause: e });
      }
      chunks.push(chunk);
    }
    if (createHash('sha256').update(Buffer.concat(chunks)).digest('hex') !== manifest.hash)
      throw Error('Immutable original digest mismatch.', { cause: e });
    return old.ETag;
  }
}
export async function runCollaborationJob(
  client,
  {
    adapter = createGoogleAdapter,
    configuration = googleConfiguration,
    upload = quarantineAttachment,
    now = () => Date.now(),
  } = {},
) {
  const lease = await collaborationRpc(client, 'claim', {});
  if (['idle', 'suppressed'].includes(lease.mode)) return { status: lease.mode };
  const deadline = now() + 22000;
  const gate = () => {
    if (now() > deadline - 7000) throw Error('Google job budget exhausted.');
    return collaborationRpc(client, 'gate', lease);
  };
  const initial = await gate(),
    config = configuration();
  const credential = unseal(initial.credentials, credentialAad(initial), config.key);
  const provider = adapter({ config, before: gate, now });
  try {
    await provider.refresh(credential);
    if (lease.mode === 'sync') {
      const g = await gate();
      if (g.kind === 'calendar') {
        const channel = await provider.renewChannel(g);
        if (channel) {
          await collaborationRpc(client, 'channel', { ...lease, channel });
          // Channel IDs change on every renewal. Old hints are rejected even if stopping fails.
          try {
            await provider.stopChannel(g.channel);
          } catch {
            /* expiry and periodic reconciliation provide recovery */
          }
        }
      }
      const page =
        g.kind === 'mailbox' ? await provider.syncMailbox(g) : await provider.syncCalendar(g);
      await collaborationRpc(client, 'sync-finish', { ...lease, ...page });
      return { status: 'synchronized' };
    }
    const g = await gate();
    let result;
    if (g.operation === 'attachment') {
      const bytes = await provider.attachment(g),
        hash = createHash('sha256').update(bytes).digest('hex');
      const reservation = await collaborationRpc(client, 'attachment-reserve', {
        ...lease,
        hash,
        size: bytes.length,
      });
      const etag = await upload(bytes, reservation, { before: gate });
      await collaborationRpc(client, 'attachment-uploaded', { ...lease, etag });
      result = { outcome: 'accepted', providerId: reservation.id };
    } else if (g.operation === 'send')
      result =
        lease.mode === 'reconcile'
          ? await provider.reconcileSend(g, lease)
          : await provider.send(g, lease);
    else result = await provider.calendarWork(g, lease, lease.mode === 'reconcile');
    await collaborationRpc(client, 'finish', { ...lease, ...result });
    return { status: result.outcome };
  } catch (e) {
    if (lease.mode === 'sync') {
      await collaborationRpc(client, e.code === 'cursor-expired' ? 'sync-reset' : 'sync-error', {
        ...lease,
        code: e.code === 'reauthorize' ? 'reauthorize' : 'unavailable',
      });
      return { status: 'sync-deferred' };
    }
    // If the final gate fails or the DB acknowledgement is lost, leave the leased intent for expiry/reconciliation.
    // Never turn an uncertain write into a retryable failure.
    try {
      await collaborationRpc(client, 'finish', { ...lease, outcome: 'ambiguous' });
    } catch {
      /* lease expiry records ambiguity */
    }
    return { status: 'uncertain' };
  }
}
