import React, { useEffect, useRef, useState } from 'react';
import './linkedinImport.css';
import { cloud, getRole, getSupabase } from './repository.js';
import { Button, Field, PanelHeading } from './ui.jsx';
import { duplicate, skillList, today, uid, validateCandidate } from './domain.js';
import { candidateLabel } from './anthroId.js';
import { linkedinProfile, linkedinLookup, pastedLinkedinDraft } from './linkedin.js';
import { readLinkedinExport, localLinkedinDraft } from './linkedinFile.js';
import { linkedinCommand } from './linkedinCommand.js';
import extractorManifest from '../public/linkedin-local-extractor-manifest.json';
import { CvEvidenceReview } from './CvEvidenceReview.jsx';
import { evidenceReady } from './cvEvidence.js';

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
  readExport = readLinkedinExport,
  readClipboard = () => navigator.clipboard.readText(),
  writeClipboard = (value) => navigator.clipboard.writeText(value),
  canImport = ['admin', 'recruiter'].includes(getRole()),
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
  const [commandNotice, setCommandNotice] = useState('');
  const [command, setCommand] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function resetDraft() {
    generation.current++;
    candidateId.current = null;
    setDraft(null);
    setMetadata(null);
    setConfirmed(false);
    setError('');
  }
  function acceptDraft(result) {
    const normalized = linkedinProfile(result.draft.linkedin);
    const existing = data.candidates.find((c) => {
      try {
        return linkedinProfile(c.linkedin) === normalized;
      } catch {
        return false;
      }
    });
    if (existing)
      throw new Error(
        `Already in your repository: ${candidateLabel(existing)}. Open that candidate to update it.`,
      );
    setDraft({ ...result.draft, skills: (result.draft.skills || []).join(', ') });
    setMetadata({
      provider: result.provider,
      lookedUpAt: result.lookedUpAt,
      likelihood: result.likelihood ?? null,
      profile: normalized,
      ...(result.warnings ? { warnings: result.warnings, completeness: result.completeness } : {}),
    });
    candidateId.current = uid();
  }
  const [evidenceText, setEvidenceText] = useState('');
  async function copyCommand() {
    setCommandNotice('');
    try {
      const value = linkedinCommand(profile, extractorManifest.archiveSha256);
      setCommand(value);
      try {
        await writeClipboard(value);
        setCommandNotice('Command copied. Open PowerShell, paste it and press Enter.');
      } catch {
        setCommandNotice(
          'Clipboard access was unavailable. Select and copy the displayed command manually.',
        );
      }
    } catch (failure) {
      setCommandNotice(failure.message);
    }
  }
  async function pasteExport() {
    if (!canImport || busy) return;
    resetDraft();
    setEvidenceText('');
    setBusy(true);
    const current = generation.current;
    try {
      const content = await readClipboard();
      if (generation.current !== current) return;
      const result = localLinkedinDraft(content, profile);
      acceptDraft(result);
      setProfile(result.draft.linkedin);
      setEvidenceText(result.evidenceText || '');
    } catch (failure) {
      if (generation.current === current)
        setError(
          failure.message ||
            'Clipboard access failed. Use LinkedIn JSON export to choose the saved result file.',
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function importExport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canImport) return;
    resetDraft();
    setEvidenceText('');
    setBusy(true);
    const current = generation.current;
    try {
      const result = await readExport(file, profile);
      if (generation.current !== current) return;
      acceptDraft(result);
      setProfile(result.draft.linkedin);
      setEvidenceText(result.evidenceText || '');
    } catch (err) {
      if (generation.current === current) setError(err.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
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
    if (!canImport) return;
    setBusy(true);
    setError('');
    setDraft(null);
    setConfirmed(false);
    candidateId.current = null;
    setEvidenceText('');
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
      acceptDraft(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !confirmed || busy || !canImport || !evidenceReady(draft.cvEvidence)) return;
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
        cvEvidence: draft.cvEvidence || {},
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
          ID. Import a local extractor file, extract pasted profile text, or look it up through
          People Data Labs when enabled. Review the candidate before saving.
        </p>
        {!canImport && (
          <p role="status">Candidate import requires an administrator or recruiter role.</p>
        )}
        <Field label="LinkedIn profile URL or ID">
          <input
            aria-label="LinkedIn profile URL or ID"
            value={profile}
            maxLength={500}
            disabled={busy || !canImport}
            placeholder="https://www.linkedin.com/in/priya-sharma"
            onChange={(event) => {
              setProfile(event.target.value);
              setCommand('');
              setCommandNotice('');
              resetDraft();
              setEvidenceText('');
            }}
          />
        </Field>
        <section className="linkedin-export-import" aria-label="Quick LinkedIn extraction">
          <h3>Extract with one command</h3>
          <p>
            Enter the candidate’s LinkedIn URL above, copy the command, and run it in Windows
            PowerShell. It sets up the extractor once and opens LinkedIn for normal sign-in. Then
            return here and paste the result.
          </p>
          <div className="linkedin-command-actions">
            <Button disabled={busy || !canImport} onClick={copyCommand}>
              Copy extraction command
            </Button>
            <Button variant="secondary" disabled={busy || !canImport} onClick={pasteExport}>
              Paste extracted profile
            </Button>
          </div>
          {commandNotice && <p role="status">{commandNotice}</p>}
          {command && (
            <details open>
              <summary>Your PowerShell command</summary>
              <textarea
                aria-label="LinkedIn extraction command"
                className="linkedin-command-text"
                value={command}
                readOnly
              />
            </details>
          )}
          <p>
            Requires{' '}
            <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">
              Python 3.10 or newer
            </a>{' '}
            on Windows. First run installs Playwright and uses installed Edge or Chrome. Chromium is
            downloaded only if neither is found; later runs reuse the setup. No extension or
            administrator access is needed. Sign-in happens in the extractor’s temporary browser,
            even if another browser is already logged in. The login closes after each run.
          </p>
          <p>
            The command copies the extracted profile JSON to your clipboard. “Paste extracted
            profile” reads it for review; it does not save a candidate automatically. A local JSON
            file remains available as a fallback. No password or cookie is sent to this portal.
          </p>
        </section>
        <section aria-label="Import local LinkedIn export" className="linkedin-export-import">
          <h3>Import a local LinkedIn export</h3>
          <p>
            Sign in to LinkedIn in the local extractor’s browser, then choose its JSON file here. No
            cookie copying is needed. Your LinkedIn login stays on your computer.
          </p>
          <a className="button secondary" href="/linkedin-local-extractor.zip" download>
            Download local LinkedIn extractor
          </a>
          <details>
            <summary>How to create the export</summary>
            <ol>
              <li>
                Download and unzip the tool. Follow its README to install Python and Playwright.
              </li>
              <li>
                Run the command below with the profile URL. Sign in directly to LinkedIn in the
                opened browser, then press Enter in your terminal.
                <pre>
                  <code>
                    {
                      '.\\.venv-linkedin\\Scripts\\python.exe tools/linkedin_profile_extractor.py "https://www.linkedin.com/in/YOUR-HANDLE/" --login --out profile.json'
                    }
                  </code>
                </pre>
              </li>
              <li>
                Choose the exported JSON below. Review warnings and evidence, add a known contact,
                then save.
              </li>
            </ol>
            <p>
              This captures visible profile sections and may miss collapsed entries. It stops at
              verification screens. LinkedIn does not support session-cookie extraction and may
              restrict automated access.
            </p>
          </details>
          <Field label="LinkedIn JSON export">
            <input
              type="file"
              accept=".json,application/json"
              aria-label="LinkedIn JSON export"
              disabled={busy || !canImport}
              onChange={importExport}
            />
          </Field>
          <p className="muted">
            One profile per file · maximum 200 KiB. An entered profile URL must match the export.
          </p>
        </section>
        <Field label="LinkedIn profile text">
          <textarea
            aria-label="LinkedIn profile text"
            value={text}
            maxLength={50000}
            disabled={busy || !canImport}
            placeholder="Paste the candidate's profile text here"
            onChange={(e) => {
              setText(e.target.value);
              resetDraft();
              setEvidenceText('');
            }}
          />
        </Field>
        <Button
          disabled={busy || !canImport || !profile.trim() || !text.trim()}
          onClick={() => extract(false)}
        >
          Extract pasted LinkedIn profile
        </Button>
        <Button
          disabled={
            busy ||
            !canImport ||
            !isCloud ||
            !config?.configured ||
            !config?.enabled ||
            !profile.trim()
          }
          onClick={() => extract(true)}
        >
          Look up LinkedIn ID
        </Button>
        <Button
          disabled={
            busy ||
            !canImport ||
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
            {metadata.warnings && (
              <section aria-label="LinkedIn extraction warnings">
                <p>{metadata.completeness}</p>
                <ul>
                  {metadata.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
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
            <Field label="LinkedIn draft summary">
              <textarea
                aria-label="LinkedIn draft summary"
                value={draft.summary || ''}
                maxLength={10000}
                disabled={busy || !canImport}
                onChange={(e) => {
                  setDraft({ ...draft, summary: e.target.value });
                  setConfirmed(false);
                }}
              />
            </Field>
            {evidenceText && (
              <details>
                <summary>Export text for checking evidence</summary>
                <pre className="linkedin-export-text">{evidenceText}</pre>
              </details>
            )}
            <CvEvidenceReview
              label="LinkedIn"
              value={draft.cvEvidence}
              disabled={busy || !canImport}
              onChange={(value) => {
                setDraft({ ...draft, cvEvidence: value });
                setConfirmed(false);
              }}
            />
            {!evidenceReady(draft.cvEvidence) && (
              <p role="status">Review or remove each LinkedIn evidence excerpt before saving.</p>
            )}
            <p>
              A name and email or phone are required. Unknown experience, availability and
              compensation are left blank. The normal candidate save assigns the Anthro-ID.
            </p>
            <label>
              <input
                aria-label="Confirm LinkedIn profile review"
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{' '}
              I reviewed the identity, contact and profile details.
            </label>
            <Button
              disabled={busy || !canImport || !confirmed || !evidenceReady(draft.cvEvidence)}
              onClick={save}
            >
              Save reviewed LinkedIn candidate
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
