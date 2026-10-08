import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { cloud, getRole, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

const today = () => new Date().toISOString().slice(0, 10);
function checked(value, candidateId) {
  if (
    value?.candidateId !== candidateId ||
    !value.current ||
    !/^[a-f0-9]{32}$/.test(value.current.token || '') ||
    !Array.isArray(value.rows) ||
    value.rows.length > 25 ||
    typeof value.more !== 'boolean'
  )
    throw new Error('Availability returned an invalid response.');
  return value;
}
export function CandidateAvailability({
  candidateId,
  rpc = repositoryRead,
  enabled = cloud,
  editable = canWriteForRole(getRole()),
  onUpdated = () => {},
}) {
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [edit, setEdit] = useState(null),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState('');
  const live = useRef(false),
    operation = useRef(null);
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
      .then(() => rpc('api_candidate_availability', { p_candidate: candidateId, p_offset: offset }))
      .then((value) => {
        checked(value, candidateId);
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, enabled, offset, revision]);
  function reload() {
    setEdit(null);
    operation.current = null;
    setOffset(0);
    setRevision((value) => value + 1);
    setMessage('');
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const details = {
      ...edit.details,
      notice:
        edit.details.notice === '' || edit.details.notice == null
          ? null
          : Number(edit.details.notice),
      earliestStart: edit.details.earliestStart || null,
    };
    const signature = JSON.stringify({ candidateId, token: edit.token, details });
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    const operationId = operation.current.id;
    try {
      const result = checked(
        await rpc('api_record_candidate_availability', {
          p_candidate: candidateId,
          p_operation: operationId,
          p_token: edit.token,
          p_observation: details,
        }),
        candidateId,
      );
      if (result.recordedId !== operationId)
        throw new Error('Availability returned an invalid recording response.');
      if (live.current) {
        setPage(result);
        setOffset(0);
        setEdit(null);
        operation.current = null;
        setMessage(
          result.replayed
            ? 'Previously recorded observation confirmed. Current availability refreshed.'
            : 'Availability observation recorded.',
        );
        onUpdated({
          notice: result.current.notice,
          earliestStart: result.current.earliestStart,
          activeStatus: result.current.activeStatus,
          mode: result.current.mode,
        });
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
        Sourced availability history requires a cloud workspace. Demo profile editing remains
        available.
      </p>
    );
  return (
    <section aria-label="Candidate availability">
      <p>
        Availability is a recorded observation, not independently verified evidence. Blank notice
        and start date mean unknown; zero days means available without notice.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!page && !error && <p role="status">Loading availability…</p>}
      <Button variant="secondary" disabled={busy} onClick={reload}>
        {edit ? 'Reload availability and discard draft' : 'Refresh availability'}
      </Button>
      {page && (
        <>
          <p>
            Current: {page.current.activeStatus} · {page.current.mode || 'Work mode unknown'} ·{' '}
            {page.current.notice == null ? 'Notice unknown' : `${page.current.notice} days notice`}{' '}
            · Start {page.current.earliestStart || 'unknown'}
          </p>
          {editable && !edit && (
            <Button
              onClick={() => {
                const { token, ...details } = page.current;
                setEdit({ token, details: { ...details, source: '', observed: today() } });
                setError('');
                setMessage('');
              }}
            >
              Record availability update
            </Button>
          )}
          {edit && (
            <form aria-label="Record availability update" onSubmit={save}>
              {[
                ['notice', 'Availability notice days', 'number'],
                ['earliestStart', 'Earliest start date', 'date'],
                ['observed', 'Availability observation date', 'date'],
                ['source', 'Availability source', 'text'],
              ].map(([key, label, type]) => (
                <Field key={key} label={label}>
                  <input
                    aria-label={label}
                    type={type}
                    disabled={busy}
                    required={['source', 'observed'].includes(key)}
                    min={type === 'number' ? 0 : type === 'date' ? '1900-01-01' : undefined}
                    max={
                      type === 'number'
                        ? 3650
                        : key === 'observed'
                          ? today()
                          : type === 'date'
                            ? '2100-12-31'
                            : undefined
                    }
                    maxLength={1000}
                    step={1}
                    value={edit.details[key] ?? ''}
                    onChange={(event) =>
                      setEdit({ ...edit, details: { ...edit.details, [key]: event.target.value } })
                    }
                  />
                </Field>
              ))}
              <Field label="Candidate activity">
                <select
                  aria-label="Candidate activity"
                  disabled={busy}
                  value={edit.details.activeStatus}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      details: { ...edit.details, activeStatus: event.target.value },
                    })
                  }
                >
                  {['Active', 'Passive'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Availability work mode">
                <select
                  aria-label="Availability work mode"
                  disabled={busy}
                  value={edit.details.mode}
                  onChange={(event) =>
                    setEdit({ ...edit, details: { ...edit.details, mode: event.target.value } })
                  }
                >
                  {['', 'Flexible', 'Remote', 'Hybrid', 'Onsite'].map((value) => (
                    <option key={value} value={value}>
                      {value || 'Unknown'}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={busy}>
                Save availability observation
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEdit(null);
                  operation.current = null;
                  setError('');
                }}
              >
                Cancel availability update
              </Button>
            </form>
          )}
          <h3>Observation history</h3>
          {!page.rows.length && <p>No availability observations recorded.</p>}
          {page.rows.map((row) => (
            <article className="panel" key={row.id}>
              <p>
                {row.activeStatus} · {row.mode || 'Work mode unknown'} ·{' '}
                {row.notice == null ? 'Notice unknown' : `${row.notice} days notice`} · Start{' '}
                {row.earliestStart || 'unknown'}
              </p>
              <p>
                Observed {row.observed || 'date unknown'} · Source {row.source || 'not recorded'}
              </p>
              <small>
                Recorded {row.recordedAt || row.captured || 'date unknown'} · Actor{' '}
                {row.recordedBy || 'not recorded'}
                {row.candidateId !== candidateId ? ' · Retained merged identity' : ''}
              </small>
            </article>
          ))}
          <Button
            variant="secondary"
            disabled={busy || Boolean(edit) || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 25))}
          >
            Previous observations
          </Button>
          <Button
            variant="secondary"
            disabled={busy || Boolean(edit) || !page.more}
            onClick={() => setOffset((value) => value + 25)}
          >
            Next observations
          </Button>
        </>
      )}
    </section>
  );
}
