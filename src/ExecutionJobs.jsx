import React, { useState, useEffect } from 'react';
import { cloud } from './repository.js';
import { executionRpc } from './execution.js';
import { Button, Badge, PanelHeading } from './ui.jsx';

export function ExecutionJobsPanel({ rpc = executionRpc, isCloud = cloud }) {
  const [result, setResult] = useState(null),
    [status, setStatus] = useState(''),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    setBusy(true);
    setError('');
    setResult(null);
    rpc('api_execution_jobs', { p_status: status, p_offset: offset })
      .then((data) => {
        if (alive) setResult(data);
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
  }, [rpc, isCloud, status, offset, refresh]);
  async function action(name, args) {
    setBusy(true);
    setError('');
    try {
      await rpc(name, args);
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <PanelHeading
        title="Background workflows"
        subtitle="Durable jobs that continue when the browser is closed."
      />
      <div className="settings-body">
        {!isCloud ? (
          <p>
            Background execution requires the shared Supabase workspace and the scheduled Netlify
            worker. Demo rules continue to run in this browser.
          </p>
        ) : (
          <>
            <p>
              Server assignment runs when records are created. Workflow changes enter a durable
              queue; the scheduled worker processes them. No email is sent by this worker.
            </p>
            {result && (
              <>
                <Badge tone={result.enabled ? 'green' : 'amber'}>
                  {result.enabled ? 'Server execution enabled' : 'Browser execution enabled'}
                </Badge>
                <p>
                  Enable after migration 035 and the worker are deployed, then reload all open app
                  tabs. Pausing holds queued jobs; re-enabling resumes them. Existing records are
                  not backfilled.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => action('api_set_server_execution', { p_enabled: !result.enabled })}
                >
                  {result.enabled ? 'Pause server execution' : 'Enable server execution'}
                </Button>
              </>
            )}
            <div className="section-toolbar">
              <label>
                Job status{' '}
                <select
                  aria-label="Job status"
                  value={status}
                  disabled={busy}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All jobs</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setRefresh((value) => value + 1)}
              >
                Refresh jobs
              </Button>
            </div>
            <p className="supporting-text">
              Failed jobs retry automatically up to five attempts. An administrator can retry a
              failed job with the rule’s current actions after fixing it. Completed jobs cannot be
              replayed.
            </p>
            {busy && <p role="status">Loading background workflows…</p>}
            {result?.jobs?.length === 0 && <p>No jobs found for this filter.</p>}
            <div className="execution-job-list">
              {result?.jobs?.map((job) => (
                <article className="execution-job" key={job.id}>
                  <div>
                    <strong>{job.ruleName}</strong>{' '}
                    <Badge
                      tone={
                        job.status === 'completed'
                          ? 'green'
                          : job.status === 'failed'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>
                  <p>
                    {job.entityType} · {job.entityId} · {job.attempts}/5 attempts
                  </p>
                  <small>
                    {job.status === 'pending'
                      ? `Eligible after ${new Date(job.availableAt).toLocaleString()}`
                      : job.completed
                        ? `Completed ${new Date(job.completed).toLocaleString()}`
                        : `Created ${new Date(job.created).toLocaleString()}`}
                  </small>
                  {job.lastError && <p role="status">{job.lastError}</p>}
                  {job.status === 'failed' && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => action('api_retry_execution_job', { p_id: job.id })}
                    >
                      Retry {job.ruleName}
                    </Button>
                  )}
                </article>
              ))}
            </div>
            {result && (
              <div className="pagination">
                <Button
                  variant="secondary"
                  disabled={busy || offset === 0}
                  onClick={() => setOffset((value) => Math.max(0, value - 25))}
                >
                  Previous jobs
                </Button>
                <span>
                  {result.total ? offset + 1 : 0}–{Math.min(offset + 25, result.total)} of{' '}
                  {result.total}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy || offset + 25 >= result.total}
                  onClick={() => setOffset((value) => value + 25)}
                >
                  Next jobs
                </Button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
