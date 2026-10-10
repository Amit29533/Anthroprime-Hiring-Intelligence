import { anthroIdFor } from './anthroId.js';
import { SkillBadge } from './SkillBadge.jsx';
import React, { useState } from 'react';
import { Plus, ShieldCheck, AlertTriangle, Clock, FileText } from 'lucide-react';
import { PanelHeading, Button, Field, Badge, Empty } from './ui.jsx';
import { uid } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import { PROFICIENCY_LEVELS } from './taxonomy.js';
import {
  EVIDENCE_TYPES,
  STALE_AFTER_DAYS,
  skillsForCandidate,
  skillInventory,
  unverifiedClaims,
  blankEvidence,
  validateEvidence,
  evidenceRow,
  derivePersonSkill,
} from './skills.js';

const confidenceTone = (n) => (n >= 70 ? 'green' : n >= 30 ? 'amber' : 'gray');

/**
 * Evidence-backed skills for one candidate (blueprint §6/§7). Evidence is only ever added —
 * the database revokes UPDATE and DELETE on it — so this panel has no edit or remove control by
 * design. Correcting the record means recording a better observation.
 */
export function SkillEvidencePanel({ candidate, data, onSave, notify, busy, role = getRole() }) {
  const readOnly = !canWriteForRole(role);
  const [adding, setAdding] = useState('');
  const [open, setOpen] = useState('');
  const rows = skillsForCandidate(data, candidate.id);

  return (
    <section className="profile-section">
      <h3>Evidence-backed skills</h3>
      <p className="supporting-text">
        Each claim carries its evidence and its age. Observations are only ever added — nothing here
        overwrites an assessment, so a proficiency can always be traced to what justified it.
      </p>
      {rows.length === 0 ? (
        <Empty
          title="No skills recorded yet"
          text="Skills appear here once they are added to the profile, each with the evidence behind it."
        />
      ) : (
        <ul className="skill-evidence-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="skill-evidence-head">
                <div>
                  <SkillBadge skill={row.name} />
                  {row.skill?.domain && <small className="skill-domain">{row.skill.domain}</small>}
                </div>
                <span className="skill-evidence-tags">
                  <Badge>{row.proficiency}</Badge>
                  <Badge tone={confidenceTone(row.confidence)}>{row.confidence}% confidence</Badge>
                  {row.validated ? (
                    <Badge tone="green">
                      <ShieldCheck size={12} /> Validated
                    </Badge>
                  ) : (
                    <Badge tone="gray">Unvalidated</Badge>
                  )}
                  {row.stale === true && (
                    <Badge tone="amber">
                      <AlertTriangle size={12} /> Stale
                    </Badge>
                  )}
                  {row.stale === null && <Badge tone="gray">No evidence</Badge>}
                </span>
              </div>
              <div className="skill-evidence-meta">
                <span>
                  <Clock size={12} />
                  {row.ageDays === null
                    ? 'Never evidenced'
                    : `Last evidenced ${row.ageDays} day${row.ageDays === 1 ? '' : 's'} ago`}
                </span>
                {row.years != null && <span>{row.years} yrs</span>}
                {row.lastUsed && <span>Last used {String(row.lastUsed).slice(0, 10)}</span>}
                <button
                  className="text-link"
                  onClick={() => setOpen(open === row.id ? '' : row.id)}
                >
                  {open === row.id
                    ? 'Hide'
                    : `${row.evidence.length} observation${row.evidence.length === 1 ? '' : 's'}`}
                </button>
                {!readOnly && (
                  <button
                    className="text-link"
                    onClick={() => setAdding(adding === row.id ? '' : row.id)}
                  >
                    {adding === row.id ? 'Cancel' : 'Add evidence'}
                  </button>
                )}
              </div>

              {open === row.id && (
                <ol className="evidence-timeline">
                  {row.evidence.length === 0 && (
                    <li>
                      <span>Nothing has been recorded for this claim yet.</span>
                    </li>
                  )}
                  {row.evidence.map((e) => (
                    <li key={e.id}>
                      <div>
                        <strong>{e.evidenceType}</strong> · {e.proficiency}
                        {e.assessor ? ` · ${e.assessor}` : ''}
                        <small>
                          {String(e.date || '').slice(0, 10)}
                          {e.years != null ? ` · ${e.years} yrs` : ''}
                          {e.evidenceRef ? ` · ${e.evidenceRef}` : ''}
                        </small>
                        {e.note && <small className="evidence-note">{e.note}</small>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {adding === row.id && (
                <EvidenceForm
                  personSkill={row}
                  onCancel={() => setAdding('')}
                  busy={busy}
                  onSave={async (form) => {
                    const record = evidenceRow(form, { id: uid() });
                    if (!(await onSave('skillEvidence', [record]))) return;
                    // Keep the derived view in step locally; the database trigger is
                    // authoritative and recomputes it the same way on the server.
                    const derived = derivePersonSkill(row, [record, ...row.evidence]);
                    await onSave('personSkills', [
                      {
                        id: row.id,
                        candidateId: row.candidateId,
                        skillId: row.skillId,
                        proficiency: derived.proficiency,
                        years: derived.years,
                        lastUsed: derived.lastUsed,
                        confidence: derived.confidence,
                        validated: derived.validated,
                        evidenceCount: derived.evidenceCount,
                        lastEvidence: derived.lastEvidence,
                        created: row.created,
                      },
                    ]);
                    setAdding('');
                    setOpen(row.id);
                    notify?.(`Evidence recorded for ${row.name}.`);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceForm({ personSkill, onCancel, onSave, busy }) {
  const [form, setForm] = useState(() => blankEvidence(personSkill.id, personSkill.proficiency));
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form
      className="evidence-form"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateEvidence(form);
        setErrors(found);
        if (Object.keys(found).length) return;
        onSave(form);
      }}
    >
      <div className="form-grid">
        <Field label="Evidence type" hint={errors.evidenceType}>
          <select
            aria-label="Evidence type"
            value={form.evidenceType}
            onChange={set('evidenceType')}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Proficiency demonstrated" hint={errors.proficiency}>
          <select
            aria-label="Proficiency demonstrated"
            value={form.proficiency}
            onChange={set('proficiency')}
          >
            {PROFICIENCY_LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Relevant years" hint={errors.years}>
          {/* No native min/max: the browser would block submission with its own tooltip and our
              explanation would never be shown. validateEvidence is the single authority. */}
          <input
            type="text"
            inputMode="decimal"
            value={form.years}
            onChange={set('years')}
            aria-invalid={!!errors.years}
          />
        </Field>
        <Field label="Last used">
          <input type="date" value={form.lastUsed} onChange={set('lastUsed')} />
        </Field>
        <Field label="Assessor" hint={errors.assessor}>
          <input
            value={form.assessor}
            onChange={set('assessor')}
            placeholder="Who verified this"
            aria-invalid={!!errors.assessor}
          />
        </Field>
        <Field label="Reference">
          <input
            value={form.evidenceRef}
            onChange={set('evidenceRef')}
            placeholder="Certificate ID, project, interview"
          />
        </Field>
        <Field label="Note" wide>
          <textarea rows={2} value={form.note} onChange={set('note')} />
        </Field>
      </div>
      <p className="careers-publish-hint">
        <FileText size={13} /> This is recorded as a new observation. Nothing already on file is
        changed or removed.
      </p>
      <div className="approval-actions">
        <Button type="submit" icon={Plus} disabled={busy}>
          Record evidence
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Workspace skill inventory and the unverified-claims queue (blueprint §17 and §10). */
export function SkillInventoryPanel({ data, onOpenCandidate }) {
  const inventory = skillInventory(data).filter((r) => r.people > 0);
  const queue = unverifiedClaims(data, { limit: 8 });

  return (
    <>
      <section className="panel">
        <PanelHeading
          title="Skill inventory"
          subtitle="What the bench can actually do, and how much of it is evidenced."
        />
        {inventory.length === 0 ? (
          <p className="supporting-text">No skills recorded in this workspace yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Domain</th>
                  <th>People</th>
                  <th>Validated</th>
                  <th>Stale</th>
                  <th>Avg confidence</th>
                </tr>
              </thead>
              <tbody>
                {inventory.slice(0, 20).map((r) => (
                  <tr key={r.skill.id}>
                    <td>
                      <SkillBadge skill={r.skill.name} />
                    </td>
                    <td>{r.skill.domain || '—'}</td>
                    <td>{r.people}</td>
                    <td>
                      {r.validated}
                      {r.validatedShare !== null && <small> ({r.validatedShare}%)</small>}
                    </td>
                    <td>{r.stale || '—'}</td>
                    <td>{r.averageConfidence === null ? 'No data' : `${r.averageConfidence}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <PanelHeading
          title="Claims needing a human"
          subtitle={`Unvalidated or older than ${STALE_AFTER_DAYS} days.`}
        />
        {queue.length === 0 ? (
          <p className="supporting-text">
            Every recorded skill is validated and current. Nothing needs checking.
          </p>
        ) : (
          <ul className="client-list">
            {queue.map((c) => (
              <li key={c.id}>
                <div>
                  <button className="text-link" onClick={() => onOpenCandidate?.(c.candidateId)}>
                    <strong>
                      {c.candidate?.name || 'Unknown'} · {c.name}
                      <small className="anthro-id">{anthroIdFor(c.candidate)}</small>
                    </strong>
                  </button>
                  <small>
                    {c.reason} · {c.proficiency} · {c.confidence}% confidence
                  </small>
                </div>
                <Badge tone={confidenceTone(c.confidence)}>{c.confidence}%</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
