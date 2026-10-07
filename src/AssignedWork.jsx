import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';

export function AssignedWork({ rpc = repositoryRead }) {
  const [list, setList] = useState(null),
    [selected, setSelected] = useState(null),
    [context, setContext] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState({ title: '', score: '', evidence: '', gap: '' });
  const operation = useRef(null),
    epoch = useRef(0);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    const generation = ++ref.current;
    setContext(null);
    setError('');
    setBusy(false);
    setDraft({ title: '', score: '', evidence: '', gap: '' });
    operation.current = null;
    async function read() {
      try {
        const value = await rpc('api_assigned_work', { p_assignment: selected, p_offset: offset });
        if (
          !Array.isArray(value?.rows) ||
          value.rows.length > 25 ||
          typeof value.more !== 'boolean'
        )
          throw new Error('Invalid assigned work response.');
        if (active && generation === epoch.current) {
          if (selected) setContext(value);
          else setList(value);
          setError('');
        }
      } catch (err) {
        if (active && generation === epoch.current) {
          setContext(null);
          setList(null);
          setError(err.message);
        }
      }
    }
    read();
    const timer = setInterval(read, 45000);
    const focus = () => read();
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      ref.current++;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [rpc, selected, offset, revision]);
  async function save(event) {
    event.preventDefault();
    const generation = epoch.current;
    setBusy(true);
    setError('');
    const details = { ...draft, score: Number(draft.score) };
    const signature = JSON.stringify({ selected, version: context.assignment.version, details });
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      await rpc('api_assigned_assessment', {
        p_assignment: selected,
        p_version: context.assignment.version,
        p_operation: operation.current.id,
        p_details: details,
      });
      if (generation === epoch.current) setRevision((v) => v + 1);
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h1>Assigned work</h1>
      <p>
        Your administrator assigns access with an expiry. Refresh checks whether access is still
        available.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button variant="secondary" onClick={() => setRevision((v) => v + 1)} disabled={busy}>
        Refresh assigned access
      </Button>
      {selected && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setSelected(null);
            setOffset(0);
          }}
        >
          Back to assignments
        </Button>
      )}
      {!selected && list && (
        <>
          {!list.rows.length && <p>No active assignments.</p>}
          {list.rows.map((row) => (
            <article key={row.id}>
              <p>
                {row.kind} · {row.target_id} · Expires {row.expires_at}
              </p>
              <Button
                onClick={() => {
                  setSelected(row.id);
                  setOffset(0);
                }}
              >
                Open assignment
              </Button>
            </article>
          ))}
        </>
      )}
      {context && (
        <>
          <p>Access expires {context.assignment.expires}</p>
          {context.candidate && (
            <>
              <h2>
                {context.candidate.name} · {context.candidate.anthroId}
              </h2>
              <p>
                {context.candidate.title} · {context.candidate.skills?.join(', ')}
              </p>
              <form aria-label="Assigned evaluation" onSubmit={save}>
                {Object.keys(draft).map((key) => (
                  <Field key={key} label={`Evaluation ${key}`}>
                    <input
                      aria-label={`Evaluation ${key}`}
                      disabled={busy}
                      required={key !== 'gap'}
                      type={key === 'score' ? 'number' : 'text'}
                      min={0}
                      max={100}
                      maxLength={key === 'title' ? 300 : 4000}
                      value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    />
                  </Field>
                ))}
                <Button type="submit" disabled={busy}>
                  Record evaluation
                </Button>
              </form>
              <h3>Your recorded evaluations</h3>
            </>
          )}
          {context.rows.map((row) => (
            <article className="panel" key={row.id}>
              <h3>{row.title}</h3>
              {context.candidate ? (
                <>
                  <p>
                    Score {row.score} · {row.date}
                  </p>
                  <p>{row.evidence}</p>
                  <p>{row.gap}</p>
                </>
              ) : (
                <>
                  <p>
                    {row.client} · {row.status} · {row.positions} positions · Target {row.target}
                  </p>
                  <p>
                    {Object.entries(row.progress || {})
                      .map(([stage, count]) => `${stage}: ${count}`)
                      .join(' · ') || 'No pipeline activity'}
                  </p>
                </>
              )}
            </article>
          ))}
        </>
      )}
      <Button
        variant="secondary"
        disabled={busy || offset === 0}
        onClick={() => setOffset((v) => Math.max(0, v - 25))}
      >
        Previous assignments or records
      </Button>
      <Button
        variant="secondary"
        disabled={busy || !(selected ? context : list)?.more}
        onClick={() => setOffset((v) => v + 25)}
      >
        Next assignments or records
      </Button>
    </section>
  );
}
export function AssignmentAdmin({ members, rpc = repositoryRead }) {
  const [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState({ member: '', kind: 'evaluation', target: '', expires: '' });
  const operation = useRef(null),
    epoch = useRef(0);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    ++ref.current;
    setPage(null);
    rpc('api_assignments_admin', { p_offset: offset })
      .then((value) => {
        if (!Array.isArray(value?.rows) || value.rows.length > 25)
          throw new Error('Invalid assignment page.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
      ++ref.current;
    };
  }, [rpc, offset, revision]);
  async function action(kind, details) {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    const signature = JSON.stringify({ kind, details });
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      let payload = details;
      if (kind === 'grant' && details.kind === 'evaluation' && /^ANTHRO-/i.test(details.target)) {
        const resolved = await rpc('api_candidate_by_anthro_id', { p_anthro_id: details.target });
        if (!resolved.candidateId) throw new Error('Candidate identity not found.');
        payload = { ...details, target: resolved.candidateId };
      }
      await rpc('api_assignments_admin', {
        p_action: kind,
        p_operation: operation.current.id,
        p_details: payload,
      });
      if (generation === epoch.current) {
        operation.current = null;
        setRevision((v) => v + 1);
      }
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Access assignments">
      <h3>Access assignments</h3>
      <p>
        Assign an Assessor to a candidate, or Sales/Account to a client or demand. Role changes
        revoke existing assignments. Expiry is required and limited to one year.
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        aria-label="Grant scoped access"
        onSubmit={(e) => {
          e.preventDefault();
          action('grant', { ...draft, expires: new Date(draft.expires).toISOString() });
        }}
      >
        <Field label="Assigned member">
          <select
            aria-label="Assigned member"
            required
            disabled={busy}
            value={draft.member}
            onChange={(e) => setDraft({ ...draft, member: e.target.value })}
          >
            <option value="">Choose limited member</option>
            {members
              .filter((m) => m.role === (draft.kind === 'evaluation' ? 'assessor' : 'sales'))
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Assignment scope">
          <select
            aria-label="Assignment scope"
            disabled={busy}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value, member: '' })}
          >
            {['evaluation', 'client', 'demand'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Target Anthro-ID or record ID">
          <input
            aria-label="Target Anthro-ID or record ID"
            required
            disabled={busy}
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: e.target.value })}
          />
        </Field>
        <Field label="Access expiry">
          <input
            aria-label="Access expiry"
            type="datetime-local"
            required
            disabled={busy}
            value={draft.expires}
            onChange={(e) => setDraft({ ...draft, expires: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          Grant scoped access
        </Button>
      </form>
      {page?.rows.map((row) => (
        <article key={row.id}>
          <p>
            {members.find((m) => m.userId === row.member_id)?.email || row.member_id} · {row.kind} ·{' '}
            {row.target_id} · Expires {row.expires_at} {row.revoked_at ? '· Revoked' : ''}
          </p>
          {!row.revoked_at && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => action('revoke', { id: row.id, version: row.version })}
            >
              Revoke assignment
            </Button>
          )}
        </article>
      ))}
      <Button
        variant="secondary"
        disabled={busy || offset === 0}
        onClick={() => setOffset((v) => Math.max(0, v - 25))}
      >
        Previous access assignments
      </Button>
      <Button
        variant="secondary"
        disabled={busy || !page?.more}
        onClick={() => setOffset((v) => v + 25)}
      >
        Next access assignments
      </Button>
    </section>
  );
}
