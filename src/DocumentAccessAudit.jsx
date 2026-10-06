import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';
async function auditRpc(args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_document_access_page', args);
  if (error) throw new Error('Document access audit is unavailable.');
  return data;
}
export function DocumentAccessAudit({ isCloud = cloud, read = auditRpc }) {
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
        if (!Array.isArray(value?.rows) || !value.counts || !Number.isInteger(value.total))
          throw new Error('Invalid access audit response.');
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
        title="Document access audit"
        subtitle="Server-recorded signing requests; an issued URL does not prove a completed download"
      />
      <div className="settings-body">
        {page && !page.enabled && (
          <p>
            Audited document access is disabled. Deploy and verify the server controls before
            enabling the workspace flag.
          </p>
        )}
        <label>
          Audit period
          <select
            aria-label="Document audit period"
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
        <Button onClick={() => setRevision((n) => n + 1)}>Refresh document access audit</Button>
        {error && <p role="alert">{error}</p>}
        {page && (
          <p>
            {page.counts.issued || 0} URLs issued · {page.counts.failed || 0} failed ·{' '}
            {page.counts.abandoned || 0} abandoned · {page.counts.throttled || 0} rate-limit windows
          </p>
        )}
        {page?.counts.throttled > 0 && (
          <p role="status">
            Rate limits were reached. Review the actors and signing attempts below.
          </p>
        )}
        {page?.rows.map((row) => (
          <article key={row.id}>
            <strong>{row.outcome}</strong>
            <p>
              {row.provider} · document {row.documentId} · actor {row.actor}
            </p>
            <small>
              {new Date(row.requestedAt).toLocaleString()} · {row.reason}
            </small>
          </article>
        ))}
        <div className="section-toolbar">
          <Button disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
            Previous access events
          </Button>
          <Button
            disabled={!page || offset + 50 >= page.total}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next access events
          </Button>
        </div>
      </div>
    </section>
  );
}
