import React, { useState } from 'react';
import { getSupabase } from './repository.js';

export async function startEnterpriseSignIn(
  providerId,
  {
    client = getSupabase,
    redirect = (url) => window.location.assign(url),
    origin = window.location.origin,
  } = {},
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(providerId)
  )
    throw Error('Enter your administrator-provided SSO provider UUID.');
  const supabase = await client();
  const { data, error } = await supabase.auth.signInWithSSO({
    providerId,
    options: { redirectTo: origin, skipBrowserRedirect: true },
  });
  if (error)
    throw Error(
      'SSO is unavailable. Check your configured provider and project entitlement with your administrator.',
    );
  const url = new URL(data?.url || '');
  if (url.protocol !== 'https:') throw Error('Secure SSO redirect unavailable.');
  redirect(url.href);
}
export default function EnterpriseSignIn({ start = startEnterpriseSignIn }) {
  const [provider, setProvider] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details>
      <summary>Sign in with enterprise SSO</summary>
      <p>
        Use the provider UUID supplied by your administrator. SSO authentication still requires an
        explicit workspace grant.
      </p>
      <label>
        SSO provider UUID
        <input
          aria-label="SSO provider UUID"
          value={provider}
          maxLength={36}
          disabled={busy}
          onChange={(e) => setProvider(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy || !provider}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await start(provider);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue with enterprise SSO
      </button>
    </details>
  );
}
