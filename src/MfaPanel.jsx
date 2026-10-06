import React, { useEffect, useState } from 'react';
import { cloud, getSupabase, getRole } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';

export function MfaPanel({ isCloud = cloud, client, isAdmin = getRole() === 'admin' }) {
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(null);
  const [factor, setFactor] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const provider = async () => client || (await getSupabase());
  const checked = (result) => {
    if (result.error) throw result.error;
    return result.data;
  };
  const refresh = async (c) => {
    const factors = checked(await c.auth.mfa.listFactors()).totp || [];
    const assurance = checked(await c.auth.mfa.getAuthenticatorAssuranceLevel());
    const policy = checked(await c.rpc('api_privileged_mfa_status'));
    if (typeof policy?.enabled !== 'boolean') throw new Error('MFA policy unavailable');
    setState({ factors, level: assurance.currentLevel, enabled: policy.enabled });
    setFactor((previous) =>
      factors.some((f) => f.id === previous) ? previous : factors[0]?.id || '',
    );
  };
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    (async () => {
      try {
        const c = await provider();
        if (active) await refresh(c);
      } catch {
        if (active) setError('Unable to load authenticator settings. Refresh to retry.');
      }
    })();
    return () => {
      active = false;
    };
    // The Settings panel is keyed by workspace to discard enrollment state on switching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloud, client]);
  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action(await provider());
    } catch {
      setError('Authenticator action failed. Check your code and connection, then retry.');
    } finally {
      setBusy(false);
    }
  };
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading title="Authenticator security" />
      <div className="settings-body">
        <p>
          Use an authenticator app for administrator request reviews, audited candidate exports and
          document downloads. Other application access is unchanged.
        </p>
        {error && <p role="alert">{error}</p>}
        {state && (
          <>
            <p role="status">
              Session: {state.level || 'aal1'}. Workspace requirement:{' '}
              {state.enabled ? 'enabled' : 'disabled'}.
            </p>
            {!pending && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async (c) => {
                    const enrolled = checked(
                      await c.auth.mfa.enroll({
                        factorType: 'totp',
                        friendlyName: `Anthroprime ${new Date().toISOString()}`,
                      }),
                    );
                    setPending(enrolled);
                    setCode('');
                  })
                }
              >
                Add authenticator
              </Button>
            )}
            {pending && (
              <div>
                <p>Scan this QR code in your authenticator app, then verify its six digit code.</p>
                <img
                  alt="Authenticator enrollment QR code"
                  width="200"
                  height="200"
                  src={
                    pending.totp.qr_code.startsWith('data:image/')
                      ? pending.totp.qr_code
                      : `data:image/svg+xml,${encodeURIComponent(pending.totp.qr_code)}`
                  }
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async (c) => {
                      checked(await c.auth.mfa.unenroll({ factorId: pending.id }));
                      setPending(null);
                      setCode('');
                      await refresh(c);
                    })
                  }
                >
                  Cancel enrollment
                </Button>
              </div>
            )}
            {!pending && state.factors.length > 0 && (
              <label>
                Authenticator
                <select
                  aria-label="Authenticator"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                >
                  {state.factors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.friendly_name || 'Authenticator'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(pending || factor) && (
              <>
                <label>
                  Authenticator code
                  <input
                    aria-label="Authenticator code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <Button
                  disabled={busy || !/^\d{6}$/.test(code)}
                  onClick={() =>
                    run(async (c) => {
                      const factorId = pending?.id || factor;
                      const challenge = checked(await c.auth.mfa.challenge({ factorId }));
                      checked(
                        await c.auth.mfa.verify({ factorId, challengeId: challenge.id, code }),
                      );
                      setCode('');
                      setPending(null);
                      await refresh(c);
                    })
                  }
                >
                  Verify authenticator
                </Button>
              </>
            )}
            {!pending && factor && (
              <Button
                disabled={busy || state.level !== 'aal2' || state.enabled}
                onClick={() =>
                  run(async (c) => {
                    checked(await c.auth.mfa.unenroll({ factorId: factor }));
                    checked(await c.auth.refreshSession());
                    setCode('');
                    await refresh(c);
                  })
                }
              >
                Remove selected authenticator
              </Button>
            )}
            {isAdmin && (
              <>
                <p>
                  Before enabling, configure audited document access and candidate exports, and
                  enroll another administrator for account recovery. Keep access to your
                  authenticator; recovery requires a trusted project operator if you lose every
                  factor.
                </p>
                <Button
                  disabled={busy || state.level !== 'aal2' || !!pending}
                  onClick={() =>
                    run(async (c) => {
                      checked(await c.rpc('api_set_privileged_mfa', { p_enabled: !state.enabled }));
                      await refresh(c);
                    })
                  }
                >
                  {state.enabled
                    ? 'Disable administrator MFA requirement'
                    : 'Require administrator MFA'}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
