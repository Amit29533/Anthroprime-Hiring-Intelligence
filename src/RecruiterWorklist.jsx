import React, { useEffect, useRef, useState } from 'react';
import { intelligenceRpc } from './intelligence.js';
import { getRole, canWriteForRole } from './repository.js';
import { Button, Field, Badge } from './ui.jsx';
import { Bookmark, RefreshCw } from 'lucide-react';

const buckets = {
  tasks: 'Tasks',
  followups: 'Follow-ups',
  interviews: 'Interviews',
  'client-feedback': 'Client feedback',
};

export function RecruiterWorklist({
  rpc = intelligenceRpc,
  editable = canWriteForRole(getRole()),
  onOpen,
}) {
  const [view, setView] = useState({ bucket: 'tasks', horizon: 7 });
  const [ready, setReady] = useState(false),
    [page, setPage] = useState(null),
    [offset, setOffset] = useState(0);
  const [completed, setCompleted] = useState(false),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false),
    [prefRevision, setPrefRevision] = useState(0);
  const pending = useRef(null);
  useEffect(() => {
    let active = true;
    rpc('api_worklist_preferences')
      .then((prefs) => {
        if (
          !buckets[prefs?.bucket] ||
          !Number.isInteger(prefs?.horizon) ||
          prefs.horizon < 1 ||
          prefs.horizon > 30
        )
          throw new Error('Worklist preferences returned an invalid response.');
        if (active) {
          setView(prefs);
          setReady(true);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, prefRevision]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setPage(null);
    setError('');
    rpc('api_recruiter_worklist', {
      p_kind: view.bucket,
      p_days: view.horizon,
      p_offset: offset,
      p_completed: completed,
    })
      .then((result) => {
        if (
          !Array.isArray(result?.rows) ||
          result.rows.length > 25 ||
          !result.counts ||
          typeof result.more !== 'boolean'
        )
          throw new Error('Worklist queue returned an invalid response.');
        if (active) setPage(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, ready, view, offset, completed, revision]);
  const change = (next) => {
    setView(next);
    setOffset(0);
    setNotice('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await rpc('api_worklist_preferences', {
        p_save: true,
        p_kind: view.bucket,
        p_days: view.horizon,
      });
      setNotice('View remembered for your account in this workspace.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (row) => {
    if (row) {
      const intent = {
        p_kind: row.kind,
        p_id: row.id,
        p_version: row.version,
        p_state: !row.state,
      };
      if (!pending.current || JSON.stringify(pending.current.intent) !== JSON.stringify(intent))
        pending.current = { intent, operation: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await rpc('api_worklist_action', {
        ...pending.current.intent,
        p_operation: pending.current.operation,
      });
      pending.current = null;
      setFailed(false);
      setNotice('Internal worklist updated.');
      setRevision((n) => n + 1);
    } catch (err) {
      setFailed(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel recruiter-worklist" aria-label="Recruiter worklist">
      <div className="settings-body">
        <h2>Recruiter worklist</h2>
        <p>Tasks, follow-ups, interviews and feedback in one place.</p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {failed && (
          <div>
            <Button disabled={busy} onClick={() => decide()}>
              Retry exact worklist action
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                pending.current = null;
                setFailed(false);
                setError('');
                setRevision((n) => n + 1);
              }}
            >
              Clear failed action and refresh
            </Button>
            <p>
              Retries keep the original decision. Clearing a retry does not undo a server change.
            </p>
          </div>
        )}
        {!ready && !error && <p role="status">Loading your worklist view…</p>}
        {!ready && error && (
          <Button
            onClick={() => {
              setError('');
              setPrefRevision((n) => n + 1);
            }}
          >
            Retry loading view
          </Button>
        )}
        {ready && (
          <>
            <div className="form-grid worklist-filters">
              <Field label="Worklist queue">
                <select
                  value={view.bucket}
                  disabled={busy}
                  onChange={(e) => change({ ...view, bucket: e.target.value })}
                >
                  {Object.entries(buckets).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Upcoming days">
                <select
                  value={view.horizon}
                  disabled={busy}
                  onChange={(e) => change({ ...view, horizon: Number(e.target.value) })}
                >
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((days) => (
                    <option key={days} value={days}>
                      {days}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Worklist status">
                <select
                  value={String(completed)}
                  disabled={busy}
                  onChange={(e) => {
                    setCompleted(e.target.value === 'true');
                    setOffset(0);
                  }}
                >
                  {[false, true].map((state) => (
                    <option key={String(state)} value={String(state)}>
                      {state ? 'Completed / handled' : 'Pending'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="action-row">
              <Button icon={Bookmark} variant="secondary" disabled={busy} onClick={save}>
                Remember this view
              </Button>
              <Button
                icon={RefreshCw}
                variant="secondary"
                disabled={busy}
                onClick={() => setRevision((n) => n + 1)}
              >
                Refresh worklist
              </Button>
            </div>
            {!page && !error && <p role="status">Loading queue…</p>}
            {page && (
              <>
                <div className="table-scroll worklist-totals">
                  <table aria-label="Worklist totals">
                    <thead>
                      <tr>
                        <th scope="col">Queue</th>
                        <th scope="col">Pending</th>
                        <th scope="col">Overdue</th>
                        <th scope="col">Completed / handled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(buckets).map(([kind, label]) => {
                        const counts = page.counts[kind] || {};
                        return (
                          <tr key={kind}>
                            <th scope="row">{label}</th>
                            <td>{counts.pending || 0}</td>
                            <td>
                              <Badge tone={counts.overdue ? 'red' : 'gray'}>
                                {counts.overdue || 0}
                              </Badge>
                            </td>
                            <td>{counts.completed || 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <details className="search-help">
                  <summary>How these totals are calculated</summary>
                  <p>
                    Dates and overdue counts use UTC. Totals include past deadlines and undated
                    tasks within the selected horizon, and all outstanding client reviews. Display
                    preferences do not change reminder schedules.
                  </p>
                </details>
                {page.rows.length === 0 && <p>No matching work on this page.</p>}
                <ul className="worklist-items">
                  {page.rows.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>{row.title || buckets[row.kind]}</strong>
                        <small>{row.due || 'No deadline'}</small>
                      </div>
                      {row.overdue && <Badge tone="red">Overdue</Badge>}
                      <div className="action-row">
                        {row.candidate_id && onOpen && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onOpen(row.candidate_id)}
                          >
                            Open candidate
                          </Button>
                        )}
                        {editable && ['tasks', 'client-feedback'].includes(row.kind) && (
                          <Button disabled={busy || failed} onClick={() => decide(row)}>
                            {row.state
                              ? 'Reopen'
                              : row.kind === 'tasks'
                                ? 'Complete task'
                                : 'Mark feedback handled'}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {view.bucket === 'client-feedback' && (
                  <p>
                    Handling marks an internal review only. It does not change the client decision
                    or send a message.
                  </p>
                )}
                {['interviews', 'followups'].includes(view.bucket) && (
                  <p>
                    Open the candidate to update the interview or follow-up through its existing
                    workflow.
                  </p>
                )}
                <div className="action-row pagination-row">
                  <Button
                    variant="secondary"
                    disabled={busy || offset === 0}
                    onClick={() => setOffset((n) => Math.max(0, n - 25))}
                  >
                    Previous worklist page
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !page.more || offset >= 10000}
                    onClick={() => setOffset((n) => n + 25)}
                  >
                    Next worklist page
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
