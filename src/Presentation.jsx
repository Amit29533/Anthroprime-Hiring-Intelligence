import React, { useMemo, useState } from 'react';
import { Download, Copy, Printer, ShieldCheck, EyeOff } from 'lucide-react';
import { Modal, Button, Field, Badge, PanelHeading } from './ui.jsx';
import { getRole } from './repository.js';
import { downloadFile } from './Candidates.jsx';
import {
  DEFAULT_OPTIONS,
  DEFAULT_BRANDING,
  brandingFor,
  buildPresentation,
  presentationHtml,
  presentationText,
  presentationFilename,
  validateBranding,
} from './presentation.js';

const TOGGLES = [
  ['anonymise', 'Anonymise (initials only, hide current employer)'],
  ['showContact', 'Include contact details'],
  ['showCurrentEmployer', 'Include current employer'],
  ['showCompensation', 'Include expected compensation (admin only)'],
  ['showEmployment', 'Include employment history'],
  ['showAssessments', 'Include assessments'],
  ['showInterviews', 'Include interview outcomes'],
  ['showEvidence', 'Show skill evidence labels'],
];

/**
 * Client-ready candidate profile. The preview is the document — what is on screen is exactly
 * what downloads, so there is no gap between what a recruiter checked and what the client gets.
 */
export function PresentationModal({
  candidate,
  demand,
  data,
  onClose,
  audit,
  notify,
  role = getRole(),
  download = downloadFile,
}) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const isAdmin = role === 'admin';
  const doc = useMemo(
    () => buildPresentation(candidate, demand, data, options, { isAdmin }),
    [candidate, demand, data, options, isAdmin],
  );
  const html = useMemo(() => presentationHtml(doc), [doc]);

  function record(action) {
    audit?.({
      entityType: 'candidates',
      entityId: candidate?.id,
      action,
      detail: `Client-ready profile ${doc.reference}${demand ? ` for ${demand.title}` : ''}${
        doc.withheld.length ? ` (withheld: ${doc.withheld.join(', ')})` : ''
      }`,
    });
  }

  if (doc.blocked)
    return (
      <Modal title="Client-ready profile" subtitle="Consent check" onClose={onClose}>
        <div className="modal-body">
          <p className="form-error">{doc.reason}</p>
          <p className="supporting-text">
            Record the candidate&rsquo;s profile-sharing consent on their profile first. This is not
            a formality — sending a profile without it is the breach, not the paperwork.
          </p>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );

  return (
    <Modal
      title={`Client-ready profile — ${doc.displayName}`}
      subtitle={`Ref ${doc.reference} · what you see is exactly what downloads`}
      onClose={onClose}
      wide
    >
      <div className="modal-body presentation-body">
        <div className="presentation-options">
          {TOGGLES.map(([key, label]) => {
            const locked = key === 'showCompensation' && !isAdmin;
            return (
              <label key={key} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!options[key]}
                  disabled={locked}
                  onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                />
                {label}
                {locked && <Badge tone="gray">Admin</Badge>}
              </label>
            );
          })}
          <p className="careers-publish-hint">
            <ShieldCheck size={13} /> {doc.consent.label}.
            {doc.withheld.length > 0 && (
              <>
                {' '}
                <EyeOff size={13} /> Withheld: {doc.withheld.join(', ')}.
              </>
            )}
          </p>
        </div>

        <iframe
          className="presentation-preview"
          title="Client-ready profile preview"
          srcDoc={html}
          sandbox=""
        />
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="secondary"
          icon={Copy}
          onClick={async () => {
            try {
              await navigator.clipboard?.writeText(presentationText(doc));
              record('exported');
              notify?.('Plain-text profile copied.');
            } catch {
              notify?.('Clipboard is unavailable in this browser.');
            }
          }}
        >
          Copy as text
        </Button>
        <Button
          variant="secondary"
          icon={Printer}
          onClick={() => {
            const w = window.open('', '_blank');
            if (!w) return notify?.('Allow pop-ups to print this profile.');
            w.document.write(html);
            w.document.close();
            w.focus();
            w.print();
            record('exported');
          }}
        >
          Print / PDF
        </Button>
        <Button
          icon={Download}
          onClick={() => {
            download(html, presentationFilename(doc), 'text/html;charset=utf-8');
            record('exported');
            notify?.('Client-ready profile downloaded.');
          }}
        >
          Download
        </Button>
      </div>
    </Modal>
  );
}

/** Agency branding for every client-facing document. */
export function BrandingPanel({ data, onSave, notify, busy, role = getRole() }) {
  const saved = brandingFor(data);
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState({});
  const isAdmin = role === 'admin';
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const found = validateBranding(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const existing = (data.settings || []).find((r) => r.id === 'workspace');
    const row = {
      ...(existing || { id: 'workspace' }),
      custom: { ...(existing?.custom || {}), branding: { ...DEFAULT_BRANDING, ...form } },
    };
    if (!(await onSave('settings', [row]))) return;
    notify?.('Branding updated. New client documents will use it.');
  }

  return (
    <section className="panel">
      <PanelHeading
        title="Client document branding"
        subtitle="Applied to every client-ready candidate profile."
      />
      <form className="settings-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Agency name" hint={errors.agencyName}>
            <input
              value={form.agencyName}
              onChange={set('agencyName')}
              disabled={!isAdmin}
              aria-invalid={!!errors.agencyName}
            />
          </Field>
          <Field label="Tagline">
            <input value={form.tagline} onChange={set('tagline')} disabled={!isAdmin} />
          </Field>
          <Field label="Accent colour" hint={errors.accent}>
            <input
              value={form.accent}
              onChange={set('accent')}
              disabled={!isAdmin}
              placeholder="#1f6f5c"
              aria-invalid={!!errors.accent}
            />
          </Field>
          <Field label="Contact line">
            <input
              value={form.contactLine}
              onChange={set('contactLine')}
              disabled={!isAdmin}
              placeholder="hello@agency.example · +91 80 1234 5678"
            />
          </Field>
          <Field label="Confidentiality footer" wide>
            <textarea rows={2} value={form.footer} onChange={set('footer')} disabled={!isAdmin} />
          </Field>
        </div>
        {isAdmin ? (
          <div className="approval-actions">
            <Button type="submit" disabled={busy}>
              Save branding
            </Button>
          </div>
        ) : (
          <p className="supporting-text">
            Only an administrator can change client-facing branding.
          </p>
        )}
      </form>
    </section>
  );
}
