import React, { useEffect, useRef, useState } from 'react';
import './linkedinImport.css';
import { cloud, getRole, getSupabase } from './repository.js';
import { Button, Field } from './ui.jsx';
import {
  Copy,
  ClipboardPaste,
  ArrowRight,
  RefreshCw,
  LogOut,
  Settings2,
  FileText,
  Search,
} from 'lucide-react';
import { DisclosureSection } from './DisclosureSection.jsx';
import { duplicate, skillList, today, uid, validateCandidate } from './domain.js';
import { candidateLabel } from './anthroId.js';
import { linkedinProfile, linkedinLookup, pastedLinkedinDraft } from './linkedin.js';
import { readLinkedinExport, localLinkedinDraft } from './linkedinFile.js';
import { linkedinCommand, latestExtractorManifest } from './linkedinCommand.js';
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
  readManifest = latestExtractorManifest,
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
  const [step, setStep] = useState(1);
  const [otherOpen, setOtherOpen] = useState(false);
  const focusReview = useRef(false);
  const reviewStart = useRef(null);
  useEffect(() => {
    if (step === 3 && draft && focusReview.current) {
      focusReview.current = false;
      reviewStart.current?.focus();
    }
  }, [step, draft]);
  const candidateId = useRef(null);
  const [commandNotice, setCommandNotice] = useState('');
  const [command, setCommand] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true);
  const [commandBusy, setCommandBusy] = useState(false);
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
    focusReview.current = true;
    setOtherOpen(false);
    setStep(3);
  }
  const [evidenceText, setEvidenceText] = useState('');
  async function copyCommand(mode = 'extract') {
    if (!canImport || commandBusy) return;
    setCommandNotice('');
    setCommand('');
    setCommandBusy(true);
    const current = generation.current;
    try {
      const release = isCloud ? await readManifest() : extractorManifest;
      if (generation.current !== current) return;
      const value = linkedinCommand(
        profile,
        release.archiveSha256,
        mode === 'forget' ? 'forget' : rememberLogin ? 'session' : 'once',
      );
      setCommand(value);
      try {
        await writeClipboard(value);
        if (generation.current !== current) return;
        setCommandNotice(
          `Current release ${release.archiveSha256.slice(0, 12)} copied. Open PowerShell, paste it and press Enter.`,
        );
      } catch {
        setCommandNotice(
          'Clipboard access was unavailable. Select and copy the displayed command manually.',
        );
      }
    } catch (failure) {
      if (generation.current === current) setCommandNotice(failure.message);
    } finally {
      setCommandBusy(false);
    }
  }
  async function copyHelperInput(kind) {
    if (!canImport) return;
    try {
      await writeClipboard(kind === 'refresh' ? 'refresh' : `${linkedinProfile(profile)}/`);
      setCommandNotice('Copied. Paste into the already-open helper window and press Enter.');
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
    <section className="linkedin-guided" aria-label="LinkedIn import guide">
      <p className="import-intro">
        Open the helper, bring back its result, then review the candidate. Your LinkedIn login stays
        on your computer.
      </p>
      {!canImport && (
        <p role="status">Candidate import requires an administrator or recruiter role.</p>
      )}
      <div className="disclosure-stack linkedin-steps">
        <DisclosureSection
          title="Step 1 · Open the helper"
          description="Enter a profile URL and copy the command"
          number={1}
          open={step === 1}
          onToggle={(open) => setStep(open ? 1 : 0)}
        >
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
          <p className="linkedin-step-instruction">
            Paste the command into PowerShell. Sign in in the opened browser, then press Enter in
            PowerShell.
          </p>
          <label className="linkedin-remember">
            <input
              type="checkbox"
              checked={rememberLogin}
              disabled={!canImport || commandBusy}
              onChange={(event) => {
                setRememberLogin(event.target.checked);
                setCommand('');
                setCommandNotice('');
              }}
            />
            Remember LinkedIn login locally for up to 24 hours
          </label>
          <Button
            icon={Copy}
            disabled={busy || commandBusy || !canImport}
            onClick={() => copyCommand()}
          >
            {commandBusy ? 'Preparing command…' : 'Copy extraction command'}
          </Button>
          {commandNotice && (
            <p className="linkedin-feedback" role="status">
              {commandNotice}
            </p>
          )}
          {command && (
            <details
              className="linkedin-command-details"
              open={commandNotice.startsWith('Clipboard access') || undefined}
            >
              <summary>View or manually copy the command</summary>
              <textarea
                aria-label="LinkedIn extraction command"
                className="linkedin-command-text"
                value={command}
                readOnly
              />
            </details>
          )}
          <details className="linkedin-helper-existing">
            <summary>Helper already open? Import another profile</summary>
            <p>
              Copy this profile URL, paste it at the helper’s “Next profile URL” prompt, and press
              Enter.
            </p>
            <Button
              variant="secondary"
              icon={Copy}
              disabled={busy || !canImport}
              onClick={() => copyHelperInput('profile')}
            >
              Copy profile URL for open helper
            </Button>
          </details>
          <Button variant="secondary" icon={ArrowRight} onClick={() => setStep(2)}>
            Continue to import result
          </Button>
          <DisclosureSection
            title="Manage login and setup"
            description="Refresh, forget or read setup requirements"
            icon={Settings2}
          >
            <p>
              Type refresh in the open helper to sign in again, revoke to remove its local login, or
              quit to close it while retaining login within the 24-hour window.
            </p>
            <div className="linkedin-command-actions">
              <Button
                variant="secondary"
                icon={RefreshCw}
                disabled={busy || !canImport}
                onClick={() => copyHelperInput('refresh')}
              >
                Copy refresh login instruction
              </Button>
              <Button
                variant="secondary"
                icon={LogOut}
                disabled={busy || commandBusy || !canImport}
                onClick={() => copyCommand('forget')}
              >
                Copy forget-login command
              </Button>
            </div>
            <p>
              Close the helper before running the forget-login command. This removes the helper’s
              local login; it does not sign out other browsers or remove saved JSON files.
            </p>
            <details>
              <summary>Requirements and login privacy</summary>
              <p>
                Requires{' '}
                <a
                  href="https://www.python.org/downloads/windows/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Python 3.10 or newer
                </a>{' '}
                on Windows. First run installs Playwright and uses installed Edge or Chrome.
                Chromium is downloaded if neither is found. No extension or administrator access is
                needed.
              </p>
              <p>
                Remembered mode uses a dedicated browser profile and never reads your regular
                browser’s cookies. The fixed 24-hour limit is checked before imports and on restart;
                expired data is removed on the next use. LinkedIn may require login sooner. Uncheck
                remembered mode for a temporary login. The portal cannot inspect your local login or
                extract until you start the helper.
              </p>
            </details>
          </DisclosureSection>
        </DisclosureSection>
        <DisclosureSection
          title="Step 2 · Bring back the result"
          description="Paste the extracted profile or choose its saved JSON file"
          number={2}
          open={step === 2}
          onToggle={(open) => setStep(open ? 2 : 0)}
        >
          <p className="linkedin-step-instruction">
            Wait until PowerShell says “Ready.” Then click below to load the copied profile for
            review.
          </p>
          <Button icon={ClipboardPaste} disabled={busy || !canImport} onClick={pasteExport}>
            {busy ? 'Reading profile…' : 'Paste extracted profile'}
          </Button>
          <p className="muted">
            Nothing is saved yet. Contact details and extracted information are reviewed in Step 3.
          </p>
          <details className="linkedin-file-alternative">
            <summary>Choose a saved JSON file instead</summary>
            <section aria-label="Import local LinkedIn export" className="linkedin-export-import">
              <h3>Import a local LinkedIn export</h3>
              <p>
                Sign in to LinkedIn in the local extractor’s browser, then choose its JSON file
                here. No cookie copying is needed. Your LinkedIn login stays on your computer.
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
                    Choose the exported JSON below. Review warnings and evidence, add a known
                    contact, then save.
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
                One profile per file · maximum 200 KiB. An entered profile URL must match the
                export.
              </p>
            </section>
          </details>
          <Button variant="ghost" onClick={() => setStep(1)}>
            Back to helper setup
          </Button>
        </DisclosureSection>
        <DisclosureSection
          title="Step 3 · Review and save"
          description={draft ? 'Your draft is ready to check' : 'A profile result is needed first'}
          number={3}
          open={step === 3}
          onToggle={(open) => setStep(open ? 3 : 0)}
        >
          {!draft && (
            <div className="linkedin-review-empty">
              <FileText size={28} aria-hidden="true" />
              <p>
                Import a result in Step 2 to review identity, contact details and evidence here.
              </p>
              <Button variant="secondary" onClick={() => setStep(2)}>
                Go to import result
              </Button>
            </div>
          )}
          {draft && (
            <>
              <h3 ref={reviewStart} tabIndex={-1}>
                Check candidate details
              </h3>
              <p role="status">
                Draft from {metadata.provider}
                {metadata.likelihood != null
                  ? `; provider match score ${metadata.likelihood}/10`
                  : ''}
                . Contact and skill details may be missing or outdated.
              </p>
              {metadata.warnings?.length > 0 && (
                <details aria-label="LinkedIn extraction warnings">
                  <summary>Extraction notes ({metadata.warnings.length})</summary>
                  <p>{metadata.completeness}</p>
                  <ul>
                    {metadata.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="linkedin-review-fields">
                {['name', 'email', 'phone', 'title', 'company', 'location', 'skills'].map((key) => (
                  <Field
                    label={
                      {
                        name: 'Full name',
                        email: 'Email',
                        phone: 'Phone',
                        title: 'Headline / role',
                        company: 'Company',
                        location: 'Location',
                        skills: 'Skills',
                      }[key]
                    }
                    key={key}
                  >
                    <input
                      aria-label={`LinkedIn draft ${key}`}
                      value={draft[key] || ''}
                      maxLength={key === 'skills' ? 4000 : 254}
                      disabled={busy || !canImport}
                      onChange={(e) => {
                        setDraft({ ...draft, [key]: e.target.value });
                        setConfirmed(false);
                      }}
                    />
                  </Field>
                ))}
              </div>
              <Field label="Profile summary">
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
        </DisclosureSection>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="linkedin-other-methods">
        <DisclosureSection
          title="Other import methods"
          description="Paste profile text or use a configured provider"
          icon={Search}
          open={otherOpen}
          onToggle={setOtherOpen}
        >
          <p>Enter the profile URL or ID in Step 1 before using these methods.</p>
          <DisclosureSection
            title="Paste profile text"
            description="Use text you have copied from a profile"
            icon={FileText}
          >
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
          </DisclosureSection>
          <DisclosureSection
            title="Provider lookup"
            description="Optional workspace integrations and administrator controls"
            icon={Search}
          >
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
                The session option reads the profile page through a self-hosted worker signed in
                with a dedicated test LinkedIn account. It is not a LinkedIn-approved integration,
                may break or get that account restricted, and uses the same workspace limit of 20
                attempts per UTC day. Contact details are not returned; add an email or phone during
                review.
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
          </DisclosureSection>
        </DisclosureSection>
      </div>
    </section>
  );
}
