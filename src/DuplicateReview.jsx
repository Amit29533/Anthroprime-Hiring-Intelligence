import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';
import { canWriteForRole, getRole } from './repository.js';
export function DuplicateReview({
  rpc = repositoryRead,
  onUpdated = () => {},
  editable = canWriteForRole(getRole()),
}) {
  const [page, setPage] = useState(null),
    [context, setContext] = useState(null),
    [offset, setOffset] = useState(0),
    [reviewed, setReviewed] = useState(false),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [picks, setPicks] = useState({}),
    [confirmed, setConfirmed] = useState(false),
    [manual, setManual] = useState({ a: '', b: '' });
  const operation = useRef(null),
    epoch = useRef(0);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    ref.current++;
    setPage(null);
    setContext(null);
    setError('');
    rpc('api_duplicate_queue', { p_offset: offset, p_reviewed: reviewed })
      .then((value) => {
        if (!Array.isArray(value?.rows) || value.rows.length > 25)
          throw new Error('Invalid duplicate page.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
      ref.current++;
    };
  }, [rpc, offset, reviewed, revision]);
  async function open(a, b, eventsOffset = 0) {
    const generation = epoch.current;
    setBusy(true);
    setContext(null);
    setError('');
    try {
      const value = await rpc('api_duplicate_context', {
        p_a: a,
        p_b: b,
        p_events_offset: eventsOffset,
      });
      if (
        !value?.a?.id ||
        !value?.b?.id ||
        !Array.isArray(value.fields) ||
        !Array.isArray(value.events) ||
        !/^[a-f0-9]{32}$/.test(value.head || '')
      )
        throw new Error('Invalid duplicate context.');
      if (generation === epoch.current) {
        setContext(value);
        setPicks(Object.fromEntries(value.fields.map((key) => [key, 'a'])));
        setReason('');
        setConfirmed(false);
        operation.current = null;
      }
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function manualOpen(event) {
    event.preventDefault();
    const generation = epoch.current;
    setBusy(true);
    setError('');
    try {
      const resolve = async (value) => {
        if (/^ANTHRO-/i.test(value)) {
          const found = await rpc('api_candidate_by_anthro_id', { p_anthro_id: value });
          if (!found.candidateId) throw new Error('Candidate identity not found.');
          return found.candidateId;
        }
        return value;
      };
      const a = await resolve(manual.a.trim());
      const b = await resolve(manual.b.trim());
      if (generation === epoch.current) await open(a, b);
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function decide(status) {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    const args = {
      p_a: context.a.id,
      p_b: context.b.id,
      p_head: context.head,
      p_status: status,
      p_reason: reason,
      p_picks: status === 'merged' ? picks : {},
    };
    const signature = JSON.stringify(args);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      await rpc('api_duplicate_decision', { ...args, p_operation: operation.current.id });
      if (generation === epoch.current) {
        setRevision((v) => v + 1);
        onUpdated();
      }
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Duplicate review">
      <h3>Duplicate review</h3>
      <p>
        Similar names or references suggest a review; they do not prove identity. Merges preserve
        original linked evidence and retired Anthro-IDs. Review the primary fields below and retain
        one identity.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button variant="secondary" disabled={busy} onClick={() => setRevision((v) => v + 1)}>
        Reload duplicate review
      </Button>
      <label>
        <input
          type="checkbox"
          disabled={busy}
          checked={reviewed}
          onChange={(e) => {
            setReviewed(e.target.checked);
            setOffset(0);
          }}
        />{' '}
        Include reviewed suggestions
      </label>
      {page && (
        <>
          <p>{page.scope}</p>
          {page.bounded && (
            <p role="status">
              This workspace exceeds the suggestion batch. Use Anthro-IDs to review pairs outside
              this batch.
            </p>
          )}
          {!page.rows.length && <p>No pending suggestions in this batch.</p>}
          {!context &&
            page.rows.map((row) => (
              <article key={`${row.a}:${row.b}`}>
                <p>
                  {row.a_name} ({row.a_anthro}) + {row.b_name} ({row.b_anthro}) · {row.reason}{' '}
                  {row.status ? `· ${row.status}` : ''}
                </p>
                <Button disabled={busy} onClick={() => open(row.a, row.b)}>
                  Review pair
                </Button>
              </article>
            ))}
        </>
      )}
      {!context && (
        <form aria-label="Review identities by ID" onSubmit={manualOpen}>
          {['a', 'b'].map((key) => (
            <Field key={key} label={`Candidate ${key.toUpperCase()} Anthro-ID or record ID`}>
              <input
                aria-label={`Candidate ${key.toUpperCase()} Anthro-ID or record ID`}
                disabled={busy}
                required
                value={manual[key]}
                onChange={(e) => setManual({ ...manual, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Button type="submit" disabled={busy}>
            Review these identities
          </Button>
        </form>
      )}
      {context && (
        <>
          <h4>
            Survivor: {context.a.name} ({context.a.anthroId})
          </h4>
          <p>
            Retired on merge: {context.b.name} ({context.b.anthroId}). Historical facts retain their
            original identity. Consent and confirmation are not inferred from a merge.
          </p>
          {context.held && (
            <p role="alert">
              An outbound hold blocks merging. Review the privacy case before proceeding.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>A</th>
                <th>B</th>
                <th>Keep</th>
              </tr>
            </thead>
            <tbody>
              {context.fields.map((key) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{String(context.a[key] ?? 'Unknown')}</td>
                  <td>{String(context.b[key] ?? 'Unknown')}</td>
                  <td>
                    <select
                      aria-label={`Keep ${key} from`}
                      disabled={busy || !editable}
                      value={picks[key]}
                      onChange={(e) => setPicks({ ...picks, [key]: e.target.value })}
                    >
                      <option value="a">A</option>
                      <option value="b">B</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {editable && (
            <>
              <Field label="Duplicate decision reason">
                <input
                  aria-label="Duplicate decision reason"
                  disabled={busy}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                I reviewed both identities and every selected field for this merge
              </label>
              <Button
                disabled={busy || reason.trim().length < 3}
                onClick={() => decide('distinct')}
              >
                Mark distinct people
              </Button>
              <Button
                variant="secondary"
                disabled={busy || reason.trim().length < 3}
                onClick={() => decide('deferred')}
              >
                Defer for more evidence
              </Button>
              <Button
                disabled={busy || !confirmed || context.held || reason.trim().length < 3}
                onClick={() => decide('merged')}
              >
                Merge B into A
              </Button>
            </>
          )}
          <h4>Retained review history</h4>
          {context.events.map((row) => (
            <p key={row.id}>
              {row.status} · {row.reason} · {row.actor} · {row.at}
            </p>
          ))}
          <Button variant="secondary" disabled={busy} onClick={() => setContext(null)}>
            Back to suggestions
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !(context.eventsOffset > 0)}
            onClick={() => open(context.a.id, context.b.id, Math.max(0, context.eventsOffset - 25))}
          >
            Previous review history and discard draft
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !context.eventsMore}
            onClick={() => open(context.a.id, context.b.id, (context.eventsOffset || 0) + 25)}
          >
            Next review history and discard draft
          </Button>
        </>
      )}
      <Button
        variant="secondary"
        disabled={busy || Boolean(context) || offset === 0}
        onClick={() => setOffset((v) => Math.max(0, v - 25))}
      >
        Previous duplicate suggestions
      </Button>
      <Button
        variant="secondary"
        disabled={busy || Boolean(context) || !page?.more}
        onClick={() => setOffset((v) => v + 25)}
      >
        Next duplicate suggestions
      </Button>
    </section>
  );
}
