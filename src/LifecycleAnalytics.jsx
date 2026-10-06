import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';

export async function fetchLifecycleAnalytics(days) {
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_lifecycle_analytics', { p_days: days });
  if (error)
    throw new Error(
      ['PGRST202', '42883'].includes(error.code)
        ? 'Apply the lifecycle_analytics migration to enable historical metrics.'
        : error.message,
    );
  return data;
}

export function LifecycleAnalytics({ isCloud = cloud, fetchMetrics = fetchLifecycleAnalytics }) {
  const [days, setDays] = useState(90);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setBusy(true);
    setMetrics(null);
    setError('');
    Promise.resolve()
      .then(() => fetchMetrics(days))
      .then((result) => {
        if (active) setMetrics(result);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Historical metrics could not be loaded.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [isCloud, days, refresh, fetchMetrics]);
  return (
    <section className="panel">
      <PanelHeading
        title="Historical ECOD progression"
        subtitle="Observed journeys for records added during the selected period"
      />
      <div className="settings-body">
        {!isCloud ? (
          <p>
            Historical tracking requires a shared cloud workspace. Demo records have no verified
            transition history.
          </p>
        ) : (
          <>
            <div className="section-toolbar">
              <label>
                Journey start period
                <select
                  aria-label="Historical cohort period"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                  <option value={365}>Last 365 days</option>
                </select>
              </label>
              <Button disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
                Refresh history
              </Button>
            </div>
            {busy && <p role="status">Loading historical metrics…</p>}
            {error && <p role="alert">{error}</p>}
            {metrics && (
              <>
                <p>
                  {metrics.considerations} tracked demand journeys · {metrics.openJourneys} still
                  open. Open journeys are included; these percentages can change as they progress.
                </p>
                <table>
                  <caption>Stages actually reached</caption>
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Journeys</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.stages.map((row) => (
                      <tr key={row.stage}>
                        <td>{row.stage}</td>
                        <td>{row.reached}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table>
                  <caption>Observed stage progression</caption>
                  <thead>
                    <tr>
                      <th>Transition</th>
                      <th>Progressed / entered</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.progression.map((row) => (
                      <tr key={row.from}>
                        <td>
                          {row.from} → {row.to}
                        </td>
                        <td>
                          {row.progressed} / {row.entered}
                        </td>
                        <td>{row.pct == null ? '—' : `${row.pct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Average time to first Ready status:{' '}
                  <strong>
                    {metrics.averageDaysToReady == null
                      ? '—'
                      : `${metrics.averageDaysToReady} days`}
                  </strong>{' '}
                  · {metrics.readyCandidates} of {metrics.candidates} tracked candidates reached
                  Ready. Ready status is recruiter-recorded, not proof of an assessment.
                </p>
                <table>
                  <caption>Source to Ready status</caption>
                  <thead>
                    <tr>
                      <th>Source at entry</th>
                      <th>Candidates</th>
                      <th>Reached Ready</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.sources.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source || 'Unknown'}</td>
                        <td>{row.total}</td>
                        <td>{row.ready}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">
                  Tracking began{' '}
                  {metrics.trackingSince
                    ? new Date(metrics.trackingSince).toLocaleDateString()
                    : 'with the first recorded event'}
                  . {metrics.baselineRecords} pre-existing records are excluded from these cohorts
                  because their complete history is unavailable. Merged candidates and relinked
                  journeys are excluded. Skipped stages are not inferred.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
