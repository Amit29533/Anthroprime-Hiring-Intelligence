import { DisclosureSection } from './DisclosureSection.jsx';
import { SkillBadge } from './SkillBadge.jsx';
import { CalendarClock, ShieldCheck } from 'lucide-react';
// Candidate portal (/portal.html) — cloud mode signs in with Supabase Auth and reads the
// curated RPCs through explicit account grants; demo mode opens a fictional profile by email.
// Cloud profile changes use reviewed proposals; communication opt-outs apply immediately.
import React, { useState, useEffect, useRef } from 'react';
import { anthroIdFor } from './anthroId.js';
import { createRoot } from 'react-dom/client';
import { cloud, getSupabase, loadData, saveRows } from './repository.js';

import {
  portalOverview,
  applyPortalUpdate,
  validatePortalPayload,
  bookSlotRows,
} from './portal.js';
import { ThemeToggle, useTheme } from './theme.jsx';
import { FeedbackPortal } from './FeedbackLoops.jsx';
import { TalentScene, MotionToggle, PublicBrand } from './Visuals.jsx';
import './workspace.css';
import './dark.css';
import './polish.css';
import './modern.css';
import './experience.css';
import './consistency.css';

const label = {
  pending: 'Received — in review',
  accepted: 'Accepted — we will be in touch',
  dismissed: 'Not moving forward',
  Identified: 'In identification',
  Contacted: 'Contacted',
  Assessed: 'Assessed',
  Enrichment: 'Enrichment',
  Submitted: 'Submitted to client',
  Interview: 'Interview stage',
  Offer: 'Offer stage',
  Deployed: 'Deployed',
  Rejected: 'Not selected',
  Withdrawn: 'Withdrawn',
};

function Pill({ kind, children }) {
  return <span className={`status-pill ${kind || ''}`}>{children}</span>;
}

function Overview({ view, onSave, busy, msg, onBook, booking }) {
  const p = view.profile;
  const [form, setForm] = useState({
    notice: p.notice ?? '',
    earliestStart: p.earliestStart || '',
    activeStatus: p.activeStatus || 'Active',
    mode: p.mode || 'Flexible',
    engagement: p.engagement || '',
    preferredLocations: p.preferredLocations || '',
    expected: p.expected ?? '',
  });
  return (
    <main className="careers-main portal-main">
      <section className="careers-status portal-card">
        <h2 style={{ margin: '0 0 2px' }}>{p.name}</h2>
        <p className="anthro-id">Anthro-ID: {anthroIdFor(p)}</p>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          {[p.title, p.location].filter(Boolean).join(' · ') || 'Candidate profile'}
        </p>
        {p.skills?.length > 0 && (
          <div className="careers-skills" style={{ marginTop: 10 }}>
            {p.skills.slice(0, 10).map((s) => (
              <SkillBadge key={s} skill={s} />
            ))}
          </div>
        )}
      </section>
      {!cloud && (
        <DisclosureSection
          title="Update availability"
          description="Notice period, start date and work preferences."
          icon={CalendarClock}
        >
          <section className="careers-status portal-card">
            <h2>Your availability</h2>
            <p>Update your preferences any time — recruiters see the change immediately.</p>
            <div className="form-grid">
              <label>
                Notice period (days)
                <input
                  type="number"
                  min="0"
                  value={form.notice ?? ''}
                  onChange={(e) => setForm({ ...form, notice: e.target.value })}
                />
              </label>
              <label>
                Earliest start
                <input
                  type="date"
                  value={form.earliestStart || ''}
                  onChange={(e) => setForm({ ...form, earliestStart: e.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={form.activeStatus}
                  onChange={(e) => setForm({ ...form, activeStatus: e.target.value })}
                >
                  <option>Active</option>
                  <option>Passive</option>
                </select>
              </label>
              <label>
                Work mode
                <select
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                >
                  <option>Flexible</option>
                  <option>Remote</option>
                  <option>Hybrid</option>
                  <option>Onsite</option>
                </select>
              </label>
              <label>
                Engagement preference
                <input
                  value={form.engagement}
                  onChange={(e) => setForm({ ...form, engagement: e.target.value })}
                  placeholder="Permanent / Contract / C2H…"
                />
              </label>
              <label>
                Preferred locations
                <input
                  value={form.preferredLocations}
                  onChange={(e) => setForm({ ...form, preferredLocations: e.target.value })}
                  placeholder="Bengaluru, Remote…"
                />
              </label>
            </div>
            <button className="apply-btn" disabled={busy} onClick={() => onSave(form)}>
              {busy ? 'Saving…' : 'Save preferences'}
            </button>
            {msg && (
              <p className="careers-loading" style={{ marginTop: 8 }}>
                {msg}
              </p>
            )}
          </section>
        </DisclosureSection>
      )}
      <section className="careers-status portal-card">
        <h2>Your applications</h2>
        {view.applications.length || view.submissions.length ? (
          <div className="status-results">
            {view.applications.map((a, i) => (
              <div key={`a${i}`} className="status-row">
                <strong>{a.demand}</strong>
                <span>{a.client}</span>
                <Pill>{label[a.stage] || a.stage}</Pill>
              </div>
            ))}
            {view.submissions.map((s, i) => (
              <div key={`s${i}`} className="status-row">
                <strong>{s.demand}</strong>
                <span>
                  {s.client} · {s.submittedOn}
                </span>
                <Pill
                  kind={
                    s.status === 'accepted'
                      ? 'accepted'
                      : s.status === 'dismissed'
                        ? 'dismissed'
                        : ''
                  }
                >
                  {label[s.status] || s.status}
                </Pill>
              </div>
            ))}
          </div>
        ) : (
          <p className="careers-loading">No applications yet.</p>
        )}
      </section>
      {(view.slots || []).length > 0 && (
        <section className="careers-status portal-card">
          <h2>Choose an interview time</h2>
          <p className="careers-publish-hint">
            Pick whichever suits you. The other times are released as soon as you choose, so nobody
            is left holding a slot you do not need.
          </p>
          <div className="status-results">
            {view.slots.map((s) => (
              <div key={s.id} className="status-row">
                <strong>
                  {new Date(s.startsAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </strong>
                <span>
                  {s.round} · {s.mode}
                  {s.durationMins ? ` · ${s.durationMins} min` : ''}
                </span>
                <button className="apply-btn" disabled={booking} onClick={() => onBook(s.id)}>
                  {booking === s.id ? 'Booking…' : 'Book this time'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {view.interviews.length > 0 && (
        <section className="careers-status portal-card">
          <h2>Your interviews</h2>
          <div className="status-results">
            {view.interviews.map((iv, i) => (
              <div key={i} className="status-row">
                <strong>
                  {iv.round} · {iv.mode}
                </strong>
                <span>
                  {new Date(iv.scheduledAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <Pill>{iv.status}</Pill>
              </div>
            ))}
          </div>
        </section>
      )}
      {view.offers.length > 0 && (
        <section className="careers-status portal-card">
          <h2>Your offers</h2>
          <div className="status-results">
            {view.offers.map((o, i) => (
              <div key={i} className="status-row">
                <strong>{o.role || 'Offer'}</strong>
                <span>
                  {o.ctc ? `₹${o.ctc} LPA · ` : ''}
                  {o.joining || ''}
                </span>
                <Pill
                  kind={
                    o.status === 'Accepted'
                      ? 'accepted'
                      : o.status === 'Rejected' || o.status === 'Withdrawn'
                        ? 'dismissed'
                        : ''
                  }
                >
                  {o.status}
                </Pill>
              </div>
            ))}
          </div>
        </section>
      )}
      <DisclosureSection
        title="Privacy and consents"
        description="View your choices or withdraw consent."
        icon={ShieldCheck}
      >
        <section className="careers-status portal-card">
          <h2>Your consents</h2>
          <p>You can withdraw any consent here; required notices stay on record.</p>
          <div className="status-results">
            {view.consents.map((cn) => (
              <div key={cn.id} className="status-row">
                <strong>{cn.purpose}</strong>
                <span>{String(cn.date).slice(0, 10)}</span>
                {cn.status === 'revoked' ? (
                  <Pill kind="dismissed">Withdrawn</Pill>
                ) : (
                  <button className="apply-btn" onClick={() => onSave(null, cn.id)}>
                    Withdraw
                  </button>
                )}
              </div>
            ))}
            {!view.consents.length && <p className="careers-loading">No consents recorded.</p>}
          </div>
        </section>
      </DisclosureSection>
    </main>
  );
}

// The portal writes only the fields portal.js whitelists. Inputs arrive as strings; the
// workspace stores notice/expected as numbers and dates as ISO strings or null.
// Blank means unknown. `Number('  ')` is 0, so an untrimmed empty value used to be stored as a
// hard zero — read downstream as "immediately available" and "expects ₹0 LPA". Trim first, and
// treat anything that is not a finite number as unknown rather than as 0 or NaN.
const toNumber = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
export function normalizePortalPayload(form = {}) {
  return {
    notice: toNumber(form.notice),
    expected: toNumber(form.expected),
    earliestStart: form.earliestStart || null,
    activeStatus: form.activeStatus || 'Active',
    mode: form.mode || 'Flexible',
    engagement: form.engagement || '',
    preferredLocations: form.preferredLocations || '',
  };
}

export function PortalApp() {
  const [theme, setTheme] = useTheme();
  const [cloudView, setCloudView] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [portalUser, setPortalUser] = useState('');
  const authGeneration = useRef(0),
    authUser = useRef('');
  // Demo mode: the workspace is loaded asynchronously (loadData is a promise — wrapping it in
  // normalizeData used to hand the portal an empty repository, so no email could ever match).
  const [demoData, setDemoData] = useState(null);
  const [demoId, setDemoId] = useState(null);
  const [email, setEmail] = useState(''),
    [pw, setPw] = useState(''),
    [demoEmail, setDemoEmail] = useState('');
  const [msg, setMsg] = useState(''),
    [busy, setBusy] = useState(false),
    [booking, setBooking] = useState('');
  useEffect(() => {
    if (cloud) return;
    let active = true;
    loadData()
      .then((d) => {
        if (active) setDemoData(d);
      })
      .catch((e) => {
        if (active) setMsg(e.message || 'Could not open the demo workspace.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!cloud) return;
    const generationRef = authGeneration;
    let active = true;
    let authSubscription;
    getSupabase()
      .then(async (supabase) => {
        if (!active) return;
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          const userId = session?.user?.id || '';
          if (authUser.current !== userId) {
            authUser.current = userId;
            authGeneration.current++;
            setCloudView(null);
            setPortalUser(userId);
          }
          setSignedIn(!!session);
          if (session) setTimeout(() => active && refresh(), 0);
          else setCloudView(null);
        });
        authSubscription = subscription.subscription;
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) setMsg(error.message);
        const userId = data.session?.user?.id || '';
        if (authUser.current !== userId) authGeneration.current++;
        authUser.current = userId;
        setPortalUser(userId);
        setSignedIn(!!data.session);
        if (data.session) await refresh();
      })
      .catch((error) => {
        if (active) setMsg(error.message || 'Could not initialize the candidate portal.');
      });
    return () => {
      active = false;
      generationRef.current++;
      authSubscription?.unsubscribe();
    };
  }, []);
  async function refresh() {
    const generation = authGeneration.current;
    setCloudView(null);
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('api_portal_overview');
    if (generation !== authGeneration.current) return;
    if (error) setMsg(error.message);
    else if (!data) setMsg('The portal could not return your record.');
    else if (data.error) setMsg(data.error);
    else {
      setCloudView(data);
      setMsg('');
    }
  }
  async function signOut() {
    setBusy(true);
    authGeneration.current++;
    setCloudView(null);
    setSignedIn(false);
    setPortalUser('');
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setMsg('Signed out.');
    } catch (error) {
      setMsg(error.message || 'Could not finish signing out.');
    } finally {
      setBusy(false);
    }
  }
  const demoCandidate = demoData ? demoData.candidates.find((c) => c.id === demoId) || null : null;
  const view = cloud ? cloudView : demoCandidate ? portalOverview(demoCandidate, demoData) : null;
  function openDemo(e) {
    e.preventDefault();
    const wanted = demoEmail.trim().toLowerCase();
    const c = (demoData?.candidates || []).find(
      (x) => String(x.email || '').toLowerCase() === wanted,
    );
    if (!c) return setMsg('No profile with that email in the demo workspace.');
    setMsg('');
    setDemoId(c.id);
  }
  async function save(form, revokeId) {
    const payload = revokeId ? null : normalizePortalPayload(form);
    const validation = payload ? validatePortalPayload(payload) : null;
    if (validation) {
      setMsg(validation);
      return;
    }
    setBusy(true);
    try {
      if (cloud) {
        const supabase = await getSupabase();
        if (revokeId) {
          const { data: result, error } = await supabase.rpc('api_portal_revoke_consent', {
            p_id: revokeId,
          });
          if (error) throw error;
          if (result?.error) throw new Error(result.error);
        } else {
          const { error } = await supabase.rpc('api_portal_update', { payload });
          if (error) throw error;
        }
        await refresh();
        setMsg(revokeId ? 'Consent withdrawn.' : 'Preferences saved.');
      } else {
        if (!demoCandidate || !demoData)
          throw new Error('Your demo session is no longer linked to a profile.');
        if (revokeId) {
          const row = demoData.consents.find((x) => x.id === revokeId);
          if (!row) throw new Error('That consent record is no longer on file.');
          await saveRows('consents', [{ ...row, status: 'revoked' }], demoData);
          setMsg('Consent withdrawn and recorded in the workspace.');
        } else {
          await saveRows('candidates', [applyPortalUpdate(demoCandidate, payload)], demoData);
          setMsg('Preferences saved to the demo workspace.');
        }
        setDemoData(await loadData());
      }
    } catch (e) {
      setMsg(e.message || 'Could not save your changes.');
    }
    setBusy(false);
  }
  /** Book an interview slot. Cloud goes through the atomic RPC; demo mirrors it locally. */
  async function book(slotId) {
    setBooking(slotId);
    try {
      if (cloud) {
        const supabase = await getSupabase();
        const { data: result, error } = await supabase.rpc('api_portal_book_slot', {
          p_slot: slotId,
        });
        if (error) throw error;
        if (result?.error) throw new Error(result.error);
        await refresh();
      } else {
        if (!demoCandidate || !demoData)
          throw new Error('Your demo session is no longer linked to a profile.');
        const rows = bookSlotRows(demoCandidate.id, slotId, demoData);
        if (rows.error) throw new Error(rows.error);
        await saveRows('interviews', [rows.interview], demoData);
        const refreshed = await loadData();
        await saveRows('interviewSlots', rows.slots, refreshed);
        setDemoData(await loadData());
      }
      setMsg('Your interview is booked. The other times have been released.');
    } catch (e) {
      setMsg(e.message || 'That time could not be booked.');
    }
    setBooking('');
  }

  return (
    <div className="careers-page">
      <div className="public-theme">
        <MotionToggle />
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
      <header className="careers-hero" style={{ padding: '40px 8vw 32px' }}>
        <TalentScene compact />
        <PublicBrand subtitle="ECOD · CANDIDATE PORTAL" />
        <h1>{view ? `Welcome, ${view.profile.name.split(' ')[0]}` : 'Your profile, your data'}</h1>
        <p>
          {view
            ? 'Everything below is your own record — applications, interviews, offers and consents.'
            : 'Sign in with your granted account to see your applications, review your profile, submit updates and respond to invitations.'}
        </p>
      </header>
      {cloud && signedIn && (
        <section className="panel portal-card">
          <p>You are signed in. Portal actions recheck your current account access.</p>
          <button type="button" disabled={busy} onClick={signOut}>
            Sign out of candidate portal
          </button>
          {msg && <p role="status">{msg}</p>}
        </section>
      )}
      {!view && !(cloud && signedIn) && (
        <main className="careers-main">
          <section className="careers-status portal-card">
            {cloud ? (
              <>
                <h2>Sign in</h2>
                <form
                  className="status-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const supabase = await getSupabase();
                      const { error } = await supabase.auth.signInWithPassword({
                        email: email.trim(),
                        password: pw,
                      });
                      setMsg(error ? error.message : '');
                    } catch (authError) {
                      setMsg(authError.message || 'Could not sign in.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email"
                  />
                  <input
                    type="password"
                    required
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Password"
                    aria-label="Password"
                  />
                  <button className="apply-btn" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
                <p className="careers-loading">
                  Ask your recruiter to grant your registered account access. A matching email alone
                  does not link your profile.
                </p>
                {msg && <p className="form-error">{msg}</p>}
              </>
            ) : (
              <>
                <h2>Open your record</h2>
                <p>Demo mode — enter the email of any profile in the local workspace.</p>
                <form className="status-form" onSubmit={openDemo}>
                  <input
                    type="email"
                    required
                    value={demoEmail}
                    onChange={(e) => setDemoEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-label="Your email"
                  />
                  <button className="apply-btn" disabled={busy}>
                    Open my record
                  </button>
                </form>
                {msg && <p className="form-error">{msg}</p>}
              </>
            )}
          </section>
        </main>
      )}
      {cloud && signedIn && <FeedbackPortal key={portalUser} />}
      {view && (
        <Overview view={view} onSave={save} busy={busy} msg={msg} onBook={book} booking={booking} />
      )}
      <footer className="careers-footer">
        <span>AnthroPrime · ECOD Talent Intelligence</span>
        <span>You can request access, correction or erasure of your data at any time.</span>
      </footer>
    </div>
  );
}
if (typeof document !== 'undefined' && document.getElementById('portal-root')) {
  createRoot(document.getElementById('portal-root')).render(<PortalApp />);
}
