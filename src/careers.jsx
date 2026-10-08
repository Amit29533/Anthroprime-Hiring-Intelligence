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
import { jobPostingJsonLd, jobListJsonLd, pageMeta } from './jobPosting.js';
import { ThemeToggle, useTheme } from './theme.jsx';
import { TalentScene, MotionToggle, PublicBrand } from './Visuals.jsx';
import './workspace.css';
import './dark.css';
import './polish.css';
import './modern.css';
import './experience.css';

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
    source: (() => {
      const value = new URLSearchParams(location.search).get('source') || 'Career page';
      return /^[A-Za-z0-9 ._-]{1,100}$/.test(value) ? value : 'Career page';
    })(),
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
          source: form.source,
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

/**
 * Refer someone (Zoho D6). Most employees are not ATS users, so this is how a referral actually
 * reaches the recruiter. The form insists the referrer confirms they have the person's
 * permission — that is not consent in the §12 sense, only the referred person can give that,
 * but it records who asserted it. Nothing is ever read back: the RPC is write-only.
 */
function ReferSomeone({ roles }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    referrerName: '',
    referrerEmail: '',
    refereeName: '',
    refereeEmail: '',
    refereePhone: '',
    relationship: '',
    note: '',
    demandId: '',
    confirmPermission: false,
  });
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try {
      if (cloud) {
        const ws =
          new URLSearchParams(location.search).get('ws') || localStorage.getItem(WS_KEY) || '';
        const supabase = await getSupabase();
        const { error } = await supabase.rpc('api_public_refer', { ws, payload: form });
        if (error) throw error;
      } else {
        // Demo mode writes to the same browser store the recruiter app reads.
        const workspace = await loadData();
        await saveRows(
          'referrals',
          [
            {
              ...form,
              demandId: form.demandId || null,
              id: crypto.randomUUID(),
              status: 'New',
              rewardStatus: 'Not eligible',
              source: 'Careers page',
              created: new Date().toISOString().slice(0, 10),
            },
          ],
          workspace,
        );
      }
      setState({ busy: false, done: true, error: '' });
    } catch (err) {
      setState({ busy: false, done: false, error: err.message || 'That could not be submitted.' });
    }
  }

  if (state.done)
    return (
      <section className="careers-refer">
        <h2>Thank you</h2>
        <p>
          Your referral has reached our recruiters. We will contact them directly — and we will not
          tell them anything about you beyond your name.
        </p>
      </section>
    );

  return (
    <section className="careers-refer">
      <h2>Know someone who would fit?</h2>
      {!open ? (
        <button className="apply-btn" onClick={() => setOpen(true)}>
          Refer someone
        </button>
      ) : (
        <form onSubmit={submit}>
          <div className="careers-form-grid">
            <label>
              Your name
              <input value={form.referrerName} onChange={set('referrerName')} required />
            </label>
            <label>
              Your email
              <input type="email" value={form.referrerEmail} onChange={set('referrerEmail')} />
            </label>
            <label>
              Their name
              <input value={form.refereeName} onChange={set('refereeName')} required />
            </label>
            <label>
              Their email
              <input type="email" value={form.refereeEmail} onChange={set('refereeEmail')} />
            </label>
            <label>
              Their phone
              <input value={form.refereePhone} onChange={set('refereePhone')} />
            </label>
            <label>
              How do you know them?
              <input value={form.relationship} onChange={set('relationship')} />
            </label>
            <label className="careers-form-wide">
              Role
              <select value={form.demandId} onChange={set('demandId')}>
                <option value="">No specific role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="careers-form-wide">
              Why would they be a good fit?
              <textarea rows={2} value={form.note} onChange={set('note')} />
            </label>
          </div>
          <label className="careers-consent">
            <input
              type="checkbox"
              checked={form.confirmPermission}
              onChange={(e) => setForm({ ...form, confirmPermission: e.target.checked })}
            />
            I have asked them, and they are happy for us to get in touch.
          </label>
          {state.error && <p className="form-error">{state.error}</p>}
          <button className="apply-btn" disabled={state.busy || !form.confirmPermission}>
            {state.busy ? 'Sending…' : 'Send referral'}
          </button>
        </form>
      )}
    </section>
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

/** Replace (never duplicate) a managed tag in <head>, keyed by a data attribute. */
function setHeadTag(key, tag, attrs) {
  if (typeof document === 'undefined') return;
  const selector = `[data-careers-seo="${key}"]`;
  document.head.querySelectorAll(selector).forEach((node) => node.remove());
  const el = document.createElement(tag);
  el.setAttribute('data-careers-seo', key);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'text') el.textContent = value;
    else el.setAttribute(name, value);
  }
  document.head.appendChild(el);
}

/**
 * Publish page metadata and schema.org JobPosting markup for whatever is currently on screen.
 * A single role gets its own title, canonical URL and JobPosting; the listing gets an ItemList.
 * This is what makes the page eligible for a Google Jobs rich result.
 */
export function applyCareersSeo(role, roles, options = {}) {
  if (typeof document === 'undefined') return null;
  const meta = pageMeta(role, options);
  document.title = meta.title;
  setHeadTag('description', 'meta', { name: 'description', content: meta.description });
  setHeadTag('canonical', 'link', { rel: 'canonical', href: meta.canonical });
  setHeadTag('robots', 'meta', { name: 'robots', content: 'index, follow' });
  setHeadTag('og:title', 'meta', { property: 'og:title', content: meta.title });
  setHeadTag('og:description', 'meta', { property: 'og:description', content: meta.description });
  setHeadTag('og:type', 'meta', { property: 'og:type', content: meta.ogType });
  setHeadTag('og:url', 'meta', { property: 'og:url', content: meta.canonical });
  setHeadTag('twitter:card', 'meta', { name: 'twitter:card', content: 'summary' });

  const json = role ? jobPostingJsonLd(role, options) : jobListJsonLd(roles, options);
  if (json)
    setHeadTag('jsonld', 'script', { type: 'application/ld+json', text: JSON.stringify(json) });
  else document.head.querySelectorAll('[data-careers-seo="jsonld"]').forEach((n) => n.remove());
  return json;
}

export function CareersApp() {
  const [theme, setTheme] = useTheme();
  const { loading, roles, error } = useOpenRoles();
  const [applying, setApplying] = useState(null);
  // A deep link to one role gives that posting its own indexable URL, which is what Google Jobs
  // wants. Without it every job would share a single listing URL.
  const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
  const [focusId, setFocusId] = useState(() => params?.get('role') || '');
  const workspace = params?.get('ws') || '';
  const focused = focusId ? roles.find((r) => r.id === focusId) || null : null;
  const visible = focused ? [focused] : roles;
  const seoOptions = {
    origin: typeof location === 'undefined' ? '' : location.origin,
    path: typeof location === 'undefined' ? '/careers.html' : location.pathname,
    workspace,
  };

  useEffect(() => {
    if (loading) return;
    applyCareersSeo(focused, roles, seoOptions);
    // A deep link to a role that is no longer published must not leave a dead page.
    if (focusId && !focused && roles.length) setFocusId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, focusId, roles]);

  function showRole(id) {
    setFocusId(id);
    if (typeof history !== 'undefined' && typeof location !== 'undefined') {
      const next = new URLSearchParams(location.search);
      if (id) next.set('role', id);
      else next.delete('role');
      history.pushState({}, '', `${location.pathname}?${next.toString()}`);
    }
  }
  return (
    <div className="careers-page">
      <div className="public-theme">
        <MotionToggle />
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
      <header className="careers-hero">
        <TalentScene compact />
        <PublicBrand subtitle="ECOD · TALENT INTELLIGENCE" />
        <h1>{focused ? focused.title : 'Open roles'}</h1>
        <p>
          {focused
            ? `${focused.client} · ${focused.location} · ${focused.mode}`
            : 'Every role below is live with our client partners. Apply directly — a recruiter reviews every application, and your consent choices are recorded and respected.'}
        </p>
        {focused && (
          <button className="careers-back" onClick={() => showRole('')}>
            ← All open roles
          </button>
        )}
      </header>
      <main className="careers-main">
        {loading && <p className="careers-loading">Loading open roles…</p>}
        {error && <p className="form-error">{error}</p>}
        {!loading && !roles.length && !error && (
          <p className="careers-loading">No open roles right now — check back soon.</p>
        )}
        <div className="careers-list">
          {visible.map((r) => (
            <section className="careers-role" key={r.id}>
              <div className="careers-role-head">
                <h2>
                  {focused ? (
                    r.title
                  ) : (
                    <a
                      href={`?${workspace ? `ws=${encodeURIComponent(workspace)}&` : ''}role=${r.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        showRole(r.id);
                      }}
                    >
                      {r.title}
                    </a>
                  )}
                </h2>
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
      <ReferSomeone roles={roles} />
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
