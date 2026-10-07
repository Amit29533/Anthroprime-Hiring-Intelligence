import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Badge } from './ui.jsx';
import { cloud, getRole, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

export function CandidateContacts({
  candidateId,
  rpc = repositoryRead,
  enabled = cloud,
  editable = canWriteForRole(getRole()),
}) {
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [eventsOffset, setEventsOffset] = useState(0),
    [form, setForm] = useState({ kind: 'email', value: '', label: '', source: '' }),
    [reason, setReason] = useState('');
  const live = useRef(true),
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
      .then(() =>
        rpc('api_candidate_contacts', {
          p_candidate: candidateId,
          p_offset: offset,
          p_events_offset: eventsOffset,
        }),
      )
      .then((value) => {
        if (
          !value?.candidateId ||
          !Array.isArray(value.rows) ||
          value.rows.length > 50 ||
          !Array.isArray(value.events) ||
          value.events.length > 50
        )
          throw new Error('Contacts returned an invalid response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, enabled, offset, eventsOffset, revision]);
  async function change(action, contact) {
    setBusy(true);
    setError('');
    const details = action === 'add' ? { ...form } : { reason: reason.trim() };
    const intent = {
      p_candidate: page.candidateId,
      p_action: action,
      p_contact: contact?.id || null,
      p_version: contact?.version || 0,
      p_details: details,
    };
    const signature = JSON.stringify(intent);
    if (operation.current?.signature !== signature)
      operation.current = {
        signature,
        id: crypto.randomUUID(),
        contact: contact?.id || crypto.randomUUID(),
      };
    try {
      const result = await rpc('api_change_candidate_contact', {
        ...intent,
        p_contact: operation.current.contact,
        p_operation: operation.current.id,
      });
      if (result?.contactId !== operation.current.contact || !Number.isInteger(result.version))
        throw new Error('Contact update returned an invalid response.');
      if (live.current) {
        operation.current = null;
        setReason('');
        if (action === 'add') setForm({ kind: 'email', value: '', label: '', source: '' });
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
        Alternate contact review is available in a cloud workspace. Existing primary contacts remain
        on the profile.
      </p>
    );
  return (
    <section aria-label="Candidate contacts">
      <h3>Contacts & verification</h3>
      <p>
        Record alternate contacts and explicit recruiter confirmation. Preferred contacts do not
        change the primary profile fields, portal access or recruiting consent.
      </p>
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p role="status">Loading contacts…</p>}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => setRevision((n) => n + 1)}
      >
        Refresh contacts
      </Button>
      {page && (
        <>
          <p>
            Primary email: {page.primaryEmail || 'Not recorded'} · Primary phone:{' '}
            {page.primaryPhone || 'Not recorded'}
          </p>
          {editable && (
            <form
              aria-label="Record alternate contact"
              onSubmit={(e) => {
                e.preventDefault();
                change('add');
              }}
            >
              <div className="form-grid">
                <Field label="Contact type">
                  <select
                    aria-label="Contact type"
                    disabled={busy}
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                  </select>
                </Field>
                <Field label="Contact value">
                  <input
                    aria-label="Contact value"
                    disabled={busy}
                    required
                    maxLength={254}
                    type={form.kind === 'email' ? 'email' : 'tel'}
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                </Field>
                <Field label="Contact label">
                  <input
                    aria-label="Contact label"
                    disabled={busy}
                    maxLength={60}
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </Field>
                <Field label="Contact source">
                  <input
                    aria-label="Contact source"
                    disabled={busy}
                    required
                    minLength={3}
                    maxLength={80}
                    placeholder="Candidate call, CV, or reviewed record"
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={busy}>
                Record declared contact
              </Button>
            </form>
          )}
          {editable && (
            <Field label="Verification or change evidence">
              <textarea
                aria-label="Verification or change evidence"
                disabled={busy}
                minLength={10}
                maxLength={1000}
                value={reason}
                placeholder="Describe how this was confirmed, or why preference/retirement changes."
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {!page.rows.length && <p>No alternate contacts recorded.</p>}
          {page.rows.map((c) => (
            <article className="panel" key={c.id}>
              <div className="settings-body">
                <strong>
                  {c.kind}: {c.value}
                </strong>{' '}
                <Badge>
                  {!c.active ? 'Retired' : c.verified_at ? 'Recruiter confirmed' : 'Declared'}
                </Badge>{' '}
                {c.preferred && <Badge>Preferred</Badge>}
                <p>
                  {c.label || 'No label'} · Source: {c.source}
                </p>
                {c.verified_at && (
                  <p>
                    Confirmed: {c.verified_at} · Reviewer: {c.verified_by} · {c.verification_note}
                  </p>
                )}
                {editable && c.active && (
                  <>
                    <Button
                      type="button"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() => change('verify', c)}
                    >
                      Confirm {c.value}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || reason.trim().length < 10 || !c.verified_at || c.preferred}
                      onClick={() => change('prefer', c)}
                    >
                      Prefer {c.value}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() => {
                        if (window.confirm(`Retire ${c.value}? Its history will be preserved.`))
                          change('retire', c);
                      }}
                    >
                      Retire {c.value}
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
          <Button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous contact page
          </Button>
          <Button
            type="button"
            disabled={busy || !page.more}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next contact page
          </Button>
          <h3>Contact history</h3>
          {!page.events.length && <p>No contact events recorded.</p>}
          {page.events.map((e) => (
            <p key={e.id}>
              {e.at} · {e.action} · {e.snapshot?.value} · {e.reason}
            </p>
          ))}
          <Button
            type="button"
            disabled={busy || eventsOffset === 0}
            onClick={() => setEventsOffset((n) => Math.max(0, n - 50))}
          >
            Previous contact history page
          </Button>
          <Button
            type="button"
            disabled={busy || !page.eventsMore}
            onClick={() => setEventsOffset((n) => n + 50)}
          >
            Next contact history page
          </Button>
        </>
      )}
    </section>
  );
}
