import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { cloud, getRole, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

const today = () => new Date().toISOString().slice(0, 10);
const labels = {
  company: 'Employer',
  title: 'Role title',
  location: 'Employment location',
  employmentType: 'Employment type',
  startDate: 'Employment start',
  endDate: 'Employment end',
  kind: 'Compensation kind',
  amount: 'Amount in currency units',
  currency: 'Currency',
  basis: 'Pay basis',
  notice: 'Notice days',
  earliestStart: 'Earliest start',
  activeStatus: 'Activity',
  mode: 'Work mode',
  observed: 'Observation date',
  source: 'Source or evidence reference',
};
const stateLabels = {
  unconfirmed: 'No human-confirmed observation',
  'matches-current': 'Confirmed observation matches current profile',
  'current-differs': 'Current profile differs from the confirmed observation',
  'historical-currency': 'Currency fact retained separately from the INR LPA profile',
};
const choices = {
  employmentType: ['', 'Permanent', 'Contract', 'C2H', 'Subcontract'],
  kind: ['current', 'expected'],
  basis: ['Annual', 'Monthly', 'Daily', 'Hourly'],
  activeStatus: ['Active', 'Passive'],
  mode: ['', 'Flexible', 'Remote', 'Hybrid', 'Onsite'],
};
function initial(kind, current, row) {
  const source = row || current;
  const details =
    kind === 'employment'
      ? {
          company: source.company || '',
          title: source.title || '',
          location: source.location || '',
          employmentType: source.employmentType ?? source.engagement ?? '',
          startDate: source.startDate || '',
          endDate: source.endDate || '',
        }
      : kind === 'compensation'
        ? {
            kind: row?.kind || 'current',
            amount: row?.amountUnit === 'currency' ? (row.amount ?? '') : '',
            currency: row?.currency || 'INR',
            basis: row?.basis || 'Annual',
            components: row?.amountUnit === 'currency' ? row.components || {} : {},
          }
        : {
            notice: source.notice ?? '',
            earliestStart: source.earliestStart || '',
            activeStatus: source.activeStatus || source.status || 'Active',
            mode: source.mode ?? '',
          };
  return { ...details, source: row?.source || '', observed: today() };
}
function checked(value, kind) {
  if (
    !value?.candidateId ||
    value.kind !== kind ||
    !/^[a-f0-9]{32}$/.test(value.head || '') ||
    !value.current ||
    !Array.isArray(value.rows) ||
    value.rows.length > 25 ||
    typeof value.more !== 'boolean'
  )
    throw new Error('Candidate facts returned an invalid response.');
  return value;
}
function summary(kind, row) {
  if (kind === 'employment')
    return `${row.title || 'Role unknown'} · ${row.company || 'Employer unknown'} · ${row.startDate || 'Start unknown'} to ${row.endDate || 'End unknown'}`;
  if (kind === 'compensation')
    return `${row.kind}: ${row.amount == null ? 'Amount unknown' : row.amount} ${row.currency || 'Currency unknown'} / ${row.basis || 'Basis unknown'}${row.amountUnit !== 'currency' ? ' · Legacy profile units; review before reuse' : ''}`;
  return `${row.status || row.activeStatus} · ${row.mode || 'Work mode unknown'} · ${row.notice == null ? 'Notice unknown' : `${row.notice} days notice`} · Start ${row.earliestStart || 'unknown'}`;
}
export function CandidateFacts({
  candidateId,
  kind = 'employment',
  rpc = repositoryRead,
  enabled = cloud,
  editable = canWriteForRole(getRole()),
  onUpdated = () => {},
}) {
  const [page, setPage] = useState(null),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const operation = useRef(null),
    live = useRef(true),
    epoch = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    epoch.current += 1;
    setBusy(false);
    setPage(null);
    setDraft(null);
    setError('');
    setMessage('');
    operation.current = null;
    if (!enabled) return undefined;
    Promise.resolve()
      .then(() =>
        rpc('api_candidate_facts', { p_candidate: candidateId, p_kind: kind, p_offset: offset }),
      )
      .then((value) => {
        checked(value, kind);
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
      epoch.current += 1;
    };
  }, [candidateId, kind, rpc, enabled, offset, revision]);
  function begin(row = null) {
    operation.current = null;
    setError('');
    setMessage('');
    setDraft({
      head: page.head,
      details: initial(kind, page.current, row),
      confirmed: false,
      apply: false,
      supersedes: row?.id || null,
    });
  }
  async function save(event) {
    event.preventDefault();
    const generation = epoch.current;
    setBusy(true);
    setError('');
    setMessage('');
    const details = { ...draft.details };
    for (const key of ['startDate', 'endDate', 'earliestStart'])
      if (key in details) details[key] ||= null;
    for (const key of ['notice', 'amount'])
      if (key in details) details[key] = details[key] === '' ? null : Number(details[key]);
    const signature = JSON.stringify({ candidateId, kind, ...draft, details });
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    const operationId = operation.current.id;
    try {
      const value = checked(
        await rpc('api_record_candidate_fact', {
          p_candidate: page.candidateId,
          p_kind: kind,
          p_operation: operationId,
          p_head: draft.head,
          p_details: details,
          p_confirmed: draft.confirmed,
          p_apply_current: draft.apply,
          p_supersedes: draft.supersedes,
        }),
        kind,
      );
      if (value.recordedId !== operationId) throw new Error('Invalid fact recording response.');
      if (live.current && epoch.current === generation) {
        setPage(value);
        setDraft(null);
        operation.current = null;
        setMessage(value.replayed ? 'Previously recorded fact acknowledged.' : 'Fact recorded.');
        onUpdated(value.current);
      }
    } catch (err) {
      if (live.current && epoch.current === generation) setError(err.message);
    } finally {
      if (live.current && epoch.current === generation) setBusy(false);
    }
  }
  if (!enabled) return <p>Sourced facts require a cloud workspace.</p>;
  return (
    <section aria-label={`${kind} facts`}>
      <p>
        Recording a fact does not verify it. Human confirmation records who reviewed the source and
        when. Blank values mean unknown. Corrections retain the original record.
      </p>
      {kind === 'compensation' && (
        <p>
          Enter actual currency amounts. Applying INR annual or monthly pay updates the profile in
          annual LPA. Other currencies and pay bases remain historical facts.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setOffset(0);
          setRevision((v) => v + 1);
        }}
      >
        Reload facts and discard draft
      </Button>
      {!page && !error && <p role="status">Loading facts…</p>}
      {page && (
        <>
          <p>
            {page.latestConfirmed
              ? `Latest applicable human-confirmed observation: ${summary(kind, page.latestConfirmed)}. Observed ${page.latestConfirmed.observed || 'date unknown'}.`
              : 'No applicable human-confirmed observation.'}{' '}
            Confirmation applies to that observation; the current profile may have changed since.
          </p>
          {page.confirmationState &&
            (kind === 'compensation'
              ? Object.entries(page.confirmationState)
              : [[kind, page.confirmationState]]
            ).map(([key, state]) => (
              <p key={key}>
                {key}: {stateLabels[state.state] || 'Review confirmation state'} ·{' '}
                {state.stale
                  ? 'Observation older than 120 days or unconfirmed'
                  : 'Observation within 120 days'}{' '}
                · {state.observed || 'Observation date unknown'}
              </p>
            ))}
          {kind === 'compensation' &&
            Object.entries(page.latestConfirmedByKind || {}).map(([key, fact]) => (
              <p key={key}>
                {key}: {fact ? summary(kind, fact) : 'No human-confirmed observation'}
              </p>
            ))}
          {editable && !draft && <Button onClick={() => begin()}>Record {kind} fact</Button>}
          {draft && (
            <form aria-label={`Record ${kind} fact`} onSubmit={save}>
              {draft.supersedes && (
                <p>
                  Correcting record {draft.supersedes}. Review the source again before confirming.
                </p>
              )}
              {Object.keys(draft.details)
                .filter((key) => key !== 'components')
                .map((key) => (
                  <Field key={key} label={labels[key]}>
                    {choices[key] ? (
                      <select
                        aria-label={labels[key]}
                        disabled={busy}
                        value={draft.details[key]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            details: { ...draft.details, [key]: e.target.value },
                          })
                        }
                      >
                        {choices[key].map((value) => (
                          <option key={value} value={value}>
                            {value || 'Unknown'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={labels[key]}
                        disabled={busy}
                        type={
                          /Date|Start|observed/.test(key)
                            ? 'date'
                            : ['notice', 'amount'].includes(key)
                              ? 'number'
                              : 'text'
                        }
                        value={draft.details[key] ?? ''}
                        required={['company', 'title', 'source', 'observed', 'currency'].includes(
                          key,
                        )}
                        min={['notice', 'amount'].includes(key) ? 0 : undefined}
                        max={key === 'observed' ? today() : key === 'notice' ? 3650 : undefined}
                        step={key === 'amount' ? 'any' : 1}
                        maxLength={key === 'source' ? 1000 : 300}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            details: { ...draft.details, [key]: e.target.value },
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
              {kind === 'compensation' &&
                ['fixed', 'variable', 'bonus', 'equity'].map((key) => (
                  <Field key={key} label={`${key} component`}>
                    <input
                      aria-label={`${key} component`}
                      type="number"
                      min={0}
                      step="any"
                      disabled={busy}
                      value={draft.details.components[key] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          details: {
                            ...draft.details,
                            components: {
                              ...draft.details.components,
                              [key]: e.target.value === '' ? null : Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.confirmed}
                  onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })}
                />{' '}
                I reviewed the source and confirm this observation
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.apply}
                  onChange={(e) => setDraft({ ...draft, apply: e.target.checked })}
                />{' '}
                Apply this observation to the current profile
              </label>
              <Button type="submit" disabled={busy}>
                Save fact
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  operation.current = null;
                }}
              >
                Cancel
              </Button>
            </form>
          )}
          <h3>Retained fact history</h3>
          {!page.rows.length && <p>No facts recorded.</p>}
          {page.rows.map((row) => (
            <article className="panel" key={row.id}>
              <p>{summary(kind, row)}</p>
              <p>
                Observed {row.observed || 'date unknown'} · Source {row.source || 'not recorded'}
              </p>
              <p>
                {row.superseded ? 'Superseded · ' : ''}
                {row.verification === 'confirmed'
                  ? `Human-confirmed by ${row.verifiedBy || 'unknown actor'} at ${row.verifiedAt || 'unknown time'}`
                  : 'Unconfirmed observation'}
              </p>
              <small>
                Recorded by {row.recordedBy || 'legacy actor unknown'} at{' '}
                {row.recordedAt || 'legacy time unknown'}
                {row.candidateId !== page.candidateId ? ' · Retained merged identity' : ''}
              </small>
              {editable && !draft && !row.superseded && (
                <Button variant="secondary" onClick={() => begin(row)}>
                  Correct fact {row.id}
                </Button>
              )}
            </article>
          ))}
          <Button
            variant="secondary"
            disabled={busy || Boolean(draft) || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 25))}
          >
            Previous facts
          </Button>
          <Button
            variant="secondary"
            disabled={busy || Boolean(draft) || !page.more}
            onClick={() => setOffset((v) => v + 25)}
          >
            Next facts
          </Button>
        </>
      )}
    </section>
  );
}
