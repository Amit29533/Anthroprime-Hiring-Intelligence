// Public careers portal (blueprint D1 + D3): explicitly published roles and an application form
// whose consent checkboxes feed the §12 consent ledger when the application is accepted.
// Demo mode renders the seed workspace and stores applications in this browser; cloud mode uses
// a workspace-scoped, column-limited RPC and posts through the consent-validating apply RPC.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BriefcaseBusiness, MapPin, Clock, Send, CheckCircle2, ShieldCheck } from 'lucide-react';
import { cloud, getSupabase, loadData, saveRows } from './repository.js';
import { makeSeed } from './seed.js';
import { normalizeData } from './schema.js';
import './workspace.css';

const WS_KEY = 'ecod-careers-workspace';

function statusLabel(d) {
  return d.status === 'Open' && d.careersVisible === true;
}

function demoRoles() {
  return normalizeData(makeSeed()).demands.filter(statusLabel);
}
function useOpenRoles() {
  // The synchronous seed keeps the server-rendered page meaningful; the effect below replaces it
  // with the real workspace (cloud table, or the same browser store the recruiter's app writes).
  const [state, setState] = useState(() =>
    cloud
      ? { loading: true, roles: [], error: '' }
      : { loading: false, roles: demoRoles(), error: '' },
  );
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (cloud) {
          const queryWorkspace = new URLSearchParams(location.search).get('ws') || '';
          const ws = queryWorkspace || localStorage.getItem(WS_KEY) || '';
          if (!ws) {
            throw new Error(
              'This careers page is not configured for a workspace. Add ?ws=<workspace-id> to its URL.',
            );
          }
          localStorage.setItem(WS_KEY, ws);
          const supabase = await getSupabase();
          const { data, error } = await supabase.rpc('api_public_open_roles', {
            p_workspace: ws,
          });
          if (error) throw error;
          if (active) setState({ loading: false, roles: data || [], error: '' });
        } else {
          const workspace = await loadData();
          if (active)
            setState({ loading: false, roles: workspace.demands.filter(statusLabel), error: '' });
        }
      } catch (e) {
        if (active)
          setState({
            loading: false,
            roles: [],
            error: e.message || 'Could not load open roles. Please try again later.',
          });
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return state;
}

function ApplyForm({ role, onDone }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    message: '',
    consentContact: false,
    consentSharing: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [statusCode, setStatusCode] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return setError('Name and email are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return setError('Enter a valid email address.');
    if (!form.consentContact)
      return setError('We need your consent to contact you about this application.');
    setBusy(true);
    setError('');
    try {
      let applicationStatusCode = '';
      if (cloud) {
        const ws = localStorage.getItem(WS_KEY) || '';
        const supabase = await getSupabase();
        const { data: receipt, error: rpcError } = await supabase.rpc('api_public_apply', {
          ws: ws || null,
          payload: { ...form, demandId: role?.id || null },
        });
        if (rpcError) throw rpcError;
        applicationStatusCode = receipt?.statusToken || '';
      } else {
        // Land in the workspace's own application queue, exactly where the cloud RPC puts it,
        // so a recruiter sees it on Activities → Career applications.
        const workspace = await loadData();
        applicationStatusCode = crypto.randomUUID();
        const record = {
          id: crypto.randomUUID(),
          statusToken: applicationStatusCode,
          demandId: role?.id || null,
          demandTitle: role?.title || '',
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          linkedin: form.linkedin.trim(),
          message: form.message.trim(),
          status: 'pending',
          consentContact: form.consentContact,
          consentSharing: form.consentSharing,
          created: new Date().toISOString(),
        };
        await saveRows('publicApplications', [record], workspace);
      }
      setStatusCode(applicationStatusCode);
      setDone(true);
      onDone && onDone();
    } catch (err) {
      setError(err.message || 'Could not send the application. Please try again.');
    }
    setBusy(false);
  }
  if (done)
    return (
      <div className="apply-done">
        <CheckCircle2 size={22} />
        <div>
          <strong>Application received.</strong>
          <p>
            Thank you — our talent team will review your profile and reach out. Your consent choices
            were recorded and can be changed at any time.
          </p>
          {statusCode ? (
            <p className="application-status-code">
              Save this private status code with your application email. You will need both to check
              progress: <code>{statusCode}</code>
            </p>
          ) : (
            <p className="application-status-code">
              Keep your application details. If a status code is not shown, contact our talent team
              for an update.
            </p>
          )}
        </div>
      </div>
    );
  return (
    <form className="apply-form" onSubmit={submit}>
      <h3>Apply — {role.title}</h3>
      <div className="apply-grid">
        <label>
          Full name *
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email *
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+91…"
          />
        </label>
        <label>
          LinkedIn
          <input
            value={form.linkedin}
            onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
            placeholder="https://www.linkedin.com/in/…"
          />
        </label>
        <label className="wide">
          A few words about your fit
          <textarea
            rows={3}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
        </label>
      </div>
      <label className="consent-check">
        <input
          type="checkbox"
          checked={form.consentContact}
          onChange={(e) => setForm({ ...form, consentContact: e.target.checked })}
        />
        I consent to AnthroPrime contacting me about this application and future matching roles
        (recruiting contact).
      </label>
      <label className="consent-check">
        <input
          type="checkbox"
          checked={form.consentSharing}
          onChange={(e) => setForm({ ...form, consentSharing: e.target.checked })}
        />
        I consent to my profile being shared with the hiring client for this role (profile sharing).
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="apply-send" disabled={busy}>
        {busy ? 'Sending…' : 'Submit application'}
        <Send size={15} />
      </button>
      <p className="apply-fineprint">
        <ShieldCheck size={13} /> Your details are used only for recruitment. You can request
        access, correction or erasure at any time.
      </p>
    </form>
  );
}

function StatusCheck() {
  const [email, setEmail] = useState('');
  const [statusCode, setStatusCode] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  async function check(e) {
    e.preventDefault();
    if (!email.trim() || !statusCode.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      if (cloud) {
        const ws =
          new URLSearchParams(location.search).get('ws') || localStorage.getItem(WS_KEY) || '';
        if (!ws) throw new Error('This careers page is not configured for a workspace.');
        const supabase = await getSupabase();
        const { data, error } = await supabase.rpc('api_public_application_status', {
          p_workspace: ws,
          p_email: email.trim(),
          p_status_token: statusCode.trim(),
        });
        if (error) throw error;
        setResults(data || []);
      } else {
        const workspace = await loadData();
        const titleOf = (id) =>
          ((workspace.demands || []).find((d) => d.id === id) || {}).title || '';
        setResults(
          (workspace.publicApplications || [])
            .filter(
              (a) =>
                String(a.email || '').toLowerCase() === email.trim().toLowerCase() &&
                String(a.statusToken || '') === statusCode.trim(),
            )
            .map((a, i) => ({
              ref: String(a.id || `app-${i}`)
                .replace(/-/g, '')
                .slice(0, 8),
              role: a.demandTitle || titleOf(a.demandId) || 'General application',
              location: '',
              status: a.status || 'pending',
              submittedOn: String(a.created || '').slice(0, 10),
            })),
        );
      }
    } catch {
      setResults([]);
    }
    setBusy(false);
  }
  const label = {
    pending: 'Received — in review',
    accepted: 'Accepted — our team will contact you',
    dismissed: 'Not moving forward',
  };
  return (
    <section className="careers-status">
      <h2>Check your application status</h2>
      <p>
        Enter your application email and the private code shown after you applied. No account
        needed.
      </p>
      <form className="status-form" onSubmit={check}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Your email"
        />
        <input
          type="text"
          required
          maxLength={36}
          autoComplete="off"
          value={statusCode}
          onChange={(e) => setStatusCode(e.target.value)}
          placeholder="Private application code"
          aria-label="Private application code"
        />
        <button className="apply-btn" disabled={busy}>
          {busy ? 'Checking…' : 'Check status'}
        </button>
      </form>
      {results && (
        <div className="status-results">
          {results.length ? (
            results.map((r) => (
              <div key={r.ref} className="status-row">
                <strong>{r.role}</strong>
                <span>
                  {r.location ? `${r.location} · ` : ''}
                  {r.submittedOn}
                </span>
                <span className={`status-pill ${r.status}`}>{label[r.status] || r.status}</span>
              </div>
            ))
          ) : (
            <p className="careers-loading">No application matched that email and private code.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function CareersApp() {
  const { loading, roles, error } = useOpenRoles();
  const [applying, setApplying] = useState(null);
  return (
    <div className="careers-page">
      <header className="careers-hero">
        <span className="careers-brand">
          AnthroPrime<small>ECOD · TALENT INTELLIGENCE</small>
        </span>
        <h1>Open roles</h1>
        <p>
          Every role below is live with our client partners. Apply directly — a recruiter reviews
          every application, and your consent choices are recorded and respected.
        </p>
      </header>
      <main className="careers-main">
        {loading && <p className="careers-loading">Loading open roles…</p>}
        {error && <p className="form-error">{error}</p>}
        {!loading && !roles.length && !error && (
          <p className="careers-loading">No open roles right now — check back soon.</p>
        )}
        <div className="careers-list">
          {roles.map((r) => (
            <section className="careers-role" key={r.id}>
              <div className="careers-role-head">
                <h2>{r.title}</h2>
                <button
                  className="apply-btn"
                  onClick={() => setApplying(applying === r.id ? null : r.id)}
                >
                  {applying === r.id ? 'Close' : 'Apply'}
                </button>
              </div>
              <p className="careers-meta">
                <span>
                  <BriefcaseBusiness size={14} />
                  {r.client}
                </span>
                <span>
                  <MapPin size={14} />
                  {r.location} · {r.mode}
                </span>
                <span>
                  <Clock size={14} />
                  {r.engagementType || 'Engagement flexible'} · {r.positions} position
                  {r.positions === 1 ? '' : 's'}
                </span>
              </p>
              {r.skills && (
                <div className="careers-skills">
                  {r.skills.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
              )}
              {r.description && <p className="careers-desc">{r.description}</p>}
              {applying === r.id && <ApplyForm role={r} />}
            </section>
          ))}
        </div>
      </main>
      <StatusCheck />
      <footer className="careers-footer">
        <span>AnthroPrime · ECOD Talent Intelligence</span>
        <span>Applications are handled by people, not algorithms.</span>
      </footer>
    </div>
  );
}

if (typeof document !== 'undefined' && document.getElementById('careers-root')) {
  createRoot(document.getElementById('careers-root')).render(<CareersApp />);
}
