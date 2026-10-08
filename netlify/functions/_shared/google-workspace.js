import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';

export const googleCapabilities = Object.freeze({
  provider: 'google-workspace',
  delivery: 'provider acceptance; no delivery guarantee',
  sendIdempotency: false,
  calendarIdempotency: 'stable event ID and conditional updates',
  mailbox: 'bounded polling and history reconciliation',
  calendar: 'watch hints and polling',
});
export const googleScopes = Object.freeze({
  mailbox: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  calendar: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/calendar.calendars.readonly',
  ],
});
export class GoogleError extends Error {
  constructor(code, status = 0) {
    super('Google operation unavailable.');
    this.code = code;
    this.status = status;
  }
}
function encryptionKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || ''))
    throw Error('Google credential encryption is not configured.');
  return Buffer.from(value, 'hex');
}
export function seal(value, aad, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(aad));
  const plain = JSON.stringify(value);
  if (Buffer.byteLength(plain) > 12000) throw Error('Credential envelope too large.');
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    cipher: encrypted.toString('base64url'),
  };
}
export function unseal(value, aad, key) {
  if (
    !value ||
    !/^[a-f0-9]{24}$/.test(value.iv || '') ||
    !/^[a-f0-9]{32}$/.test(value.tag || '') ||
    typeof value.cipher !== 'string' ||
    value.cipher.length > 20000
  )
    throw Error('Invalid credential envelope.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(key),
    Buffer.from(value.iv, 'hex'),
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.cipher, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  );
}
export const credentialAad = (c) => `google:${c.workspace}:${c.kind}:${c.generation}`;
export function googleConfiguration(env = process.env) {
  encryptionKey(env.GOOGLE_CREDENTIAL_KEY);
  const origin = new URL(env.GOOGLE_APP_ORIGIN || '');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw Error('Google app HTTPS origin is required.');
  if (!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') || !env.GOOGLE_CLIENT_SECRET)
    throw Error('Google OAuth configuration is missing.');
  return {
    origin: origin.origin,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    key: env.GOOGLE_CREDENTIAL_KEY,
    redirect: origin.origin + '/.netlify/functions/google-oauth-callback',
  };
}
export function authorizationUrl(ticket, config, now = Date.now()) {
  if (!googleScopes[ticket.kind]) throw Error('Unsupported Google capability.');
  const verifier = randomBytes(32).toString('base64url');
  const state = Buffer.from(
    JSON.stringify(
      seal(
        { ticket: ticket.ticket, verifier, kind: ticket.kind, exp: now + 600000 },
        'google-oauth-state',
        config.key,
      ),
    ),
  ).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirect,
    response_type: 'code',
    scope: googleScopes[ticket.kind].join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    login_hint: ticket.account,
  }).toString();
  return url.href;
}
export function readOAuthState(raw, key, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(raw))
    throw Error('Invalid OAuth state.');
  const state = unseal(
    JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    'google-oauth-state',
    key,
  );
  if (
    !Number.isSafeInteger(state.exp) ||
    state.exp <= now ||
    state.exp > now + 600000 ||
    !googleScopes[state.kind] ||
    !/^[a-f0-9-]{36}$/.test(state.ticket || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.verifier || '')
  )
    throw Error('OAuth state expired.');
  return state;
}
async function limitedJson(response, limit = 8 * 1024 * 1024) {
  if (Number(response.headers.get('content-length') || 0) > limit)
    throw new GoogleError('oversized');
  const reader = response.body?.getReader();
  if (!reader) throw new GoogleError('invalid-response');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new GoogleError('oversized');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GoogleError('invalid-response');
  }
}
export function createGoogleAdapter({
  fetcher = fetch,
  config = googleConfiguration(),
  before = async () => {},
  now = () => Date.now(),
} = {}) {
  let token;
  async function request(url, options = {}, bearer = token) {
    const u = new URL(url);
    if (
      ![
        'oauth2.googleapis.com',
        'gmail.googleapis.com',
        'www.googleapis.com',
        'openidconnect.googleapis.com',
      ].includes(u.hostname) ||
      u.protocol !== 'https:' ||
      u.port ||
      u.username ||
      u.password
    )
      throw new GoogleError('invalid-destination');
    await before();
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...options.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new GoogleError('uncertain');
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      throw new GoogleError(
        status === 401 ? 'reauthorize' : status === 429 || status >= 500 ? 'transient' : 'rejected',
        status,
      );
    }
    if (response.status === 204) return {};
    return limitedJson(response);
  }
  async function verifyAccount(expected, kind, credential) {
    token = credential.access_token;
    const identity = await request('https://openidconnect.googleapis.com/v1/userinfo');
    if (
      identity.email_verified !== true ||
      identity.email?.toLowerCase() !== expected.toLowerCase()
    )
      throw new GoogleError('wrong-account');
    if (kind === 'mailbox') {
      const profile = await request('https://gmail.googleapis.com/gmail/v1/users/me/profile');
      if (profile.emailAddress?.toLowerCase() !== expected.toLowerCase())
        throw new GoogleError('wrong-account');
    }
    return expected;
  }
  const gmail = (path, query = {}) =>
    'https://gmail.googleapis.com/gmail/v1/users/me/' + path + '?' + new URLSearchParams(query);
  const calendar = (id, path = '', query = {}) =>
    'https://www.googleapis.com/calendar/v3/calendars/' +
    encodeURIComponent(id) +
    path +
    '?' +
    new URLSearchParams(query);
  async function tokenRequest(body) {
    // POST token exchanges never receive the candidate payload or a browser-supplied destination.
    try {
      return await request(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            ...body,
            client_id: config.clientId,
            client_secret: config.clientSecret,
          }).toString(),
        },
        null,
      );
    } catch (e) {
      if (e.status === 400 || e.status === 401) throw new GoogleError('reauthorize');
      throw e;
    }
  }
  async function refresh(credential) {
    if (
      typeof credential.refresh_token !== 'string' ||
      !credential.refresh_token ||
      credential.refresh_token.length > 4000
    )
      throw new GoogleError('reauthorize');
    const fresh = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh_token,
    });
    if (typeof fresh.access_token !== 'string' || fresh.access_token.length > 8000)
      throw new GoogleError('invalid-response');
    token = fresh.access_token;
    return fresh;
  }
  async function exchange(code, state, ticket) {
    if (state.kind !== ticket.kind || typeof code !== 'string' || code.length > 4000 || !code)
      throw new GoogleError('invalid-state');
    const credential = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: state.verifier,
      redirect_uri: config.redirect,
    });
    const scopes = new Set(String(credential.scope || '').split(' '));
    if (
      !googleScopes[ticket.kind]
        .filter((x) => !['openid', 'email'].includes(x))
        .every((x) => scopes.has(x)) ||
      !credential.refresh_token
    )
      throw new GoogleError('missing-scope');
    await verifyAccount(ticket.account, ticket.kind, credential);
    if (ticket.kind === 'calendar') await diagnostic(ticket);
    return { refresh_token: credential.refresh_token, scope: [...scopes] };
  }
  async function diagnostic(gate) {
    const identity = await request('https://openidconnect.googleapis.com/v1/userinfo');
    if (
      identity.email_verified !== true ||
      identity.email?.toLowerCase() !== gate.account.toLowerCase()
    )
      throw new GoogleError('wrong-account');
    if (gate.kind === 'mailbox') return request(gmail('profile'));
    const resource = await request(calendar(gate.calendarId));
    if (!resource.id) throw new GoogleError('invalid-calendar');
    const acl = await request(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList/' +
        encodeURIComponent(resource.id),
    );
    if (!['owner', 'writer'].includes(acl.accessRole)) throw new GoogleError('calendar-readonly');
    return { writable: true };
  }
  async function syncMailbox(gate) {
    let baseline = gate.baseline;
    if (gate.fullSync && !baseline) baseline = (await request(gmail('profile'))).historyId;
    let page;
    try {
      page = await request(
        gmail(gate.fullSync ? 'messages' : 'history', {
          maxResults: '3',
          ...(gate.fullSync ? {} : { startHistoryId: gate.cursor }),
          ...(gate.page ? { pageToken: gate.page } : {}),
        }),
      );
    } catch (e) {
      if (e.status === 404 && !gate.fullSync) throw new GoogleError('cursor-expired');
      throw e;
    }
    const ids = new Map();
    if (gate.fullSync) for (const m of page.messages || []) ids.set(m.id, { ...m, deleted: false });
    else
      for (const h of page.history || []) {
        for (const x of [
          ...(h.messagesAdded || []),
          ...(h.labelsAdded || []),
          ...(h.labelsRemoved || []),
        ])
          ids.set(x.message.id, { ...x.message, deleted: false });
        for (const x of h.messagesDeleted || [])
          ids.set(x.message.id, { ...x.message, deleted: true });
      }
    // One history record can exceed the processing budget. Reset to paged full sync rather than advancing past unprocessed changes.
    if (ids.size > 10) throw new GoogleError('cursor-expired');
    const items = [];
    for (const m of ids.values()) {
      if (m.deleted) {
        items.push({
          id: m.id,
          thread: m.threadId || m.id,
          deleted: true,
          body: {},
          attachments: [],
        });
        continue;
      }
      try {
        items.push(
          normalizeMessage(
            await request(gmail('messages/' + encodeURIComponent(m.id), { format: 'full' })),
          ),
        );
      } catch (e) {
        if (e.status !== 404) throw e;
        items.push({
          id: m.id,
          thread: m.threadId || m.id,
          deleted: true,
          body: {},
          attachments: [],
        });
      }
    }
    return {
      items,
      page: page.nextPageToken || null,
      cursor: gate.fullSync ? baseline : page.historyId,
      baseline,
    };
  }
  async function syncCalendar(gate) {
    let page;
    try {
      page = await request(
        calendar(gate.calendarId, '/events', {
          maxResults: '3',
          showDeleted: 'true',
          ...(gate.fullSync ? {} : { syncToken: gate.cursor }),
          ...(gate.page ? { pageToken: gate.page } : {}),
        }),
      );
    } catch (e) {
      if (e.status === 410) throw new GoogleError('cursor-expired');
      throw e;
    }
    const items = (page.items || []).map((e) => ({
      id: e.id,
      status: e.status,
      updated: e.updated || new Date(now()).toISOString(),
      start: e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : null,
      rsvp:
        (e.attendees || []).find((a) => a.email === e.extendedProperties?.private?.candidateEmail)
          ?.responseStatus || 'needsAction',
      etag: e.etag,
    }));
    const windowStart = new Date(now()).toISOString(),
      windowEnd = new Date(now() + 31 * 86400000).toISOString();
    const availability = await request('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: windowStart,
        timeMax: windowEnd,
        items: [{ id: gate.calendarId }],
      }),
    });
    const result = availability.calendars?.[gate.calendarId];
    if (!result || result.errors?.length || !Array.isArray(result.busy) || result.busy.length > 500)
      throw new GoogleError('availability-unavailable');
    return {
      items,
      page: page.nextPageToken || null,
      cursor: page.nextSyncToken || gate.cursor,
      busy: result.busy,
      windowStart,
      windowEnd,
    };
  }
  async function renewChannel(gate) {
    if (gate.channel && Date.parse(gate.channel.expiration) > now() + 3600000) return null;
    const id = cryptoUuid(),
      secret = randomBytes(32).toString('hex');
    const ch = await request(calendar(gate.calendarId, '/events/watch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        type: 'web_hook',
        address: config.origin + '/.netlify/functions/google-calendar-callback',
        token: secret,
        expiration: String(now() + 86400000),
      }),
    });
    if (ch.id !== id || !ch.resourceId || !Number.isFinite(Number(ch.expiration)))
      throw new GoogleError('invalid-channel');
    // The old channel is allowed to expire if stopping it fails. Generation/token binding rejects stale hints.
    return {
      id,
      token: secret,
      resourceId: ch.resourceId,
      expiration: new Date(Number(ch.expiration)).toISOString(),
      number: '0',
    };
  }
  async function stopChannel(channel) {
    if (!channel?.id || !channel.resourceId) return;
    await request('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }),
    });
  }
  async function send(gate, lease) {
    const raw = mimeMessage(gate.preview, gate.account, lease.id);
    try {
      const r = await request(gmail('messages/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw: Buffer.from(raw).toString('base64url'),
          ...(gate.preview.threadId ? { threadId: gate.preview.threadId } : {}),
        }),
      });
      if (!r.id) return { outcome: 'ambiguous' };
      return { outcome: 'accepted', providerId: r.id };
    } catch (e) {
      return {
        outcome:
          e.code === 'transient' && e.status === 429
            ? 'transient'
            : e.code === 'rejected' || e.code === 'reauthorize'
              ? 'permanent'
              : 'ambiguous',
      };
    }
  }
  async function reconcileSend(gate, lease) {
    const r = await request(
      gmail('messages', {
        q: 'in:sent rfc822msgid:' + messageIdentity(lease.id, gate.account),
        maxResults: '2',
      }),
    );
    if (r.messages?.length !== 1) return { outcome: 'not-found' };
    const m = await request(
      gmail('messages/' + encodeURIComponent(r.messages[0].id), {
        format: 'metadata',
        metadataHeaders: 'Message-ID',
      }),
    );
    const value = m.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value;
    if (value !== '<' + messageIdentity(lease.id, gate.account) + '>')
      return { outcome: 'not-found' };
    return { outcome: 'accepted', providerId: m.id };
  }
  async function calendarWork(gate, lease, reconcile = false) {
    const b = gate.booking,
      url = calendar(gate.calendarId, '/events/' + encodeURIComponent(b.provider_id));
    if (reconcile) {
      try {
        const event = await request(url);
        if (gate.operation === 'cancel' && event.status === 'cancelled')
          return { outcome: 'accepted', providerId: b.provider_id, etag: event.etag };
        if (
          event.extendedProperties?.private?.operation !== lease.id ||
          event.id !== b.provider_id ||
          event.status === 'cancelled' ||
          Date.parse(event.start?.dateTime) !== Date.parse(b.starts_at) ||
          Date.parse(event.end?.dateTime) !== Date.parse(b.ends_at) ||
          !(event.attendees || []).some(
            (a) => a.email?.toLowerCase() === gate.preview.recipient.toLowerCase(),
          )
        )
          return { outcome: 'not-found' };
        return { outcome: 'accepted', providerId: event.id, etag: event.etag };
      } catch (e) {
        if ([404, 410].includes(e.status))
          return {
            outcome: gate.operation === 'cancel' ? 'accepted' : 'not-found',
            providerId: b.provider_id,
          };
        throw e;
      }
    }
    // Fetch free/busy again immediately before creating or moving the event.
    if (gate.operation !== 'cancel') {
      const free = await request('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: b.starts_at,
          timeMax: b.ends_at,
          items: [{ id: gate.calendarId }],
        }),
      });
      const current = free.calendars?.[gate.calendarId];
      if (!current || current.errors?.length || !Array.isArray(current.busy))
        throw new GoogleError('availability-unavailable');
      if (
        current.busy.some(
          (x) =>
            !(
              gate.operation === 'reschedule' &&
              Date.parse(x.start) === Date.parse(b.old_start) &&
              Date.parse(x.end) === Date.parse(b.old_end)
            ),
        )
      )
        return { outcome: 'permanent' };
    }
    const event = {
      ...(gate.operation === 'book' ? { id: b.provider_id } : {}),
      summary: gate.preview.subject,
      description: gate.preview.text,
      start: { dateTime: new Date(b.starts_at).toISOString(), timeZone: b.zone },
      end: { dateTime: new Date(b.ends_at).toISOString(), timeZone: b.zone },
      attendees: [{ email: gate.preview.recipient }],
      extendedProperties: {
        private: { operation: lease.id, candidateEmail: gate.preview.recipient },
      },
    };
    try {
      const r = await request(
        gate.operation === 'book'
          ? calendar(gate.calendarId, '/events', { sendUpdates: 'all' })
          : url + '&sendUpdates=all',
        {
          method:
            gate.operation === 'cancel' ? 'DELETE' : gate.operation === 'book' ? 'POST' : 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(b.etag ? { 'If-Match': b.etag } : {}),
          },
          ...(gate.operation === 'cancel' ? {} : { body: JSON.stringify(event) }),
        },
      );
      if (
        gate.operation !== 'cancel' &&
        (r.id !== b.provider_id || typeof r.etag !== 'string' || !r.etag)
      )
        return { outcome: 'ambiguous' };
      return { outcome: 'accepted', providerId: r.id || b.provider_id, etag: r.etag };
    } catch (e) {
      if (e.status === 409 && gate.operation === 'book') return calendarWork(gate, lease, true);
      return {
        outcome:
          e.status === 429
            ? 'transient'
            : e.code === 'rejected' || e.code === 'reauthorize'
              ? 'permanent'
              : 'ambiguous',
      };
    }
  }
  async function attachment(gate) {
    const a = gate.attachment;
    let r;
    if (!a.attachmentId) {
      const message = await request(
        gmail('messages/' + encodeURIComponent(a.messageProviderId), { format: 'full' }),
      );
      let part;
      let count = 0;
      const find = (p, depth = 0) => {
        if (++count > 100 || depth > 10) throw new GoogleError('oversized-message');
        if (p.partId === a.part) part = p;
        for (const child of p.parts || []) find(child, depth + 1);
      };
      find(message.payload || {});
      r = part?.body;
      if (!r || part.filename !== a.name) throw new GoogleError('invalid-attachment');
    } else
      r = await request(
        gmail(
          'messages/' +
            encodeURIComponent(a.messageProviderId) +
            '/attachments/' +
            encodeURIComponent(a.attachmentId),
        ),
      );
    if (
      typeof r.data !== 'string' ||
      !/^[A-Za-z0-9_-]*={0,2}$/.test(r.data) ||
      r.data.length > 6990510
    )
      throw new GoogleError('invalid-attachment');
    const bytes = Buffer.from(r.data, 'base64url');
    if (
      bytes.length < 1 ||
      bytes.length > 5242880 ||
      bytes.length !== a.size ||
      (r.size !== undefined && bytes.length !== r.size)
    )
      throw new GoogleError('invalid-attachment');
    return bytes;
  }
  return {
    exchange,
    refresh,
    diagnostic,
    syncMailbox,
    syncCalendar,
    renewChannel,
    stopChannel,
    send,
    reconcileSend,
    calendarWork,
    attachment,
  };
}
function cryptoUuid() {
  return randomBytes(16)
    .toString('hex')
    .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
}
export const messageIdentity = (id, account) => `anthro-${id}@${account.split('@')[1]}`;
export function mimeMessage(preview, account, id) {
  const email = /^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (
    !email.test(account || '') ||
    !email.test(preview?.recipient || '') ||
    !/^[a-f0-9-]{36}$/i.test(id || '') ||
    typeof preview.subject !== 'string' ||
    preview.subject.length > 200 ||
    /[\r\n]/.test(preview.subject) ||
    typeof preview.text !== 'string' ||
    preview.text.length > 12000
  )
    throw Error('Invalid reviewed message.');
  const subject = [...preview.subject]
    .reduce(
      (chunks, c) => {
        const last = chunks.at(-1);
        if (Buffer.byteLength(last + c) > 30) chunks.push(c);
        else chunks[chunks.length - 1] += c;
        return chunks;
      },
      [''],
    )
    .map((s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)
    .join('\r\n ');
  if (preview.inReplyTo && !/^<[^<>\s]+@[^<>\s]+>$/.test(preview.inReplyTo))
    throw Error('Invalid reviewed reply identity.');
  return [
    `From: ${account}`,
    `To: ${preview.recipient}`,
    `Message-ID: <${messageIdentity(id, account)}>`,
    ...(preview.inReplyTo
      ? [`In-Reply-To: ${preview.inReplyTo}`, `References: ${preview.inReplyTo}`]
      : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(preview.text)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') || '',
    '',
  ].join('\r\n');
}
// Only one unambiguous sender can drive automatic campaign response suppression.
export function singleSenderEmail(value) {
  const text = String(value || '').trim();
  const address = text.includes('<') ? text.match(/^[^<>\r\n,]*<([^<>\s,]+)>$/)?.[1] : text;
  return address && address.length <= 254 && /^[^<>\s,@]+@[^<>\s,@]+\.[^<>\s,@]+$/.test(address)
    ? address.toLowerCase()
    : '';
}
export function normalizeMessage(message) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(message?.id || '') || typeof message.threadId !== 'string')
    throw new GoogleError('invalid-message');
  const receivedMs = Number(message.internalDate);
  const headers = message.payload?.headers || [],
    get = (key) =>
      String(headers.find((h) => h.name?.toLowerCase() === key)?.value || '').slice(0, 1000);
  let text = '',
    deliveryStatus = '',
    originalMessageId = '';
  const attachments = [];
  let count = 0;
  function walk(part, depth = 0) {
    if (++count > 100 || depth > 10) throw new GoogleError('oversized-message');
    if (part.mimeType === 'message/delivery-status' && part.body?.data)
      deliveryStatus = Buffer.from(part.body.data, 'base64url').toString('utf8').slice(0, 8000);
    if (['message/rfc822', 'text/rfc822-headers'].includes(part.mimeType)) {
      originalMessageId =
        part.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value || '';
      if (!originalMessageId && part.body?.data)
        originalMessageId =
          Buffer.from(part.body.data, 'base64url')
            .toString('utf8')
            .slice(0, 8000)
            .match(/^Message-ID:\s*(<[^\r\n]+>)\s*$/im)?.[1] || '';
    }
    if (part.filename) {
      if (attachments.length >= 10) throw new GoogleError('oversized-message');
      if (part.body?.attachmentId || (part.body?.data && part.partId))
        attachments.push({
          part: part.partId || String(count),
          attachmentId: part.body.attachmentId,
          name: String(part.filename).slice(0, 160),
          size: part.body.size,
          mime: String(part.mimeType || '').slice(0, 160),
        });
      return;
    }
    if (part.mimeType === 'text/plain' && part.body?.data)
      text += Buffer.from(part.body.data, 'base64url').toString('utf8');
    for (const child of part.parts || []) walk(child, depth + 1);
  }
  if (message.payload) walk(message.payload);
  const status = deliveryStatus.match(/^Status:\s*(5\.\d{1,3}\.\d{1,3})\s*$/im)?.[1],
    recipient = deliveryStatus.match(/^Final-Recipient:\s*rfc822;\s*([^\s;]+)\s*$/im)?.[1];
  const bounce =
    status &&
    recipient &&
    /^Action:\s*failed\s*$/im.test(deliveryStatus) &&
    /^<anthro-[a-f0-9-]{36}@[^<>\s]+>$/.test(originalMessageId)
      ? { originalMessageId, recipient, status, action: 'failed' }
      : null;
  return {
    id: message.id,
    thread: message.threadId,
    deleted: false,
    body: {
      subject: get('subject'),
      from: get('from'),
      ...(Number.isSafeInteger(receivedMs) && receivedMs >= 0 && receivedMs <= Date.now() + 300000
        ? { receivedMs }
        : {}),
      senderEmail: singleSenderEmail(get('from')),
      to: get('to'),
      messageId: get('message-id'),
      references: get('references'),
      text: text.slice(0, 8000),
      htmlOmitted: !text && !!message.payload,
      ...(bounce ? { bounce } : {}),
      labels: (message.labelIds || []).slice(0, 20),
    },
    attachments,
  };
}
export function validChannelHeaders(headers) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = {
    channel: h['x-goog-channel-id'],
    token: h['x-goog-channel-token'],
    resourceId: h['x-goog-resource-id'],
    number: h['x-goog-message-number'],
  };
  if (
    !/^[a-f0-9-]{36}$/.test(body.channel || '') ||
    !/^[a-f0-9]{64}$/.test(body.token || '') ||
    typeof body.resourceId !== 'string' ||
    body.resourceId.length > 500 ||
    !/^[0-9]{1,20}$/.test(body.number || '') ||
    !['sync', 'exists', 'not_exists'].includes(h['x-goog-resource-state'])
  )
    throw Error('Invalid calendar notification.');
  return body;
}
export function safeEqual(a, b) {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
