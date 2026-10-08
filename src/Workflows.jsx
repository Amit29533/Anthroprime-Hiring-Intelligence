import ProcessingRecovery from './ProcessingRecovery.jsx';
import DeliverySandbox from './DeliverySandbox.jsx';
import { DuplicateReview } from './DuplicateReview.jsx';
import { candidateLabel, anthroIdFor } from './anthroId.js';
import { LifecycleAnalytics } from './LifecycleAnalytics.jsx';
import { DocumentReputation } from './DocumentReputation.jsx';
import { DocumentReviewQueue } from './DocumentReviewQueue.jsx';
import { DocumentAccessAudit } from './DocumentAccessAudit.jsx';
import { CandidateExportAudit } from './CandidateExportAudit.jsx';
import { SubjectRequests } from './SubjectRequests.jsx';
import { MfaPanel } from './MfaPanel.jsx';
import { InterviewReminders } from './InterviewReminders.jsx';
import { FreshnessReviews } from './FreshnessReviews.jsx';
import { SavedImports } from './SavedImports.jsx';
import { CustomFieldsPanel } from './CustomFields.jsx';
import { ExecutionJobsPanel } from './ExecutionJobs.jsx';
import { OperationsConsole } from './OperationsConsole.jsx';
import { IntegrationsPanel, ExternalMappingsPanel } from './Integrations.jsx';
import MachineCredentials from './MachineCredentials.jsx';
import { IntelligenceSettings, IndexHealthPanel } from './HostedIntelligence.jsx';
import React, { useState, useMemo } from 'react';
import {
  Plus,
  Download,
  Check,
  CheckCircle2,
  ArrowRight,
  Users,
  Layers,
  Database,
  Cloud,
  ClipboardCheck,
  Clock,
  TrendingUp,
  LogOut,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import {
  PageHeader,
  Button,
  Field,
  Modal,
  Badge,
  Empty,
  PersonName,
  PanelHeading,
  Stat,
} from './ui.jsx';
import { Members } from './Members.jsx';
import { DepartmentsPanel, CareersSeoPanel } from './Requisitions.jsx';
import { BrandingPanel } from './Presentation.jsx';
import { AssignmentPanel } from './Assignment.jsx';
import { SkillInventoryPanel } from './Skills.jsx';
import {
  uid,
  today,
  freshness,
  STAGES,
  matchCandidate,
  stageLabel,
  stageLabelsMap,
} from './domain.js';
import { qualityQueues, retentionDue, anonymizeCandidate } from './quality.js';
import { deriveGaps } from './gaps.js';
import { duplicatePairs, mergePreview, MERGE_FIELDS, mergeCandidateRecords } from './dedupe.js';
import { setCustomTaxonomy, allSkills } from './taxonomy.js';
import { AssessmentTemplatePanel } from './AssessmentTemplates.jsx';
import { StaticPools } from './StaticPools.jsx';
import { assessmentTemplateFields, rubricScore } from './assessmentTemplates.js';
import {
  timeToReady,
  sourceConversion,
  rediscoveryRate,
  demandCoverage,
  upliftConversion,
  clientFunnel,
  usableProfiles,
  interviewAnalytics,
} from './analytics.js';
import { thresholdFor, DEFAULT_CRITERIA, templatesFor } from './feedback.js';
import { changesSince } from './sync.js';
import { exportSensitiveFile } from './downloads.js';
import { exportCandidateData } from './candidateExports.js';
import {
  cloud,
  getSupabase,
  getRole,
  getWorkspaceId,
  canWriteForRole,
  resetDemo,
} from './repository.js';
import { backupBundle, parseBackup, restoreBackupRows } from './backup.js';
import { TRIGGERS, TRIGGER_VALUES, describeRule, describeActions } from './automation.js';
import { documentTemplatesFor, MERGE_FIELD_CATALOG } from './templates.js';

export { ImportModal } from './ImportCandidates.jsx';
export { Login } from './Login.jsx';

export function AssessmentForm({ data, candidateId, onSave, onClose, busy }) {
  const [templateId, setTemplateId] = useState(''),
    [rubricScores, setRubricScores] = useState({}),
    [error, setError] = useState('');
  const templates = (data.assessmentTemplates || []).filter((row) => !row.archived);
  const template = templates.find((row) => row.id === templateId);
  const computedScore = template ? rubricScore(template.rubric, rubricScores) : null;
  const [form, setForm] = useState({
    candidateId: candidateId || data.candidates[0]?.id || '',
    demandId: '',
    skill: '',
    title: 'Technical readiness review',
    score: 80,
    assessor: '',
    date: today(),
    evidence: '',
    gap: '',
  });
  async function submit(e) {
    e.preventDefault();
    setError('');
    let templateFields = {};
    try {
      if (templateId && !template)
        throw new Error('This template is no longer available. Choose another template.');
      if (template) templateFields = assessmentTemplateFields(template, rubricScores, form.date);
    } catch (problem) {
      setError(problem.message);
      return;
    }
    if (
      await onSave('assessments', [
        {
          ...form,
          ...templateFields,
          id: uid(),
          demandId: form.demandId || null,
          skill: form.skill || null,
        },
      ])
    )
      onClose();
  }
  return (
    <Modal
      title="Record an assessment"
      subtitle="Keep the evidence. Make readiness explainable."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field
            label="Assessment template"
            hint="Choose a reusable rubric or record a standalone assessment."
            wide
          >
            <select
              value={templateId}
              onChange={(e) => {
                const next = templates.find((row) => row.id === e.target.value);
                setTemplateId(e.target.value);
                setRubricScores({});
                setError('');
                if (next) setForm({ ...form, title: next.name });
              }}
            >
              <option value="">Standalone assessment</option>
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} · v{row.version}
                </option>
              ))}
            </select>
          </Field>
          {template && (
            <div className="rubric-evaluation wide">
              <p>{template.description}</p>
              {template.rubric.map((criterion) => (
                <Field
                  key={criterion.id}
                  label={`${criterion.label} (0–${criterion.maxScore})`}
                  hint={`${criterion.weight}% of the total score`}
                >
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    max={criterion.maxScore}
                    value={rubricScores[criterion.id] ?? ''}
                    onChange={(e) =>
                      setRubricScores({ ...rubricScores, [criterion.id]: e.target.value })
                    }
                  />
                </Field>
              ))}
              <strong>
                Weighted score:{' '}
                {computedScore === null ? 'Score all criteria' : `${computedScore}/100`}
              </strong>
              <small>Valid for {template.validityDays} days from the assessment date.</small>
            </div>
          )}
          <Field label="Candidate *" wide>
            <select
              required
              value={form.candidateId}
              onChange={(e) => setForm({ ...form, candidateId: e.target.value })}
            >
              {!data.candidates.length && <option value="">Add a candidate first</option>}
              {data.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {candidateLabel(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Demand (optional)" wide>
            <select
              value={form.demandId}
              onChange={(e) => setForm({ ...form, demandId: e.target.value })}
            >
              <option value="">General readiness</option>
              {data.demands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assessment title *" wide>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          {!template && (
            <Field label="Score (0–100) *">
              <input
                required
                type="number"
                min="0"
                max="100"
                value={form.score}
                onChange={(e) => setForm({ ...form, score: Number(e.target.value) })}
              />
            </Field>
          )}
          <Field label="Assessment date *">
            <input
              required
              type="date"
              max={today()}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label="Assessor *" wide>
            <input
              required
              value={form.assessor}
              onChange={(e) => setForm({ ...form, assessor: e.target.value })}
            />
          </Field>
          <Field label="Evidence & observations *" wide>
            <textarea
              required
              rows={4}
              value={form.evidence}
              onChange={(e) => setForm({ ...form, evidence: e.target.value })}
              placeholder="What was evaluated? Include observed strengths and evidence references."
            />
          </Field>
          <Field label="Skill addressed (optional)">
            <select
              value={form.skill}
              onChange={(e) => setForm({ ...form, skill: e.target.value })}
            >
              <option value="">General readiness</option>
              {(data.candidates.find((c) => c.id === form.candidateId)?.skills || []).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Skill gaps / recommended next steps" wide>
            <textarea
              rows={3}
              value={form.gap}
              onChange={(e) => setForm({ ...form, gap: e.target.value })}
            />
          </Field>
          <p className="supporting-text wide">
            Assessment scores update matching. Recruiters confirm profile readiness separately;
            earlier assessments remain in history.
          </p>
          {error && (
            <p className="form-error wide" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !form.candidateId}>
            Save assessment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function EnrichmentForm({ data, onSave, onClose, busy, preset }) {
  const [form, setForm] = useState({
    candidateId: preset?.candidateId || data.candidates[0]?.id || '',
    demandId: preset?.demandId || '',
    gapSkill: preset?.gapSkill || '',
    title: preset?.gapSkill ? `${preset.gapSkill} readiness plan` : '',
    description: '',
    due: '',
    owner: '',
    status: 'Planned',
  });
  const skillOptions = form.candidateId
    ? data.candidates.find((c) => c.id === form.candidateId)?.skills || []
    : [];
  return (
    <Modal
      title="Create an enrichment plan"
      subtitle="Turn a skill gap into a clear next step."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave('enrichment', [
              { ...form, id: uid(), demandId: form.demandId || null, created: today() },
            ])
          )
            onClose();
        }}
      >
        <div className="modal-body form-grid">
          <Field label="Candidate *" wide>
            <select
              required
              value={form.candidateId}
              onChange={(e) =>
                setForm({ ...form, candidateId: e.target.value, gapSkill: '', title: '' })
              }
            >
              {!form.candidateId && <option value="">Add a candidate first</option>}
              {data.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {candidateLabel(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Demand (optional)">
            <select
              value={form.demandId}
              onChange={(e) => setForm({ ...form, demandId: e.target.value })}
            >
              <option value="">Not demand-specific</option>
              {data.demands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Skill to close (optional)">
            <select
              value={form.gapSkill}
              onChange={(e) =>
                setForm({
                  ...form,
                  gapSkill: e.target.value,
                  title: e.target.value ? `${e.target.value} readiness plan` : form.title,
                })
              }
            >
              <option value="">General development</option>
              {skillOptions.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Learning action *" wide>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Expected evidence *" wide>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Owner *">
            <input
              required
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
            />
          </Field>
          <Field label="Due date *">
            <input
              type="date"
              required
              value={form.due}
              onChange={(e) => setForm({ ...form, due: e.target.value })}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !form.candidateId}>
            Create plan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function Assessments({ data, onNew, onEnrich, onOpen, onSave, busy }) {
  const viewer = cloud && !canWriteForRole(getRole());
  const [tab, setTab] = useState('Assessments');
  return (
    <>
      <PageHeader
        eyebrow="ASSESS · ENRICH · VALIDATE"
        title="Build confidence in every candidate."
        description="Capture evidence, close skill gaps and create deployment-ready talent."
      >
        {!viewer && (
          <>
            <Button variant="secondary" icon={Plus} onClick={onEnrich}>
              Enrichment plan
            </Button>
            <Button icon={Plus} onClick={() => onNew()}>
              Record assessment
            </Button>
          </>
        )}
      </PageHeader>
      <div className="repository-tabs">
        {['Assessments', 'Enrichment plans', 'Templates'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            <span>
              {t === 'Assessments'
                ? data.assessments.length
                : t === 'Templates'
                  ? (data.assessmentTemplates || []).filter((row) => !row.archived).length
                  : data.enrichment.length}
            </span>
          </button>
        ))}
      </div>
      <section className="panel">
        {tab === 'Templates' ? (
          <AssessmentTemplatePanel data={data} onSave={onSave} busy={busy} />
        ) : tab === 'Assessments' ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Assessment</th>
                  <th>Score</th>
                  <th>Assessor</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {[...data.assessments]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((a) => {
                    const c = data.candidates.find((c) => c.id === a.candidateId);
                    return c ? (
                      <tr key={a.id}>
                        <td>
                          <PersonName person={c} onClick={() => onOpen(c.id)} />
                        </td>
                        <td>
                          {a.title}
                          {a.templateSnapshot && (
                            <small className="block">
                              {a.templateSnapshot.name} · v{a.templateSnapshot.version} ·{' '}
                              {a.validUntil < today() ? 'Expired' : 'Valid until'} {a.validUntil}
                            </small>
                          )}
                          {a.gap && <small className="block text-amber">Gap identified</small>}
                        </td>
                        <td>
                          <Badge tone={a.score >= 80 ? 'green' : 'amber'}>{a.score}/100</Badge>
                        </td>
                        <td>{a.assessor}</td>
                        <td>{a.date}</td>
                      </tr>
                    ) : null;
                  })}
              </tbody>
            </table>
            {!data.assessments.length && (
              <Empty title="Start with evidence" text="Record your first candidate assessment." />
            )}
          </div>
        ) : (
          <div className="enrichment-list">
            {data.enrichment.map((a) => {
              const c = data.candidates.find((c) => c.id === a.candidateId);
              return (
                <article className="enrichment-card" key={a.id}>
                  <div className="enrichment-icon">
                    <Layers size={22} />
                  </div>
                  <div>
                    <h3>{a.title}</h3>
                    <button className="inline-link" onClick={() => onOpen(c?.id)}>
                      {c ? candidateLabel(c) : 'Unknown candidate'}
                    </button>
                    <p>{a.description}</p>
                    <small>
                      {a.owner} · Due {a.due}
                    </small>
                  </div>
                  <select
                    aria-label={`Enrichment status for ${a.title}`}
                    disabled={busy || viewer}
                    value={a.status}
                    onChange={(e) => onSave('enrichment', [{ ...a, status: e.target.value }])}
                  >
                    {['Planned', 'In progress', 'Complete', 'Validated'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </article>
              );
            })}
            {!data.enrichment.length && (
              <Empty
                title="Turn a gap into growth"
                text="Create an enrichment plan with a learning action and due date."
              />
            )}
          </div>
        )}
      </section>
    </>
  );
}
export function Activities({ data, onOpen, onSave, busy, notify, audit }) {
  const viewer = cloud && !canWriteForRole(getRole());
  const [mode, setMode] = useState('Upcoming');
  const [taskForm, setTaskForm] = useState({ title: '', due: '', candidateId: '', demandId: '' });
  const rows = data.notes
    .filter((n) =>
      mode === 'All notes' || mode === 'Completed'
        ? mode === 'All notes' || n.completed
        : n.followUp && !n.completed,
    )
    .sort((a, b) => (a.followUp || '9999').localeCompare(b.followUp || '9999'));
  const tasks = [...data.tasks].sort(
    (a, b) =>
      (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.due || '9999').localeCompare(b.due || '9999'),
  );
  async function addTask(e) {
    e.preventDefault();
    if (!taskForm.title.trim() || busy) return;
    if (
      await onSave('tasks', [
        {
          id: uid(),
          title: taskForm.title.trim(),
          due: taskForm.due || null,
          done: false,
          owner: '',
          candidateId: taskForm.candidateId || null,
          demandId: taskForm.demandId || null,
          created: today(),
        },
      ])
    )
      setTaskForm({ title: '', due: '', candidateId: '', demandId: '' });
  }
  async function toggleTask(t) {
    if (!busy) await onSave('tasks', [{ ...t, done: !t.done }]);
  }
  const [appTab, setAppTab] = useState('pending');
  const apps = data.publicApplications
    .filter((a) => appTab === 'all' || a.status === appTab)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  async function reviewApp(a, decision) {
    if (decision === 'accepted') {
      const candidate = {
        id: uid(),
        name: a.name,
        email: a.email,
        phone: a.phone,
        title: 'Candidate (careers application)',
        company: '',
        location: 'Not stated',
        experience: null,
        relevantExperience: null,
        notice: null,
        current: null,
        expected: null,
        skills: [],
        skillsDetail: [],
        status: 'Assessing',
        mode: 'Flexible',
        source: a.source || 'Career page',
        summary: a.message
          ? `Applied via the careers page: ${a.message}`
          : 'Applied via the careers page.',
        linkedin: a.linkedin,
        verified: today(),
        created: today(),
        owner: '',
        tags: ['Careers'],
        custom: {},
        timezone: '',
        preferredLocations: '',
        nextAction: 'Review application',
        externalId: '',
      };
      const consents = [];
      if (a.consentContact)
        consents.push({
          id: uid(),
          candidateId: candidate.id,
          purpose: 'recruiting-contact',
          status: 'granted',
          noticeVersion: 'v1.1',
          source: 'Careers page application',
          note: 'Ticked on the public application form',
          date: new Date().toISOString(),
        });
      if (a.consentSharing)
        consents.push({
          id: uid(),
          candidateId: candidate.id,
          purpose: 'profile-sharing',
          status: 'granted',
          noticeVersion: 'v1.1',
          source: 'Careers page application',
          note: 'Ticked on the public application form',
          date: new Date().toISOString(),
        });
      if (!(await onSave('candidates', [candidate]))) return;
      if (consents.length) await onSave('consents', consents);
      await onSave('notes', [
        {
          id: uid(),
          candidateId: candidate.id,
          text: `Applied via the careers page${a.demandId ? ' for a specific role' : ''}. Message: ${a.message || '(none)'}`,
          date: today(),
          followUp: null,
          completed: false,
          author: '',
          channel: 'Note',
        },
      ]);
      audit &&
        audit({
          entityType: 'candidate',
          entityId: candidate.id,
          action: 'created',
          detail: `Accepted careers application from ${a.name}`,
        });
      notify && notify(`${a.name} added to the repository with recorded consents.`);
    }
    if (await onSave('publicApplications', [{ ...a, status: decision }])) {
      notify &&
        notify(decision === 'accepted' ? 'Application accepted.' : 'Application dismissed.');
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="KEEP THE RELATIONSHIP WARM"
        title="Every conversation counts."
        description="Your notes, next steps and candidate follow-ups in one place."
      />
      <div className="repository-tabs">
        {['Upcoming', 'Completed', 'All notes'].map((s) => (
          <button key={s} className={mode === s ? 'active' : ''} onClick={() => setMode(s)}>
            {s}
          </button>
        ))}
      </div>
      <section className="panel activities-list">
        {rows.map((n) => {
          const c = data.candidates.find((c) => c.id === n.candidateId);
          if (!c) return null;
          return (
            <article key={n.id}>
              <div className="activity-date">
                <Clock size={18} />
                <strong>{n.followUp || n.date}</strong>
                <Badge tone={n.completed ? 'green' : n.followUp <= today() ? 'amber' : 'gray'}>
                  {n.completed ? 'Done' : n.followUp <= today() ? 'Due' : 'Upcoming'}
                </Badge>
              </div>
              <div className="activity-content">
                <PersonName person={c} onClick={() => onOpen(c.id)} />
                <p>{n.text}</p>
                <small>
                  {n.author} · Added {n.date}
                </small>
              </div>
              {n.followUp && !n.completed && !viewer && (
                <Button
                  disabled={busy}
                  variant="secondary"
                  icon={Check}
                  onClick={() => onSave('notes', [{ ...n, completed: true }])}
                >
                  Mark done
                </Button>
              )}
            </article>
          );
        })}
        {!rows.length && (
          <Empty
            title="You're all caught up"
            text="Add a note and follow-up date from any candidate profile."
          />
        )}
      </section>
      <section className="panel task-panel">
        <PanelHeading
          title="Tasks"
          subtitle="The working checklist across candidates and demands - interview prep, documents, offer letters"
        />
        {!viewer && (
          <form className="task-add" onSubmit={addTask}>
            <input
              required
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              placeholder="Add a task, e.g. Collect documents from Ishaan"
            />
            <input
              type="date"
              aria-label="Due date"
              value={taskForm.due}
              onChange={(e) => setTaskForm({ ...taskForm, due: e.target.value })}
            />
            <select
              aria-label="Task candidate"
              value={taskForm.candidateId}
              onChange={(e) => setTaskForm({ ...taskForm, candidateId: e.target.value })}
            >
              <option value="">No candidate</option>
              {data.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {candidateLabel(c)}
                </option>
              ))}
            </select>
            <select
              aria-label="Task demand"
              value={taskForm.demandId}
              onChange={(e) => setTaskForm({ ...taskForm, demandId: e.target.value })}
            >
              <option value="">No demand</option>
              {data.demands
                .filter((d) => d.status === 'Open')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </select>
            <Button className="small" icon={Plus} disabled={busy}>
              Add task
            </Button>
          </form>
        )}
        <div className="task-list">
          {tasks.map((t) => {
            const c = t.candidateId && data.candidates.find((x) => x.id === t.candidateId),
              d = t.demandId && data.demands.find((x) => x.id === t.demandId);
            return (
              <div className={`task-row ${t.done ? 'done' : ''}`} key={t.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={busy || viewer}
                    onChange={() => toggleTask(t)}
                  />
                  <span>{t.title}</span>
                </label>
                <div className="task-meta">
                  {c && (
                    <button className="text-link" onClick={() => onOpen(c.id)}>
                      {candidateLabel(c)}
                    </button>
                  )}
                  {d && <small>{d.title}</small>}
                  {t.due && (
                    <Badge tone={t.done ? 'gray' : t.due < today() ? 'red' : 'amber'}>
                      {t.done ? 'Closed' : t.due < today() ? `Overdue ${t.due}` : `Due ${t.due}`}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
          {!tasks.length && (
            <Empty
              title="No tasks yet"
              text="Add the first task above - prep, paperwork, call-backs."
            />
          )}
        </div>
      </section>
      <section className="panel task-panel">
        <PanelHeading
          title="Career applications"
          subtitle="Applications from the public careers page - accepting creates the profile and records the applicant's consent choices"
          action={
            <div className="repository-tabs" style={{ margin: 0, border: 0 }}>
              {[
                ['pending', 'Pending'],
                ['accepted', 'Accepted'],
                ['dismissed', 'Dismissed'],
                ['all', 'All'],
              ].map(([k, l]) => (
                <button
                  key={k}
                  className={appTab === k ? 'active' : ''}
                  onClick={() => setAppTab(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          }
        />
        <div className="app-review">
          {apps.map((a) => {
            const d = data.demands.find((x) => x.id === a.demandId);
            return (
              <div className="app-row" key={a.id}>
                <div className="app-who">
                  <strong>{a.name}</strong>
                  <small>
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ''}
                    {a.linkedin ? ` · LinkedIn` : ''}
                    {d ? ` · applied for ${d.title}` : ''}
                    {a.source ? ` · Source: ${a.source}` : ''}
                  </small>
                  {a.message && <p className="app-msg">{a.message}</p>}
                  <div className="app-flags">
                    {a.consentContact && <Badge tone="green">contact consent</Badge>}
                    {a.consentSharing && <Badge tone="green">sharing consent</Badge>}
                    {!a.consentContact && !a.consentSharing && (
                      <Badge tone="gray">no consent ticked</Badge>
                    )}
                  </div>
                </div>
                <div className="iv-actions">
                  {a.status === 'pending' && !viewer && (
                    <>
                      <Button
                        className="small"
                        disabled={busy}
                        onClick={() => reviewApp(a, 'accepted')}
                      >
                        Accept into repository
                      </Button>
                      <Button
                        variant="ghost"
                        className="small"
                        disabled={busy}
                        onClick={() => reviewApp(a, 'dismissed')}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                  {(a.status !== 'pending' || viewer) && (
                    <Badge tone={a.status === 'accepted' ? 'green' : 'gray'}>{a.status}</Badge>
                  )}
                </div>
              </div>
            );
          })}
          {!apps.length && (
            <Empty
              title="No applications here"
              text="Applications from the careers page land in this queue for human review."
            />
          )}
        </div>
      </section>
    </>
  );
}
export function Pools({ data, onOpen, onSave, busy }) {
  const [selected, setSelected] = useState(null);
  const pools = [
    {
      name: 'Databricks & data platforms',
      description: 'Your lakehouse, data engineering and analytics talent.',
      skills: ['Databricks', 'Apache Spark', 'Snowflake'],
      color: 'teal',
    },
    {
      name: 'Identity & security',
      description: 'Specialists protecting identities, systems and operations.',
      skills: ['Microsoft Entra', 'IAM', 'OT Security'],
      color: 'blue',
    },
    {
      name: 'Product engineering',
      description: 'People who turn product ideas into great experiences.',
      skills: ['React', 'TypeScript', 'Node.js'],
      color: 'violet',
    },
    {
      name: 'Cloud & infrastructure',
      description: 'Builders of reliable cloud foundations.',
      skills: ['Terraform', 'Kubernetes', 'AWS'],
      color: 'amber',
    },
    {
      name: 'Ready in 30 days',
      description: 'Ready talent with a confirmed notice of 30 days or less.',
      filter: (c) => c.status === 'Ready' && c.notice !== null && c.notice <= 30,
      color: 'green',
    },
    {
      name: 'Rediscover & reconnect',
      description: 'Profiles that need a fresh conversation and revalidation.',
      filter: (c) => freshness(c.verified) === 'Stale',
      color: 'rose',
    },
  ];
  const members = (p) =>
    data.candidates.filter(p.filter || ((c) => c.skills.some((s) => p.skills.includes(s))));
  return (
    <>
      <PageHeader
        eyebrow="CURATED CONNECTIONS"
        title="A network, organized around possibility."
        description="Dynamic talent pools update automatically as your repository grows."
      />
      <StaticPools data={data} onOpen={onOpen} onSave={onSave} busy={busy} />
      <div className="pools-grid">
        {pools.map((p) => (
          <button
            className={`pool-card ${selected === p.name ? 'selected' : ''}`}
            key={p.name}
            onClick={() => setSelected(selected === p.name ? null : p.name)}
          >
            <span className={`pool-icon ${p.color}`}>
              <Layers size={24} />
            </span>
            <h2>{p.name}</h2>
            <p>{p.description}</p>
            <div>
              <span>{members(p).length} candidates</span>
              <ArrowRight size={18} />
            </div>
          </button>
        ))}
      </div>
      {selected && (
        <section className="panel pool-members">
          <PanelHeading title={selected} subtitle="Live membership based on profile details" />
          <div className="people-grid">
            {members(pools.find((p) => p.name === selected)).map((c, i) => (
              <div className="pool-person" key={c.id}>
                <PersonName person={c} index={i} onClick={() => onOpen(c.id)} />
                <Badge>{c.status}</Badge>
              </div>
            ))}
          </div>
          {members(pools.find((p) => p.name === selected)).length === 0 && (
            <Empty
              title="This pool is waiting to grow"
              text="Matching profiles will appear automatically."
            />
          )}
        </section>
      )}
    </>
  );
}
export function Analytics({ data, navigate }) {
  const n = data.candidates.length,
    ready = data.candidates.filter((c) => c.status === 'Ready').length;
  const queues = qualityQueues(data);
  const shorts = data.considerations
    .map((a) => {
      const d = data.demands.find((x) => x.id === a.demandId);
      return d && d.created && a.created
        ? Math.max(0, Math.round((new Date(a.created) - new Date(d.created)) / 86400000))
        : null;
    })
    .filter((v) => v != null);
  const tts = shorts.length
    ? Math.round((shorts.reduce((a, b) => a + b, 0) / shorts.length) * 10) / 10
    : null;
  const views = data.auditEvents.filter((e) => e.action === 'viewed').length,
    exportsN = data.auditEvents.filter((e) => e.action === 'exported').length;
  const ttr = timeToReady(data.candidates, data.assessments);
  const srcConv = sourceConversion(data.candidates);
  const rediscovery = rediscoveryRate(data.considerations);
  const coverage = demandCoverage(data.candidates, data.demands, data.assessments);
  const uplift = upliftConversion(data.candidates, data.assessments, data.enrichment);
  const funnel = clientFunnel(data.considerations);
  const usable = usableProfiles(data.candidates);
  const iva = interviewAnalytics(data.interviews, thresholdFor(data.settings));
  const gapHeat = {};
  for (const d of data.demands.filter((x) => x.status === 'Open'))
    for (const c of data.candidates) {
      const m = matchCandidate(c, d, data.assessments);
      if (m.score < 40) continue;
      for (const g of deriveGaps(c, d, m, {
        assessments: data.assessments,
        enrichment: data.enrichment,
      })) {
        const entry =
          gapHeat[g.skill] || (gapHeat[g.skill] = { critical: 0, trainable: 0, contextual: 0 });
        entry[g.severity]++;
      }
    }
  const heatRows = Object.entries(gapHeat)
    .map(([skill, v]) => ({ skill, ...v, total: v.critical + v.trainable + v.contextual }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const sources = Object.entries(
    data.candidates.reduce((o, c) => ({ ...o, [c.source]: (o[c.source] || 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const skills = Object.entries(
    data.candidates.flatMap((c) => c.skills).reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return (
    <>
      <PageHeader
        eyebrow="THE VALUE IN YOUR NETWORK"
        title="Talent intelligence, in perspective."
        description="Live metrics from your repository and current hiring processes."
      />
      <div className="stats-grid">
        <Stat
          label="Ready talent"
          value={ready}
          detail={`${n ? Math.round((ready / n) * 100) : 0}% of the repository`}
          icon={Users}
        />
        <Stat
          label="Assessed candidates"
          value={new Set(data.assessments.map((a) => a.candidateId)).size}
          detail={`${data.assessments.length} recorded assessments`}
          icon={ClipboardCheck}
        />
        <Stat
          label="Active considerations"
          value={
            data.considerations.filter(
              (a) => !['Deployed', 'Rejected', 'Withdrawn'].includes(a.stage),
            ).length
          }
          detail="Across all client demands"
          icon={TrendingUp}
        />
        <Stat
          label="Deployed"
          value={data.considerations.filter((a) => a.stage === 'Deployed').length}
          detail="Recruiter-confirmed placements"
          icon={CheckCircle2}
        />
        <Stat
          label="Usable profiles"
          value={usable}
          detail="Contactable, fresh, with skills — ready to work"
          icon={Database}
        />
      </div>
      <div className="analytics-grid">
        <LifecycleAnalytics />
        <SkillInventoryPanel
          data={data}
          onOpenCandidate={(id) => navigate('Candidates', { personId: id })}
        />
        <section className="panel">
          <PanelHeading
            title="Skill inventory"
            subtitle="People with each skill on their profile"
          />
          <div className="horizontal-chart">
            {skills.map(([s, count]) => (
              <div key={s}>
                <span>{s}</span>
                <div>
                  <i
                    style={{ width: `${(count / Math.max(...skills.map((s) => s[1]), 1)) * 100}%` }}
                  />
                </div>
                <strong>{count}</strong>
              </div>
            ))}
            {!skills.length && <Empty title="No skill data yet" />}
          </div>
        </section>
        <section className="panel">
          <PanelHeading title="Where your talent comes from" subtitle="Candidate count by source" />
          <div className="horizontal-chart sources-chart">
            {sources.map(([s, count], i) => (
              <div key={s}>
                <span>{s}</span>
                <div>
                  <i
                    style={{
                      width: `${(count / Math.max(n, 1)) * 100}%`,
                      background: ['#658da0', '#8bb4a7', '#c2b48c', '#9298b4', '#b99894'][i % 5],
                    }}
                  />
                </div>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Current pipeline distribution"
            subtitle="Current stages, not historical conversion rates"
          />
          <div className="horizontal-chart">
            {STAGES.map((s) => (
              <div key={s}>
                <span>{stageLabel(s)}</span>
                <div>
                  <i
                    style={{
                      width: `${(data.considerations.filter((a) => a.stage === s).length / Math.max(data.considerations.length, 1)) * 100}%`,
                    }}
                  />
                </div>
                <strong>{data.considerations.filter((a) => a.stage === s).length}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Data quality queues"
            subtitle="Profiles to fix before a client submission"
          />
          <div className="quality-list">
            {queues.map((q) => (
              <button
                key={q.id}
                className="quality-row"
                onClick={() => navigate && navigate('Candidates', { queue: q.id })}
              >
                <span>{q.label}</span>
                <strong>{q.candidates.length}</strong>
              </button>
            ))}
          </div>
          {!queues.some((q) => q.candidates.length) && (
            <Empty title="Repository is clean" text="No profiles are waiting in a quality queue." />
          )}
        </section>
        <section className="panel">
          <PanelHeading
            title="Skill gap heatmap"
            subtitle="Open demands × nearby candidates, by gap severity"
          />
          <div className="heat-list">
            {heatRows.map((h) => (
              <div key={h.skill} className="heat-row">
                <span>{h.skill}</span>
                <div className="heat-cells">
                  <i
                    className="critical"
                    style={{ flex: h.critical + (h.critical ? 0.001 : 0) }}
                    title={`${h.critical} critical`}
                  />
                  <i
                    className="trainable"
                    style={{ flex: h.trainable + (h.trainable ? 0.001 : 0) }}
                    title={`${h.trainable} trainable`}
                  />
                  <i
                    className="contextual"
                    style={{ flex: h.contextual + (h.contextual ? 0.001 : 0) }}
                    title={`${h.contextual} contextual`}
                  />
                </div>
                <strong>{h.total}</strong>
                <small>
                  {h.critical}C · {h.trainable}T · {h.contextual}X
                </small>
              </div>
            ))}
            {!heatRows.length && (
              <Empty
                title="No gaps near open demands"
                text="As candidates approach open requirements their missing skills appear here."
              />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Demand coverage"
            subtitle="Per open demand: deployment-ready, near-ready and unfilled positions"
          />
          <div className="coverage-list">
            {coverage.map(({ demand: d, ready, near, missing }) => (
              <div key={d.id} className="coverage-row">
                <span>
                  <strong>{d.title}</strong>
                  <small className="block">
                    {d.client} · {d.positions} open position{d.positions === 1 ? '' : 's'}
                  </small>
                </span>
                <span className="coverage-cells">
                  <b className="cov-ready">{ready} ready</b>
                  <b className="cov-near">{near} near</b>
                  <b className={missing ? 'cov-missing' : 'cov-ready'}>{missing} unfilled</b>
                </span>
              </div>
            ))}
            {!coverage.length && (
              <Empty title="No open demands" text="Coverage appears when a demand is open." />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Client funnel & uplift"
            subtitle="Submission to deployment, and the ECOD uplift loop"
          />
          <div className="velocity-list">
            <div>
              <span>Client funnel</span>
              <strong>{funnel.map((f) => `${f.stage} ${f.count}`).join(' · ') || '—'}</strong>
              <small>Current considerations in client-facing stages</small>
            </div>
            <div>
              <span>Assessment → enrichment</span>
              <strong>{uplift.assessedToEnriched}%</strong>
              <small>
                {uplift.enriched} of {uplift.assessed} assessed candidates have an enrichment plan
              </small>
            </div>
            <div>
              <span>Enrichment → ready</span>
              <strong>{uplift.enrichedToReady}%</strong>
              <small>{uplift.readyAfter} enriched candidates are Ready today</small>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Interview outcomes"
            subtitle="Structured feedback from completed interview panels"
          />
          <div className="velocity-list">
            <div>
              <span>Completed panels</span>
              <strong>{iva.completed}</strong>
              <small>
                {iva.recommended} recommended (
                {iva.recommendRate == null ? '—' : iva.recommendRate + '%'}) · {iva.upcoming}{' '}
                upcoming
              </small>
            </div>
            <div>
              <span>Average rating</span>
              <strong>{iva.avgOverall ?? '—'}</strong>
              <small>
                {iva.aboveBar} above the {thresholdFor(data.settings)} feedback bar
              </small>
            </div>
            <div>
              <span>Recommendations</span>
              <strong>
                {Object.entries(iva.byRec)
                  .map(([r, n]) => `${r} ${n}`)
                  .join(' · ') || '—'}
              </strong>
              <small>
                {iva.cancelled} cancelled · {iva.noShow} no-shows
              </small>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Velocity & audit"
            subtitle="Blueprint measures over current records"
          />
          <div className="velocity-list">
            <div>
              <span>Average time to shortlist</span>
              <strong>{tts == null ? '—' : `${tts} days`}</strong>
              <small>{shorts.length} shortlists measured from demand creation</small>
            </div>
            <div>
              <span>Profile views logged</span>
              <strong>{views}</strong>
              <small>Audit trail of profile opens</small>
            </div>
            <div>
              <span>Data exports logged</span>
              <strong>{exportsN}</strong>
              <small>CSV exports with actor and size</small>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Conversion & rediscovery"
            subtitle="Blueprint §17 measures over current records"
          />
          <div className="velocity-list">
            <div>
              <span>Time to ready</span>
              <strong>{ttr == null ? '—' : `${ttr} days`}</strong>
              <small>Profile creation to latest assessment, Ready candidates</small>
            </div>
            <div>
              <span>Rediscovery rate</span>
              <strong>{rediscovery.pct}%</strong>
              <small>
                {rediscovery.multi} of {rediscovery.total} considered candidates appear in 2+
                demands
              </small>
            </div>
            <div>
              <span>Source → ready</span>
              <strong>
                {srcConv
                  .slice(0, 3)
                  .map((x) => `${x.source} ${x.pct}%`)
                  .join(' · ') || '—'}
              </strong>
              <small>Ready share by sourcing channel</small>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Profile freshness"
            subtitle="Days since the last recruiter verification"
          />
          <div className="freshness-report">
            {[
              ['Fresh', 'Verified within 60 days'],
              ['Aging', '61–120 days since verification'],
              ['Stale', 'Over 120 days; revalidate before use'],
            ].map(([s, t]) => (
              <div key={s}>
                <Badge>{s}</Badge>
                <span>{t}</span>
                <strong>{data.candidates.filter((c) => freshness(c.verified) === s).length}</strong>
              </div>
            ))}
          </div>
          <div className="analytics-insight">
            <Database size={22} />
            <p>
              Fresh profiles make stronger shortlists. Confirm availability, compensation and skills
              before a client submission.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
export function Settings({ data, session, onReload, notify, audit, onSave, onDelete, onModal }) {
  const viewer = cloud && !canWriteForRole(getRole());
  const [since, setSince] = useState(''),
    [restoreBusy, setRestoreBusy] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title="A foundation for better recruiting."
        description="Understand where your data lives and how this workspace is configured."
      />
      <div className="settings-grid">
        <section className="panel">
          <PanelHeading
            title="Data & connection"
            action={
              <Badge tone={cloud ? 'green' : 'amber'}>
                {cloud ? 'Cloud connected' : 'Local demo'}
              </Badge>
            }
          />
          <div className="settings-body">
            <div className="settings-feature">
              <Cloud size={25} />
              <div>
                <h3>{cloud ? 'Shared PostgreSQL repository' : 'Browser-local demo workspace'}</h3>
                <p>
                  {cloud
                    ? 'Your account accesses workspace records through Supabase authentication and row-level security.'
                    : 'This workspace uses fictional examples and saves changes in this browser. It is not a shared team database. Use demo information until your cloud workspace is configured.'}
                </p>
              </div>
            </div>
            <dl>
              <div>
                <dt>Hosting target</dt>
                <dd>Netlify</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{cloud ? 'Supabase PostgreSQL' : 'Browser storage'}</dd>
              </div>
              <div>
                <dt>Matching engine</dt>
                <dd>Weighted, deterministic criteria</dd>
              </div>
              <div>
                <dt>Profile persistence</dt>
                <dd>{cloud ? 'Shared workspace' : 'This browser only'}</dd>
              </div>
              <div>
                <dt>Candidate records</dt>
                <dd>{data.candidates.length}</dd>
              </div>
            </dl>
            <Button variant="secondary" icon={RefreshCw} onClick={onReload}>
              Reload repository
            </Button>
            {!cloud && (
              <Button
                variant="secondary"
                icon={Database}
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Reset the demo workspace? Every change saved in this browser is discarded and the fictional sample data is restored. This cannot be undone.',
                    )
                  )
                    return;
                  await resetDemo();
                  if (onReload) await onReload();
                  notify('Demo workspace reset to the sample data.');
                  audit &&
                    audit({
                      entityType: 'workspace',
                      entityId: null,
                      action: 'updated',
                      detail: 'Demo data reset from Workspace settings',
                    });
                }}
              >
                Reset demo data
              </Button>
            )}
            {!cloud && (
              <p className="supporting-text">
                Team setup instructions and the database migration are included in the project's
                README. Configure the Supabase project URL and public key in Netlify, then redeploy.
              </p>
            )}
          </div>
        </section>
        <Members notify={notify} audit={audit} />
        <DepartmentsPanel
          data={data}
          onSave={onSave}
          onNew={() => onModal?.({ type: 'department' })}
          onEdit={(department) => onModal?.({ type: 'department', department })}
          notify={notify}
        />
        <CareersSeoPanel data={data} notify={notify} />
        <BrandingPanel data={data} onSave={onSave} notify={notify} />
        <CustomFieldsPanel data={data} onSave={onSave} notify={notify} />
        <AssignmentPanel
          data={data}
          onSave={onSave}
          onDelete={onDelete}
          onNew={() => onModal?.({ type: 'assignmentRule' })}
          onEdit={(rule) => onModal?.({ type: 'assignmentRule', rule })}
          notify={notify}
        />
        <section className="panel">
          <PanelHeading title="Workspace capabilities" />
          <div className="settings-body">
            <div className="capability">
              <CheckCircle2 />
              <span>Reusable candidate profiles & history</span>
            </div>
            <div className="capability">
              <CheckCircle2 />
              <span>Explainable demand matching</span>
            </div>
            <div className="capability">
              <CheckCircle2 />
              <span>Pipeline, assessments & enrichment</span>
            </div>
            <div className="capability">
              <CheckCircle2 />
              <span>CSV import with duplicate checks</span>
            </div>
            <div className="roadmap-note">
              <h3>Release boundaries</h3>
              <p>
                This release includes in-browser CV parsing, private document storage, local
                semantic retrieval, public careers and candidate self-service portals, and
                admin-only manual retention review. It does not include hosted embeddings or
                AI-driven decisions, automated email notifications or calendar sync, client/vendor
                portals, fine-grained role administration, or automatic retention enforcement.
              </p>
            </div>
          </div>
        </section>
        {!viewer && (
          <DataTools
            data={data}
            onSave={onSave}
            onReload={onReload}
            notify={notify}
            audit={audit}
          />
        )}
        <MfaPanel key={`mfa-${getWorkspaceId()}`} />
        {getRole() === 'admin' && (
          <OperationsConsole key={`operations-${getWorkspaceId()}`} onHoldChange={onReload} />
        )}
        {getRole() === 'admin' && <ExecutionJobsPanel />}
        {getRole() === 'admin' && <InterviewReminders key={`reminders-${getWorkspaceId()}`} />}
        {getRole() === 'admin' && <FreshnessReviews key={`freshness-${getWorkspaceId()}`} />}
        {!viewer && <SavedImports onReload={onReload} notify={notify} />}
        {getRole() === 'admin' && <IntegrationsPanel />}
        {getRole() === 'admin' && <DeliverySandbox />}
        {getRole() === 'admin' && <ProcessingRecovery />}
        {getRole() === 'admin' && <MachineCredentials />}
        {!viewer && <ExternalMappingsPanel candidates={data.candidates} />}
        {getRole() === 'admin' && <IntelligenceSettings />}
        {getRole() === 'admin' && <IndexHealthPanel />}
        {getRole() === 'admin' && <DocumentReputation documents={data.documents} />}
        {getRole() === 'admin' && <DocumentReviewQueue onReload={onReload} />}
        {getRole() === 'admin' && <DocumentAccessAudit />}
        {getRole() === 'admin' && <CandidateExportAudit />}
        {getRole() === 'admin' && (
          <SubjectRequests key={getWorkspaceId()} onHoldChange={onReload} />
        )}
        {getRole() === 'admin' && (
          <AdminPanel data={data} onSave={onSave} notify={notify} audit={audit} />
        )}
        {!viewer && <TaxonomyEditor data={data} onSave={onSave} notify={notify} />}
        <section className="panel">
          <PanelHeading title="Data portability" />
          <div className="settings-body">
            {viewer ? (
              <p className="supporting-text" role="status">
                Your viewer role is read-only; data export and restore are unavailable.
              </p>
            ) : (
              <p>Export candidate records for your own reporting and migration.</p>
            )}
            <Button
              variant="secondary"
              icon={Download}
              disabled={viewer}
              title={viewer ? 'Viewer role cannot export candidate data' : ''}
              onClick={async () => {
                const exportRows = data.candidates.filter((c) => !c.mergedInto);
                if (!(await exportCandidateData(exportRows, notify))) return;
                notify('Candidate CSV exported.');
                audit &&
                  audit({
                    entityType: 'candidates',
                    entityId: null,
                    action: 'exported',
                    detail: `${exportRows.length} candidates`,
                  });
              }}
            >
              Export candidate CSV
            </Button>
            <p className="supporting-text">
              Includes contact details. Audited candidate CSVs include compensation only for
              administrators. Store exports in an appropriate private location.
            </p>
            <div className="backup-row">
              <Button
                variant="secondary"
                icon={Download}
                disabled={viewer}
                title={viewer ? 'Viewer role cannot export a workspace backup' : ''}
                onClick={() => {
                  const exported = exportSensitiveFile(
                    JSON.stringify(backupBundle(data), null, 2),
                    `ecod-workspace-backup-${today()}.json`,
                    'application/json',
                    notify,
                  );
                  if (!exported) return;
                  notify('Workspace backup downloaded - store it somewhere private.');
                  audit &&
                    audit({
                      entityType: 'workspace',
                      entityId: null,
                      action: 'exported',
                      detail: 'Loaded application rows snapshot (JSON); partial cloud coverage',
                    });
                }}
              >
                Download workspace backup (JSON)
              </Button>
              {!viewer && (
                <label className={`button secondary${restoreBusy ? ' disabled' : ''}`}>
                  <FileSpreadsheet size={16} />
                  {restoreBusy ? 'Restoring…' : 'Restore from backup'}
                  <input
                    type="file"
                    hidden
                    accept=".json"
                    disabled={restoreBusy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (
                        !window.confirm(
                          'Restore merges every table from this backup into the workspace. Existing rows with the same ids are overwritten; deletions are not applied. Continue?',
                        )
                      )
                        return;
                      setRestoreBusy(true);
                      try {
                        const text = await file.text();
                        const { rows: restored, exportedAt } = parseBackup(text);
                        const { touched, total } = await restoreBackupRows(restored, onSave);
                        notify(
                          `Restore complete: ${total} rows across ${touched} tables (backup from ${String(exportedAt).slice(0, 10)}).`,
                        );
                        audit &&
                          audit({
                            entityType: 'workspace',
                            entityId: null,
                            action: 'updated',
                            detail: `Restored backup from ${String(exportedAt).slice(0, 10)}`,
                          });
                      } catch (err) {
                        notify(`Restore failed: ${err.message}`);
                      }
                      setRestoreBusy(false);
                    }}
                  />
                </label>
              )}
            </div>
            <p className="supporting-text">
              This portability snapshot contains application rows currently loaded for your account.
              Cloud coverage may be partial. It excludes private governance and operations records,
              Auth, original file bytes, protected columns and database configuration. Restore
              merges rows by id through the normal save path — deletions are never applied.
              Encrypted server-side backups with tested restore (RPO/RTO) remain an operations
              responsibility.
            </p>
            <div className="since-export">
              <Field label="Incremental change export (API groundwork)">
                <input
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  aria-label="Export changes since"
                />
              </Field>
              <Button
                variant="secondary"
                icon={FileSpreadsheet}
                disabled={!since || viewer}
                title={viewer ? 'Viewer role cannot export workspace data' : ''}
                onClick={() =>
                  exportSensitiveFile(
                    JSON.stringify(changesSince(data, since), null, 2),
                    `ecod-changes-${since}.json`,
                    'application/json',
                    notify,
                  )
                }
              >
                Export changes since {since || '…'}
              </Button>
              <p className="supporting-text">
                Blueprint §14: the same shape a future <code>updated_since</code> API endpoint
                returns.
              </p>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeading
            title="Recent activity"
            subtitle="Views and exports recorded in this workspace"
          />
          <div className="audit-list">
            {data.auditEvents.slice(0, 8).map((e) => (
              <article key={e.id} className="audit-row">
                <Badge tone={e.action === 'exported' ? 'amber' : 'gray'}>{e.action}</Badge>
                <span>{e.detail || e.entityType}</span>
                <small>
                  {new Date(e.date).toLocaleString()} · {e.actor}
                </small>
              </article>
            ))}
            {!data.auditEvents.length && (
              <p className="supporting-text">
                Profile views and CSV exports will be recorded here.
              </p>
            )}
          </div>
        </section>
        {cloud && (
          <section className="panel">
            <PanelHeading title="Your session" />
            <div className="settings-body">
              <p>{session?.user?.email}</p>
              <Button
                variant="secondary"
                icon={LogOut}
                onClick={async () => {
                  const supabase = await getSupabase();
                  await supabase.auth.signOut();
                }}
              >
                Sign out
              </Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
export function DispositionModal({ application, stage, onSave, onClose, busy }) {
  const [reason, setReason] = useState(''),
    [note, setNote] = useState('');
  return (
    <Modal
      title={`Mark as ${stage.toLowerCase()}`}
      subtitle="Keep the context for future opportunities."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave('considerations', [
              {
                ...application,
                stage,
                reason: reason + (note ? `: ${note}` : ''),
                updated: today(),
              },
            ])
          )
            onClose();
        }}
      >
        <div className="modal-body">
          <Field label="Reason *">
            <select required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select a reason</option>
              {[
                'Skill gap',
                'Compensation mismatch',
                'Availability mismatch',
                'Candidate declined',
                'Client decision',
                'Role cancelled',
                'Other',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Additional context">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save outcome
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DataTools({ data, onSave, onReload, notify, audit }) {
  const [pair, setPair] = useState(null),
    [picks, setPicks] = useState({}),
    [busy, setBusy] = useState(false);
  const pairs = useMemo(() => duplicatePairs(data.candidates), [data.candidates]);
  const preview = pair ? mergePreview(data, pair.a.id, pair.b.id, picks) : null;
  async function runMerge() {
    if (!pair || !preview) return;
    setBusy(true);
    const winner = preview;
    try {
      await mergeCandidateRecords(data, winner, pair.b, onSave);
      audit &&
        audit({
          entityType: 'candidate',
          entityId: winner.id,
          action: 'merged',
          detail: `Merged ${pair.b.name} into ${winner.name}`,
        });
      notify(
        'Profiles merged. The duplicate is hidden, not deleted; its history points to the surviving record.',
      );
      setPair(null);
      setPicks({});
      onReload && onReload();
    } catch (error) {
      notify(
        error.message || 'The merge could not be completed. Review the profiles before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (cloud)
    return (
      <section className="panel">
        <DuplicateReview onUpdated={() => onReload?.()} />
      </section>
    );
  return (
    <section className="panel">
      <PanelHeading
        title="Merge duplicates"
        subtitle="Suggested duplicates — never merged automatically. A human reviews and picks every value."
      />
      {!pairs.length && (
        <p className="supporting-text">
          No probable duplicates found (same email, phone, LinkedIn, or name plus
          employer/location).
        </p>
      )}
      {!!pairs.length && !pair && (
        <div className="dup-list">
          {pairs.map((p, i) => (
            <button
              key={i}
              className="quality-row"
              onClick={() => {
                setPair(p);
                setPicks({});
              }}
            >
              <span>
                <strong>{p.a.name}</strong> + <strong>{p.b.name}</strong>
              </span>
              <Badge tone={p.confidence === 'high' ? 'red' : 'amber'}>
                {p.confidence} confidence · {p.reason}
              </Badge>
            </button>
          ))}
        </div>
      )}
      {pair && preview && (
        <div className="merge-review">
          <p className="supporting-text">
            Surviving record: <strong>{preview.name || pair.a.name}</strong> (
            {pair.a.name || pair.b.name} keeps {anthroIdFor(pair.a)}). {pair.b.name} is flagged
            merged and hidden; its former Anthro-ID remains searchable. Choose a value per field:
          </p>
          <div className="table-scroll merge-table">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>{pair.a.name}</th>
                  <th>{pair.b.name}</th>
                  <th>Keep</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {MERGE_FIELDS.map((f) => (
                  <tr key={f}>
                    <td>{f}</td>
                    <td
                      className={picks[f] !== 'b' && String(pair.a[f] ?? '') !== '' ? 'picked' : ''}
                    >
                      {String(pair.a[f] ?? '—')}
                    </td>
                    <td className={picks[f] === 'b' ? 'picked' : ''}>{String(pair.b[f] ?? '—')}</td>
                    <td>
                      <span className="merge-pick">
                        <label>
                          <input
                            type="radio"
                            name={`pick-${f}`}
                            checked={picks[f] !== 'b'}
                            onChange={() => setPicks({ ...picks, [f]: 'a' })}
                          />
                          A
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`pick-${f}`}
                            checked={picks[f] === 'b'}
                            onChange={() => setPicks({ ...picks, [f]: 'b' })}
                          />
                          B
                        </label>
                      </span>
                    </td>
                    <td>
                      <strong>{String(preview[f] ?? '—')}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="supporting-text">
            Skills and skill evidence are always combined, keeping the stronger (validated,
            higher-proficiency) row per skill.
          </p>
          <div className="merge-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setPair(null);
                setPicks({});
              }}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={runMerge}>
              {busy ? 'Merging…' : `Merge into ${preview.name || pair.a.name}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
function TaxonomyEditor({ data, onSave, notify }) {
  const row = data.taxonomy.find((r) => r && r.id === 'workspace');
  const [form, setForm] = useState({ skill: '', domain: '', aliases: '' });
  const custom = row?.custom || { skills: [], aliases: {}, domains: {} };
  async function addSkill(e) {
    e.preventDefault();
    const name = form.skill.trim();
    if (!name) return;
    const next = {
      skills: [...new Set([...custom.skills, name])],
      aliases: { ...custom.aliases },
      domains: { ...custom.domains },
    };
    for (const a of form.aliases
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean))
      next.aliases[a] = name;
    if (form.domain.trim()) next.domains[name] = form.domain.trim();
    if (await onSave('taxonomy', [{ id: 'workspace', custom: next }])) {
      setCustomTaxonomy(next);
      setForm({ skill: '', domain: '', aliases: '' });
      notify('Skill added to the workspace taxonomy.');
    }
  }
  async function removeSkill(name) {
    const next = {
      skills: custom.skills.filter((s) => s !== name),
      aliases: { ...custom.aliases },
      domains: { ...custom.domains },
    };
    for (const k of Object.keys(next.aliases)) if (next.aliases[k] === name) delete next.aliases[k];
    delete next.domains[name];
    if (await onSave('taxonomy', [{ id: 'workspace', custom: next }])) {
      setCustomTaxonomy(next);
      notify('Skill removed from the workspace taxonomy.');
    }
  }
  return (
    <section className="panel">
      <PanelHeading
        title="Skill taxonomy"
        subtitle={`${allSkills().length} canonical skills (${custom.skills.length} workspace-added) · matching, JD parsing and CV parsing all use this vocabulary`}
      />
      <form className="taxonomy-form" onSubmit={addSkill}>
        <Field label="Skill name">
          <input
            required
            value={form.skill}
            onChange={(e) => setForm({ ...form, skill: e.target.value })}
            placeholder="e.g. Apache Iceberg"
          />
        </Field>
        <Field label="Domain">
          <input
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            placeholder="e.g. Data platform"
          />
        </Field>
        <Field label="Aliases (comma-separated)">
          <input
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            placeholder="iceberg, apache iceberg"
          />
        </Field>
        <div>
          <Button type="submit">Add skill</Button>
        </div>
      </form>
      {!!custom.skills.length && (
        <div className="taxonomy-list">
          {custom.skills.map((s) => (
            <div key={s} className="taxonomy-row">
              <span>
                <strong>{s}</strong>
                <small className="block">
                  {custom.domains[s] || 'Other'} · aliases:{' '}
                  {Object.entries(custom.aliases)
                    .filter(([, v]) => v === s)
                    .map(([k]) => k)
                    .join(', ') || '—'}
                </small>
              </span>
              <Button variant="ghost" className="small" onClick={() => removeSkill(s)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminPanel({ data, onSave, notify, audit }) {
  const [ruleDraft, setRuleDraft] = useState(null);
  const row = data.settings.find((r) => r && r.id === 'workspace');
  const custom = row?.custom || {};
  const [labels, setLabels] = useState(() => ({ ...stageLabelsMap() }));
  const [months, setMonths] = useState(custom.retentionMonths ?? 12);
  const [bar, setBar] = useState(custom.feedbackThreshold ?? 3.5);
  const [crit, setCrit] = useState(() =>
    Array.isArray(custom.feedbackCriteria) && custom.feedbackCriteria.length
      ? custom.feedbackCriteria.join(', ')
      : DEFAULT_CRITERIA.join(', '),
  );
  const [coolingDays, setCoolingDays] = useState(custom.coolingOffDays ?? 30);
  const [approvals, setApprovals] = useState(!!custom.offerApprovals);
  const [tpls, setTpls] = useState(() => templatesFor(data.settings).map((t) => ({ ...t })));
  const [docTpls, setDocTpls] = useState(() =>
    documentTemplatesFor(data.settings).map((t) => ({ ...t })),
  );
  const [busy, setBusy] = useState(false);
  const due = retentionDue(data.candidates, months);
  const candidateActionsAvailable = ruleDraft?.triggerTable !== 'demands';
  async function saveSettings(next) {
    setBusy(true);
    if (await onSave('settings', [{ id: 'workspace', custom: { ...custom, ...next } }]))
      notify('Workspace settings saved.');
    setBusy(false);
  }
  // Blueprint §12: the admin sees the whole trail, not just four curated verbs — submissions,
  // consent events and record updates are auditable too and used to be filtered out here.
  const rows = [...data.auditEvents]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 50);
  return (
    <section className="panel">
      <PanelHeading
        title="Administration"
        subtitle="Workspace-wide configuration — admin role only"
      />
      <h3 className="history-heading">Pipeline stage labels</h3>
      <p className="supporting-text">
        Rename how the ten stages display across the workspace. Values stay stable for history and
        dispositions.
      </p>
      <div className="stage-label-grid">
        {STAGES.map((st) => (
          <Field key={st} label={st}>
            <input
              value={labels[st] || ''}
              placeholder={st}
              onChange={(e) => setLabels({ ...labels, [st]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <Button
        className="small"
        disabled={busy}
        onClick={() => saveSettings({ stageLabels: labels })}
      >
        Save stage labels
      </Button>
      {!cloud && (
        <>
          <h3 className="history-heading">Retention policy</h3>
          <div className="retention-row">
            <Field label="Review profiles unverified for (months)">
              <input
                type="number"
                min="1"
                max="120"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              />
            </Field>
            <Button
              className="small"
              disabled={busy}
              onClick={() => saveSettings({ retentionMonths: months })}
            >
              Save policy
            </Button>
            <span className="retention-count">
              {due.length} profile{due.length === 1 ? '' : 's'} due for review
            </span>
          </div>
          {cloud && (
            <p className="supporting-text">
              Cloud profile anonymization is unavailable: the legacy scrubber cannot cover linked
              files, history or verified privacy fulfillment. Use subject-request and erasure review
              to record scope and decisions. Destructive execution remains pending.
            </p>
          )}
          {!!due.length && (
            <div className="retention-list">
              {due.slice(0, 10).map((c) => (
                <div key={c.id} className="quality-row">
                  <span>
                    <strong>{c.name}</strong>
                    <small className="anthro-id">{anthroIdFor(c)}</small>
                    <small className="block">Last verified {c.verified}</small>
                  </span>
                  <Button
                    variant="ghost"
                    className="small"
                    disabled={busy || cloud}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Anonymize profile fields for ${c.name}? Linked files and history remain. This does not fulfill an erasure request.`,
                        )
                      )
                        return;
                      setBusy(true);
                      if (await onSave('candidates', [anonymizeCandidate(c)])) {
                        audit &&
                          audit({
                            entityType: 'candidate',
                            entityId: c.id,
                            action: 'anonymized',
                            detail: c.name,
                          });
                        notify('Profile anonymized.');
                      }
                      setBusy(false);
                    }}
                  >
                    Anonymize
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {cloud && (
        <p className="supporting-text">
          Configure cloud retention review in Operations and governance above. Selected jobs use its
          versioned policy reference; profile and file deletion remain disabled.
        </p>
      )}
      <h3 className="history-heading">Interview feedback bar</h3>
      <div className="retention-row">
        <Field label="Bar (overall rating out of 5)">
          <input
            type="number"
            step="0.1"
            min="1"
            max="5"
            value={bar}
            onChange={(e) => setBar(Number(e.target.value))}
          />
        </Field>
        <Field label="Rating criteria" hint="Comma-separated, shown on every feedback form">
          <input value={crit} onChange={(e) => setCrit(e.target.value)} />
        </Field>
        <Button
          className="small"
          disabled={busy}
          onClick={() =>
            saveSettings({
              feedbackThreshold: bar,
              feedbackCriteria: crit
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        >
          Save feedback settings
        </Button>
      </div>
      <h3 className="history-heading">Email templates</h3>
      <p className="supporting-text">
        Drafts for invites and follow-ups, composed in your mail client. Placeholders:{' '}
        {'{name} {demand} {round} {mode} {date} {time}'}.
      </p>
      <div className="tpl-list">
        {tpls.map((t, i) => (
          <div key={i} className="tpl-card">
            <Field label="Name">
              <input
                value={t.name}
                onChange={(e) => {
                  const next = [...tpls];
                  next[i] = { ...t, name: e.target.value };
                  setTpls(next);
                }}
              />
            </Field>
            <Field label="Subject">
              <input
                value={t.subject}
                onChange={(e) => {
                  const next = [...tpls];
                  next[i] = { ...t, subject: e.target.value };
                  setTpls(next);
                }}
              />
            </Field>
            <Field label="Body">
              <textarea
                rows={4}
                value={t.body}
                onChange={(e) => {
                  const next = [...tpls];
                  next[i] = { ...t, body: e.target.value };
                  setTpls(next);
                }}
              />
            </Field>
            <Button
              variant="ghost"
              className="small"
              disabled={busy}
              onClick={() => setTpls(tpls.filter((_, j) => j !== i))}
            >
              Remove template
            </Button>
          </div>
        ))}
      </div>
      <div className="tpl-actions">
        <Button
          className="small"
          disabled={busy}
          onClick={() => setTpls([...tpls, { name: 'New template', subject: '', body: '' }])}
        >
          Add template
        </Button>
        <Button
          className="small"
          disabled={busy}
          onClick={async () => {
            if (
              await onSave('settings', [
                {
                  id: 'workspace',
                  custom: { ...custom, emailTemplates: tpls.filter((t) => t.name.trim()) },
                },
              ])
            )
              notify('Email templates saved.');
          }}
        >
          Save templates
        </Button>
      </div>
      <h3 className="history-heading">Document templates</h3>
      <p className="supporting-text">
        Merge-field letter templates used by Generate letter on profiles and the offer letter modal.
        Tokens like {'{{Candidate.name}}'} are replaced when the letter is generated - unknown
        tokens stay visible so typos are easy to spot. Click a field to append it to a template.
      </p>
      <div className="tpl-list">
        {docTpls.map((t, i) => (
          <div key={t.id || i} className="tpl-card">
            <Field label="Name">
              <input
                value={t.name}
                onChange={(e) => {
                  const next = [...docTpls];
                  next[i] = { ...t, name: e.target.value };
                  setDocTpls(next);
                }}
              />
            </Field>
            <Field label="Letter body">
              <textarea
                rows={6}
                value={t.body}
                onChange={(e) => {
                  const next = [...docTpls];
                  next[i] = { ...t, body: e.target.value };
                  setDocTpls(next);
                }}
              />
            </Field>
            <div className="merge-chips">
              {MERGE_FIELD_CATALOG.map(([g, f]) => (
                <button
                  type="button"
                  key={g + '.' + f}
                  className="chip"
                  title={'Insert {{' + g + '.' + f + '}}'}
                  onClick={() =>
                    setDocTpls(
                      docTpls.map((x, j) =>
                        j === i ? { ...x, body: (x.body || '') + '{{' + g + '.' + f + '}}' } : x,
                      ),
                    )
                  }
                >
                  {g + '.' + f}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="small"
              disabled={busy}
              onClick={() => setDocTpls(docTpls.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="tpl-actions">
        <Button
          className="small"
          disabled={busy}
          onClick={() =>
            setDocTpls([
              ...docTpls,
              { id: uid(), name: 'New letter template', body: 'Dear {{Candidate.name}},\n\n' },
            ])
          }
        >
          Add document template
        </Button>
        <Button
          className="small"
          disabled={busy}
          onClick={() => saveSettings({ documentTemplates: docTpls })}
        >
          Save document templates
        </Button>
      </div>
      <h3 className="history-heading">Fair-process guardrails</h3>
      <div className="retention-row">
        <Field label="Cooling-off after a client rejection (days)">
          <input
            type="number"
            min="0"
            max="365"
            value={coolingDays}
            onChange={(e) => setCoolingDays(Number(e.target.value))}
          />
        </Field>
        <label className="consent-check">
          <input
            type="checkbox"
            checked={approvals}
            onChange={(e) => setApprovals(e.target.checked)}
          />
          Require admin approval before offers are sent
        </label>
        <Button
          className="small"
          disabled={busy}
          onClick={() => saveSettings({ coolingOffDays: coolingDays, offerApprovals: approvals })}
        >
          Save guardrails
        </Button>
      </div>
      <p className="supporting-text">
        Cooling-off shows a confirmation before re-submitting a candidate the same client rejected
        within this window (Zoho-style fair evaluation). Offer approval holds new offers in
        &ldquo;Pending approval&rdquo; until an admin releases them.
      </p>
      <h3 className="history-heading">Automation rules</h3>
      <p className="supporting-text">
        When a trigger fires — a candidate or demand stage change, an offer status, an interview
        recommendation — ECOD applies the rule&rsquo;s actions (task, note, tag, next action) and
        records it in the audit log. With server execution enabled, database changes queue these
        actions for the background worker. Otherwise the browser applies them on save. Automated
        email, webhooks and time-based rule conditions are not available yet.
      </p>
      <div className="rules-list">
        {(data.workflowRules || []).map((r) => (
          <article key={r.id} className={`rule-row${r.enabled ? '' : ' paused'}`}>
            <div className="rule-main">
              <strong>{r.name}</strong>
              <small className="block">{describeRule(r)}</small>
              <small className="block text-muted">{describeActions(r) || 'No actions'}</small>
              {r.triggerTable === 'demands' &&
                (r.actions || []).some((a) => ['note', 'tag', 'nextAction'].includes(a.type)) && (
                  <small className="block text-amber">
                    Candidate-only actions cannot run on a demand trigger. Duplicate this rule and
                    use a task instead.
                  </small>
                )}
            </div>
            <div className="rule-actions">
              <Button
                variant={r.enabled ? 'ghost' : 'secondary'}
                className="small"
                disabled={
                  busy ||
                  (!r.enabled &&
                    r.triggerTable === 'demands' &&
                    (r.actions || []).some((a) => ['note', 'tag', 'nextAction'].includes(a.type)))
                }
                onClick={async () => {
                  if (await onSave('workflowRules', [{ ...r, enabled: !r.enabled }]))
                    notify(r.enabled ? `${r.name} enabled.` : `${r.name} paused.`);
                }}
              >
                {r.enabled ? 'Pause' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                className="small"
                disabled={busy}
                onClick={() =>
                  setRuleDraft({
                    name: `${r.name} (copy)`,
                    triggerTable: r.triggerTable,
                    triggerField: r.triggerField,
                    op: r.op,
                    value: r.value,
                    actions: {
                      task: true,
                      taskTitle: (r.actions.find((a) => a.type === 'task') || {}).title || '',
                      dueDays: (r.actions.find((a) => a.type === 'task') || {}).dueDays ?? 1,
                      note: false,
                      noteText: '',
                      tag: false,
                      tagText: '',
                      nextAction: false,
                      nextActionText: '',
                    },
                  })
                }
              >
                Duplicate
              </Button>
            </div>
          </article>
        )) || null}
        {!(data.workflowRules || []).length && (
          <p className="supporting-text">No rules yet — create the first one below.</p>
        )}
      </div>
      {!ruleDraft ? (
        <Button
          variant="secondary"
          icon={Plus}
          onClick={() =>
            setRuleDraft({
              name: '',
              triggerTable: 'candidates',
              triggerField: 'stage',
              op: 'eq',
              value: '',
              actions: {
                task: true,
                taskTitle: '',
                dueDays: 1,
                note: false,
                noteText: '',
                tag: false,
                tagText: '',
                nextAction: false,
                nextActionText: '',
              },
            })
          }
        >
          New automation rule
        </Button>
      ) : (
        <div className="rule-editor">
          <div className="form-grid">
            <Field label="Rule name">
              <input
                value={ruleDraft.name}
                onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })}
                placeholder="e.g. Offer accepted → onboarding prep"
              />
            </Field>
            <Field label="When this happens">
              <select
                value={`${ruleDraft.triggerTable}.${ruleDraft.triggerField}`}
                onChange={(e) => {
                  const [table, field] = e.target.value.split('.');
                  setRuleDraft({
                    ...ruleDraft,
                    triggerTable: table,
                    triggerField: field,
                    value: '',
                    actions: {
                      ...ruleDraft.actions,
                      ...(table === 'demands'
                        ? { note: false, tag: false, nextAction: false }
                        : {}),
                    },
                  });
                }}
              >
                {TRIGGERS.map((t) => (
                  <option key={`${t.table}.${t.field}`} value={`${t.table}.${t.field}`}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Match">
              <select
                value={ruleDraft.op}
                onChange={(e) => setRuleDraft({ ...ruleDraft, op: e.target.value })}
              >
                <option value="eq">enters the value</option>
                <option value="neq">changes away from the value</option>
                <option value="changed">any change</option>
              </select>
            </Field>
            {ruleDraft.op !== 'changed' && (
              <Field label="Value">
                {(() => {
                  // Offered values come from the trigger's own vocabulary, so a rule cannot be saved
                  // waiting on a value the field can never hold (which would silently never fire).
                  const options =
                    TRIGGER_VALUES[`${ruleDraft.triggerTable}.${ruleDraft.triggerField}`];
                  return options ? (
                    <select
                      value={ruleDraft.value}
                      onChange={(e) => setRuleDraft({ ...ruleDraft, value: e.target.value })}
                    >
                      <option value="">Select a value…</option>
                      {options.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={ruleDraft.value}
                      onChange={(e) => setRuleDraft({ ...ruleDraft, value: e.target.value })}
                    />
                  );
                })()}
              </Field>
            )}
          </div>
          <div className="rule-actions-picker">
            <label className="consent-check">
              <input
                type="checkbox"
                checked={!!ruleDraft.actions.task}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, task: e.target.checked },
                  })
                }
              />
              Create task
            </label>
            {ruleDraft.actions.task && (
              <>
                <input
                  value={ruleDraft.actions.taskTitle}
                  onChange={(e) =>
                    setRuleDraft({
                      ...ruleDraft,
                      actions: { ...ruleDraft.actions, taskTitle: e.target.value },
                    })
                  }
                  placeholder="Task title"
                />
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={ruleDraft.actions.dueDays}
                  onChange={(e) =>
                    setRuleDraft({
                      ...ruleDraft,
                      actions: { ...ruleDraft.actions, dueDays: Number(e.target.value) },
                    })
                  }
                  title="Due in N days"
                />{' '}
                days
              </>
            )}
            <label className="consent-check">
              <input
                type="checkbox"
                checked={candidateActionsAvailable && !!ruleDraft.actions.note}
                disabled={!candidateActionsAvailable}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, note: e.target.checked },
                  })
                }
              />
              Add note
            </label>
            {ruleDraft.actions.note && (
              <input
                value={ruleDraft.actions.noteText}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, noteText: e.target.value },
                  })
                }
                placeholder="Note text"
              />
            )}
            <label className="consent-check">
              <input
                type="checkbox"
                checked={candidateActionsAvailable && !!ruleDraft.actions.tag}
                disabled={!candidateActionsAvailable}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, tag: e.target.checked },
                  })
                }
              />
              Tag candidate
            </label>
            {ruleDraft.actions.tag && (
              <input
                value={ruleDraft.actions.tagText}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, tagText: e.target.value },
                  })
                }
                placeholder="Tag"
              />
            )}
            <label className="consent-check">
              <input
                type="checkbox"
                checked={candidateActionsAvailable && !!ruleDraft.actions.nextAction}
                disabled={!candidateActionsAvailable}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, nextAction: e.target.checked },
                  })
                }
              />
              Set next action
            </label>
            {ruleDraft.actions.nextAction && (
              <input
                value={ruleDraft.actions.nextActionText}
                onChange={(e) =>
                  setRuleDraft({
                    ...ruleDraft,
                    actions: { ...ruleDraft.actions, nextActionText: e.target.value },
                  })
                }
                placeholder="Next action"
              />
            )}
            {!candidateActionsAvailable && (
              <p className="supporting-text">
                Notes, tags and next actions need a candidate-linked trigger. Use a task for demand
                events.
              </p>
            )}
          </div>
          {ruleDraft.op !== 'changed' && !String(ruleDraft.value || '').trim() && (
            <p className="form-error">
              Choose the value this rule waits for, or switch the match to “any change”.
            </p>
          )}
          <div className="modal-actions">
            <Button
              disabled={
                !ruleDraft.name.trim() ||
                (ruleDraft.op !== 'changed' && !String(ruleDraft.value || '').trim()) ||
                busy
              }
              onClick={async () => {
                const actions = [];
                const a = ruleDraft.actions;
                if (a.task)
                  actions.push({
                    type: 'task',
                    title: a.taskTitle || `Follow up: ${ruleDraft.name}`,
                    dueDays: a.dueDays ?? 1,
                  });
                if (a.note) actions.push({ type: 'note', text: a.noteText || '' });
                if (a.tag && a.tagText.trim()) actions.push({ type: 'tag', tag: a.tagText.trim() });
                if (a.nextAction && a.nextActionText.trim())
                  actions.push({ type: 'nextAction', text: a.nextActionText.trim() });
                if (
                  await onSave('workflowRules', [
                    {
                      id: uid(),
                      name: ruleDraft.name.trim(),
                      triggerTable: ruleDraft.triggerTable,
                      triggerField: ruleDraft.triggerField,
                      op: ruleDraft.op,
                      value: ruleDraft.value,
                      actions,
                      enabled: true,
                      created: today(),
                    },
                  ])
                ) {
                  notify(`Rule “${ruleDraft.name.trim()}” saved.`);
                  setRuleDraft(null);
                }
              }}
            >
              Save rule
            </Button>
            <Button variant="ghost" onClick={() => setRuleDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <h3 className="history-heading">Audit log</h3>
      <div className="audit-list">
        {rows.map((e) => (
          <article key={e.id} className="audit-row">
            <Badge tone={e.action === 'exported' || e.action === 'anonymized' ? 'amber' : 'gray'}>
              {e.action}
            </Badge>
            <span>{e.detail || e.entityType}</span>
            <small>
              {new Date(e.date).toLocaleString()} · {e.actor}
            </small>
          </article>
        ))}
        {!rows.length && (
          <p className="supporting-text">
            Profile views, exports, submissions, merges, consent events and anonymizations will
            appear here.
          </p>
        )}
      </div>
    </section>
  );
}
