import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, Field, PanelHeading } from './ui.jsx';
async function freshnessRpc(name, args) {
  const c = await getSupabase();
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message || 'Freshness reviews are unavailable.');
  return data;
}
export function FreshnessReviews({ isCloud = cloud, rpc = freshnessRpc }) {
  const [page, setPage] = useState(null),
    [days, setDays] = useState(121),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setBusy(true);
    setPage(null);
    setError('');
    Promise.resolve()
      .then(() => rpc('api_freshness_reviews', { p_offset: offset }))
      .then((result) => {
        if (
          !Array.isArray(result?.rows) ||
          !Number.isInteger(result.total) ||
          !Number.isInteger(result.staleDays)
        )
          throw new Error('Freshness review is unavailable. Apply the freshness-review migration.');
        if (active) {
          setPage(result);
          setDays(result.staleDays);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [isCloud, rpc, offset, revision]);
  async function mutate(name, args) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await rpc(name, args);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading title="Internal freshness reviews" />
      <div className="settings-body">
        <p>
          Create shared review tasks for stale profiles with current recruiting-contact consent.
          Outbound holds, merged profiles and unavailable candidates are excluded. Verification
          updates and consent withdrawal close obsolete tasks. No candidate message is sent.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Refresh freshness reviews
        </Button>
        {page && (
          <>
            <p role="status">
              Reviews {page.enabled ? 'enabled' : 'paused'} · Last successful global batch:{' '}
              {page.lastRun ? new Date(page.lastRun).toLocaleString() : 'not recorded'}.
            </p>
            <Field label="Stale after days">
              <input
                type="number"
                min={30}
                max={365}
                step={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </Field>
            <Button
              disabled={busy || !Number.isInteger(days) || days < 30 || days > 365}
              onClick={() =>
                mutate('api_set_freshness_reviews', {
                  p_enabled: !page.enabled,
                  p_stale_days: days,
                })
              }
            >
              {page.enabled ? 'Pause freshness reviews' : 'Enable freshness reviews'}
            </Button>
            <Button
              disabled={
                busy ||
                !Number.isInteger(days) ||
                days < 30 ||
                days > 365 ||
                days === page.staleDays
              }
              onClick={() =>
                mutate('api_set_freshness_reviews', { p_enabled: page.enabled, p_stale_days: days })
              }
            >
              Save freshness threshold
            </Button>
            <p>
              The worker runs hourly. Refresh the workspace to see tasks in Notes &amp; Tasks.
              Completing a task does not create another for that verification period. Pausing keeps
              existing tasks; threshold changes are reconciled on the next batch.
            </p>
            <ul>
              {page.rows.map((r) => (
                <li key={r.id}>
                  {r.anthroId} · verified {r.verifiedOn} ·{' '}
                  {r.status === 'delivered' ? 'Task created' : r.status} · attempts {r.attempts}
                  {r.lastError ? ` · ${r.lastError}` : ''}
                  {r.status === 'failed' && (
                    <Button
                      disabled={busy || !page.enabled}
                      onClick={() => mutate('api_retry_freshness_review', { p_id: r.id })}
                    >
                      Retry freshness review {r.anthroId}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Button
              disabled={busy || offset === 0}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Previous freshness reviews
            </Button>
            <Button
              disabled={busy || offset + 50 >= page.total}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next freshness reviews
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
