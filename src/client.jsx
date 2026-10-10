import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cloud, getSupabase } from './repository.js';
import { ClientPortalView } from './ClientPortal.jsx';
import EnterpriseSignIn from './EnterpriseSignIn.jsx';
import { useTheme, ThemeToggle } from './theme.jsx';
import { MotionToggle, PublicBrand } from './Visuals.jsx';
import './workspace.css';
import './dark.css';
import './polish.css';
import './modern.css';
import './experience.css';
import './consistency.css';
function ClientApp() {
  const [theme, setTheme] = useTheme();
  const [session, setSession] = useState(null),
    [ready, setReady] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true,
      subscription;
    getSupabase()
      .then(async (c) => {
        if (!c) {
          if (alive) setReady(true);
          return;
        }
        subscription = c.auth.onAuthStateChange((_e, s) => {
          if (alive) {
            setSession(s);
            setReady(true);
          }
        }).data.subscription;
        const { data, error } = await c.auth.getSession();
        if (alive) {
          setSession(data.session);
          setReady(true);
          if (error) setError(error.message);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const c = await getSupabase();
      const { error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setSession(null);
    setBusy(true);
    try {
      const c = await getSupabase();
      const { error } = await c.auth.signOut();
      if (error) throw error;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!cloud)
    return (
      <main className="careers-main client-signin">
        <div className="public-controls">
          <ThemeToggle theme={theme} onChange={setTheme} />
          <MotionToggle />
        </div>
        <h1>Client portal</h1>
        <p>Configure the existing cloud workspace to enable client accounts.</p>
      </main>
    );
  if (!ready) return <p>Checking your session…</p>;
  return (
    <div className="client-portal-shell">
      <header className="careers-main client-portal-header">
        <a href="/">
          <PublicBrand subtitle="CLIENT WORKSPACE" />
        </a>
        <div className="public-controls">
          <ThemeToggle theme={theme} onChange={setTheme} />
          <MotionToggle />
        </div>
        {session && (
          <button disabled={busy} onClick={logout}>
            Sign out
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {session ? (
        <ClientPortalView key={session.user.id} />
      ) : (
        <main className="careers-main client-signin">
          <h1>Client sign in</h1>
          <p>Use the account your recruiter provisioned.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="button" disabled={busy}>
              Sign in
            </button>
            <EnterpriseSignIn />
          </form>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById('client-root')).render(<ClientApp />);
