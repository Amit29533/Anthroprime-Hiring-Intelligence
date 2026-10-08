import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId, getSupabase, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
export const dependencyCatalogVersion = 1;
export const dependencyCatalog = Object.freeze([
  [
    'delivery',
    'Delivery sandbox',
    'Fictional adapter, final dispatch gate and receipt reconciliation',
  ],
  ['mailbox', 'Mailbox', 'Google Workspace mailbox and quarantine; use Stage 3 controls'],
  [
    'calendar',
    'Calendar',
    'Google Calendar, subscriptions and timezone acceptance; use Stage 3 controls',
  ],
  [
    'processing',
    'Private scanning / OCR',
    'Private native health and acceptance; use Stage 2 controls',
  ],
  [
    'recovery',
    'Off-site recovery',
    'Encrypted backup, key custody and isolated drill; use Stage 2 controls',
  ],
  [
    'intelligence',
    'AI intelligence',
    'Processing policy, provider/compute and evaluation; Stage 4',
  ],
  ['enrichment', 'Profile enrichment', 'Licensed supported source and budget; Stage 4'],
  ['signing', 'E-signing', 'Signer workflow and permitted provider; Stage 4'],
  ['sso', 'Enterprise SSO', 'Identity provider, entitlement and offboarding policy; Stage 5'],
  [
    'fulfillment',
    'Retention fulfillment',
    'Authorized policy, case decisions and external-copy handling; Stage 5',
  ],
]);
export async function diagnoseDeliverySandbox() {
  const client = await getSupabase(),
    { data } = await client.auth.getSession();
  if (!data.session) throw Error('Sign in again.');
  const response = await fetch('/.netlify/functions/delivery-sandbox-diagnostic', {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Sandbox diagnostic failed.');
  return body;
}
export default function DeliverySandbox({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  candidateId = '',
  ...props
}) {
  if (!isCloud || !['admin', 'recruiter', 'viewer'].includes(role)) return null;
  return (
    <Console
      key={`${scope}:${role}:${candidateId}`}
      role={role}
      candidateId={candidateId}
      {...props}
    />
  );
}
function Console({ role, candidateId, rpc = repositoryRead, diagnose = diagnoseDeliverySandbox }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [candidate, setCandidate] = useState(candidateId),
    [template, setTemplate] = useState(''),
    [demand, setDemand] = useState(''),
    [interview, setInterview] = useState(''),
    [schedule, setSchedule] = useState(''),
    [preview, setPreview] = useState(null),
    [kind, setKind] = useState('delivery'),
    [body, setBody] = useState({
      owner: '',
      account: '',
      purpose: '',
      costDecision: '',
      evidence: '',
      scenario: 'success',
      secretRef: 'none',
    }),
    [reason, setReason] = useState(''),
    [selected, setSelected] = useState(null),
    [history, setHistory] = useState(null),
    [historyOffset, setHistoryOffset] = useState(0);
  const live = useRef(true),
    epoch = useRef(0),
    intent = useRef(null);
  const admin = role === 'admin',
    editor = canWriteForRole(role),
    locked = busy || !!pending;
  useEffect(() => {
    const e = epoch;
    live.current = true;
    return () => {
      live.current = false;
      e.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    rpc('api_delivery_sandbox', {
      p_action: 'context',
      p_candidate: candidate || null,
      p_offset: offset,
    })
      .then((v) => {
        if (!Array.isArray(v?.connections) || !Array.isArray(v.rows) || v.rows.length > 25)
          throw Error('Invalid bounded delivery context.');
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, candidate, offset, revision]);
  const conn = data?.connections.find((x) => x.kind === kind),
    head = conn?.head || data?.defaultHead;
  async function write(a, p = {}, c = null, h = null) {
    if (busy || (a && intent.current)) return;
    if (a)
      intent.current = structuredClone({
        p_action: a,
        p_payload: p,
        p_candidate: c,
        p_head: h,
        p_operation: crypto.randomUUID(),
      });
    if (!intent.current) return;
    const args = intent.current,
      g = epoch.current;
    setPending(args);
    setBusy(true);
    setError('');
    try {
      await rpc('api_delivery_sandbox', args);
      if (!live.current || g !== epoch.current) return;
      intent.current = null;
      setPending(null);
      setNotice('Recorded. Refreshing server state.');
      setPreview(null);
      setSelected(null);
      setHistory(null);
      setRevision((n) => n + 1);
    } catch (e) {
      if (live.current && g === epoch.current) setError(e.message);
    } finally {
      if (live.current && g === epoch.current) setBusy(false);
    }
  }
  async function viewPreview() {
    setBusy(true);
    setError('');
    const g = epoch.current;
    try {
      const v = await rpc('api_delivery_sandbox', {
        p_action: 'preview',
        p_candidate: candidate,
        p_payload: {
          template,
          context: { ...(demand ? { demand } : {}), ...(interview ? { interview } : {}) },
        },
      });
      if (!v?.head || !v.preview) throw Error('Invalid sandbox preview.');
      if (live.current && g === epoch.current) setPreview(v);
    } catch (e) {
      if (live.current && g === epoch.current) setError(e.message);
    } finally {
      if (live.current && g === epoch.current) setBusy(false);
    }
  }
  async function loadHistory(row, off = 0) {
    setBusy(true);
    setError('');
    const g = epoch.current;
    try {
      const v = await rpc('api_delivery_sandbox', {
        p_action: 'history',
        p_payload: { intent: row.id },
        p_offset: off,
      });
      if (
        !Array.isArray(v?.rows) ||
        v.rows.length > 25 ||
        !Array.isArray(v.attempts) ||
        v.attempts.length > 3
      )
        throw Error('Invalid bounded sandbox history.');
      if (live.current && g === epoch.current) {
        setHistory(v);
        setSelected(row);
        setHistoryOffset(off);
        setReason('');
      }
    } catch (e) {
      if (live.current && g === epoch.current) setError(e.message);
    } finally {
      if (live.current && g === epoch.current) setBusy(false);
    }
  }
  async function diagnostic() {
    setBusy(true);
    setError('');
    const g = epoch.current;
    try {
      await diagnose();
      if (live.current && g === epoch.current) {
        setNotice('Server diagnostic recorded; refresh acceptance evidence.');
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (live.current && g === epoch.current) setError(e.message);
    } finally {
      if (live.current && g === epoch.current) setBusy(false);
    }
  }
  function changeSource(setter, value) {
    epoch.current++;
    setter(value);
    setPreview(null);
    setHistory(null);
    setSelected(null);
    setNotice('');
  }
  return (
    <section className="panel foundation-workbench" aria-label="Dependent delivery sandbox">
      <h2>Stage 1 dependent integrations</h2>
      <p>
        Fictional delivery sandbox only. No email, calendar or other live provider is connected.
        Existing communication tests remain separate.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading sandbox readiness…</p>}
      {pending && (
        <div>
          <p>The exact request is frozen. A lost acknowledgement may already have committed.</p>
          <button disabled={busy} onClick={() => write()}>
            Retry sandbox request
          </button>
          <button
            disabled={busy}
            onClick={() => {
              intent.current = null;
              setPending(null);
              setError('');
              setPreview(null);
              setHistory(null);
              setSelected(null);
              setRevision((n) => n + 1);
              setNotice('Retry discarded. Review server history before another write.');
            }}
          >
            Discard sandbox retry
          </button>
        </div>
      )}
      <fieldset disabled={locked}>
        <legend>Dependent integration controls</legend>
        <button
          onClick={() => {
            setRevision((n) => n + 1);
            setPreview(null);
            setHistory(null);
            setSelected(null);
          }}
        >
          Refresh delivery sandbox
        </button>
        {data && (
          <>
            {admin && (
              <details>
                <summary>Integration readiness catalog</summary>
                {dependencyCatalog.map(([id, label, requirements]) => {
                  const connection = data.connections.find((c) => c.kind === id);
                  return (
                    <article key={id}>
                      <h3>{label}</h3>
                      <p>{requirements}</p>
                      <p>
                        State: {connection?.state || 'not configured'}. Generation:{' '}
                        {connection?.generation || 0}.
                      </p>
                      {connection?.body && (
                        <p>
                          Owner: {connection.body.owner}. Cost decision:{' '}
                          {connection.body.costDecision}. Evidence: {connection.body.evidence}.
                        </p>
                      )}
                      <button
                        disabled={['mailbox', 'calendar', 'processing', 'recovery'].includes(id)}
                        onClick={() => {
                          setKind(id);
                          setBody(
                            connection?.body
                              ? Object.fromEntries(
                                  [
                                    'owner',
                                    'account',
                                    'purpose',
                                    'costDecision',
                                    'evidence',
                                    'scenario',
                                    'secretRef',
                                  ].map((k) => [k, connection.body[k]]),
                                )
                              : {
                                  owner: '',
                                  account: '',
                                  purpose: '',
                                  costDecision: '',
                                  evidence: '',
                                  scenario: 'success',
                                  secretRef: 'none',
                                },
                          );
                          setReason('');
                        }}
                      >
                        Review {label} readiness
                      </button>
                    </article>
                  );
                })}
                <h3>{dependencyCatalog.find((x) => x[0] === kind)?.[1]}</h3>
                <p>
                  {conn?.accepted_at && <>Accepted at: {conn.accepted_at}. </>}
                  {!conn
                    ? 'Next: record ownership, purpose, cost and acceptance evidence.'
                    : conn.state === 'enabled'
                      ? 'Fictional sandbox enabled; review diagnostics after configuration changes.'
                      : conn.state === 'staging accepted'
                        ? 'Next: enable the accepted fictional generation.'
                        : conn.state === 'revoked'
                          ? 'Next: configure a new generation before diagnosing or accepting it.'
                          : 'Next: run a fresh server diagnostic, review evidence and accept before enabling.'}
                </p>
                <p>
                  Only the fictional delivery capability can be diagnosed, accepted or enabled in
                  this stage.
                </p>
                <div className="form-grid">
                  {[
                    ['owner', 'Administrator owner UUID'],
                    ['account', 'Connection label'],
                    ['purpose', 'Purpose decision'],
                    ['costDecision', 'Cost / quota decision'],
                    ['evidence', 'Acceptance evidence'],
                  ].map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        value={body[k] || ''}
                        maxLength={k === 'account' ? 100 : k === 'owner' ? 36 : 1000}
                        onChange={(e) => setBody((p) => ({ ...p, [k]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Fictional scenario
                  <select
                    value={body.scenario || 'success'}
                    onChange={(e) => setBody((p) => ({ ...p, scenario: e.target.value }))}
                  >
                    {[
                      'success',
                      'transient',
                      'permanent',
                      'accepted-timeout',
                      'unknown',
                      'duplicate',
                      'reordered',
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Server secret reference
                  <select
                    value={body.secretRef || 'none'}
                    onChange={(e) => setBody((p) => ({ ...p, secretRef: e.target.value }))}
                  >
                    <option value="none">No callback secret reference</option>
                    <option value="env:DELIVERY_SANDBOX_CALLBACK_SECRET">
                      Server environment callback secret reference
                    </option>
                  </select>
                </label>
                <p>
                  Enter references only. Credentials are configured on the server; sandbox dispatch
                  needs no provider key.
                </p>
                <button onClick={() => write('configure', { ...body, kind }, null, head)}>
                  Save dependency configuration
                </button>
                <label>
                  Readiness action reason
                  <textarea
                    value={reason}
                    maxLength="1000"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={kind !== 'delivery' || !conn || conn.state === 'revoked'}
                  onClick={diagnostic}
                >
                  Run server sandbox diagnostic
                </button>
                {conn?.diagnostic && (
                  <p>
                    Diagnostic: {conn.diagnostic.code} (
                    {conn.diagnostic.at || 'timestamp unavailable'}). Callback verification:{' '}
                    {conn.diagnostic.callbackConfigured
                      ? 'configured'
                      : 'not configured (optional)'}
                    . Live transport: disabled.
                  </p>
                )}
                {['accept', 'enable', 'pause', 'degrade', 'rotate', 'revoke'].map((a) => (
                  <button
                    key={a}
                    disabled={
                      !conn ||
                      reason.trim().length < 10 ||
                      (['accept', 'enable'].includes(a) && kind !== 'delivery')
                    }
                    onClick={() => write(a, { kind, reason }, null, head)}
                  >
                    {a} sandbox readiness
                  </button>
                ))}
              </details>
            )}
            <p>
              Delivery state:{' '}
              {data.connections.find((c) => c.kind === 'delivery')?.state || 'not configured'}.
            </p>
            <label>
              Sandbox candidate UUID
              <input
                value={candidate}
                maxLength="36"
                readOnly={!!candidateId}
                onChange={(e) => {
                  changeSource(setCandidate, e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            {!!data?.templates?.length && (
              <label>
                Select an existing template version
                <select
                  value={template}
                  onChange={(e) => changeSource(setTemplate, e.target.value)}
                >
                  <option value="">Choose a reviewed template</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.key} · version {t.version}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Existing communication template UUID
              <input
                value={template}
                maxLength="36"
                onChange={(e) => changeSource(setTemplate, e.target.value)}
              />
            </label>
            <p>
              Create/version templates and review contacts/preferences in Communication tests.
              Sandbox preparation does not queue an old test message.
            </p>
            <label>
              Sandbox demand UUID (optional)
              <input
                value={demand}
                maxLength="36"
                onChange={(e) => changeSource(setDemand, e.target.value)}
              />
            </label>
            <label>
              Sandbox interview UUID (optional)
              <input
                value={interview}
                maxLength="36"
                onChange={(e) => changeSource(setInterview, e.target.value)}
              />
            </label>
            <button disabled={!candidate || !template} onClick={viewPreview}>
              Preview fictional delivery
            </button>
            {preview && (
              <div>
                <p>
                  Recipient: {preview.preview.recipient}. {preview.preview.subject}
                </p>
                <p>{preview.preview.text}</p>
                <p>
                  {preview.eligible ? 'Eligible source for fictional exercise' : preview.reason}
                </p>
                <label>
                  Sandbox schedule (local time)
                  <input
                    type="datetime-local"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                </label>
                {editor && (
                  <button
                    disabled={!preview.eligible}
                    onClick={() => {
                      const when = schedule ? new Date(schedule) : null;
                      if (when && !Number.isFinite(when.getTime())) {
                        setError('Choose a valid schedule.');
                        return;
                      }
                      write(
                        'prepare',
                        {
                          template,
                          context: {
                            ...(demand ? { demand } : {}),
                            ...(interview ? { interview } : {}),
                          },
                          ...(when ? { availableAt: when.toISOString() } : {}),
                        },
                        candidate,
                        preview.head,
                      );
                    }}
                  >
                    Prepare fictional intent
                  </button>
                )}
              </div>
            )}
            {data.rows.map((row) => (
              <article key={row.id}>
                <strong>{row.status}</strong>
                <p>
                  Candidate UUID: {row.candidate_id}. Attempts: {row.attempts}. Generation:{' '}
                  {row.generation}.
                </p>
                <p>{row.reason}</p>
                <button onClick={() => loadHistory(row)}>Review sandbox intent {row.id}</button>
              </article>
            ))}
            <button
              disabled={!offset}
              onClick={() => {
                setOffset((n) => Math.max(0, n - 25));
                setHistory(null);
                setSelected(null);
              }}
            >
              Previous sandbox page
            </button>
            <button
              disabled={!data.more}
              onClick={() => {
                setOffset((n) => n + 25);
                setHistory(null);
                setSelected(null);
              }}
            >
              Next sandbox page
            </button>
          </>
        )}
        {history && selected && (
          <section>
            <h3>Sandbox outcome: {history.status}</h3>
            <p>
              Provider accepted does not mean delivered. Ambiguous outcomes require reconciliation
              and cannot be resent.
            </p>
            {history.attempts.map((a) => (
              <p key={a.id}>
                Attempt {a.number}: {a.outcome || 'Lease active'}; gate {a.gate_at || 'not passed'}.
              </p>
            ))}
            {history.rows.map((e) => (
              <p key={e.id}>
                {e.body.type} · {e.event_id} · {e.at}
              </p>
            ))}
            <button
              disabled={!historyOffset}
              onClick={() => loadHistory(selected, Math.max(0, historyOffset - 25))}
            >
              Previous sandbox history
            </button>
            <button
              disabled={!history.more}
              onClick={() => loadHistory(selected, historyOffset + 25)}
            >
              Next sandbox history
            </button>
            {editor && (
              <>
                <label>
                  Sandbox recovery reason
                  <textarea
                    value={reason}
                    maxLength="1000"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {['Queued', 'Deferred', 'Failed'].includes(history.status) && (
                  <button
                    disabled={reason.trim().length < 10}
                    onClick={() =>
                      write('cancel', { intent: selected.id, reason }, null, history.head)
                    }
                  >
                    Cancel pending sandbox intent
                  </button>
                )}
                {history.status === 'Failed' && selected.attempts < 3 && (
                  <button
                    disabled={reason.trim().length < 10}
                    onClick={() =>
                      write('retry', { intent: selected.id, reason }, null, history.head)
                    }
                  >
                    Retry known failed sandbox intent
                  </button>
                )}
                {['Ambiguous', 'Provider accepted'].includes(history.status) && (
                  <button
                    disabled={reason.trim().length < 10}
                    onClick={() =>
                      write(
                        'request-reconcile',
                        { intent: selected.id, reason },
                        null,
                        history.head,
                      )
                    }
                  >
                    Request sandbox reconciliation
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </fieldset>
    </section>
  );
}
