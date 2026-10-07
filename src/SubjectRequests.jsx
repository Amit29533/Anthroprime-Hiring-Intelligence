import React, { useEffect, useRef, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, Field, PanelHeading } from './ui.jsx';
import { SubjectAccessReview } from './SubjectAccessReview.jsx';
async function requestRpc(name, args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || 'Request tracking is unavailable.');
  return data;
}
const kinds = {
  access: 'Access',
  correction: 'Correction',
  restriction: 'Restriction',
  erasure: 'Erasure',
  retention_review: 'Retention review',
};
const actions = {
  verify: 'Record identity verification',
  start: 'Start review',
  wait: 'Await action',
  close: 'Record closure',
  decline: 'Record decline',
  reopen: 'Reopen request',
};
const available = {
  opened: ['verify', 'decline'],
  verified: ['start', 'decline'],
  in_review: ['wait', 'close', 'decline'],
  awaiting_action: ['start', 'close', 'decline'],
  closed: ['reopen'],
  declined: ['reopen'],
};
export function SubjectRequests({
  candidateId = null,
  isCloud = cloud,
  rpc = requestRpc,
  onHoldChange,
}) {
  const [page, setPage] = useState(null),
    [filter, setFilter] = useState('active'),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [historyOffset, setHistoryOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
      kind: 'access',
      summary: '',
      channel: 'email',
      due: '',
      assignee: '',
    }),
    [note, setNote] = useState(''),
    [plan, setPlan] = useState({ due: '', assignee: '' });
  const pending = useRef(null);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setPage(null);
    Promise.resolve()
      .then(() =>
        rpc('api_subject_request_page', {
          p_candidate: candidateId,
          p_filter: filter,
          p_offset: offset,
        }),
      )
      .then((value) => {
        if (
          !Array.isArray(value?.rows) ||
          !Array.isArray(value.admins) ||
          !Number.isInteger(value.total)
        )
          throw new Error('Invalid request queue response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, isCloud, rpc, filter, offset, revision]);
  useEffect(() => {
    if (!isCloud || !selected) return;
    let active = true;
    setDetail(null);
    Promise.resolve()
      .then(() => rpc('api_subject_request_detail', { p_id: selected, p_offset: historyOffset }))
      .then((value) => {
        if (!value?.case?.id || !Array.isArray(value.events) || !Number.isInteger(value.total))
          throw new Error('Invalid request history response.');
        if (active) {
          setDetail(value);
          setPlan({ due: value.case.dueDate || '', assignee: value.case.assignee || '' });
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [selected, historyOffset, isCloud, rpc, revision]);
  useEffect(() => {
    setSelected(null);
    setDetail(null);
    setOffset(0);
    pending.current = null;
  }, [candidateId]);
  async function mutate(name, args, idField) {
    if (busy) return;
    const fingerprint = JSON.stringify({ name, args });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const result = await rpc(name, { ...args, [idField]: pending.current.id });
      if (!result?.id || !Number.isInteger(result.version))
        throw new Error('Request receipt is unavailable. Retry the same action.');
      pending.current = null;
      setSelected(result.id);
      setHistoryOffset(0);
      setRevision((n) => n + 1);
      setNote('');
      if (name === 'api_create_subject_request')
        setForm({ kind: 'access', summary: '', channel: 'email', due: '', assignee: '' });
      if (name === 'api_set_subject_outbound_hold') {
        try {
          await onHoldChange?.();
        } catch {
          setError('Hold recorded. Reload the workspace to refresh candidate flags.');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  const ownerLabel = (id) =>
    page?.admins.find((admin) => admin.id === id)?.label ||
    (id ? 'Owner not listed' : 'Unassigned');
  const adminOptions = (
    <>
      <option value="">Unassigned</option>
      {page?.admins.map((admin) => (
        <option key={admin.id} value={admin.id}>
          {admin.label}
        </option>
      ))}
    </>
  );
  return (
    <section className="panel">
      <PanelHeading
        title="Data-subject request review"
        subtitle="Administrative review and outbound recruiting holds; erasure and wider processing controls require separate work"
      />
      <div className="settings-body">
        {error && <p role="alert">{error}</p>}
        {candidateId && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              mutate(
                'api_create_subject_request',
                {
                  p_candidate: candidateId,
                  p_kind: form.kind,
                  p_summary: form.summary,
                  p_channel: form.channel,
                  p_due: form.due || null,
                  p_assignee: form.assignee || null,
                },
                'p_id',
              );
            }}
          >
            <Field label="Request type">
              <select
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value })}
              >
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Request summary">
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
              />
            </Field>
            <Field label="Intake channel">
              <select
                value={form.channel}
                onChange={(event) => setForm({ ...form, channel: event.target.value })}
              >
                {['email', 'phone', 'portal', 'other'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Initial review date">
              <input
                type="date"
                value={form.due}
                onChange={(event) => setForm({ ...form, due: event.target.value })}
              />
            </Field>
            <Field label="Initial request owner">
              <select
                value={form.assignee}
                onChange={(event) => setForm({ ...form, assignee: event.target.value })}
              >
                {adminOptions}
              </select>
            </Field>
            <Button type="submit" disabled={busy || !page}>
              Record request case
            </Button>
          </form>
        )}
        <label>
          Request queue
          <select
            aria-label="Request queue filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setOffset(0);
            }}
          >
            <option value="active">Active requests</option>
            <option value="overdue">Overdue reviews</option>
            <option value="all">All requests</option>
          </select>
        </label>
        <Button
          disabled={busy}
          onClick={() => {
            setError('');
            setRevision((n) => n + 1);
          }}
        >
          Refresh request review
        </Button>
        {page && (
          <p>
            {page.total} cases · {page.overdue} overdue reviews in this queue. Review dates are set
            by administrators.
          </p>
        )}
        {page?.rows.map((row) => (
          <article key={row.id}>
            <strong>
              {kinds[row.kind] || row.kind} · {row.status}
            </strong>
            <p>
              {row.candidateName} · {row.anthroId}
              {row.mergedInto ? ' · original candidate has been merged' : ''}
            </p>
            <p>{row.summary}</p>
            <small>
              Owner {ownerLabel(row.assignee)} · review date {row.dueDate || 'Unscheduled'}
            </small>
            <Button
              disabled={busy}
              onClick={() => {
                setSelected(row.id);
                setHistoryOffset(0);
                setNote('');
                setError('');
              }}
            >
              Review request {row.id}
            </Button>
          </article>
        ))}
        <div className="section-toolbar">
          <Button disabled={!offset || busy} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
            Previous request cases
          </Button>
          <Button
            disabled={!page || offset + 50 >= page.total || busy}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next request cases
          </Button>
        </div>
        {detail && (
          <section aria-label="Selected request review">
            <h3>
              {kinds[detail.case.kind]} request · {detail.case.status}
            </h3>
            <p>{detail.case.summary}</p>
            {detail.case.kind === 'access' && (
              <SubjectAccessReview
                caseRecord={detail.case}
                rpc={rpc}
                busy={busy}
                onBusyChange={setBusy}
                onChanged={() => setRevision((n) => n + 1)}
              />
            )}
            <p>
              Case {detail.case.id} · version {detail.case.version} · {detail.case.anthroId}
            </p>
            <Field label="Review reference or decision">
              <textarea
                minLength={10}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <p>
              Record verification or action references. Keep identity documents in your approved
              private records. Closure records your decision; an active outbound hold remains until
              explicitly released.
            </p>
            {detail.case.kind === 'restriction' && (
              <div>
                <p>
                  Outbound hold: {detail.outboundHold?.active ? 'Active' : 'Inactive'}. This blocks
                  covered recruiting actions and audited candidate CSV exports. Reads and
                  corrections remain available.
                </p>
                {detail.outboundHold?.active && detail.outboundHold?.owned ? (
                  <Button
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      mutate(
                        'api_set_subject_outbound_hold',
                        {
                          p_id: detail.case.id,
                          p_version: detail.case.version,
                          p_enabled: false,
                          p_note: note,
                        },
                        'p_operation',
                      )
                    }
                  >
                    Release outbound hold
                  </Button>
                ) : (
                  !detail.outboundHold?.active &&
                  ['in_review', 'awaiting_action'].includes(detail.case.status) && (
                    <Button
                      disabled={busy || note.trim().length < 10}
                      onClick={() =>
                        mutate(
                          'api_set_subject_outbound_hold',
                          {
                            p_id: detail.case.id,
                            p_version: detail.case.version,
                            p_enabled: true,
                            p_note: note,
                          },
                          'p_operation',
                        )
                      }
                    >
                      Apply outbound hold
                    </Button>
                  )
                )}
              </div>
            )}
            <div className="section-toolbar">
              {(available[detail.case.status] || []).map((action) => (
                <Button
                  key={action}
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    mutate(
                      'api_update_subject_request',
                      {
                        p_id: detail.case.id,
                        p_version: detail.case.version,
                        p_action: action,
                        p_note: note,
                      },
                      'p_operation',
                    )
                  }
                >
                  {actions[action]}
                </Button>
              ))}
            </div>
            {!['closed', 'declined'].includes(detail.case.status) && (
              <>
                <Field label="Request owner">
                  <select
                    value={plan.assignee}
                    onChange={(event) => setPlan({ ...plan, assignee: event.target.value })}
                  >
                    {adminOptions}
                  </select>
                </Field>
                <Field label="Review date">
                  <input
                    type="date"
                    value={plan.due}
                    onChange={(event) => setPlan({ ...plan, due: event.target.value })}
                  />
                </Field>
                <Button
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    mutate(
                      'api_update_subject_request',
                      {
                        p_id: detail.case.id,
                        p_version: detail.case.version,
                        p_action: 'plan',
                        p_note: note,
                        p_due: plan.due || null,
                        p_assignee: plan.assignee || null,
                      },
                      'p_operation',
                    )
                  }
                >
                  Save request review plan
                </Button>
              </>
            )}
            <h4>Server-recorded history</h4>
            {detail.events.map((event) => (
              <article key={event.id}>
                <strong>
                  {event.action} · {event.status} · version {event.version}
                </strong>
                <p>{event.note}</p>
                <small>
                  {new Date(event.at).toLocaleString()} · actor {event.actor}
                </small>
                <p>
                  Owner {ownerLabel(event.assignee)} · review date {event.dueDate || 'Unscheduled'}
                </p>
              </article>
            ))}
            <div className="section-toolbar">
              <Button
                disabled={!historyOffset || busy}
                onClick={() => setHistoryOffset((n) => Math.max(0, n - 50))}
              >
                Previous request history
              </Button>
              <Button
                disabled={historyOffset + 50 >= detail.total || busy}
                onClick={() => setHistoryOffset((n) => n + 50)}
              >
                Next request history
              </Button>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
