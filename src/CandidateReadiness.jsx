import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Badge } from './ui.jsx';
import { cloud, getRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

export function CandidateReadiness({
  candidateId,
  rpc = repositoryRead,
  enabled = cloud,
  validator = getRole() === 'admin',
}) {
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [decision, setDecision] = useState('Near-ready'),
    [days, setDays] = useState(30),
    [reason, setReason] = useState('');
  const operation = useRef(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPage(null);
    setError('');
    if (!enabled) return undefined;
    Promise.resolve()
      .then(() => rpc('api_candidate_readiness', { p_candidate: candidateId, p_offset: offset }))
      .then((value) => {
        if (
          !value?.candidateId ||
          typeof value.fingerprint !== 'string' ||
          !Array.isArray(value.rows) ||
          value.rows.length > 50 ||
          !Array.isArray(value.blockers)
        )
          throw new Error('Readiness returned an invalid response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, enabled, offset, revision]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const args = {
      p_candidate: page.candidateId,
      p_head: page.headId,
      p_fingerprint: page.fingerprint,
      p_decision: decision,
      p_days: Number(days),
      p_reason: reason.trim(),
    };
    const signature = JSON.stringify(args);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await rpc('api_decide_candidate_readiness', {
        ...args,
        p_operation: operation.current.id,
      });
      if (typeof result?.id !== 'string')
        throw new Error('Readiness decision returned an invalid response.');
      if (live.current) {
        operation.current = null;
        setReason('');
        setOffset(0);
        setRevision((n) => n + 1);
      }
    } catch (err) {
      if (live.current) setError(err.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  if (!enabled)
    return (
      <p>
        Readiness validation requires a cloud workspace. Profile status remains an observed
        recruiting label.
      </p>
    );
  return (
    <section aria-label="Candidate readiness review">
      <h3>Readiness review</h3>
      <p>
        This review uses general assessments and enrichment evidence. Demand fit must be reviewed
        separately. Decisions preserve the profile status and do not grant consent or authorize
        submissions.
      </p>
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p role="status">Loading readiness evidence…</p>}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => setRevision((n) => n + 1)}
      >
        Refresh readiness
      </Button>
      {page && (
        <>
          <p>
            Validated review: <Badge>{page.state}</Badge> · Profile status: {page.profileStatus}
          </p>
          {page.assessment && (
            <article>
              <h4>{page.assessment.title}</h4>
              <p>
                {page.assessment.score}/100 · {page.assessment.date} · Evidence valid through{' '}
                {page.assessment.validUntil}
              </p>
              <p>{page.assessment.evidence}</p>
              {page.assessment.evidenceTruncated && (
                <p>Evidence preview shortened; review the original assessment.</p>
              )}
            </article>
          )}
          <h4>Evidence checks</h4>
          {page.blockers.length ? (
            <ul>
              {page.blockers.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>Evidence checks passed. An administrator must still record a decision.</p>
          )}
          {validator ? (
            <form aria-label="Validate candidate readiness" onSubmit={submit}>
              <Field label="Readiness decision">
                <select
                  aria-label="Readiness decision"
                  value={decision}
                  disabled={busy}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="Ready" disabled={!page.eligible}>
                    Ready
                  </option>
                  <option value="Near-ready">Near-ready</option>
                  <option value="Not-ready">Not-ready</option>
                  <option value="Revoked">Revoked</option>
                </select>
              </Field>
              <Field
                label="Validity days"
                hint="Ready expiry is capped by assessment and profile evidence validity."
              >
                <input
                  aria-label="Validity days"
                  type="number"
                  min="1"
                  max="180"
                  step="1"
                  required
                  disabled={busy}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </Field>
              <Field label="Validator evidence">
                <textarea
                  aria-label="Validator evidence"
                  minLength={10}
                  maxLength={2000}
                  required
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                disabled={
                  busy || reason.trim().length < 10 || (decision === 'Ready' && !page.eligible)
                }
              >
                Record readiness decision
              </Button>
            </form>
          ) : (
            <p>Administrator validation is required to record a readiness decision.</p>
          )}
          <h4>Readiness decision history</h4>
          {!page.rows.length && <p>No readiness decisions recorded.</p>}
          {page.rows.map((row) => (
            <article key={row.id}>
              <p>
                <strong>{row.decision}</strong> · {row.at} · Valid through {row.expires}
              </p>
              <p>{row.reason}</p>
              <small>
                Validator: {row.actor} · Candidate identity: {row.candidateId}
              </small>
            </article>
          ))}
          <Button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous readiness history page
          </Button>
          <Button
            type="button"
            disabled={busy || !page.more}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next readiness history page
          </Button>
        </>
      )}
    </section>
  );
}
