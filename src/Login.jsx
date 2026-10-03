import { TalentScene, MotionToggle } from './Visuals.jsx';
import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Field } from './ui.jsx';
import { ThemeToggle } from './theme.jsx';
import { getSupabase } from './repository.js';

export function Login({ theme = 'system', onThemeChange }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      {onThemeChange && (
        <div className="public-theme">
          <MotionToggle />
          <ThemeToggle theme={theme} onChange={onThemeChange} />
        </div>
      )}
      <div className="login-story">
        <div className="brand">
          <img
            className="brand-image"
            src="/anthroprime-logo.jpg"
            alt="AnthroPrime logo"
            width="62"
            height="48"
          />
          <span className="brand-wordmark">
            AnthroPrime<small>ECOD · TALENT INTELLIGENCE</small>
          </span>
        </div>
        <h1>
          Great talent.
          <br />
          Lasting connections.
        </h1>
        <p>Your team's talent repository, built around every possibility.</p>
        <TalentScene />
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const supabase = await getSupabase();
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) setError(error.message);
          } catch (authError) {
            setError(authError.message || 'Could not sign in.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h1>Good to have you here.</h1>
        <p>Sign in with your team account.</p>
        <Field label="Work email">
          <input
            required
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={16} />
        </Button>
        <small>Accounts are provisioned by your workspace administrator.</small>
      </form>
    </div>
  );
}
