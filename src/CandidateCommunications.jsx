import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';
import { getRole, canWriteForRole } from './repository.js';
const blankTemplate = {
  key: '',
  version: 0,
  kind: 'custom',
  purpose: 'recruiting-contact',
  subject: 'Hello {{candidateName}}',
  text: 'Your Anthro-ID is {{anthroId}}.',
  enabled: true,
};
export function CandidateCommunications({
  candidateId = null,
  rpc = repositoryRead,
  role = getRole(),
}) {
  const [candidate, setCandidate] = useState(candidateId),
    [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(null),
    [template, setTemplate] = useState(''),
    [demand, setDemand] = useState(''),
    [contextQuery, setContextQuery] = useState(''),
    [contextSearch, setContextSearch] = useState(''),
    [interview, setInterview] = useState(''),
    [preview, setPreview] = useState(null),
    [schedule, setSchedule] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [tag, setTag] = useState(''),
    [people, setPeople] = useState(null),
    [peopleOffset, setPeopleOffset] = useState(0);
  const operation = useRef(null),
    epoch = useRef(0);
  const editor = canWriteForRole(role),
    admin = role === 'admin';
  useEffect(() => {
    setCandidate(candidateId);
  }, [candidateId]);
  useEffect(() => {
    setOffset(0);
    setDraft(null);
    setPreview(null);
    setTemplate('');
    setDemand('');
    setInterview('');
    operation.current = null;
  }, [candidate]);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    const generation = ++ref.current;
    setPage(null);
    setError('');
    setBusy(false);
    rpc('api_test_communications', {
      p_action: 'context',
      p_payload: { contextQuery },
      p_candidate: candidate,
      p_offset: offset,
    })
      .then((v) => {
        if (
          v?.transport !== 'test-only' ||
          !Array.isArray(v.rows) ||
          v.rows.length > 25 ||
          !Array.isArray(v.templates) ||
          typeof v.more !== 'boolean'
        )
          throw new Error('Invalid communication context.');
        if (active && ref.current === generation) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      ref.current++;
    };
  }, [candidate, rpc, offset, revision, contextQuery]);
  useEffect(() => {
    if (candidateId) return;
    let active = true;
    setPeople(null);
    rpc('api_test_communications', {
      p_action: 'browse',
      p_payload: { query, status, tag },
      p_offset: peopleOffset,
    })
      .then((v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25 || typeof v.more !== 'boolean')
          throw new Error('Invalid recipient segment.');
        if (active) setPeople(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, query, status, tag, peopleOffset]);
  function begin(action, payload) {
    operation.current = null;
    setError('');
    setDraft({ action, payload });
  }
  function edit(payload) {
    operation.current = null;
    setDraft({ ...draft, payload });
  }
  async function save(e) {
    e.preventDefault();
    const generation = epoch.current;
    operation.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const payload =
        draft.action === 'queue'
          ? {
              template,
              context: { ...(demand ? { demand } : {}), ...(interview ? { interview } : {}) },
              availableAt: schedule ? new Date(schedule).toISOString() : new Date().toISOString(),
            }
          : draft.payload;
      // Freeze the exact request once issued so a lost acknowledgement cannot change its schedule.
      operation.current =
        typeof operation.current === 'string'
          ? {
              id: operation.current,
              payload,
              head: draft.action === 'policy' ? page.policyHead : preview?.head,
            }
          : operation.current;
      await rpc('api_test_communications', {
        p_action: draft.action,
        p_candidate: ['policy', 'template'].includes(draft.action) ? null : candidate,
        p_operation: operation.current.id,
        p_head: operation.current.head || null,
        p_payload: operation.current.payload,
      });
      if (generation === epoch.current) {
        operation.current = null;
        setDraft(null);
        setPreview(null);
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function review() {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const v = await rpc('api_test_communications', {
        p_action: 'preview',
        p_candidate: candidate,
        p_payload: {
          template,
          context: { ...(demand ? { demand } : {}), ...(interview ? { interview } : {}) },
        },
      });
      if (!/^[a-f0-9]{32}$/.test(v?.head || '') || typeof v.eligible !== 'boolean' || !v.preview)
        throw new Error('Invalid test preview.');
      if (generation === epoch.current) setPreview(v);
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  const invalidate = () => {
    operation.current = null;
    setPreview(null);
    setDraft(null);
  };
  return (
    <section className="panel">
      <div className="settings-body">
        <h2>Communication test workspace</h2>
        <p>
          No live email is sent. Queuing records an explicit test intent; only the scheduled worker
          can record a simulated receipt. Consent, contact confirmation, preferences and holds are
          checked again at execution.
        </p>
        {error && <p role="alert">{error}</p>}
        {!page && !error && <p role="status">Loading communication history…</p>}
        {!candidateId && (
          <>
            <h3>Recipient segment</h3>
            {[
              ['Name or Anthro-ID', query, setQuery],
              ['Candidate status', status, setStatus],
              ['Candidate tag', tag, setTag],
            ].map(([label, value, set]) => (
              <Field key={label} label={label}>
                <input
                  maxLength="200"
                  value={value}
                  disabled={busy || !!draft}
                  onChange={(e) => {
                    set(e.target.value);
                    setPeopleOffset(0);
                  }}
                />
              </Field>
            ))}
            <p>
              25 recipients per page. Each recipient requires a separate reviewed preview and
              explicit test intent.
            </p>
            {people?.rows.map((p) => (
              <Button
                type="button"
                key={p.id}
                disabled={busy || !!draft}
                onClick={() => setCandidate(p.id)}
              >
                {p.name} · {p.anthroId}
              </Button>
            ))}
            <Button
              type="button"
              disabled={!peopleOffset || busy || !!draft}
              onClick={() => setPeopleOffset((n) => Math.max(0, n - 25))}
            >
              Previous recipients
            </Button>
            <Button
              type="button"
              disabled={!people?.more || busy || !!draft}
              onClick={() => setPeopleOffset((n) => n + 25)}
            >
              Next recipients
            </Button>
            {candidate && (
              <Button type="button" disabled={busy} onClick={() => setCandidate(null)}>
                Back to workspace outbox
              </Button>
            )}
          </>
        )}
        {page && (
          <>
            <p>
              Test transport: {page.policy.enabled ? 'enabled' : 'paused'} · daily candidate test
              limit {page.policy.daily_limit}. Last worker run:{' '}
              {page.lastWorkerRun || 'Not recorded'}.
            </p>
            {admin && !draft && (
              <>
                <Button
                  type="button"
                  onClick={() =>
                    begin('policy', {
                      enabled: page.policy.enabled,
                      outcome: page.policy.outcome,
                      dailyLimit: page.policy.daily_limit,
                    })
                  }
                >
                  Configure test transport
                </Button>
                <Button type="button" onClick={() => begin('template', { ...blankTemplate })}>
                  Create test template
                </Button>
              </>
            )}
            <h3>Versioned templates</h3>
            {page.templates.map((t) => (
              <article key={t.id}>
                <p>
                  {t.key} · v{t.version} · {t.body.kind} · {t.body.purpose} ·{' '}
                  {t.body.enabled ? 'enabled' : 'disabled'}
                </p>
                {admin && !draft && (
                  <Button
                    type="button"
                    onClick={() => begin('template', { key: t.key, version: t.version, ...t.body })}
                  >
                    Revise {t.key}
                  </Button>
                )}
              </article>
            ))}
            {candidate && editor && !draft && (
              <>
                <h3>Prepare a candidate test intent</h3>
                <Field label="Message template">
                  <select
                    value={template}
                    disabled={busy}
                    onChange={(e) => {
                      setTemplate(e.target.value);
                      invalidate();
                    }}
                  >
                    <option value="">Choose a template</option>
                    {page.templates
                      .filter((t) => t.body.enabled)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.key} · v{t.version}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Search message context by demand title">
                  <input
                    maxLength="200"
                    disabled={busy}
                    value={contextSearch}
                    onChange={(e) => setContextSearch(e.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setContextQuery(contextSearch);
                    setDemand('');
                    setInterview('');
                    invalidate();
                  }}
                >
                  Search demand contexts
                </Button>
                <p>
                  Context choices show up to 100 demands and 100 recent candidate interviews per
                  title search. Narrow the title search to find another context.
                </p>
                <Field label="Message demand context">
                  <select
                    value={demand}
                    disabled={busy}
                    onChange={(e) => {
                      setDemand(e.target.value);
                      setInterview('');
                      invalidate();
                    }}
                  >
                    <option value="">No demand context</option>
                    {page.demands?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Message interview context">
                  <select
                    value={interview}
                    disabled={busy}
                    onChange={(e) => {
                      setInterview(e.target.value);
                      invalidate();
                    }}
                  >
                    <option value="">No interview context</option>
                    {page.interviews
                      ?.filter((i) => (i.demandId || '') === demand)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.scheduledAt} · {i.status}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button type="button" disabled={!template || busy} onClick={review}>
                  Review test preview
                </Button>
                {preview && (
                  <>
                    <p>
                      {preview.eligible
                        ? 'Eligible for a reviewed test intent'
                        : `Suppressed: ${preview.reason}`}
                    </p>
                    <p>Confirmed recipient: {preview.preview.recipient || 'None'}</p>
                    <h4>{preview.preview.subject}</h4>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.preview.text}</pre>
                    <Field label="Schedule test (local time; empty means now)">
                      <input
                        type="datetime-local"
                        value={schedule}
                        onChange={(e) => {
                          setSchedule(e.target.value);
                          operation.current = null;
                        }}
                      />
                    </Field>
                    <Button
                      type="button"
                      disabled={!preview.eligible || !page.policy.enabled || busy}
                      onClick={() => begin('queue', {})}
                    >
                      Confirm reviewed test intent
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    begin('preference', {
                      purpose: 'recruiting-contact',
                      optOut: true,
                      startHour: 0,
                      endHour: 24,
                      source: '',
                    })
                  }
                >
                  Record candidate email preference
                </Button>
              </>
            )}
            {candidate && (
              <>
                <h3>Recorded preferences</h3>
                {page.preferences?.map((p) => (
                  <p key={p.id}>
                    {p.purpose}: {p.body.optOut ? 'opted out' : 'not opted out'} · UTC window{' '}
                    {p.body.startHour}–{p.body.endHour} · {p.body.source}
                  </p>
                ))}
              </>
            )}
            <h3>Test outbox and receipts</h3>
            {!page.rows.length && <p>No recorded test intents on this page.</p>}
            {page.rows.map((i) => (
              <article key={i.id}>
                <p>
                  {i.preview?.anthroId || i.candidate_id} ·{' '}
                  {i.templateKey || i.preview?.templateKey} · {i.status} · {i.attempts} attempts
                </p>
                <p>
                  {i.reason} · scheduled {i.available_at} · expires {i.expires_at}
                </p>
                {i.preview && (
                  <details>
                    <summary>Reviewed message and simulated receipts</summary>
                    <p>
                      {i.preview.recipient} · {i.preview.subject}
                    </p>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{i.preview.text}</pre>
                    {i.receipts?.map((r) => (
                      <p key={r.id}>
                        Attempt {r.attempt}: {r.outcome} · {r.at} · snapshot SHA-256 {r.checksum}
                      </p>
                    ))}
                  </details>
                )}
                {!candidateId && !candidate && (
                  <Button
                    type="button"
                    disabled={busy || !!draft}
                    onClick={() => setCandidate(i.candidate_id)}
                  >
                    Review candidate intent
                  </Button>
                )}
                {candidate &&
                  i.candidate_id === candidate &&
                  editor &&
                  !draft &&
                  ['Queued', 'Retrying', 'Failed'].includes(i.status) && (
                    <Button
                      type="button"
                      onClick={() => begin('cancel', { intent: i.id, reason: '' })}
                    >
                      Cancel test intent
                    </Button>
                  )}
                {candidate &&
                  i.candidate_id === candidate &&
                  admin &&
                  !draft &&
                  i.status === 'Failed' && (
                    <Button
                      type="button"
                      onClick={() => begin('retry', { intent: i.id, reason: '' })}
                    >
                      Review failed test retry
                    </Button>
                  )}
              </article>
            ))}
            <Button
              type="button"
              disabled={!offset || busy || !!draft}
              onClick={() => setOffset((n) => Math.max(0, n - 25))}
            >
              Previous test intents
            </Button>
            <Button
              type="button"
              disabled={!page.more || busy || !!draft}
              onClick={() => setOffset((n) => n + 25)}
            >
              Next test intents
            </Button>
          </>
        )}
        {draft && (
          <form aria-label={`Communication ${draft.action}`} onSubmit={save}>
            <h3>Review {draft.action}</h3>
            {draft.action === 'queue' ? (
              <p>
                Record this exact reviewed preview using the test-only transport. This confirmation
                does not send an email.
              </p>
            ) : (
              Object.entries(draft.payload)
                .filter(([k]) => !['version', 'intent'].includes(k))
                .map(([k, v]) => (
                  <Field key={k} label={`Communication ${k}`}>
                    {typeof v === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={v}
                        disabled={busy}
                        onChange={(e) => edit({ ...draft.payload, [k]: e.target.checked })}
                      />
                    ) : ['purpose', 'kind', 'outcome'].includes(k) ? (
                      <select
                        value={v}
                        disabled={busy}
                        onChange={(e) => edit({ ...draft.payload, [k]: e.target.value })}
                      >
                        {(k === 'purpose'
                          ? ['recruiting-contact', 'marketing']
                          : k === 'kind'
                            ? [
                                'custom',
                                'application-acknowledgement',
                                'interview-invite',
                                'interview-reminder',
                                'freshness-check',
                                'redeployment',
                              ]
                            : ['success', 'transient', 'permanent']
                        ).map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        required
                        value={v}
                        disabled={busy}
                        maxLength={k === 'text' ? 8000 : 1000}
                        onChange={(e) =>
                          edit({
                            ...draft.payload,
                            [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                ))
            )}
            {draft.action === 'template' && (
              <p>
                Plain text only. Supported placeholders:{' '}
                {'{{candidateName}}, {{anthroId}}, {{demandTitle}}, {{scheduledAt}}'}. Revising
                creates a new version and invalidates queued older previews.
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Save reviewed communication {draft.action}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                operation.current = null;
              }}
            >
              Discard communication draft
            </Button>
            {error && (
              <p>
                Keep this draft to retry the same operation. If the source or template changed,
                discard it, refresh, and review the current version.
              </p>
            )}
          </form>
        )}
        <Button
          type="button"
          disabled={busy || !!draft}
          onClick={() => {
            setPreview(null);
            setRevision((n) => n + 1);
          }}
        >
          Refresh communication workspace
        </Button>
      </div>
    </section>
  );
}
