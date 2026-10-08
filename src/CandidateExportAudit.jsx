import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';
async function readAudit(args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_candidate_export_page', args);
  if (error) throw new Error('Candidate export audit is unavailable.');
  return data;
}
export function CandidateExportAudit({ isCloud = cloud, read = readAudit }) {
  const [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [hours, setHours] = useState(24),
    [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setPage(null);
    setError('');
    Promise.resolve()
      .then(() => read({ p_offset: offset, p_hours: hours }))
      .then((value) => {
        if (
          !Array.isArray(value?.rows) ||
          !Number.isInteger(value.total) ||
          !Number.isFinite(value.volume)
        )
          throw new Error('Invalid candidate export audit response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [isCloud, read, offset, hours, revision]);
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading
        title="Candidate CSV export audit"
        subtitle="Server-prepared datasets; a receipt does not confirm a file was saved"
      />
      <div className="settings-body">
        {page && !page.enabled && (
          <p>
            Audited candidate CSV exports are disabled. Verify staging before enabling the workspace
            flag.
          </p>
        )}
        <label>
          Audit period
          <select
            aria-label="Candidate export audit period"
            value={hours}
            onChange={(event) => {
              setHours(Number(event.target.value));
              setOffset(0);
            }}
          >
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
        </label>
        <Button onClick={() => setRevision((n) => n + 1)}>Refresh candidate export audit</Button>
        {error && <p role="alert">{error}</p>}
        {page && (
          <p>
            {page.volume} candidate rows prepared · {page.throttled} rate-limit windows
          </p>
        )}
        {page && (page.volume >= 1000 || page.throttled > 0) && (
          <p role="status">
            Export volume or rate limits warrant review for the selected period. Repeated candidates
            count again.
          </p>
        )}
        {page?.rows.map((row) => (
          <article key={row.id}>
            <strong>
              {row.outcome} · {row.rowCount} rows
            </strong>
            <p>
              Actor {row.actor} · {row.projection} projection · receipt {row.id}
            </p>
            <small>
              {new Date(row.preparedAt).toLocaleString()} · schema {row.schemaVersion}
            </small>
          </article>
        ))}
        <div className="section-toolbar">
          <Button disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
            Previous export events
          </Button>
          <Button
            disabled={!page || offset + 50 >= page.total}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next export events
          </Button>
        </div>
      </div>
    </section>
  );
}
