import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
const defaults = {
  owner: '',
  account: '',
  purpose: '',
  costDecision: '',
  evidence: '',
  requireOcr: false,
  keyRef: '',
  destinationRef: '',
  rpoHours: 24,
  rtoMinutes: 120,
};
export default function ProcessingRecovery({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  ...props
}) {
  if (!isCloud || role !== 'admin') return null;
  return <Console key={scope + ':' + role} {...props} />;
}
function Console({ rpc = repositoryRead }) {
  const [data, setData] = useState(null),
    [kind, setKind] = useState('processing'),
    [body, setBody] = useState(defaults),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reason, setReason] = useState(''),
    [history, setHistory] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null);
  const lifecycle = useRef({ live: true, epoch: 0 }),
    intent = useRef(null);
  useEffect(() => {
    const state = lifecycle.current;
    state.live = true;
    return () => {
      state.live = false;
      state.epoch++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    rpc('api_processing_recovery', { p_action: 'context' })
      .then((v) => {
        if (!Array.isArray(v?.policies) || v.policies.length > 2)
          throw Error('Invalid processing context');
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
    setHistory(null);
    rpc('api_processing_recovery', { p_action: 'history', p_payload: { kind }, p_offset: offset })
      .then((v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25)
          throw Error('Invalid bounded evidence page');
        if (active) setHistory(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, revision, kind, offset]);
  const cfg = data?.policies.find((x) => x.kind === kind),
    locked = busy || !!pending;
  async function write(action, payload) {
    if (busy || (action && intent.current)) return;
    if (action)
      intent.current = structuredClone({
        p_action: action,
        p_operation: crypto.randomUUID(),
        p_head: cfg?.head || data.defaultHead,
        p_payload: payload,
      });
    if (!intent.current) return;
    const request = intent.current,
      state = lifecycle.current,
      g = state.epoch;
    setPending(request);
    setBusy(true);
    setError('');
    try {
      await rpc('api_processing_recovery', request);
      if (!state.live || g !== state.epoch) return;
      intent.current = null;
      setPending(null);
      setNotice('Recorded; refresh server evidence before the next decision.');
      setRevision((n) => n + 1);
    } catch (e) {
      if (state.live && g === state.epoch) setError(e.message);
    } finally {
      if (state.live && g === state.epoch) setBusy(false);
    }
  }
  return (
    <section className="panel foundation-workbench" aria-label="Private processing and recovery">
      <h2>Stage 2 private processing and recovery</h2>
      <p>
        Configure and accept native worker evidence and isolated recovery drills. This panel stores
        references and decisions; server keys and backup files stay outside the browser.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data?.paused && (
        <p role="alert">
          Recovery lockdown is active. Application writes and processing completions are paused.
          Only the server operator can unlock; feature policies remain paused afterwards.
        </p>
      )}
      {pending && (
        <div>
          <p>The exact operation and reviewed head are frozen after a lost acknowledgement.</p>
          <button disabled={busy} onClick={() => write()}>
            Retry Stage 2 request
          </button>
          <button
            disabled={busy}
            onClick={() => {
              intent.current = null;
              setPending(null);
              setError('');
              setRevision((n) => n + 1);
              setNotice('Retry discarded. Review current evidence before another write.');
            }}
          >
            Discard Stage 2 retry
          </button>
        </div>
      )}
      <fieldset disabled={locked}>
        <legend>Processing and recovery controls</legend>
        <button
          onClick={() => {
            setError('');
            setRevision((n) => n + 1);
          }}
        >
          Refresh Stage 2 evidence
        </button>
        {data && (
          <>
            <p>
              Quarantined import queue: {data.queue?.imports ?? 'unknown'}; attachment queue:{' '}
              {data.queue?.attachments ?? 'unknown'}.
            </p>
            <label>
              Stage 2 capability
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setBody(defaults);
                  setReason('');
                  setOffset(0);
                }}
              >
                <option value="processing">Private scanning and OCR</option>
                <option value="recovery">Encrypted backup and isolated restore</option>
              </select>
            </label>
            <p>
              State: {cfg?.state || 'not configured'}. Generation: {cfg?.generation || 0}. Fresh
              operational evidence: {cfg?.healthy ? 'available' : 'not accepted or overdue'}.
            </p>
            <button
              disabled={!cfg}
              onClick={() => {
                setBody(
                  Object.fromEntries(
                    Object.keys(defaults).map((k) => [k, cfg.body[k] ?? defaults[k]]),
                  ),
                );
                setReason('');
              }}
            >
              Review existing Stage 2 configuration
            </button>
            <div className="form-grid">
              {[
                ['owner', 'Stage 2 administrator owner UUID'],
                ['account', 'Worker / recovery label'],
                ['purpose', 'Stage 2 purpose'],
                ['costDecision', 'Stage 2 cost and quota decision'],
                ['evidence', 'Stage 2 acceptance notes'],
                ['keyRef', 'Server key custody reference'],
                ['destinationRef', 'Backup destination / worker host reference'],
              ].map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    value={body[k]}
                    maxLength={['purpose', 'costDecision', 'evidence'].includes(k) ? 1000 : 100}
                    onChange={(e) => setBody((p) => ({ ...p, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            {kind === 'processing' && (
              <label>
                <input
                  type="checkbox"
                  checked={body.requireOcr}
                  onChange={(e) => setBody((p) => ({ ...p, requireOcr: e.target.checked }))}
                />
                Require native OCR smoke evidence
              </label>
            )}
            {kind === 'recovery' && (
              <div className="form-grid">
                <label>
                  Recovery point objective (hours)
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={body.rpoHours}
                    onChange={(e) => setBody((p) => ({ ...p, rpoHours: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Recovery time objective (minutes)
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={body.rtoMinutes}
                    onChange={(e) => setBody((p) => ({ ...p, rtoMinutes: Number(e.target.value) }))}
                  />
                </label>
              </div>
            )}
            <p>
              {kind === 'processing'
                ? 'Configuration adopts a strict worker-health gate. Existing uploads remain quarantined while native evidence is missing. Report smoke results from the private worker; no browser button can invent a passed scan.'
                : 'Capture and verify encrypted database, roles and private originals with the operator runner. A matching isolated restore and measured RTO are required for acceptance. Browser exports are portability snapshots.'}
            </p>
            <button disabled={data.paused} onClick={() => write('configure', { kind, ...body })}>
              Save Stage 2 configuration
            </button>
            <label>
              Stage 2 decision reason
              <textarea
                maxLength="1000"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {['accept', 'enable', 'pause', 'revoke'].map((a) => (
              <button
                key={a}
                disabled={!cfg || reason.trim().length < 10 || data.paused}
                onClick={() => write(a, { kind, reason })}
              >
                {a} Stage 2 capability
              </button>
            ))}
            <p>
              Processing evidence expires after 15 minutes. Recovery evidence follows the configured
              RPO; restore acceptance lasts seven days. Changing configuration invalidates prior
              generation evidence.
            </p>
          </>
        )}
        {history && (
          <>
            <h3>Server evidence history</h3>
            {history.rows.length === 0 && (
              <p>
                No native/operator evidence recorded. Configure the host or backup runner before
                acceptance.
              </p>
            )}
            {history.rows.map((e) => (
              <article key={e.id}>
                <strong>
                  {e.component}: {e.status}
                </strong>
                <p>
                  Generation {e.generation} · {e.at}
                </p>
                <p>
                  {e.body.code || 'Verified operator evidence'}
                  {e.body.engine && ' · ' + e.body.engine}
                </p>
                {e.body.digest && <p>Encrypted artifact digest: {e.body.digest}</p>}
              </article>
            ))}
            <button disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 25))}>
              Previous Stage 2 evidence
            </button>
            <button disabled={!history.more} onClick={() => setOffset((n) => n + 25)}>
              Next Stage 2 evidence
            </button>
          </>
        )}
      </fieldset>
    </section>
  );
}
