import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleAdapter,
  seal,
  unseal,
  credentialAad,
  authorizationUrl,
  readOAuthState,
  normalizeMessage,
  mimeMessage,
  validChannelHeaders,
  googleScopes,
} from '../netlify/functions/_shared/google-workspace.js';
import { runCollaborationJob } from '../netlify/functions/_shared/collaboration-worker.js';
import { createGoogleCalendarCallback } from '../netlify/functions/google-calendar-callback.js';
import { createGoogleOAuthCallback } from '../netlify/functions/google-oauth-callback.js';
import { resolveZonedTime, zonedCandidates } from '../src/schedulingTime.js';
import { parseICS, icsForInterview } from '../src/calendar.js';
const config = {
  key: 'ab'.repeat(32),
  origin: 'https://example.invalid',
  clientId: 'fictional.apps.googleusercontent.com',
  clientSecret: 'fictional',
  redirect: 'https://example.invalid/.netlify/functions/google-oauth-callback',
};
const uid = '79000000-0000-4000-8000-000000000001';
const gate = {
  workspace: uid,
  kind: 'mailbox',
  generation: 1,
  account: 'sender@example.invalid',
  calendarId: 'primary',
};
test('OAuth state and credential custody bind purpose, generation, expiry and PKCE', () => {
  const envelope = seal({ refresh_token: 'fictional secret' }, credentialAad(gate), config.key);
  assert.equal(unseal(envelope, credentialAad(gate), config.key).refresh_token, 'fictional secret');
  assert.throws(() => unseal(envelope, credentialAad({ ...gate, generation: 2 }), config.key));
  assert.throws(() =>
    unseal({ ...envelope, tag: '00'.repeat(16) }, credentialAad(gate), config.key),
  );
  const url = new URL(
    authorizationUrl({ ticket: uid, kind: 'mailbox', account: gate.account }, config, 10000),
  );
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = readOAuthState(url.searchParams.get('state'), config.key, 10001);
  assert.equal(state.ticket, uid);
  assert.equal(state.verifier.length, 43);
  assert.throws(() => readOAuthState(url.searchParams.get('state'), config.key, 610001), /expired/);
  assert.throws(() => readOAuthState('x'.repeat(4001), config.key), /Invalid/);
});
test('wall clock resolution rejects gaps, forces fold choice and supports quarter-hour zones', () => {
  assert.deepEqual(zonedCandidates('2026-03-08T02:30', 'America/New_York'), []);
  assert.throws(() => resolveZonedTime('2026-03-08T02:30', 'America/New_York'), /does not exist/);
  const fold = zonedCandidates('2026-11-01T01:30', 'America/New_York');
  assert.deepEqual(fold, ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
  assert.throws(() => resolveZonedTime('2026-11-01T01:30', 'America/New_York'), /twice/);
  assert.equal(resolveZonedTime('2026-11-01T01:30', 'America/New_York', fold[1]), fold[1]);
  assert.equal(resolveZonedTime('2026-10-08T10:00', 'Asia/Kathmandu'), '2026-10-08T04:15:00.000Z');
  assert.throws(() => zonedCandidates('2026-02-30T10:00', 'UTC'), /Invalid/);
});
test('manual ICS fallback honors TZID, exposes ambiguous times and folds UTF-8 octets', () => {
  const event = parseICS(
    'BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20261101T013000\r\nEND:VEVENT',
  )[0];
  assert.equal(event.start, null);
  assert.match(event.timeIssue, /twice/);
  const ics = icsForInterview(
    {
      id: uid,
      status: 'Scheduled',
      scheduledAt: '2026-10-10T10:00:00Z',
      round: '😀'.repeat(100),
      mode: 'Video',
      durationMins: 45,
    },
    { name: 'Example' },
    null,
  );
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 74));
});
test('delivery-status reports require structured failure evidence and exact original identity', () => {
  const original = `<anthro-${uid}@example.invalid>`,
    data = (s) => Buffer.from(s).toString('base64url');
  const m = normalizeMessage({
    id: 'dsn',
    threadId: 'dsn-thread',
    payload: {
      parts: [
        {
          mimeType: 'message/delivery-status',
          body: {
            data: data(
              'Final-Recipient: rfc822; candidate@example.invalid\r\nAction: failed\r\nStatus: 5.1.1\r\n',
            ),
          },
        },
        {
          filename: 'original.eml',
          partId: '2',
          mimeType: 'message/rfc822',
          body: { data: data(`Message-ID: ${original}\r\n`), size: 128 },
        },
      ],
    },
  });
  assert.deepEqual(m.body.bounce, {
    originalMessageId: original,
    recipient: 'candidate@example.invalid',
    status: '5.1.1',
    action: 'failed',
  });
  assert.equal(m.attachments[0].name, 'original.eml');
  assert.equal(m.body.text, '');
});
test('plain-text MIME and inbox normalization reject injection and omit active HTML', () => {
  const raw = mimeMessage(
    { recipient: 'candidate@example.invalid', subject: 'Interview 😀', text: 'Example' },
    gate.account,
    uid,
  );
  assert.ok(raw.includes(`Message-ID: <anthro-${uid}@example.invalid>`));
  assert.ok(raw.includes('Content-Transfer-Encoding: base64'));
  assert.throws(() =>
    mimeMessage(
      { recipient: 'victim@example.invalid\r\nBcc: x@e.com', subject: 'Hello', text: 'x' },
      gate.account,
      uid,
    ),
  );
  const m = normalizeMessage({
    id: 'abc',
    threadId: 'thread',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'Subject', value: 'Example' }],
      parts: [
        {
          mimeType: 'text/html',
          body: { data: Buffer.from('<script>bad()</script>').toString('base64url') },
        },
        {
          partId: '2',
          filename: 'cv.txt',
          mimeType: 'text/plain',
          body: { attachmentId: 'att', size: 3 },
        },
      ],
    },
  });
  assert.equal(m.body.text, '');
  assert.equal(m.body.htmlOmitted, true);
  assert.equal(m.attachments.length, 1);
  assert.ok(!JSON.stringify(m).includes('script'));
});
test('Gmail lost send acknowledgement stays ambiguous and reconciliation uses stable message identity', async () => {
  const calls = [];
  let gates = 0;
  const adapter = createGoogleAdapter({
    config,
    before: async () => {
      gates++;
    },
    fetcher: async (url) => {
      calls.push(url);
      if (url.includes('/token')) return Response.json({ access_token: 'fixture' });
      throw Error('Acknowledgement lost');
    },
  });
  await adapter.refresh({ refresh_token: 'fixture' });
  const result = await adapter.send(
    {
      ...gate,
      preview: { recipient: 'candidate@example.invalid', subject: 'Hello', text: 'Example' },
    },
    { id: uid },
  );
  assert.equal(result.outcome, 'ambiguous');
  assert.equal(calls.filter((x) => x.includes('/messages/send')).length, 1);
  assert.equal(gates, 2);
  const reconcile = createGoogleAdapter({
    config,
    fetcher: async (url) => {
      calls.push(url);
      return url.includes('/messages/abc')
        ? Response.json({
            id: 'abc',
            payload: {
              headers: [{ name: 'Message-ID', value: `<anthro-${uid}@example.invalid>` }],
            },
          })
        : Response.json({ messages: [{ id: 'abc' }] });
    },
  });
  assert.equal((await reconcile.reconcileSend(gate, { id: uid })).outcome, 'accepted');
  assert.ok(calls.some((x) => x.includes('rfc822msgid')));
});
test('Gmail cursor expiry and expanded history preserve the checkpoint by forcing full reconciliation', async () => {
  const gone = createGoogleAdapter({
    config,
    fetcher: async () => new Response('', { status: 404 }),
  });
  await assert.rejects(
    gone.syncMailbox({ ...gate, fullSync: false, cursor: '10' }),
    (e) => e.code === 'cursor-expired',
  );
  const over = createGoogleAdapter({
    config,
    fetcher: async () =>
      Response.json({
        history: [
          { messagesAdded: Array.from({ length: 11 }, (_, i) => ({ message: { id: String(i) } })) },
        ],
        historyId: '20',
      }),
  });
  await assert.rejects(
    over.syncMailbox({ ...gate, fullSync: false, cursor: '10' }),
    (e) => e.code === 'cursor-expired',
  );
});
test('OAuth requires complete scopes, a verified matching account and an offline refresh grant', async () => {
  let calls = 0;
  const provider = createGoogleAdapter({
    config,
    fetcher: async () => {
      calls++;
      return Response.json({
        access_token: 'fixture',
        refresh_token: 'fixture',
        scope: googleScopes.mailbox.join(' '),
      });
    },
  });
  await assert.rejects(
    provider.exchange(
      'fixture',
      { kind: 'mailbox', verifier: 'fixture' },
      { ...gate, kind: 'mailbox' },
    ),
    (e) => e.code === 'wrong-account',
  );
  assert.equal(calls, 2);
  const missing = createGoogleAdapter({
    config,
    fetcher: async () => Response.json({ access_token: 'fixture', scope: 'openid email' }),
  });
  await assert.rejects(
    missing.exchange('fixture', { kind: 'mailbox', verifier: 'fixture' }, gate),
    (e) => e.code === 'missing-scope',
  );
});
test('calendar writes use stable IDs, If-Match and an immediate authoritative free/busy gate', async () => {
  const calls = [];
  const adapter = createGoogleAdapter({
    config,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return url.includes('freeBusy')
        ? Response.json({ calendars: { primary: { busy: [] } } })
        : Response.json({ id: 'abc', etag: 'v2' });
    },
  });
  const booking = {
    provider_id: 'abc',
    starts_at: '2026-10-10T10:00:00Z',
    ends_at: '2026-10-10T10:45:00Z',
    zone: 'UTC',
    etag: 'v1',
  };
  const result = await adapter.calendarWork(
    {
      ...gate,
      kind: 'calendar',
      operation: 'reschedule',
      booking,
      preview: { recipient: 'candidate@example.invalid', subject: 'Example', text: 'Example' },
    },
    { id: uid },
  );
  assert.equal(result.outcome, 'accepted');
  assert.equal(calls[1].options.headers['If-Match'], 'v1');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(JSON.parse(calls[1].options.body).extendedProperties.private.operation, uid);
  const blocked = createGoogleAdapter({
    config,
    fetcher: async () =>
      Response.json({
        calendars: { primary: { busy: [{ start: booking.starts_at, end: booking.ends_at }] } },
      }),
  });
  assert.equal(
    (
      await blocked.calendarWork(
        { ...gate, kind: 'calendar', operation: 'book', booking, preview: {} },
        { id: uid },
      )
    ).outcome,
    'permanent',
  );
});
test('calendar hints validate bounded authentication fields and never accept event truth from the callback', async () => {
  const h = {
    'x-goog-channel-id': uid,
    'x-goog-channel-token': 'ab'.repeat(32),
    'x-goog-resource-id': 'resource',
    'x-goog-message-number': '2',
    'x-goog-resource-state': 'exists',
  };
  assert.equal(validChannelHeaders(h).number, '2');
  assert.throws(() => validChannelHeaders({ ...h, 'x-goog-channel-token': 'bad' }));
  let payload;
  const handler = createGoogleCalendarCallback({
    client: () => ({
      rpc: async (_, args) => {
        payload = args.p_payload;
        return { data: { status: 'Hint recorded' } };
      },
    }),
  });
  assert.equal((await handler({ httpMethod: 'POST', headers: h, body: '' })).statusCode, 204);
  assert.deepEqual(Object.keys(payload), ['channel', 'token', 'resourceId', 'number']);
  assert.equal((await handler({ httpMethod: 'POST', headers: {}, body: '' })).statusCode, 403);
});
test('worker final-gate revocation blocks network and never silently resends an uncertain write', async () => {
  const credentials = seal({ refresh_token: 'fixture' }, credentialAad(gate), config.key);
  let network = 0,
    claims = 0;
  const client = {
    rpc: async (_, args) => {
      if (args.p_action === 'claim') {
        claims++;
        return { data: { mode: 'work', id: uid, workspace: uid, kind: 'mailbox', lease: uid } };
      }
      if (args.p_action === 'gate')
        return { data: { ...gate, credentials, operation: 'send', preview: {} } };
      if (args.p_action === 'finish') return { error: { message: 'Acknowledgement lost' } };
      return { data: {} };
    },
  };
  const result = await runCollaborationJob(client, {
    configuration: () => config,
    adapter: ({ before }) => ({
      refresh: async () => before(),
      send: async () => {
        await before();
        network++;
        return { outcome: 'ambiguous' };
      },
    }),
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(network, 1);
  assert.equal(claims, 1);
  let count = 0;
  const revoked = {
    rpc: async (_, args) => {
      if (args.p_action === 'claim')
        return { data: { mode: 'work', id: uid, workspace: uid, kind: 'mailbox', lease: uid } };
      if (args.p_action === 'gate' && ++count === 1) return { data: { ...gate, credentials } };
      return { error: { message: 'revoked' } };
    },
  };
  await runCollaborationJob(revoked, {
    configuration: () => config,
    adapter: ({ before }) => ({
      refresh: async () => {
        await before();
        network++;
      },
    }),
  });
  assert.equal(network, 1);
});
test('OAuth callback pages redact codes, credentials and failures', async () => {
  const handler = createGoogleOAuthCallback({
    configuration: () => config,
    client: () => {
      throw Error('private server secret');
    },
  });
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { state: 'invalid', code: 'private-code' },
  });
  assert.equal(response.statusCode, 400);
  assert.ok(!response.body.includes('private'));
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
});
test('calendar reconciliation rejects a matching operation with externally moved times', async () => {
  const booking = {
    provider_id: 'event',
    starts_at: '2026-10-10T10:00:00Z',
    ends_at: '2026-10-10T10:45:00Z',
  };
  const event = {
    id: 'event',
    status: 'confirmed',
    extendedProperties: { private: { operation: uid } },
    start: { dateTime: '2026-10-10T11:00:00Z' },
    end: { dateTime: '2026-10-10T11:45:00Z' },
    attendees: [{ email: 'candidate@example.invalid' }],
  };
  const adapter = createGoogleAdapter({ config, fetcher: async () => Response.json(event) });
  assert.equal(
    (
      await adapter.calendarWork(
        {
          ...gate,
          kind: 'calendar',
          operation: 'reschedule',
          booking,
          preview: { recipient: 'candidate@example.invalid' },
        },
        { id: uid },
        true,
      )
    ).outcome,
    'not-found',
  );
  event.start.dateTime = booking.starts_at;
  event.end.dateTime = booking.ends_at;
  assert.equal(
    (
      await adapter.calendarWork(
        {
          ...gate,
          kind: 'calendar',
          operation: 'reschedule',
          booking,
          preview: { recipient: 'candidate@example.invalid' },
        },
        { id: uid },
        true,
      )
    ).outcome,
    'accepted',
  );
});
test('calendar subscriptions renew before expiry and stop the previous resource channel', async () => {
  const calls = [];
  const now = Date.parse('2026-10-08T10:00:00Z');
  const adapter = createGoogleAdapter({
    config,
    now: () => now,
    fetcher: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return url.includes('/watch')
        ? Response.json({
            id: calls.at(-1).body.id,
            resourceId: 'resource',
            expiration: String(now + 86400000),
          })
        : new Response(null, { status: 204 });
    },
  });
  assert.equal(
    await adapter.renewChannel({
      ...gate,
      channel: { expiration: new Date(now + 7200000).toISOString() },
    }),
    null,
  );
  const channel = await adapter.renewChannel(gate);
  assert.equal(channel.token.length, 64);
  assert.equal(
    calls[0].body.address,
    config.origin + '/.netlify/functions/google-calendar-callback',
  );
  await adapter.stopChannel({ id: 'old', resourceId: 'old-resource' });
  assert.equal(calls[1].body.id, 'old');
});
test('immutable attachment imports verify existing bytes after a lost upload acknowledgement', async () => {
  const { quarantineAttachment } = await import(
    '../netlify/functions/_shared/collaboration-worker.js'
  );
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('abc'),
    manifest = {
      path: 'workspace/candidate/original.txt',
      mime: 'text/plain',
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  let count = 0;
  const storage = () => ({
    bucket: 'private',
    client: {
      send: async (command) => {
        if (++count === 1) {
          assert.equal(command.input.IfNoneMatch, '*');
          const error = Error('Exists');
          error.name = 'PreconditionFailed';
          throw error;
        }
        return {
          ContentLength: 3,
          Metadata: { sha256: manifest.hash },
          ETag: 'fixture',
          Body: (async function* () {
            yield bytes;
          })(),
        };
      },
    },
  });
  assert.equal(await quarantineAttachment(bytes, manifest, { storage }), 'fixture');
});
