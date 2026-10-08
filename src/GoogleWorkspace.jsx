import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId, getSupabase } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { resolveZonedTime, zonedCandidates } from './schedulingTime.js';

export async function googleServer(action, body) {
  const client = await getSupabase(),
    { data } = await client.auth.getSession();
  if (!data.session) throw Error('Sign in again.');
  const r = await fetch('/.netlify/functions/google-' + action, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + data.session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw Error(value.error || 'Google operation failed.');
  return value;
}
export default function GoogleWorkspace({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  candidateId = '',
  ...props
}) {
  if (!isCloud || !['admin', 'recruiter'].includes(role)) return null;
  return (
    <Console
      key={`${scope}:${role}:${candidateId}`}
      role={role}
      candidateId={candidateId}
      {...props}
    />
  );
}
function Console({
  role,
  candidateId,
  rpc = repositoryRead,
  server = googleServer,
  openAuthorization = (url) => window.open(url, '_blank', 'noopener,noreferrer'),
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null);
  const [kind, setKind] = useState('mailbox'),
    [config, setConfig] = useState({
      owner: '',
      account: '',
      calendarId: 'primary',
      purpose: '',
      costDecision: '',
      evidence: '',
    });
  const [candidate, setCandidate] = useState(candidateId),
    [operation, setOperation] = useState('send'),
    [template, setTemplate] = useState(''),
    [demand, setDemand] = useState(''),
    [interview, setInterview] = useState('');
  const [local, setLocal] = useState(''),
    [zone, setZone] = useState('Asia/Kolkata'),
    [occurrence, setOccurrence] = useState(''),
    [preview, setPreview] = useState(null),
    [templates, setTemplates] = useState([]),
    [contexts, setContexts] = useState(null),
    [reply, setReply] = useState(''),
    [authorization, setAuthorization] = useState(''),
    [search, setSearch] = useState(''),
    [people, setPeople] = useState(null),
    [peopleOffset, setPeopleOffset] = useState(0);
  const [tab, setTab] = useState('history'),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState(null),
    [linkEvidence, setLinkEvidence] = useState(''),
    [resolutionEvidence, setResolutionEvidence] = useState('');
  const lifetime = useRef({ live: true, epoch: 0 }),
    request = useRef(null);
  useEffect(() => {
    const state = lifetime.current;
    state.live = true;
    return () => {
      state.live = false;
      state.epoch++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    rpc('api_google_collaboration', { p_action: 'context' })
      .then((v) => {
        if (!Array.isArray(v?.connections) || v.connections.length > 2)
          throw Error('Invalid Google context.');
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, revision]);
  useEffect(() => {
    let active = true;
    setPage(null);
    rpc('api_google_collaboration', {
      p_action: tab,
      p_candidate: candidate || null,
      p_offset: offset,
    })
      .then((v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25)
          throw Error('Invalid bounded Google page.');
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, revision, tab, candidate, offset]);
  useEffect(() => {
    let active = true;
    setTemplates([]);
    setContexts(null);
    rpc('api_test_communications', {
      p_action: 'context',
      p_candidate: candidate || null,
      p_offset: 0,
    })
      .then((v) => {
        if (!Array.isArray(v?.templates)) throw Error('Invalid template context.');
        if (active) {
          setTemplates(v.templates);
          setContexts(v);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, candidate, revision]);
  useEffect(() => {
    if (candidateId) return;
    let active = true;
    setPeople(null);
    rpc('api_test_communications', {
      p_action: 'browse',
      p_payload: { query: search },
      p_offset: peopleOffset,
    })
      .then((v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25) throw Error('Invalid candidate page.');
        if (active) setPeople(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, candidateId, search, peopleOffset]);
  const cfg = data?.connections.find((c) => c.kind === kind),
    locked = busy || !!pending;
  let choices = [];
  try {
    if (local) choices = zonedCandidates(local, zone);
  } catch {
    /* review displays precise validation */
  }
  function payload() {
    return {
      operation,
      template,
      ...(reply && operation === 'send' ? { reply } : {}),
      context: { ...(demand ? { demand } : {}), ...(interview ? { interview } : {}) },
      ...(operation === 'send'
        ? local
          ? { availableAt: resolveZonedTime(local, zone, occurrence) }
          : {}
        : {
            interview,
            zone,
            local,
            ...(operation === 'cancel' ? {} : { start: resolveZonedTime(local, zone, occurrence) }),
          }),
    };
  }
  function invalidate() {
    setPreview(null);
    setOccurrence('');
  }
  async function review(extra) {
    if (locked) return;
    const state = lifetime.current,
      g = state.epoch;
    setBusy(true);
    setError('');
    try {
      const p = extra || payload(),
        v = await rpc('api_google_collaboration', {
          p_action: 'preview',
          p_candidate: candidate || null,
          p_payload: p,
        });
      if (state.live && g === state.epoch) setPreview({ ...v, payload: p });
    } catch (e) {
      if (state.live && g === state.epoch) setError(e.message);
    } finally {
      if (state.live && g === state.epoch) setBusy(false);
    }
  }
  async function write(action, payload, head = null, target = candidate || null) {
    if (busy || (action && request.current)) return;
    if (action)
      request.current = structuredClone({
        p_action: action,
        p_candidate: target,
        p_operation: crypto.randomUUID(),
        p_head: head,
        p_payload: payload,
      });
    if (!request.current) return;
    const state = lifetime.current,
      g = state.epoch;
    setPending(request.current);
    setBusy(true);
    setError('');
    try {
      await rpc('api_google_collaboration', request.current);
      if (!state.live || g !== state.epoch) return;
      request.current = null;
      setPending(null);
      setPreview(null);
      setNotice('Recorded on the server. Review refreshed status before another action.');
      setRevision((v) => v + 1);
    } catch (e) {
      if (state.live && g === state.epoch) setError(e.message);
    } finally {
      if (state.live && g === state.epoch) setBusy(false);
    }
  }
  async function adminServer(action) {
    if (locked || !cfg) return;
    const state = lifetime.current,
      g = state.epoch;
    setBusy(true);
    setError('');
    try {
      const result = await server(action, { kind, head: cfg.head, operation: crypto.randomUUID() });
      if (!state.live || g !== state.epoch) return;
      if (action === 'oauth-start') {
        const url = new URL(result.url);
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth')
          throw Error('Invalid authorization destination.');
        openAuthorization(url.href);
        setAuthorization(url.href);
        setNotice(
          'Complete Google authorization in the new tab, then refresh and run the diagnostic.',
        );
      } else {
        setNotice(result.status);
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (state.live && g === state.epoch) setError(e.message);
    } finally {
      if (state.live && g === state.epoch) setBusy(false);
    }
  }
  return (
    <section
      className="panel foundation-workbench"
      aria-label="Google Workspace communication and scheduling"
    >
      <h2>Stage 3 Google Workspace</h2>
      {authorization && (
        <p>
          <a href={authorization} target="_blank" rel="noopener noreferrer">
            Open Google authorization
          </a>
        </p>
      )}
      <p>
        Send reviewed recruiting messages, review mailbox threads and manage calendar invitations.
        Provider acceptance does not prove delivery. Manual scheduling and ICS exports remain
        available during an outage.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data?.paused && <p role="alert">Recovery lockdown is active. Google work is paused.</p>}
      {pending && (
        <div>
          <p>The exact request is frozen after an uncertain acknowledgement.</p>
          <button disabled={busy} onClick={() => write()}>
            Retry exact Google request
          </button>
          <button
            disabled={busy}
            onClick={() => {
              request.current = null;
              setPending(null);
              setPreview(null);
              setRevision((n) => n + 1);
            }}
          >
            Discard retry and refresh
          </button>
        </div>
      )}
      <fieldset disabled={locked}>
        <legend>Connection status</legend>
        <button onClick={() => setRevision((n) => n + 1)}>Refresh Google status</button>
        {(data?.connections || []).map((c) => (
          <p key={c.kind}>
            {c.kind}: {c.state} · generation {c.generation} ·{' '}
            {c.authorized ? 'Account authorized' : 'Authorization required'}
            {c.error ? ` · ${c.error}` : ''}
          </p>
        ))}
        {role === 'admin' && (
          <details>
            <summary>Google account configuration and activation</summary>
            <label>
              Google capability
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="mailbox">Gmail delivery and mailbox</option>
                <option value="calendar">Google Calendar</option>
              </select>
            </label>
            {Object.keys(config).map((key) => (
              <label key={key}>
                Google {key}
                <input
                  value={config[key]}
                  maxLength={['purpose', 'costDecision', 'evidence'].includes(key) ? 1000 : 254}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                />
              </label>
            ))}
            <p>
              Owner is a current administrator UUID. Credentials stay in server custody.
              Configuration changes require new authorization and acceptance.
            </p>
            <button
              disabled={!cfg}
              onClick={() =>
                setConfig(
                  Object.fromEntries(Object.keys(config).map((key) => [key, cfg.body[key] || ''])),
                )
              }
            >
              Review existing Google configuration
            </button>
            <button
              disabled={!data}
              onClick={() =>
                write('configure', { kind, ...config }, cfg?.head || data.defaultHead, null)
              }
            >
              Save Google configuration
            </button>
            <button disabled={!cfg} onClick={() => adminServer('oauth-start')}>
              Authorize configured Google account
            </button>
            <button disabled={!cfg?.authorized} onClick={() => adminServer('diagnostic')}>
              Run Google diagnostic
            </button>
            {['accept', 'enable', 'pause', 'revoke'].map((a) => (
              <button key={a} disabled={!cfg} onClick={() => write(a, { kind }, cfg.head, null)}>
                {a === 'accept'
                  ? 'Accept Google staging'
                  : a === 'enable'
                    ? 'Enable Google connection'
                    : a === 'pause'
                      ? 'Pause Google connection'
                      : 'Revoke local Google connection'}
              </button>
            ))}
            <p>
              Local revocation blocks further work. Remove the app in your Google account to revoke
              Google’s authorization grant.
            </p>
          </details>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Candidate and reviewed operation</legend>
        {!candidateId && (
          <>
            <label>
              Search Google recipients
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPeopleOffset(0);
                }}
              />
            </label>
            <label>
              Choose Google recipient
              <select
                value={candidate}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  setOffset(0);
                  setTemplate('');
                  setDemand('');
                  setInterview('');
                  setReply('');
                  invalidate();
                }}
              >
                <option value="">Choose a candidate</option>
                {candidate && !(people?.rows || []).some((p) => p.id === candidate) && (
                  <option value={candidate}>{candidate}</option>
                )}
                {(people?.rows || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.anthroId}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!peopleOffset}
              onClick={() => setPeopleOffset((v) => Math.max(0, v - 25))}
            >
              Previous recipient page
            </button>
            <button
              disabled={!people?.more || peopleOffset >= 10000}
              onClick={() => setPeopleOffset((v) => v + 25)}
            >
              Next recipient page
            </button>
          </>
        )}
        <label>
          Google candidate UUID
          <input
            value={candidate}
            disabled={!!candidateId}
            onChange={(e) => {
              setCandidate(e.target.value);
              setOffset(0);
              setTemplate('');
              setDemand('');
              setInterview('');
              setReply('');
              invalidate();
            }}
          />
        </label>
        <label>
          Google operation
          <select
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value);
              setLocal('');
              invalidate();
            }}
          >
            {['send', 'book', 'reschedule', 'cancel'].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Google reviewed template
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              invalidate();
            }}
          >
            <option value="">Choose a current template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.key} · v{t.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Google demand UUID
          <input
            value={demand}
            onChange={(e) => {
              setDemand(e.target.value);
              invalidate();
            }}
          />
        </label>
        {(contexts?.demands || []).length > 0 && (
          <label>
            Choose Google demand context
            <select
              value={demand}
              onChange={(e) => {
                setDemand(e.target.value);
                invalidate();
              }}
            >
              <option value="">No demand context</option>
              {contexts.demands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Google interview UUID
          <input
            value={interview}
            onChange={(e) => {
              setInterview(e.target.value);
              invalidate();
            }}
          />
        </label>
        {(contexts?.interviews || []).length > 0 && (
          <label>
            Choose Google interview context
            <select
              value={interview}
              onChange={(e) => {
                const i = contexts.interviews.find((iv) => iv.id === e.target.value);
                setInterview(e.target.value);
                setDemand(i?.demandId || '');
                invalidate();
              }}
            >
              <option value="">Choose an interview</option>
              {contexts.interviews.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.scheduledAt} · {i.status}
                </option>
              ))}
            </select>
          </label>
        )}
        {contexts?.interviews?.map((i) => (
          <p key={i.id}>
            {i.id} · {i.scheduledAt}
          </p>
        ))}
        {reply && operation === 'send' && (
          <p>
            Replying to reviewed message {reply}. The template subject must match the original
            thread.
            <button
              onClick={() => {
                setReply('');
                invalidate();
              }}
            >
              Clear reply context
            </button>
          </p>
        )}
        {operation !== 'cancel' && (
          <>
            <label>
              {operation === 'send'
                ? 'Google scheduled send time (optional)'
                : 'Google local interview time'}
              <input
                type="datetime-local"
                value={local}
                onChange={(e) => {
                  setLocal(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              Google interview timezone
              <input
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  invalidate();
                }}
              />
            </label>
            {choices.length > 1 && (
              <label>
                DST occurrence
                <select
                  value={occurrence}
                  onChange={(e) => {
                    setOccurrence(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose an occurrence</option>
                  {choices.map((v, i) => (
                    <option key={v} value={v}>
                      {i === 0 ? 'Earlier' : 'Later'}: {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {operation !== 'send' && (
              <button onClick={() => write('availability', {}, null, null)}>
                Request free/busy refresh
              </button>
            )}
            <p>
              Latest free/busy check: {data?.availability?.checkedAt || 'Not checked'}. Reservations
              require a fresh server check.
            </p>
          </>
        )}
        <button disabled={!candidate || !template} onClick={() => review()}>
          Review Google operation
        </button>
        {preview && (
          <div>
            <p>{preview.eligible ? 'Eligible for preparation' : preview.reason}</p>
            <p>{preview.preview?.recipient}</p>
            <p>{preview.preview?.subject}</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {preview.preview?.text}
            </pre>
            <button
              disabled={!preview.eligible}
              onClick={() =>
                write(
                  preview.payload.operation === 'attachment' ? 'quarantine' : 'prepare',
                  preview.payload,
                  preview.head,
                )
              }
            >
              Queue reviewed Google operation
            </button>
          </div>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Mailbox and operation history</legend>
        <label>
          Google journal
          <select
            value={tab}
            onChange={(e) => {
              setTab(e.target.value);
              setOffset(0);
            }}
          >
            <option value="history">Operation history</option>
            <option value="inbox">Mailbox review</option>
            <option value="bookings">Calendar bookings and RSVP</option>
          </select>
        </label>
        {tab === 'inbox' && (
          <label>
            Thread linking evidence
            <input
              value={linkEvidence}
              maxLength={1000}
              onChange={(e) => setLinkEvidence(e.target.value)}
            />
          </label>
        )}
        {tab === 'bookings' && role === 'admin' && (
          <label>
            Independently verified Google cancellation evidence
            <input
              value={resolutionEvidence}
              maxLength={1000}
              onChange={(e) => setResolutionEvidence(e.target.value)}
            />
          </label>
        )}
        {(page?.rows || []).map((row) => (
          <article key={row.id} style={{ overflowWrap: 'anywhere' }}>
            {tab === 'history' ? (
              <>
                <p>
                  {row.kind} · {row.status} · {row.reason}
                </p>
                <p>{row.id}</p>
                {['Queued', 'Deferred'].includes(row.status) && (
                  <button
                    onClick={() => write('cancel-work', { id: row.id }, row.head, row.candidate_id)}
                  >
                    Cancel queued Google work
                  </button>
                )}
                {row.status === 'Failed' && (
                  <button
                    onClick={() => write('retry', { id: row.id }, row.head, row.candidate_id)}
                  >
                    Retry known failed Google work
                  </button>
                )}
                {['Ambiguous', 'Provider accepted'].includes(row.status) && (
                  <button
                    onClick={() => write('reconcile', { id: row.id }, row.head, row.candidate_id)}
                  >
                    Reconcile Google outcome
                  </button>
                )}
              </>
            ) : tab === 'bookings' ? (
              <>
                <p>
                  Booking {row.state} · RSVP {row.rsvp}
                </p>
                <p>
                  {row.starts_at} to {row.ends_at} · {row.zone}
                </p>
                <p>Provider event {row.provider_id}</p>
                <p>
                  Original calendar {row.calendar_id} · account {row.account}
                </p>
                {row.old_start && (
                  <p>
                    Previous reservation retained: {row.old_start} to {row.old_end}
                  </p>
                )}
                {role === 'admin' && ['Reserved', 'Manual review'].includes(row.state) && (
                  <>
                    <p>
                      Resolve only after independently checking cancellation in the original Google
                      calendar. This records a human decision, not provider delivery proof.
                    </p>
                    <button
                      disabled={resolutionEvidence.trim().length < 20}
                      onClick={() =>
                        write(
                          'resolve-booking',
                          {
                            booking: row.id,
                            resolution: 'cancelled-at-provider',
                            evidence: resolutionEvidence,
                          },
                          row.head,
                          row.candidate_id,
                        )
                      }
                    >
                      Record verified cancellation and release reservation
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <h3>{row.body.subject || 'Mailbox message'}</h3>
                <p>
                  {row.body.from} · thread {row.thread_id} ·{' '}
                  {row.deleted
                    ? 'Deleted at source'
                    : row.candidate_id
                      ? 'Linked candidate'
                      : 'Unlinked'}
                </p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{row.body.text}</pre>
                {row.body.htmlOmitted && (
                  <p>HTML and remote images are omitted. Review the original in Gmail if needed.</p>
                )}
                {row.candidate_id && !row.deleted && candidate === row.candidate_id && (
                  <button
                    onClick={() => {
                      setOperation('send');
                      setReply(row.id);
                      invalidate();
                    }}
                  >
                    Use reviewed thread for reply
                  </button>
                )}
                {!row.candidate_id && !row.deleted && (
                  <button
                    disabled={!candidate || linkEvidence.trim().length < 10}
                    onClick={() =>
                      write('link', { message: row.id, evidence: linkEvidence }, row.head)
                    }
                  >
                    Link reviewed thread to candidate
                  </button>
                )}
                {(row.attachments || []).map((a) => (
                  <p key={a.id}>
                    {a.body.name} · {a.body.size} bytes ·{' '}
                    {a.documentId
                      ? 'In private document pipeline'
                      : 'Quarantined import requires review'}
                    {row.candidate_id && !row.deleted && !a.documentId && (
                      <button
                        disabled={candidate !== row.candidate_id}
                        onClick={() => review({ operation: 'attachment', attachment: a.id })}
                      >
                        Review attachment quarantine
                      </button>
                    )}
                  </p>
                ))}
              </>
            )}
          </article>
        ))}
        {!page && <p role="status">Loading Google journal…</p>}
        {page?.rows.length === 0 && <p>No Google records in this scope.</p>}
        <button disabled={offset === 0} onClick={() => setOffset((v) => Math.max(0, v - 25))}>
          Previous Google page
        </button>
        <button disabled={!page?.more || offset >= 10000} onClick={() => setOffset((v) => v + 25)}>
          Next Google page
        </button>
      </fieldset>
    </section>
  );
}
