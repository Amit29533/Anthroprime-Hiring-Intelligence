import React, { useEffect, useRef, useState } from 'react';
import { intelligenceRpc } from './intelligence.js';
import { Snapshot } from './ClientCollaboration.jsx';

function Feedback({ pack, rpc }) {
  const [kind, setKind] = useState('comment'),
    [decision, setDecision] = useState('Shortlisted'),
    [rating, setRating] = useState(''),
    [comment, setComment] = useState(''),
    [proposed, setProposed] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const operation = useRef(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const args = {
        p_pack: pack.id,
        p_kind: kind,
        p_decision: kind === 'decision' ? decision : null,
        p_rating: rating ? Number(rating) : null,
        p_comment: comment,
        p_proposed: kind === 'interview' ? new Date(proposed).toISOString() : null,
      };
      const intent = JSON.stringify(args);
      if (operation.current?.intent !== intent)
        operation.current = { intent, id: crypto.randomUUID() };
      await rpc('api_client_respond', { ...args, p_operation: operation.current.id });
      operation.current = null;
      setComment('');
      setMessage(
        kind === 'interview'
          ? 'Interview request received. The recruiter will confirm scheduling.'
          : 'Feedback recorded.',
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        Feedback type
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="comment">Comment</option>
          <option value="decision">Decision</option>
          <option value="interview">Request interview</option>
        </select>
      </label>
      {kind === 'decision' && (
        <label>
          Decision
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            {['Shortlisted', 'Rejected', 'Hold'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Rating (optional)
        <select value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">Unrated</option>
          {[1, 2, 3, 4, 5].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {kind === 'interview' && (
        <label>
          Proposed interview time (your local time)
          <input
            type="datetime-local"
            required
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
          />
        </label>
      )}
      <label>
        Review notes
        <textarea
          required
          minLength={10}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <button disabled={busy || comment.trim().length < 10}>Send feedback</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function ClientPortalView({ rpc = intelligenceRpc }) {
  const [clients, setClients] = useState([]),
    [client, setClient] = useState(''),
    [view, setView] = useState(null),
    [offset, setOffset] = useState(0),
    [demandsOffset, setDemandsOffset] = useState(0),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    rpc('api_client_portal_clients')
      .then((rows) => {
        if (alive) {
          setClients(rows);
          setClient(rows[0]?.id || '');
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc]);
  useEffect(() => {
    setView(null);
    if (!client) return;
    let alive = true;
    setError('');
    rpc('api_client_portal', {
      p_client: client,
      p_offset: offset,
      p_demands_offset: demandsOffset,
    })
      .then((v) => {
        if (alive) setView(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, client, offset, demandsOffset, refresh]);
  return (
    <main className="careers-main">
      <h1>Client review portal</h1>
      <p>Review approved candidate versions and request the next step.</p>
      {error && <p role="alert">{error}</p>}
      <label>
        Client
        <select
          value={client}
          onChange={(e) => {
            setView(null);
            setClient(e.target.value);
            setOffset(0);
            setDemandsOffset(0);
          }}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          setView(null);
          setRefresh(refresh + 1);
        }}
      >
        Refresh access and versions
      </button>
      {!clients.length && !error && <p>No active client access is available.</p>}
      {view && (
        <div key={client}>
          <h2>Approved demand progress</h2>
          {view.demands.map((d) => (
            <p key={d.id}>
              {d.title} · {d.status} · {d.positions} positions · {d.activePlacements} active
              placements
              {d.target && ` · Target ${d.target}`}
            </p>
          ))}
          <button disabled={!demandsOffset} onClick={() => setDemandsOffset(demandsOffset - 20)}>
            Previous demands
          </button>
          <button disabled={!view.demandsMore} onClick={() => setDemandsOffset(demandsOffset + 20)}>
            Next demands
          </button>
          <h2>Approved shortlist</h2>
          {!view.packs.length && (
            <p>No current approved versions. Contact your recruiter for an updated shortlist.</p>
          )}
          {view.packs.map((p) => (
            <article className="panel" key={p.id}>
              <Snapshot pack={p} />
              {p.respond_by && (
                <p>Feedback requested by {new Date(p.respond_by).toLocaleDateString()}</p>
              )}
              <Feedback pack={p} rpc={rpc} />
            </article>
          ))}
          <button disabled={!offset} onClick={() => setOffset(offset - 20)}>
            Previous candidates
          </button>
          <button disabled={!view.more} onClick={() => setOffset(offset + 20)}>
            Next candidates
          </button>
        </div>
      )}
    </main>
  );
}
