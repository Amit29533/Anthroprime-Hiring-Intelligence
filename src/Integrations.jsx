import { candidateLabel } from './anthroId.js';
import React, { useState, useEffect } from 'react';
import { cloud } from './repository.js';
import { intelligenceRpc } from './intelligence.js';
import { Button, PanelHeading } from './ui.jsx';

export function IntegrationsPanel({ rpc = intelligenceRpc, isCloud = cloud }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [secret, setSecret] = useState(''),
    [rotation, setRotation] = useState({});
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    rpc('api_webhook_admin', { p_operation: 'list' })
      .then((value) => {
        if (alive) setResult(value);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, isCloud]);
  async function action(args) {
    setBusy(true);
    setError('');
    try {
      setResult(await rpc('api_webhook_admin', args));
      if (args.p_operation === 'create') {
        setSecret('');
        setName('');
        setUrl('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  return (
    <section className="panel intelligence-panel">
      <PanelHeading
        title="Integrations and webhooks"
        subtitle="Signed notifications and idempotent candidate writes for external systems."
      />
      <div className="settings-body">
        <p>
          Webhooks contain event IDs and record references. Receivers verify the signature and
          deduplicate event IDs. Create a subscription, configure your receiver, then enable
          delivery.
        </p>
        <div className="section-toolbar">
          <label>
            Subscription name
            <input
              aria-label="Subscription name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Receiver URL
            <input
              aria-label="Webhook URL"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-receiver.example/events"
            />
          </label>
          <label>
            Signing secret
            <input
              aria-label="Webhook signing secret"
              type="password"
              autoComplete="new-password"
              minLength={32}
              maxLength={256}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !name.trim() || !url.startsWith('https://') || secret.length < 32}
            onClick={() =>
              action({ p_operation: 'create', p_name: name, p_url: url, p_secret: secret })
            }
          >
            Create paused subscription
          </Button>
        </div>
        {result?.subscriptions.map((s) => (
          <div className="section-toolbar" key={s.id}>
            <strong>{s.name}</strong>
            <span>{s.url}</span>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => action({ p_operation: 'toggle', p_id: s.id, p_enabled: !s.enabled })}
            >
              {s.enabled ? 'Pause' : 'Enable'}
            </Button>
            {!s.enabled && (
              <>
                <label>
                  New signing secret
                  <input
                    aria-label={`New signing secret for ${s.name}`}
                    type="password"
                    autoComplete="new-password"
                    maxLength={256}
                    value={rotation[s.id] || ''}
                    onChange={(e) => setRotation({ ...rotation, [s.id]: e.target.value })}
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={busy || (rotation[s.id] || '').length < 32}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await rpc('api_rotate_webhook', { p_id: s.id, p_secret: rotation[s.id] });
                      setRotation({ ...rotation, [s.id]: '' });
                      setResult(await rpc('api_webhook_admin', { p_operation: 'list' }));
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Rotate signing key
                </Button>
              </>
            )}
          </div>
        ))}
        <Button variant="secondary" disabled={busy} onClick={() => action({ p_operation: 'list' })}>
          Refresh deliveries
        </Button>
        {result?.deliveries.map((d) => (
          <div className="section-toolbar" key={d.id}>
            <span>
              {d.status} · {d.attempts} attempts · {new Date(d.created).toLocaleString()}{' '}
              {d.last_error}
            </span>
            {d.status === 'failed' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => action({ p_operation: 'retry', p_id: d.id })}
              >
                Retry failed delivery
              </Button>
            )}
          </div>
        ))}
        <p>
          Candidate integration endpoint: <code>/.netlify/functions/integration-candidate</code>.
          Requires a workspace editor’s bearer token, an Idempotency-Key header, source and
          externalId. Updates require the returned mapping version.
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

export function ExternalMappingsPanel({ candidates = [], rpc = intelligenceRpc, isCloud = cloud }) {
  const [page, setPage] = useState(null),
    [source, setSource] = useState(''),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [targets, setTargets] = useState({});
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    setBusy(true);
    setError('');
    setPage(null);
    rpc('api_mapping_page', { p_source: source, p_offset: offset })
      .then((value) => {
        if (alive) setPage(value);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [rpc, isCloud, source, offset, refresh]);
  if (!isCloud) return null;
  return (
    <section className="panel intelligence-panel">
      <PanelHeading
        title="External candidate mappings"
        subtitle="Review external IDs and repair links without copying or overwriting candidate data."
      />
      <div className="settings-body">
        <label>
          Source filter
          <input
            aria-label="Mapping source filter"
            value={source}
            maxLength={100}
            onChange={(e) => {
              setSource(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <Button variant="secondary" disabled={busy} onClick={() => setRefresh(refresh + 1)}>
          Refresh mappings
        </Button>
        {page?.rows.map((row) => {
          const key = JSON.stringify([row.source, row.externalId]);
          return (
            <div className="section-toolbar" key={key}>
              <span>
                {row.source} / {row.externalId} → {row.name} ·{' '}
                {candidateLabel(
                  candidates.find((c) => c.id === row.candidateId) || {
                    anthroId: row.anthroId,
                    name: 'Anthro-ID',
                  },
                )}{' '}
                · Version {row.version}
                {row.mergedInto && ' · Merged candidate: reconcile link'}
              </span>
              <label>
                Candidate link
                <select
                  aria-label={`Candidate link for ${row.externalId}`}
                  value={targets[key] || ''}
                  onChange={(e) => setTargets({ ...targets, [key]: e.target.value })}
                >
                  <option value="">Choose replacement candidate</option>
                  {candidates
                    .filter((c) => !c.mergedInto && c.id !== row.candidateId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {candidateLabel(c)}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                variant="secondary"
                disabled={busy || !targets[key]}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await rpc('api_reconcile_mapping', {
                      p_source: row.source,
                      p_external_id: row.externalId,
                      p_version: row.version,
                      p_candidate: targets[key],
                    });
                    setTargets({ ...targets, [key]: '' });
                    setRefresh(refresh + 1);
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reconcile candidate link
              </Button>
            </div>
          );
        })}
        {page && (
          <div className="section-toolbar">
            <span>
              {page.total === 0 ? 0 : offset + 1}–{Math.min(offset + 25, page.total)} of{' '}
              {page.total}
            </span>
            <Button
              variant="secondary"
              disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Previous mappings
            </Button>
            <Button
              variant="secondary"
              disabled={busy || offset + 25 >= page.total}
              onClick={() => setOffset(offset + 25)}
            >
              Next mappings
            </Button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
