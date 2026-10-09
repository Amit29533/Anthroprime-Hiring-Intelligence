import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getSupabase } from './repository.js';
import { Button, Field, PanelHeading } from './ui.jsx';
import { duplicate, skillList, today, uid, validateCandidate } from './domain.js';
import { candidateLabel } from './anthroId.js';
import { linkedinProfile, linkedinLookup, pastedLinkedinDraft } from './linkedin.js';

export async function linkedinRequest(body) {
  const c = await getSupabase();
  const { data, error } = await c.auth.getSession();
  if (error || !data.session) throw new Error('Sign in again to import from LinkedIn.');
  const response = await fetch('/.netlify/functions/linkedin-candidate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('LinkedIn lookup is unavailable. Use pasted profile text instead.');
  }
  if (!response.ok) throw new Error(result.error || 'LinkedIn lookup failed.');
  return result;
}
async function setWorkspaceEnabled(enabled) {
  const c = await getSupabase();
  const { error } = await c.rpc('api_set_linkedin_import', { p_enabled: enabled });
  if (error) throw new Error(error.message);
}
export function LinkedinImport({
  data,
  onSave,
  onImported,
  isCloud = cloud,
  isAdmin = getRole() === 'admin',
  request = linkedinRequest,
  setEnabled = setWorkspaceEnabled,
}) {
  const [profile, setProfile] = useState(''),
    [text, setText] = useState(''),
    [draft, setDraft] = useState(null),
    [metadata, setMetadata] = useState(null),
    [config, setConfig] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const candidateId = useRef(null);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    request({ action: 'status' })
      .then((result) => {
        if (active) setConfig(result);
      })
      .catch(() => {
        if (active) setConfig({ configured: false, enabled: false });
      });
    return () => {
      active = false;
    };
  }, [isCloud, request]);
  async function extract(provider, via = 'provider') {
    setBusy(true);
    setError('');
    setDraft(null);
    setConfirmed(false);
    candidateId.current = null;
    try {
      const input = linkedinLookup(profile);
      const normalized = input.profile;
      const existing = data.candidates.find((c) => {
        try {
          return normalized && linkedinProfile(c.linkedin) === normalized;
        } catch {
          return false;
        }
      });
      if (existing)
        throw new Error(
          `Already in your repository: ${candidateLabel(existing)}. Open that candidate to update it.`,
        );
      const result = provider
        ? await request({
            action: via === 'session' ? 'session-lookup' : 'lookup',
            profile: input.id || normalized,
          })
        : {
            draft: pastedLinkedinDraft(profile, text),
            provider: 'Pasted LinkedIn text',
            lookedUpAt: new Date().toISOString(),
          };
      if (!result.draft || (normalized && linkedinProfile(result.draft.linkedin) !== normalized))
        throw new Error('Returned profile does not match your LinkedIn ID.');
      setDraft({ ...result.draft, skills: (result.draft.skills || []).join(', ') });
      setMetadata({
        provider: result.provider,
        lookedUpAt: result.lookedUpAt,
        likelihood: result.likelihood ?? null,
        profile: linkedinProfile(result.draft.linkedin),
      });
      candidateId.current = uid();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const candidate = {
        id: candidateId.current,
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim(),
        title: draft.title.trim(),
        company: draft.company.trim(),
        location: draft.location.trim(),
        linkedin: metadata.profile,
        skills: skillList(draft.skills),
        skillsDetail: [],
        summary: draft.summary || '',
        source: 'LinkedIn import',
        status: 'Assessing',
        mode: 'Flexible',
        experience: null,
        relevantExperience: null,
        notice: null,
        current: null,
        expected: null,
        owner: '',
        created: today(),
        verified: today(),
        activeStatus: 'Active',
        engagement: '',
        earliestStart: null,
        tags: [],
        cvEvidence: {},
        custom: { linkedinImport: { ...metadata, reviewedAt: new Date().toISOString() } },
      };
      const invalid = validateCandidate(candidate);
      if (invalid) throw new Error(invalid);
      const existing =
        duplicate(candidate, data.candidates) ||
        data.candidates.find((c) => {
          if (c.id === candidate.id) return false;
          try {
            return linkedinProfile(c.linkedin) === candidate.linkedin;
          } catch {
            return false;
          }
        });
      if (existing)
        throw new Error(
          `Already in your repository: ${candidateLabel(existing)}. Open that candidate to update it.`,
        );
      if (await onSave('candidates', [candidate])) onImported?.();
      else setError('Candidate was not saved. Your reviewed draft is retained for retry.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <PanelHeading title="Import from LinkedIn" />
      <div className="settings-body">
        <p>
          Enter a member profile URL, public handle (for example, priya-sharma) or numeric LinkedIn
          ID. Extract a draft from pasted profile text, or look it up through People Data Labs when
          enabled. Review the candidate before saving.
        </p>
        <Field label="LinkedIn profile URL or ID">
          <input
            aria-label="LinkedIn profile URL or ID"
            value={profile}
            maxLength={500}
            disabled={busy}
            placeholder="https://www.linkedin.com/in/priya-sharma"
            onChange={(e) => {
              setProfile(e.target.value);
              setDraft(null);
              setConfirmed(false);
            }}
          />
        </Field>
        <Field label="LinkedIn profile text">
          <textarea
            aria-label="LinkedIn profile text"
            value={text}
            maxLength={50000}
            disabled={busy}
            placeholder="Paste the candidate's profile text here"
            onChange={(e) => {
              setText(e.target.value);
              setDraft(null);
              setConfirmed(false);
            }}
          />
        </Field>
        <Button disabled={busy || !profile.trim() || !text.trim()} onClick={() => extract(false)}>
          Extract pasted LinkedIn profile
        </Button>
        <Button
          disabled={busy || !isCloud || !config?.configured || !config?.enabled || !profile.trim()}
          onClick={() => extract(true)}
        >
          Look up LinkedIn ID
        </Button>
        <Button
          disabled={
            busy ||
            !isCloud ||
            !config?.sessionWorker ||
            !config?.enabled ||
            !profile.trim() ||
            /^\d{5,20}$/.test(profile.trim())
          }
          onClick={() => extract(true, 'session')}
        >
          Look up with LinkedIn test-account session
        </Button>
        {isCloud && config?.sessionWorker && (
          <p>
            The session option reads the profile page through a self-hosted worker signed in with a
            dedicated test LinkedIn account. It is not a LinkedIn-approved integration, may break or
            get that account restricted, and uses the same workspace limit of 20 attempts per UTC
            day. Contact details are not returned; add an email or phone during review.
          </p>
        )}
        <p>
          {isCloud && config?.configured
            ? 'Provider lookup sends the profile URL to People Data Labs and may use billable credits. Workspace limit: 20 attempts per UTC day, including unsuccessful attempts.'
            : 'Automatic lookup needs a configured enrichment provider in the shared Netlify workspace. Pasted text works without a key.'}
        </p>
        {isCloud && isAdmin && (config?.configured || config?.sessionWorker) && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await setEnabled(!config.enabled);
                setConfig(await request({ action: 'status' }));
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {config.enabled
              ? 'Disable workspace LinkedIn lookup'
              : 'Enable workspace LinkedIn lookup'}
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
        {draft && (
          <>
            <p role="status">
              Draft from {metadata.provider}
              {metadata.likelihood != null
                ? `; provider match score ${metadata.likelihood}/10`
                : ''}
              . Contact and skill details may be missing or outdated.
            </p>
            {['name', 'email', 'phone', 'title', 'company', 'location', 'skills'].map((key) => (
              <Field label={`LinkedIn draft ${key}`} key={key}>
                <input
                  aria-label={`LinkedIn draft ${key}`}
                  value={draft[key] || ''}
                  maxLength={key === 'skills' ? 4000 : 254}
                  disabled={busy}
                  onChange={(e) => {
                    setDraft({ ...draft, [key]: e.target.value });
                    setConfirmed(false);
                  }}
                />
              </Field>
            ))}
            <p>
              A name and email or phone are required. Unknown experience, availability and
              compensation are left blank. The normal candidate save assigns the Anthro-ID.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{' '}
              I reviewed the identity, contact and profile details.
            </label>
            <Button disabled={busy || !confirmed} onClick={save}>
              Save reviewed LinkedIn candidate
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
