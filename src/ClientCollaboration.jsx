import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, canWriteForRole } from './repository.js';
import { intelligenceRpc } from './intelligence.js';

export function Snapshot({ pack }) {
  const p = pack.content;
  return (
    <div>
      <strong>
        {p.name} · {p.anthroId}
      </strong>
      <p>{[p.title, p.location, p.demandMode].filter(Boolean).join(' · ')}</p>
      <p>
        {p.demandTitle} · version {pack.version}
      </p>
      <p>{p.skills?.join(', ')}</p>
      <small>
        Profile status: {p.profileStatus || 'Unrecorded'}. Profile verification date:{' '}
        {p.profileVerified || 'Unrecorded'}. These are recorded profile facts, not a hiring
        recommendation.
      </small>
    </div>
  );
}

export default function ClientCollaboration({
  clientId,
  rpc = intelligenceRpc,
  isCloud = cloud,
  role = getRole(),
}) {
  return <Review key={clientId} clientId={clientId} rpc={rpc} isCloud={isCloud} role={role} />;
}
function Review({ clientId, rpc, isCloud, role }) {
  const [view, setView] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [submission, setSubmission] = useState(''),
    [reason, setReason] = useState(''),
    [user, setUser] = useState(''),
    [demand, setDemand] = useState('');
  const operation = useRef(null);
  const read = () => rpc('api_client_review', { p_client: clientId, p_offset: offset });
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    setView(null);
    setError('');
    rpc('api_client_review', { p_client: clientId, p_offset: offset })
      .then((v) => {
        if (alive) setView(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, clientId, offset, isCloud]);
  async function act(action, id = null, details = {}) {
    const intent = JSON.stringify([action, id, details]);
    if (operation.current?.intent !== intent)
      operation.current = { intent, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await rpc('api_change_client_review', {
        p_client: clientId,
        p_operation: operation.current.id,
        p_action: action,
        p_id: id,
        p_details: details,
      });
      operation.current = null;
      setView(await read());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud)
    return (
      <section className="panel">
        <h2>Client collaboration</h2>
        <p>Client accounts and shared versions require the configured cloud workspace.</p>
      </section>
    );
  const edit = canWriteForRole(role),
    admin = role === 'admin';
  return (
    <section className="panel intelligence-panel">
      <h2>Client collaboration</h2>
      <p>
        Prepare a shortlist version, review its contents, then approve access. Candidate, consent,
        demand or offer changes require a fresh version.
      </p>
      <a href="/client.html" target="_blank" rel="noreferrer">
        Open client portal
      </a>
      {error && <p role="alert">{error}</p>}
      {!view && !error && <p>Loading client review…</p>}
      {edit && view && (
        <div className="form-grid">
          <label>
            Submission
            <select value={submission} onChange={(e) => setSubmission(e.target.value)}>
              <option value="">Choose a submission</option>
              {view.submissions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !submission} onClick={() => act('prepare', submission)}>
            Prepare review version
          </button>
        </div>
      )}
      {admin && (
        <label>
          Approval evidence
          <textarea
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record what you reviewed before approving this version"
          />
        </label>
      )}
      {view?.packs.map((pack) => (
        <article key={pack.id} className="panel">
          <Snapshot pack={pack} />
          <p>
            {pack.state}
            {pack.feedbackAgeDays != null &&
              ` · Awaiting feedback for ${pack.feedbackAgeDays} days`}
          </p>
          {pack.respond_by && (
            <small>Feedback requested by {new Date(pack.respond_by).toLocaleDateString()}</small>
          )}
          {admin && pack.state === 'Draft' && (
            <button
              disabled={busy || reason.trim().length < 10}
              onClick={() => act('approve', pack.id, { reason })}
            >
              Approve version {pack.version}
            </button>
          )}
          {edit && !pack.revoked && (
            <button disabled={busy} onClick={() => act('revoke', pack.id)}>
              Revoke share
            </button>
          )}
          {view.feedback
            .filter((f) => f.pack_id === pack.id)
            .map((f) => (
              <FeedbackEvidence key={f.id} f={f} />
            ))}
        </article>
      ))}
      {view && (
        <div>
          <button disabled={busy || offset === 0} onClick={() => setOffset(offset - 20)}>
            Previous versions
          </button>
          <button disabled={busy || !view.more} onClick={() => setOffset(offset + 20)}>
            Next versions
          </button>
        </div>
      )}
      {view?.feedback
        .filter((f) => !view.packs.some((p) => p.id === f.pack_id))
        .map((f) => (
          <article key={f.id}>
            <h3>
              Recent feedback: {f.candidateName || f.pack_id} · {f.demandTitle} · version{' '}
              {f.version}
            </h3>
            <FeedbackEvidence f={f} />
          </article>
        ))}
      {admin && view && (
        <div>
          <h3>Client access</h3>
          <p>
            Provision the account in existing Supabase Auth first, without workspace membership.
            Share the portal link manually. Grants expire after 30 days; grant again to renew.
          </p>
          <label>
            Client Auth user ID
            <input value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label>
            Demand ID (optional; empty grants this client’s demands)
            <input value={demand} onChange={(e) => setDemand(e.target.value)} />
          </label>
          <button
            disabled={busy || !user}
            onClick={() => act('grant', null, { userId: user, demandId: demand || null })}
          >
            Grant client access
          </button>
          {view.members.map((m) => (
            <p key={m.id}>
              {m.user_id} · {m.demand_id || 'All client demands'} ·{' '}
              {m.active
                ? Date.parse(m.expires_at) > Date.now()
                  ? 'Active'
                  : 'Expired'
                : 'Revoked'}{' '}
              {m.expires_at && ` · Expires ${new Date(m.expires_at).toLocaleDateString()} `}
              {m.active && (
                <button disabled={busy} onClick={() => act('remove', m.id)}>
                  Remove access
                </button>
              )}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function FeedbackEvidence({ f }) {
  return (
    <blockquote key={f.id}>
      <strong>
        {f.kind}
        {f.decision && ` · ${f.decision}`}
        {f.rating && ` · ${f.rating}/5`}
      </strong>
      <p>{f.comment}</p>
      {f.proposed_at && (
        <p>
          Requested interview: {new Date(f.proposed_at).toLocaleString()} — recruiter must confirm
          and schedule.
        </p>
      )}
      <small>{new Date(f.at).toLocaleString()}</small>
    </blockquote>
  );
}
