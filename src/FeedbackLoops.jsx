import React, { useEffect, useRef, useState } from 'react';
import { repositoryRead } from './pagedRepository.js';
import { getRole } from './repository.js';

const labels = {
  name: 'Name',
  title: 'Job title',
  company: 'Company',
  location: 'Location',
  summary: 'Summary',
  experience: 'Total experience',
  relevantExperience: 'Relevant experience',
  notice: 'Notice days',
  earliestStart: 'Earliest start',
  activeStatus: 'Availability status',
  mode: 'Work mode',
  engagement: 'Engagement',
  preferredLocations: 'Preferred locations',
  contactEmail: 'New alternate email (requires verification)',
  contactPhone: 'New alternate phone (requires verification)',
};
const numeric = ['experience', 'relevantExperience', 'notice'];
function checked(v) {
  if (
    !v ||
    !Array.isArray(v.prompts) ||
    v.prompts.length > 25 ||
    !Array.isArray(v.proposals) ||
    v.proposals.length > 25 ||
    typeof v.more !== 'boolean'
  )
    throw new Error('Feedback returned an invalid page.');
  return v;
}
// A failed acknowledgement freezes the exact request. Only retry or explicit discard may follow.
function useJournal(rpc, api, scope, request = null) {
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [query, setQuery] = useState(''),
    [message, setMessage] = useState(''),
    [record, setRecord] = useState(null);
  const epoch = useRef(0),
    operation = useRef(null);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    const generation = ++epoch.current;
    setPage(null);
    setError('');
    rpc(api, {
      ...JSON.parse(scopeKey),
      p_action: 'context',
      p_offset: offset,
      p_payload: { query, ...(request ? { request } : {}) },
    })
      .then((v) => {
        if (generation === epoch.current) setPage(checked(v));
      })
      .catch((e) => {
        if (generation === epoch.current) setError(e.message);
      });
    return () => {
      if (epoch.current === generation) epoch.current = generation + 1;
    };
  }, [rpc, api, scopeKey, offset, query, revision, request]);
  async function execute(args = null) {
    if (busy) return;
    if (args && operation.current) return;
    const generation = epoch.current;
    if (args)
      operation.current = structuredClone({ ...scope, ...args, p_operation: crypto.randomUUID() });
    const frozen = operation.current;
    if (!frozen) return;
    setPending(frozen);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const v = await rpc(api, frozen);
      if (generation !== epoch.current) return;
      operation.current = null;
      setPending(null);
      setMessage(
        v.path
          ? `Recorded. Share this authenticated link manually: ${v.path}`
          : `Recorded: ${v.status || 'Saved'}.`,
      );
      setRecord({ operation: frozen.p_operation, action: frozen.p_action, status: v.status });
      setRevision((n) => n + 1);
      return v;
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
      return null;
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  function discard() {
    operation.current = null;
    setPending(null);
    setError('');
    setMessage(
      'Discarded the local retry draft. A server write may already exist; refresh and review history before creating another request.',
    );
    setRevision((n) => n + 1);
  }
  return {
    page,
    record,
    error,
    busy,
    pending,
    message,
    execute,
    offset,
    setOffset,
    setQuery,
    refresh: () => setRevision((n) => n + 1),
    discard,
  };
}
function State({ journal: j }) {
  return (
    <>
      {j.error && <p role="alert">{j.error}</p>}
      {j.message && <p role="status">{j.message}</p>}
      {j.pending && (
        <div>
          <p>The exact request is retained for safe retry.</p>
          <button type="button" disabled={j.busy} onClick={() => j.execute()}>
            Retry pending request
          </button>
          <button type="button" disabled={j.busy} onClick={j.discard}>
            Discard retry draft and refresh
          </button>
        </div>
      )}
      {!j.page && !j.error && <p role="status">Loading feedback…</p>}
      <button type="button" disabled={j.busy || !!j.pending} onClick={j.refresh}>
        Refresh feedback
      </button>
    </>
  );
}
function Paging({ journal: j }) {
  return (
    <div>
      <button
        type="button"
        disabled={!j.offset || j.busy || !!j.pending}
        onClick={() => j.setOffset(j.offset - 25)}
      >
        Previous feedback
      </button>
      <button
        type="button"
        disabled={!j.page?.more || j.busy || !!j.pending}
        onClick={() => j.setOffset(j.offset + 25)}
      >
        Next feedback
      </button>
    </div>
  );
}
function Changes({ proposal: p }) {
  return (
    <table>
      <caption>Proposed profile changes</caption>
      <thead>
        <tr>
          <th>Field</th>
          <th>Recorded</th>
          <th>Proposed</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(p.fields).map(([k, v]) => (
          <tr key={k}>
            <th>{labels[k] || k}</th>
            <td>{String(p.base?.[k] ?? 'Unknown')}</td>
            <td>{String(v ?? 'Unknown')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FeedbackReview({
  onUpdated,
  candidateId = null,
  clientId = null,
  rpc = repositoryRead,
  role = getRole(),
}) {
  return (
    <Reviewer
      key={`${candidateId}-${clientId}`}
      candidateId={candidateId}
      clientId={clientId}
      rpc={rpc}
      role={role}
      onUpdated={onUpdated}
    />
  );
}
function Reviewer({ candidateId, clientId, rpc, role, onUpdated }) {
  const j = useJournal(rpc, 'api_feedback_staff', { p_candidate: candidateId, p_client: clientId });
  const notified = useRef(null);
  const [refreshError, setRefreshError] = useState('');
  useEffect(() => {
    if (
      !onUpdated ||
      j.record?.action !== 'review' ||
      j.record.status !== 'Accepted' ||
      notified.current === j.record.operation
    )
      return;
    notified.current = j.record.operation;
    let active = true;
    Promise.resolve()
      .then(() => onUpdated())
      .catch(() => {
        if (active)
          setRefreshError(
            'Proposal accepted. Close and reopen the profile to refresh its current fields.',
          );
      });
    return () => {
      active = false;
    };
  }, [j.record, onUpdated]);
  const [reason, setReason] = useState(''),
    [user, setUser] = useState(''),
    [grantDays, setGrantDays] = useState('30'),
    [recipient, setRecipient] = useState(''),
    [kind, setKind] = useState(clientId ? 'survey' : 'freshness'),
    [question, setQuestion] = useState('Please share your current preferences and experience.'),
    [demand, setDemand] = useState(''),
    [days, setDays] = useState('7'),
    [preview, setPreview] = useState(null),
    [previewError, setPreviewError] = useState(''),
    [previewBusy, setPreviewBusy] = useState(false),
    [query, setQuery] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const edit = ['admin', 'recruiter'].includes(role),
    locked = j.busy || !!j.pending || previewBusy;
  const reasonOK = reason.trim().length >= 10 && reason.trim().length <= 1000;
  function act(action, id, head = null, payload = {}) {
    return j.execute({
      p_action: action,
      p_id: id,
      p_head: head,
      p_payload: { ...payload, reason },
    });
  }
  async function reviewPrompt(e) {
    e.preventDefault();
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const payload = {
        recipient,
        kind,
        question,
        demand: demand || null,
        expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString(),
        reason,
      };
      const v = await rpc('api_feedback_staff', {
        p_action: 'preview',
        p_candidate: candidateId,
        p_client: clientId,
        p_payload: payload,
      });
      if (!v.preview || !v.head) throw new Error('Invalid invitation preview.');
      if (alive.current) setPreview({ ...v, payload });
    } catch (e) {
      if (alive.current) setPreviewError(e.message);
    } finally {
      if (alive.current) setPreviewBusy(false);
    }
  }
  return (
    <section className="panel intelligence-panel">
      <h2>{candidateId ? 'Candidate feedback review' : 'Account feedback review'}</h2>
      <p>
        Links require the recipient’s existing authenticated account. Share them manually. Responses
        and profile assertions require review; they do not certify readiness.
      </p>
      <State journal={j} />
      {refreshError && <p role="alert">{refreshError}</p>}
      {edit && (
        <label>
          Review reason
          <textarea
            minLength={10}
            maxLength={1000}
            disabled={locked || !!preview}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {j.page && (
        <>
          {edit && <p>Proposal decision reasons are visible to the candidate.</p>}
          {candidateId && (
            <>
              <h3>Candidate account access</h3>
              {role === 'admin' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act('grant', null, null, {
                      user,
                      expiresAt: new Date(Date.now() + Number(grantDays) * 86400000).toISOString(),
                    });
                  }}
                >
                  <fieldset disabled={locked || !reasonOK}>
                    <legend>Grant a verified registered account</legend>
                    <label>
                      Candidate Auth user UUID
                      <input required value={user} onChange={(e) => setUser(e.target.value)} />
                    </label>
                    <label>
                      Grant days
                      <input
                        type="number"
                        min="1"
                        max="30"
                        required
                        value={grantDays}
                        onChange={(e) => setGrantDays(e.target.value)}
                      />
                    </label>
                    <button>Grant portal access</button>
                  </fieldset>
                </form>
              )}
              {j.page.grants?.map((g) => (
                <article key={g.id}>
                  <p>
                    {g.user_id} · Until {g.expires_at} · {g.revoked_at ? 'Revoked' : 'Granted'}
                  </p>
                  {role === 'admin' && !g.revoked_at && (
                    <button
                      type="button"
                      disabled={locked || !reasonOK}
                      onClick={() => act('revoke', g.id)}
                    >
                      Revoke candidate access
                    </button>
                  )}
                </article>
              ))}
            </>
          )}
          {edit && (
            <>
              <h3>Scoped invitation</h3>
              {previewError && <p role="alert">{previewError}</p>}
              {!preview ? (
                <form onSubmit={reviewPrompt}>
                  <fieldset disabled={locked}>
                    <legend>Prepare invitation</legend>
                    <label>
                      Invitation recipient
                      <select
                        required
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                      >
                        <option value="">Choose an account</option>
                        {(candidateId
                          ? (j.page.grants || [])
                              .filter((g) => !g.revoked_at && Date.parse(g.expires_at) > Date.now())
                              .map((g) => ({ user_id: g.user_id, demand_id: null }))
                          : j.page.recipients || []
                        ).map((r, i) => (
                          <option key={`${r.user_id}-${i}`} value={r.user_id}>
                            {r.user_id}
                            {r.demand_id ? ` · Demand ${r.demand_id}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Invitation kind
                      <select value={kind} onChange={(e) => setKind(e.target.value)}>
                        {(candidateId ? ['freshness', 'redeployment', 'survey'] : ['survey']).map(
                          (k) => (
                            <option key={k}>{k}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Demand context search
                      <input
                        maxLength={200}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        j.setOffset(0);
                        j.setQuery(query);
                      }}
                    >
                      Search feedback demand contexts
                    </button>
                    <label>
                      Invitation demand
                      <select
                        required={kind === 'redeployment'}
                        value={demand}
                        onChange={(e) => setDemand(e.target.value)}
                      >
                        <option value="">General feedback</option>
                        {j.page.demands?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Invitation question
                      <textarea
                        required
                        minLength={10}
                        maxLength={500}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                      />
                    </label>
                    <label>
                      Invitation days
                      <input
                        required
                        type="number"
                        min="1"
                        max="30"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                      />
                    </label>
                    <button disabled={!reasonOK}>Review invitation</button>
                  </fieldset>
                </form>
              ) : (
                <div>
                  <h4>Reviewed invitation</h4>
                  <p>{preview.preview.question}</p>
                  <p>
                    Recipient: {preview.preview.recipient} · {preview.preview.kind} · Expires{' '}
                    {preview.preview.expiresAt}
                  </p>
                  <p>{preview.preview.demand?.title}</p>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      j
                        .execute({
                          p_action: 'invite',
                          p_head: preview.head,
                          p_payload: preview.payload,
                        })
                        .then(() => {
                          if (alive.current) setPreview(null);
                        })
                    }
                  >
                    Confirm reviewed invitation
                  </button>
                  <button type="button" disabled={locked} onClick={() => setPreview(null)}>
                    Discard invitation preview
                  </button>
                </div>
              )}
            </>
          )}
          <h3>Profile proposals</h3>
          {!j.page.proposals.length && <p>No profile proposals on this page.</p>}
          {j.page.proposals.map((p) => (
            <article className="panel" key={p.id}>
              <Changes proposal={p} />
              <p>
                {p.status} · Submitted {p.at}
              </p>
              <p>{p.reason}</p>
              {p.review_reason && <p>Review: {p.review_reason}</p>}
              {edit && p.status === 'Pending' && (
                <>
                  <button
                    type="button"
                    disabled={locked || !reasonOK}
                    onClick={() => act('review', p.id, p.reviewHead, { decision: 'Accepted' })}
                  >
                    Accept proposed fields
                  </button>
                  <button
                    type="button"
                    disabled={locked || !reasonOK}
                    onClick={() => act('review', p.id, p.reviewHead, { decision: 'Rejected' })}
                  >
                    Reject proposal
                  </button>
                </>
              )}
            </article>
          ))}
          <h3>Invitation history</h3>
          {j.page.prompts.map((p) => (
            <article key={p.id}>
              <p>
                {p.kind} · {p.state} · {p.question} · Until {p.expires_at}
              </p>
              <a href={`${candidateId ? '/portal.html' : '/client.html'}#request=${p.id}`}>
                Authenticated invitation link
              </a>
              {edit && p.status === 'Open' && (
                <button
                  type="button"
                  disabled={locked || !reasonOK}
                  onClick={() => act('cancel', p.id)}
                >
                  Cancel invitation
                </button>
              )}
            </article>
          ))}
          <h3>Response review</h3>
          {j.page.surveySummary && (
            <p>
              Survey responses: {j.page.surveySummary.responses} · Average rating:{' '}
              {j.page.surveySummary.averageRating ?? 'No ratings'} · Pending review:{' '}
              {j.page.surveySummary.pendingReview}
            </p>
          )}
          {!j.page.responses?.length && <p>No responses on this page.</p>}
          {j.page.responses?.map((r) => (
            <article className="panel" key={r.id}>
              <p>
                {r.body.answer || `Rating ${r.body.rating}/5`} · {r.disposition}
              </p>
              <p>{r.body.comment}</p>
              {r.review_reason && <p>Review: {r.review_reason}</p>}
              {edit && r.disposition === 'Pending' && (
                <>
                  <button
                    type="button"
                    disabled={locked || !reasonOK}
                    onClick={() => act('triage', r.id, r.reviewHead, { decision: 'Actioned' })}
                  >
                    Mark response actioned
                  </button>
                  <button
                    type="button"
                    disabled={locked || !reasonOK}
                    onClick={() => act('triage', r.id, r.reviewHead, { decision: 'Dismissed' })}
                  >
                    Dismiss response
                  </button>
                </>
              )}
            </article>
          ))}
          <Paging journal={j} />
        </>
      )}
    </section>
  );
}

export function FeedbackPortal({ candidateId = null, clientId = null, rpc = repositoryRead }) {
  const request = useRequestedInvitation();
  const [accounts, setAccounts] = useState(null),
    [selected, setSelected] = useState(candidateId || ''),
    [error, setError] = useState('');
  useEffect(() => {
    if (candidateId || clientId) return;
    let alive = true;
    setError('');
    if (request) setSelected('');
    rpc('api_feedback_portal', { p_action: 'accounts' })
      .then(async (v) => {
        if (!Array.isArray(v.candidates) || v.candidates.length > 100)
          throw new Error('Invalid account list.');
        if (alive) {
          setAccounts(v.candidates);
          if (!request && v.candidates.length === 1) setSelected(v.candidates[0].id);
        }
        if (request) {
          const link = await rpc('api_feedback_portal', { p_action: 'open', p_id: request });
          if (alive && v.candidates.some((a) => a.id === link.candidateId))
            setSelected(link.candidateId);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, candidateId, clientId, request]);
  return (
    <section className="panel portal-card">
      <h2>{clientId ? 'Account surveys' : 'Your profile and feedback'}</h2>
      {error && <p role="alert">{error}</p>}
      {request && (
        <button
          type="button"
          onClick={() => {
            window.location.hash = '';
          }}
        >
          Show all invitations
        </button>
      )}
      {!candidateId && !clientId && (
        <>
          <label>
            Linked candidate account
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a candidate account</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.anthroId}
                </option>
              ))}
            </select>
          </label>
          {accounts?.length === 0 && (
            <p>
              Ask your recruiter to grant your registered Auth account access. A matching email
              alone does not link your profile.
            </p>
          )}
        </>
      )}
      {(candidateId || selected || clientId) && (
        <SelfService
          key={`${candidateId || selected}-${clientId}-${request}`}
          candidateId={candidateId || selected || null}
          clientId={clientId}
          rpc={rpc}
          request={request}
        />
      )}
    </section>
  );
}
function SelfService({ candidateId, clientId, rpc, request }) {
  const j = useJournal(
    rpc,
    'api_feedback_portal',
    {
      p_candidate: candidateId,
      p_client: clientId,
    },
    request,
  );
  const [draft, setDraft] = useState(null),
    [reason, setReason] = useState(''),
    [purpose, setPurpose] = useState('recruiting-contact'),
    [optOut, setOptOut] = useState(true),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState('24');
  const locked = j.busy || !!j.pending;
  return (
    <div>
      <p>
        Profile changes become proposals for recruiter review. Communication preferences take effect
        immediately and do not grant consent.
      </p>
      <State journal={j} />
      {j.page && (
        <>
          {candidateId && (
            <>
              {j.page.held && (
                <p>
                  Recruiting profile changes are paused under a processing hold. You can still
                  update communication preferences.
                </p>
              )}
              {!draft ? (
                <button
                  type="button"
                  disabled={locked || j.page.held}
                  onClick={() =>
                    setDraft({
                      fields: structuredClone(j.page.fields),
                      base: structuredClone(j.page.fields),
                      head: j.page.head,
                    })
                  }
                >
                  Propose profile changes
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fields = Object.fromEntries(
                      Object.entries(draft.fields)
                        .filter(
                          ([k, v]) => !['contactEmail', 'contactPhone'].includes(k) || v.trim(),
                        )
                        .map(([k, v]) => [
                          k,
                          numeric.includes(k)
                            ? v === '' || v == null
                              ? null
                              : Number(v)
                            : k === 'earliestStart' && !v
                              ? null
                              : v,
                        ])
                        .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(draft.base[k])),
                    );
                    j.execute({
                      p_action: 'propose',
                      p_head: draft.head,
                      p_payload: { fields, reason },
                    }).then((saved) => {
                      if (saved) setDraft(null);
                    });
                  }}
                >
                  <fieldset disabled={locked}>
                    <legend>Your proposed profile</legend>
                    {Object.keys(labels).map((k) => (
                      <label key={k}>
                        {labels[k]}
                        {['mode', 'activeStatus'].includes(k) ? (
                          <select
                            value={draft.fields[k] ?? ''}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fields: { ...draft.fields, [k]: e.target.value },
                              })
                            }
                          >
                            {(k === 'mode'
                              ? ['Flexible', 'Remote', 'Hybrid', 'Onsite']
                              : ['Active', 'Passive']
                            ).map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        ) : k === 'summary' ? (
                          <textarea
                            maxLength={10000}
                            value={draft.fields[k] ?? ''}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fields: { ...draft.fields, [k]: e.target.value },
                              })
                            }
                          />
                        ) : (
                          <input
                            required={k === 'name'}
                            type={
                              numeric.includes(k)
                                ? 'number'
                                : k === 'earliestStart'
                                  ? 'date'
                                  : 'text'
                            }
                            min={numeric.includes(k) ? 0 : undefined}
                            max={k === 'notice' ? 365 : numeric.includes(k) ? 100 : undefined}
                            step={k === 'notice' ? 1 : numeric.includes(k) ? 'any' : undefined}
                            maxLength={300}
                            value={draft.fields[k] ?? ''}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fields: { ...draft.fields, [k]: e.target.value },
                              })
                            }
                          />
                        )}
                      </label>
                    ))}
                    <label>
                      Update explanation
                      <textarea
                        required
                        minLength={10}
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button>Submit profile proposal</button>
                    <button type="button" onClick={() => setDraft(null)}>
                      Discard profile draft
                    </button>
                  </fieldset>
                </form>
              )}
              <h3>Communication preferences</h3>
              <p>
                Quiet windows use UTC. Turning off an opt-out leaves the existing consent state
                unchanged.
              </p>
              {j.page.preferences.map((p) => (
                <p key={p.purpose}>
                  {p.purpose}: {p.body.optOut ? 'Opted out' : 'No preference opt-out'} · UTC{' '}
                  {p.body.windowStart}–{p.body.windowEnd}
                </p>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  j.execute({
                    p_action: 'preference',
                    p_payload: {
                      purpose,
                      optOut,
                      windowStart: Number(start),
                      windowEnd: Number(end),
                    },
                  });
                }}
              >
                <fieldset disabled={locked}>
                  <legend>Set purpose preferences</legend>
                  <label>
                    Communication purpose
                    <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                      <option>recruiting-contact</option>
                      <option>marketing</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={optOut}
                      onChange={(e) => setOptOut(e.target.checked)}
                    />
                    Opt out of purpose communications
                  </label>
                  <label>
                    UTC window start
                    <input
                      required
                      type="number"
                      min="0"
                      max="23"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    UTC window end
                    <input
                      required
                      type="number"
                      min="1"
                      max="24"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                  <button>Save communication preferences</button>
                </fieldset>
              </form>
              <h3>Your proposals</h3>
              {j.page.proposals.map((p) => (
                <article className="panel" key={p.id}>
                  <Changes proposal={p} />
                  <p>
                    {p.status} · {p.reason}
                  </p>
                  {p.review_reason && <p>Review: {p.review_reason}</p>}
                  {p.status === 'Pending' && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => j.execute({ p_action: 'withdraw', p_id: p.id })}
                    >
                      Withdraw proposal
                    </button>
                  )}
                </article>
              ))}
            </>
          )}
          <h3>Your invitations</h3>
          {!j.page.prompts.length && <p>No invitations on this page.</p>}
          {j.page.prompts.map((p) => (
            <Invitation
              key={p.id}
              prompt={p}
              locked={locked}
              respond={(payload) =>
                j.execute({ p_action: 'respond', p_id: p.id, p_head: p.head, p_payload: payload })
              }
            />
          ))}
          <Paging journal={j} />
        </>
      )}
    </div>
  );
}

export function useRequestedInvitation() {
  const read = () =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.hash.slice(1)).get('request');
  const [request, setRequest] = useState(read);
  useEffect(() => {
    const update = () => setRequest(read());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return request;
}
function Invitation({ prompt: p, locked, respond }) {
  const [answer, setAnswer] = useState('Interested'),
    [rating, setRating] = useState('3'),
    [comment, setComment] = useState('');
  const request =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.hash.slice(1)).get('request')
      : null;
  return (
    <article id={`feedback-${p.id}`} className="panel">
      <h4>
        {p.kind}
        {request === p.id ? ' · Requested invitation' : ''}
      </h4>
      <p>{p.question}</p>
      <p>
        {p.demandTitle} · {p.state} · Until {p.expires_at}
      </p>
      {p.response && (
        <>
          <p>
            {p.response.answer || `Rating ${p.response.rating}/5`} · {p.disposition}
          </p>
          <p>{p.response.comment}</p>
        </>
      )}
      {p.state === 'Open' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            respond(
              p.kind === 'survey' ? { rating: Number(rating), comment } : { answer, comment },
            );
          }}
        >
          <fieldset disabled={locked}>
            <legend>Respond to invitation</legend>
            {p.kind === 'survey' ? (
              <label>
                Survey rating
                <select value={rating} onChange={(e) => setRating(e.target.value)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Your response
                <select value={answer} onChange={(e) => setAnswer(e.target.value)}>
                  {['Interested', 'Not now', 'No change', 'Update proposed'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Feedback comment
              <textarea
                required
                minLength={1}
                maxLength={2000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <button>Record invitation response</button>
          </fieldset>
        </form>
      )}
    </article>
  );
}

export function FeedbackQueue({ rpc = repositoryRead, onOpen, onOpenClient }) {
  const [kind, setKind] = useState('proposals'),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setPage(null);
    setError('');
    rpc('api_feedback_queue', { p_kind: kind, p_offset: offset })
      .then((v) => {
        if (!Array.isArray(v.rows) || v.rows.length > 25 || typeof v.more !== 'boolean')
          throw new Error('Invalid feedback queue.');
        if (alive) setPage(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, kind, offset, revision]);
  return (
    <section className="panel">
      <h2>Feedback work queue</h2>
      <label>
        Feedback queue
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        >
          <option value="proposals">Pending profile proposals</option>
          <option value="responses">Pending responses</option>
          <option value="redeployment">Placement end review</option>
        </select>
      </label>
      <p>
        Placement end dates identify review opportunities. Consent, preferences, demand context and
        account access are checked when preparing an invitation.
      </p>
      <button type="button" onClick={() => setRevision((n) => n + 1)}>
        Refresh feedback queue
      </button>
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p role="status">Loading feedback queue…</p>}
      {page?.rows.map((r) => (
        <article key={r.id}>
          <p>
            {r.name} · {r.anthroId} · {r.label}
          </p>
          {r.candidateId && onOpen && (
            <button type="button" onClick={() => onOpen(r.candidateId)}>
              Open candidate feedback
            </button>
          )}
          {r.clientId &&
            (onOpenClient ? (
              <button type="button" onClick={() => onOpenClient(r.clientId)}>
                Open account feedback
              </button>
            ) : (
              <p>Open this client in the Clients workspace to review its response.</p>
            ))}
        </article>
      ))}
      {page && !page.rows.length && <p>No queued records on this page.</p>}
      <button type="button" disabled={!offset} onClick={() => setOffset(offset - 25)}>
        Previous queue page
      </button>
      <button type="button" disabled={!page?.more} onClick={() => setOffset(offset + 25)}>
        Next queue page
      </button>
    </section>
  );
}
