import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';
import { exportOutcomeMetrics, TIMING_LABELS } from './ecodOutcomeAnalytics.js';
import { getRole } from './repository.js';

export async function fetchLifecycleAnalytics(days) {
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_lifecycle_analytics', { p_days: days });
  if (error)
    throw new Error(
      ['PGRST202', '42883'].includes(error.code)
        ? 'Apply the lifecycle_analytics migration to enable historical metrics.'
        : error.message,
    );
  const { data: outcomes, error: outcomeError } = await client.rpc('api_ecod_outcome_analytics', {
    p_days: days,
  });
  if (outcomeError && !['PGRST202', '42883'].includes(outcomeError.code))
    throw new Error(outcomeError.message);
  return { ...data, outcomes, outcomesUnavailable: !!outcomeError };
}

export function LifecycleAnalytics({
  isCloud = cloud,
  fetchMetrics = fetchLifecycleAnalytics,
  exportMetrics = exportOutcomeMetrics,
  role = getRole(),
}) {
  const [days, setDays] = useState(90);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setBusy(true);
    setMetrics(null);
    setError('');
    setExportError('');
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
                {metrics.outcomesUnavailable && (
                  <p role="status">
                    Apply the ecod_outcome_analytics migration to enable placement, enrichment and
                    timing metrics.
                  </p>
                )}
                {metrics.outcomes && (
                  <>
                    <h3>Observed outcomes and hiring velocity</h3>
                    <p>
                      These cohorts start after outcome tracking began{' '}
                      {new Date(metrics.outcomes.trackingSince).toLocaleDateString()}. Only
                      completed observations contribute to timing averages; unobserved journeys may
                      still be open, ended without that milestone, or missing a recorded stage.
                    </p>
                    <table>
                      <caption>Historical timing in days</caption>
                      <thead>
                        <tr>
                          <th>Journey</th>
                          <th>Observed / tracked</th>
                          <th>Unobserved</th>
                          <th>Average</th>
                          <th>Median</th>
                          <th>90th percentile</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.outcomes.timings.map((r) => (
                          <tr key={r.metric}>
                            <td>{TIMING_LABELS[r.metric]}</td>
                            <td>
                              {r.completed} / {r.tracked}
                            </td>
                            <td>{r.unobserved}</td>
                            <td>{r.averageDays ?? '—'}</td>
                            <td>{r.medianDays ?? '—'}</td>
                            <td>{r.p90Days ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <table>
                      <caption>Source to active placement</caption>
                      <thead>
                        <tr>
                          <th>Source at candidate entry</th>
                          <th>Candidates</th>
                          <th>Assessed</th>
                          <th>Placed</th>
                          <th>Observed placement rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.outcomes.sources.map((r) => (
                          <tr key={r.source}>
                            <td>{r.source || 'Unknown'}</td>
                            <td>{r.total}</td>
                            <td>{r.assessed}</td>
                            <td>{r.placed}</td>
                            <td>{r.placementPct == null ? '—' : `${r.placementPct}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>
                      {metrics.outcomes.enrichment.completed} of {metrics.outcomes.enrichment.plans}{' '}
                      tracked enrichment plans completed · {metrics.outcomes.enrichment.reassessed}{' '}
                      subsequently reassessed · {metrics.outcomes.enrichment.readyAfterReassessment}{' '}
                      reached Ready after reassessment.
                    </p>
                    <p className="muted">
                      Reassessment must follow completion and match the plan's skill and demand
                      scope. This sequence does not prove training caused improvement or that all
                      skills passed validation. A placement counts only after an actual Active
                      event; Planned or a Deployed pipeline label alone does not count. First
                      shortlist means the first candidate linked to a demand.
                    </p>
                    {role !== 'viewer' && (
                      <Button
                        disabled={busy || exporting}
                        onClick={async () => {
                          setExporting(true);
                          setExportError('');
                          try {
                            await exportMetrics(days);
                          } catch (err) {
                            setExportError(err.message || 'Historical export failed.');
                          } finally {
                            setExporting(false);
                          }
                        }}
                      >
                        {exporting ? 'Preparing historical CSV…' : 'Export historical metrics'}
                      </Button>
                    )}
                    {exportError && <p role="alert">{exportError}</p>}
                  </>
                )}
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
