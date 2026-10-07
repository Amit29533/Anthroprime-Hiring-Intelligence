import React, { useEffect, useRef, useState } from 'react';
import { cloud, getWorkspaceId } from './repository.js';
import { intelligenceRpc } from './intelligence.js';
export default function MachineCredentials({ rpc = intelligenceRpc, isCloud = cloud }) {
  return <Credentials key={getWorkspaceId()} rpc={rpc} isCloud={isCloud} />;
}
function Credentials({ rpc, isCloud }) {
  const [view, setView] = useState(null),
    [overview, setOverview] = useState(null),
    [deliveries, setDeliveries] = useState([]),
    [offset, setOffset] = useState(0),
    [name, setName] = useState(''),
    [source, setSource] = useState(''),
    [days, setDays] = useState(30),
    [scopes, setScopes] = useState(['events:read']),
    [token, setToken] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const issuance = useRef(null);
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    Promise.all([
      rpc('api_machine_credentials', { p_action: 'list' }),
      rpc('api_machine_overview', { p_offset: offset }),
      rpc('api_webhook_admin', { p_operation: 'list' }),
    ])
      .then(([v, o, d]) => {
        if (alive) {
          setView(v);
          setOverview(o);
          setDeliveries(d.deliveries.filter((x) => x.status === 'failed'));
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, isCloud, offset]);
  async function act(action, id) {
    setBusy(true);
    setError('');
    try {
      let args = { p_action: action, p_id: id || null };
      if (action === 'create') {
        const intent = JSON.stringify([name, source, scopes, days]);
        if (issuance.current?.intent !== intent)
          issuance.current = { intent, id: crypto.randomUUID() };
        args = {
          ...args,
          p_id: issuance.current.id,
          p_name: name,
          p_source: source,
          p_scopes: scopes,
          p_days: Number(days),
        };
      }
      const result = await rpc('api_machine_credentials', args);
      setView(result);
      if (action === 'create') {
        setToken(result.token || '');
        if (!result.token)
          setError(
            'This credential was already issued. Its secret cannot be recovered. Revoke it and create a new credential.',
          );
        issuance.current = null;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(id) {
    setBusy(true);
    setError('');
    try {
      await rpc('api_reconcile_webhook', { p_id: id, p_reason: reason });
      setReason('');
      setError(
        'Reconciliation evidence recorded; delivery remains failed until an explicit retry succeeds.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  return (
    <section className="panel intelligence-panel">
      <h2>Machine API and approved job feed</h2>
      <p>
        Create an expiring credential for the minimum required scopes. API writes require a UUID
        Idempotency-Key and the current external mapping version.
      </p>
      {error && <p role="status">{error}</p>}
      <div className="form-grid">
        <label>
          Credential name
          <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          External source
          <input maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          Expiry in days
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
      </div>
      <fieldset>
        <legend>Scopes</legend>
        {['candidate:write', 'demand:write', 'events:read', 'jobs:read'].map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={scopes.includes(s)}
              onChange={(e) =>
                setScopes(e.target.checked ? [...scopes, s] : scopes.filter((v) => v !== s))
              }
            />
            {s}
          </label>
        ))}
      </fieldset>
      <button
        disabled={busy || !name.trim() || !source.trim() || !scopes.length}
        onClick={() => act('create')}
      >
        Issue credential
      </button>
      {token && (
        <div>
          <label>
            Save this secret now; it is shown only once
            <textarea readOnly value={token} />
          </label>
          <button onClick={() => setToken('')}>Hide secret</button>
        </div>
      )}
      {view?.credentials.map((k) => (
        <article key={k.id}>
          <strong>{k.name}</strong>
          <p>
            {k.source} · {k.scopes.join(', ')} · Expires {new Date(k.expires).toLocaleString()} ·{' '}
            {k.revoked ? 'Revoked' : Date.parse(k.expires) <= Date.now() ? 'Expired' : 'Issued'}
          </p>
          <small>{k.id}</small>
          {!k.revoked && (
            <button disabled={busy} onClick={() => act('revoke', k.id)}>
              Revoke credential
            </button>
          )}
        </article>
      ))}
      <p>
        API:{' '}
        <code>/.netlify/functions/machine-api?action=candidate|demand|events|mappings|jobs</code>
      </p>
      <p>
        Public approved roles:{' '}
        <a
          href={`/.netlify/functions/approved-job-feed?ws=${encodeURIComponent(getWorkspaceId())}`}
        >
          Open approved job feed
        </a>
        . Add a source parameter to attribute applications.
      </p>
      {overview && (
        <>
          <h3>Demand mappings</h3>
          <p>
            Latest change cursor: {overview.cursor || '0'}. Read incremental events from a saved
            cursor; reconcile current records using external mappings.
          </p>
          {overview.mappings.map((m) => (
            <p key={`${m.source}:${m.external_id}`}>
              {m.source} · {m.external_id} → {m.demand_id} · version {m.version}
            </p>
          ))}
          <button disabled={!offset || busy} onClick={() => setOffset(offset - 50)}>
            Previous mappings
          </button>
          <button disabled={!overview.more || busy} onClick={() => setOffset(offset + 50)}>
            Next mappings
          </button>
        </>
      )}
      {deliveries.length > 0 && (
        <>
          <h3>Webhook reconciliation</h3>
          <p>
            Check receiver records for the signed event ID before retrying a failed delivery. Record
            evidence here, then use the existing webhook retry action.
          </p>
          <label>
            Receiver reconciliation evidence
            <textarea maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {deliveries.map((d) => (
            <p key={d.id}>
              {d.id} · {d.attempts} attempts{' '}
              <button disabled={busy || reason.trim().length < 10} onClick={() => reconcile(d.id)}>
                Record reconciliation
              </button>
            </p>
          ))}
        </>
      )}
    </section>
  );
}
