import React, { useState } from 'react';
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Pencil,
  MapPin,
  Clock,
  Users,
  BriefcaseBusiness,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  SlidersHorizontal,
  FileSearch,
  ShieldCheck,
} from 'lucide-react';
import {
  PageHeader,
  Button,
  Field,
  Modal,
  Badge,
  SearchBox,
  Empty,
  Avatar,
  PanelHeading,
} from './ui.jsx';
import {
  uid,
  today,
  skillList,
  WEIGHTS,
  extractJD,
  matchCandidate,
  money,
  STAGES,
  stageLabel,
} from './domain.js';
import { ENGAGEMENT_TYPES, PROFICIENCY_LEVELS } from './taxonomy.js';
import { OfferModal } from './Interviews.jsx';
import {
  buildSubmissionPack,
  submissionConsentState,
  submissionMailHref,
  SUBMISSION_METHODS,
} from './submissions.js';
import { coolingOffCheck } from './portal.js';
import { deriveGaps } from './gaps.js';
import { marginPct } from './analytics.js';
import { canWriteForRole, getRole } from './repository.js';
// Weights are compared at a fixed precision: binary floats make 33.4+33.3+33.3 equal
// 99.99999999999999, which used to reject a demand the recruiter could see summed to 100.
export const weightSum = (weights) =>
  Object.values(weights || {}).reduce((a, b) => a + (Number(b) || 0), 0);
export const weightsSumTo100 = (weights) => Math.round(weightSum(weights) * 100) === 10000;
const formatWeightSum = (weights) => String(Math.round(weightSum(weights) * 100) / 100);
export function DemandForm({ demand, data, onClose, onSave, onCreated, busy }) {
  const [form, setForm] = useState(
      demand || {
        title: '',
        client: '',
        skills: [],
        niceToHave: [],
        tags: [],
        minExperience: 5,
        maxNotice: 30,
        budget: 35,
        location: 'Bengaluru',
        mode: 'Hybrid',
        positions: 1,
        priority: 'High',
        status: 'Open',
        careersVisible: false,
        target: '',
        description: '',
        weights: { ...WEIGHTS },
        engagementType: 'Any',
        minProficiency: 'Working',
        skillMinimums: {},
        stageSet: [],
      },
    ),
    [skills, setSkills] = useState(demand?.skills.join(', ') || ''),
    [niceSkills, setNiceSkills] = useState(demand?.niceToHave?.join(', ') || ''),
    [tags, setTags] = useState(demand?.tags?.join(', ') || ''),
    [owner, setOwner] = useState(demand?.owner || ''),
    [businessUnit, setBusinessUnit] = useState(demand?.businessUnit || ''),
    [stageSet, setStageSet] = useState(demand?.stageSet || []),
    [parsed, setParsed] = useState(false),
    [error, setError] = useState('');
  const field = (key, type = 'text', props = {}) => (
    <input
      name={key}
      type={type}
      value={form[key]}
      onChange={(e) =>
        setForm({
          ...form,
          [key]:
            type === 'number'
              ? e.target.value === ''
                ? ''
                : Number(e.target.value)
              : e.target.value,
        })
      }
      {...props}
    />
  );
  async function submit(e) {
    e.preventDefault();
    const target = e.currentTarget.elements.namedItem('target').value;
    if (!target) return setError('Select a target start date.');
    if (!skillList(skills).length) return setError('Add at least one must-have skill.');
    if (!weightsSumTo100(form.weights)) return setError('Matching weights must add up to 100%.');
    const record = {
      ...form,
      target,
      id: form.id || uid(),
      skills: skillList(skills),
      niceToHave: skillList(niceSkills),
      tags: skillList(tags),
      custom: form.custom || {},
      owner: owner || '',
      businessUnit: businessUnit || '',
      engagementType: form.engagementType || 'Any',
      minProficiency: form.minProficiency || 'Working',
      skillMinimums: form.skillMinimums || {},
      stageSet,
      created: form.created || today(),
    };
    if (await onSave('demands', [record])) {
      onClose();
      onCreated(record.id);
    }
  }
  return (
    <Modal
      title={demand ? 'Edit demand' : 'Create a new demand'}
      subtitle="Start with the requirement. Discover the talent you already know."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="jd-parser wide">
            <Field label="Job description">
              <textarea
                rows={4}
                placeholder="Paste the JD here, or fill in the requirements below…"
                value={form.description}
                onChange={(e) => {
                  setForm({ ...form, description: e.target.value });
                  setParsed(false);
                }}
              />
            </Field>
            <div>
              <span>Keyword extraction · Review before saving</span>
              <Button
                type="button"
                variant="secondary"
                icon={FileSearch}
                disabled={!form.description.trim()}
                onClick={() => {
                  const draft = extractJD(form.description);
                  setForm({ ...form, ...draft });
                  setSkills(draft.skills.join(', '));
                  setParsed(true);
                }}
              >
                Extract requirements
              </Button>
            </div>
            {parsed && (
              <p className="parser-notice">
                Detected skills and numeric requirements are suggestions. Confirm the fields below;
                this does not infer every requirement in the JD.
              </p>
            )}
          </div>
          <Field label="Role title *">{field('title', 'text', { required: true })}</Field>
          <Field label="Client *">{field('client', 'text', { required: true })}</Field>
          <Field
            label="Must-have skills *"
            wide
            hint="Separate with commas. All listed skills are treated as mandatory."
          >
            <input
              value={skills}
              required
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Databricks, Unity Catalog, Python"
            />
          </Field>
          <Field
            label="Nice-to-have skills"
            wide
            hint="Shown as extra coverage signals; they never add hard failures."
          >
            <input
              value={niceSkills}
              onChange={(e) => setNiceSkills(e.target.value)}
              placeholder="Snowflake, Power BI"
            />
          </Field>
          <Field label="Tags" wide hint="Internal labels for your own organisation of demands.">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Data platform, High priority"
            />
          </Field>
          {(
            data.settings.find((r) => r && r.id === 'workspace')?.custom?.customFields?.demands ||
            []
          ).map((f) => (
            <Field key={f.name} label={f.name}>
              {f.type === 'select' ? (
                <select
                  value={form.custom?.[f.name] ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      custom: { ...(form.custom || {}), [f.name]: e.target.value },
                    })
                  }
                >
                  {(f.options || []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={form.custom?.[f.name] ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      custom: {
                        ...(form.custom || {}),
                        [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                      },
                    })
                  }
                />
              )}
            </Field>
          ))}
          <Field label="Demand owner" hint="Who owns this requirement internally.">
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Amit Singh"
            />
          </Field>
          <Field
            label="Business unit"
            hint="The client-side unit or practice this demand belongs to."
          >
            <input
              value={businessUnit}
              onChange={(e) => setBusinessUnit(e.target.value)}
              placeholder="Data & AI"
            />
          </Field>
          <Field label="Minimum relevant experience *">
            {field('minExperience', 'number', { required: true, min: 0, max: 50, step: 0.5 })}
          </Field>
          <Field label="Maximum notice (days) *">
            {field('maxNotice', 'number', { required: true, min: 0, max: 365 })}
          </Field>
          <Field label="Maximum expected CTC (₹ LPA) *">
            {field('budget', 'number', { required: true, min: 0.1, step: 0.1 })}
          </Field>
          <Field label="Location *">{field('location', 'text', { required: true })}</Field>
          <Field label="Work mode">
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {['Hybrid', 'Remote', 'Onsite'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Engagement type">
            <select
              value={form.engagementType || 'Any'}
              onChange={(e) => setForm({ ...form, engagementType: e.target.value })}
            >
              {['Any', ...ENGAGEMENT_TYPES].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Minimum must-have proficiency">
            <select
              value={form.minProficiency || 'Working'}
              onChange={(e) => setForm({ ...form, minProficiency: e.target.value })}
            >
              {PROFICIENCY_LEVELS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Open positions *">
            {field('positions', 'number', { required: true, min: 1, max: 1000 })}
          </Field>
          <Field label="Priority">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {['High', 'Medium', 'Low'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Target start date *">{field('target', 'date', { required: true })}</Field>
          {demand && (
            <Field label="Demand status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {['Open', 'On hold', 'Closed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}
          <div className="per-skill-min wide careers-publish-control">
            <label className="careers-publish-label">
              <input
                type="checkbox"
                checked={form.careersVisible === true}
                onChange={(e) => setForm({ ...form, careersVisible: e.target.checked })}
              />
              Publish this role on the public careers page
            </label>
            <p className="careers-publish-hint">
              Only explicitly published roles that are still Open appear to applicants. Budget,
              matching weights and internal tags are never included in the public listing.
            </p>
          </div>
          {skillList(skills).length > 0 && (
            <div className="per-skill-min wide">
              <span>Minimum proficiency per must-have skill</span>
              <div className="per-skill-grid">
                {skillList(skills).map((sk) => (
                  <Field key={sk} label={sk}>
                    <select
                      value={(form.skillMinimums || {})[sk] || form.minProficiency || 'Working'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          skillMinimums: { ...(form.skillMinimums || {}), [sk]: e.target.value },
                        })
                      }
                    >
                      {PROFICIENCY_LEVELS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          )}
          <div className="per-skill-min wide">
            <span>Pipeline stages for this demand (none ticked = all ten)</span>
            <div className="stage-set-grid">
              {STAGES.map((s) => (
                <label key={s} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={stageSet.includes(s)}
                    onChange={(e) =>
                      setStageSet(
                        e.target.checked ? [...stageSet, s] : stageSet.filter((x) => x !== s),
                      )
                    }
                  />{' '}
                  {s}
                </label>
              ))}
            </div>
          </div>
          <details className="weights-editor wide">
            <summary>
              <SlidersHorizontal size={15} /> Configure matching weights{' '}
              <span>Total: {formatWeightSum(form.weights)}%</span>
            </summary>
            <div className="form-grid">
              {Object.entries(form.weights).map(([k, v]) => (
                <Field key={k} label={`${k[0].toUpperCase() + k.slice(1)} (%)`}>
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.1"
                    value={v}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        weights: { ...form.weights, [k]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </details>
          {error && (
            <div className="form-error wide" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : demand ? 'Save demand' : 'Create & find matches'}
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function Demands({ data, onNew, onOpen }) {
  const viewer = !canWriteForRole(getRole());
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('Open');
  const rows = data.demands.filter(
    (d) =>
      (status === 'All' || d.status === status) &&
      [d.title, d.client, ...d.skills].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="FROM DEMAND TO DELIVERY"
        title="Find the people behind every possibility."
        description="Capture client requirements and put your repository to work."
      >
        {!viewer && (
          <Button icon={Plus} onClick={onNew}>
            Create demand
          </Button>
        )}
      </PageHeader>
      <div className="page-toolbar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search roles, clients or skills…"
        />
        <select
          aria-label="Demand status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {['Open', 'On hold', 'Closed', 'All'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="demands-grid">
        {rows.map((d, i) => {
          const matches = data.candidates.filter(
            (c) => matchCandidate(c, d, data.assessments).score >= 70,
          ).length;
          const pipeline = data.considerations.filter((a) => a.demandId === d.id).length;
          return (
            <article className="demand-card" key={d.id}>
              <div className="demand-card-top">
                <span className={`company-icon company-${i % 4}`}>
                  {d.client
                    .split(' ')
                    .slice(0, 2)
                    .map((s) => s[0])
                    .join('')}
                </span>
                <Badge>{d.priority}</Badge>
              </div>
              <span className="card-eyebrow">{d.client}</span>
              <h2>
                <button onClick={() => onOpen(d.id)}>{d.title}</button>
              </h2>
              <div className="card-meta">
                <span>
                  <MapPin size={14} />
                  {d.location} · {d.mode}
                </span>
                <span>
                  <Users size={14} />
                  {d.positions} {d.positions === 1 ? 'position' : 'positions'}
                </span>
              </div>
              <div className="skill-tags">
                {d.skills.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <div className="demand-card-metrics">
                <div>
                  <strong>{matches}</strong>
                  <small>70%+ matches</small>
                </div>
                <div>
                  <strong>{pipeline}</strong>
                  <small>in pipeline</small>
                </div>
                <div>
                  <strong>{d.minExperience}+</strong>
                  <small>relevant years</small>
                </div>
              </div>
              <div className="demand-card-bottom">
                <span>Target · {d.target}</span>
                <Button variant="ghost" onClick={() => onOpen(d.id)}>
                  View matches
                  <ArrowRight size={15} />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <Empty
          title="No demands found"
          text="Create a demand to start matching your repository."
          action={
            !viewer && (
              <Button icon={Plus} onClick={onNew}>
                Create demand
              </Button>
            )
          }
        />
      )}
    </>
  );
}
export function DemandDetail({
  demand: d,
  data,
  onBack,
  onEdit,
  onOpenCandidate,
  onShortlist,
  onPipeline,
  onEnrich,
  onSave,
  busy,
  audit,
}) {
  const viewer = !canWriteForRole(getRole());
  const [onlyQualified, setOnlyQualified] = useState(false),
    [minScore, setMinScore] = useState(0),
    [expanded, setExpanded] = useState(''),
    [search, setSearch] = useState(''),
    [offerOpen, setOfferOpen] = useState(false),
    [submitFor, setSubmitFor] = useState(null);
  const ranked = data.candidates
    .map((c) => ({ c, m: matchCandidate(c, d, data.assessments) }))
    .filter(
      ({ c, m }) =>
        (!onlyQualified || m.eligible) &&
        m.score >= minScore &&
        [c.name, c.title, ...c.skills].join(' ').toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.m.score - a.m.score);
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        All demands
      </button>
      <PageHeader
        eyebrow={d.client.toUpperCase()}
        title={d.title}
        description={`${d.location} · ${d.mode} · ${d.positions} open positions · Target ${d.target}`}
      >
        {!viewer && (
          <Button variant="secondary" icon={Pencil} onClick={() => onEdit(d)}>
            Edit demand
          </Button>
        )}
        <Button icon={ColumnsIcon} onClick={() => onPipeline(d.id)}>
          View pipeline
        </Button>
      </PageHeader>
      <div className="matching-layout">
        <aside className="panel requirements">
          <PanelHeading title="The brief" action={<Badge>{d.status}</Badge>} />
          <div className="requirements-body">
            <h3>Must-have skills</h3>
            <div className="skill-tags large-tags">
              {d.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
            {(d.tags || []).length > 0 && (
              <div className="demand-tags">
                <span>Tags</span>
                {d.tags.map((t) => (
                  <span className="tag-chip" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            <dl>
              {[
                ['Relevant experience', `${d.minExperience}+ years`],
                ['Maximum notice', `${d.maxNotice} days`],
                ['Budget', money(d.budget)],
                ['Work mode', d.mode],
                ['Engagement', d.engagementType || 'Any'],
                ['Min must-have proficiency', d.minProficiency || 'Working'],
                ['Priority', d.priority],
                ...(d.owner ? [['Demand owner', d.owner]] : []),
                ...(d.businessUnit ? [['Business unit', d.businessUnit]] : []),
              ].map(([l, v]) => (
                <div key={l}>
                  <dt>{l}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {getRole() === 'admin' && <CommercialsPanel demand={d} data={data} onSave={onSave} />}
            <h3>Offers</h3>
            {data.offers
              .filter((o) => o.demandId === d.id)
              .sort((a, b) =>
                a.status === b.status ? 0 : a.status === 'Sent' ? -1 : b.status === 'Sent' ? 1 : 0,
              )
              .map((o) => {
                const oc = data.candidates.find((x) => x.id === o.candidateId);
                return (
                  <div className="offer-line" key={o.id}>
                    <span className="person-compact">{oc ? oc.name : 'Removed'}</span>
                    <Badge
                      tone={
                        o.status === 'Accepted'
                          ? 'green'
                          : o.status === 'Sent'
                            ? 'blue'
                            : o.status === 'Rejected'
                              ? 'red'
                              : 'gray'
                      }
                    >
                      {o.status}
                    </Badge>
                    <small>{o.ctc != null ? `${money(o.ctc)} LPA` : ''}</small>
                  </div>
                );
              })}
            {!data.offers.some((o) => o.demandId === d.id) && (
              <p className="supporting-text">No offers raised for this demand yet.</p>
            )}
            {!viewer && (
              <Button
                variant="secondary"
                className="small"
                disabled={busy}
                onClick={() => setOfferOpen(true)}
              >
                Raise an offer
              </Button>
            )}
            <h3>Client submissions</h3>
            {data.submissions
              .filter((x) => x.demandId === d.id)
              .sort((a, b) => String(b.submittedOn).localeCompare(String(a.submittedOn)))
              .map((sub) => {
                const sc = data.candidates.find((x) => x.id === sub.candidateId);
                return (
                  <div className="offer-line" key={sub.id}>
                    <span className="person-compact">{sc ? sc.name : 'Removed'}</span>
                    <Badge>{sub.method}</Badge>
                    <small>
                      {sub.submittedOn}
                      {sub.clientContact ? ` · ${sub.clientContact}` : ''}
                    </small>
                    <select
                      aria-label="Client decision"
                      value={sub.clientStatus || 'Pending'}
                      disabled={viewer || busy}
                      onChange={async (e) => {
                        const v = e.target.value;
                        if (
                          await onSave('submissions', [
                            {
                              ...sub,
                              clientStatus: v,
                              decidedOn: v === 'Pending' ? null : today(),
                            },
                          ])
                        )
                          audit &&
                            audit({
                              entityType: 'submission',
                              entityId: sub.id,
                              action: 'updated',
                              detail: `Client decision: ${v}`,
                            });
                      }}
                    >
                      {['Pending', 'Shortlisted', 'Rejected', 'Hired'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                    {!viewer && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={async () => {
                          const c = window.prompt(
                            'Client feedback (shared with your team only):',
                            sub.clientComment || '',
                          );
                          if (
                            c != null &&
                            (await onSave('submissions', [{ ...sub, clientComment: c }]))
                          )
                            audit &&
                              audit({
                                entityType: 'submission',
                                entityId: sub.id,
                                action: 'updated',
                                detail: 'Client feedback recorded',
                              });
                        }}
                      >
                        {sub.clientComment ? 'Feedback' : 'Add feedback'}
                      </button>
                    )}
                    <Badge
                      tone={
                        sub.clientStatus === 'Hired'
                          ? 'green'
                          : sub.clientStatus === 'Shortlisted'
                            ? 'blue'
                            : sub.clientStatus === 'Rejected'
                              ? 'red'
                              : 'gray'
                      }
                    >
                      {sub.clientStatus || 'Pending'}
                    </Badge>
                  </div>
                );
              })}
            {!data.submissions.some((x) => x.demandId === d.id) && (
              <p className="supporting-text">No client submissions logged for this demand yet.</p>
            )}
            {!viewer && (
              <Button
                variant="secondary"
                className="small"
                disabled={busy}
                onClick={() => setSubmitFor('new')}
              >
                Prepare submission
              </Button>
            )}
            <h3>Matching priorities</h3>
            {Object.entries(d.weights).map(([k, v]) => (
              <div className="weight-row" key={k}>
                <span>{k}</span>
                <div>
                  <i style={{ width: `${v}%` }} />
                </div>
                <strong>{v}%</strong>
              </div>
            ))}
            <div className="matching-note">
              <ShieldIcon />
              <p>
                Scores support recruiter review. Missing requirements and unverified evidence stay
                visible.
              </p>
            </div>
            {d.description && (
              <details>
                <summary>Original job description</summary>
                <p className="jd-text">{d.description}</p>
              </details>
            )}
          </div>
        </aside>
        <section className="matches-area">
          <div className="matches-heading">
            <div>
              <h2>Your repository, matched.</h2>
              <p>{ranked.length} candidates · ranked by requirement fit</p>
            </div>
            <Badge tone="green">Explainable matching</Badge>
          </div>
          <div className="match-filters">
            <SearchBox value={search} onChange={setSearch} placeholder="Search these matches…" />
            <select
              aria-label="Minimum match score"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
            >
              <option value={0}>All scores</option>
              <option value={70}>70% and above</option>
              <option value={85}>85% and above</option>
            </select>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={onlyQualified}
                onChange={(e) => setOnlyQualified(e.target.checked)}
              />
              Verified fits only
            </label>
          </div>
          {ranked.map(({ c, m }, i) => {
            const existing = data.considerations.find(
              (a) => a.candidateId === c.id && a.demandId === d.id,
            );
            return (
              <article className="match-card" key={c.id}>
                <div className="match-card-main">
                  <Avatar name={c.name} index={i} />
                  <button className="match-person" onClick={() => onOpenCandidate(c.id)}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.title} · {c.company}
                    </span>
                    <small>
                      {c.location} · {c.experience ?? 'Unverified'} years ·{' '}
                      {c.notice == null
                        ? 'Unknown notice'
                        : c.notice === 0
                          ? 'Immediate'
                          : `${c.notice}-day notice`}
                    </small>
                  </button>
                  <div className={`match-score ${m.score < 70 ? 'moderate' : ''}`}>
                    <strong>
                      {m.score}
                      <span>%</span>
                    </strong>
                    <small>match score</small>
                  </div>
                </div>
                <div className="match-skills">
                  {d.skills.map((s) => (
                    <span className={m.matched.includes(s) ? 'matched' : 'missing'} key={s}>
                      {m.matched.includes(s) ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <AlertCircle size={12} />
                      )}{' '}
                      {s}
                    </span>
                  ))}
                  {m.niceCoverage.matched.map((s) => (
                    <span className="matched nice" key={'n' + s} title="Nice-to-have">
                      ✦ {s}
                    </span>
                  ))}
                  {m.niceCoverage.missing.length > 0 && d.niceToHave?.length > 0 && (
                    <span className="nice-note">
                      {m.niceCoverage.missing.length} nice-to-have missing
                    </span>
                  )}
                </div>
                <div className="match-flags">
                  {m.blockers.length ? (
                    <span className="constraint-warning">
                      <AlertCircle size={13} />
                      {m.blockers.length} requirement {m.blockers.length === 1 ? 'gap' : 'gaps'}
                    </span>
                  ) : (
                    <span className="text-green">
                      <CheckCircle2 size={13} />
                      No known requirement failures
                    </span>
                  )}
                  {m.unknowns.length > 0 && (
                    <span>
                      <Clock size={13} />
                      {m.unknowns.length} items to verify
                    </span>
                  )}
                  <Badge>{c.status}</Badge>
                </div>
                <div className="match-actions">
                  <button
                    className="explain-button"
                    onClick={() => setExpanded(expanded === c.id ? '' : c.id)}
                  >
                    Why this match?
                    <ChevronDown
                      size={15}
                      style={{ transform: expanded === c.id ? 'rotate(180deg)' : '' }}
                    />
                  </button>
                  {!viewer && (
                    <Button
                      variant={existing ? 'secondary' : ''}
                      className="small"
                      disabled={Boolean(existing) || busy || d.status !== 'Open'}
                      onClick={() => onShortlist(c.id, d.id)}
                    >
                      {existing ? `In pipeline · ${existing.stage}` : 'Add to shortlist'}
                      {!existing && <Plus size={14} />}
                    </Button>
                  )}
                </div>
                {expanded === c.id && (
                  <div className="match-explanation">
                    {Object.entries(m.scores).map(([key, value]) => (
                      <div className="score-component" key={key}>
                        <div>
                          <strong>{key}</strong>
                          <small>{m.details[key]}</small>
                        </div>
                        <div className="score-bar">
                          <i style={{ width: `${value * 100}%` }} />
                        </div>
                        <span>
                          {Math.round(value * m.weights[key])}/{m.weights[key]}
                        </span>
                      </div>
                    ))}
                    {m.blockers.length > 0 && (
                      <div className="constraint-list">
                        <strong>Requirement gaps</strong>
                        <ul>
                          {m.blockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {m.unknowns.length > 0 && (
                      <div className="verification-list">
                        <strong>Confirm before progressing</strong>
                        <ul>
                          {m.unknowns.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(() => {
                      const gaps = deriveGaps(c, d, m, {
                        assessments: data.assessments,
                        enrichment: data.enrichment,
                      });
                      return (
                        gaps.length > 0 && (
                          <div className="gap-list">
                            <strong>Gap map</strong>
                            <table>
                              <thead>
                                <tr>
                                  <th>Skill</th>
                                  <th>Severity</th>
                                  <th>Cause</th>
                                  <th>Status</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {gaps.map((g) => (
                                  <tr key={g.skill}>
                                    <td>{g.skill}</td>
                                    <td>
                                      <Badge
                                        tone={
                                          g.severity === 'critical'
                                            ? 'red'
                                            : g.severity === 'trainable'
                                              ? 'amber'
                                              : 'gray'
                                        }
                                      >
                                        {g.severity}
                                      </Badge>
                                    </td>
                                    <td>{g.cause}</td>
                                    <td>
                                      <Badge
                                        tone={
                                          g.status === 'Closed'
                                            ? 'green'
                                            : g.status === 'Enrichment planned'
                                              ? 'blue'
                                              : 'gray'
                                        }
                                      >
                                        {g.status}
                                      </Badge>
                                    </td>
                                    <td>
                                      {g.status === 'Open' && onEnrich && !viewer && (
                                        <Button
                                          variant="ghost"
                                          className="small"
                                          onClick={() =>
                                            onEnrich({
                                              candidateId: c.id,
                                              demandId: d.id,
                                              gapSkill: g.skill,
                                            })
                                          }
                                        >
                                          Plan enrichment
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      );
                    })()}
                  </div>
                )}
              </article>
            );
          })}
          {!ranked.length && (
            <Empty
              title="No profiles meet these filters"
              text="Widen the score or verification filters, or add more candidates."
            />
          )}
        </section>
      </div>
      {submitFor && !viewer && (
        <SubmissionModal
          demand={d}
          data={data}
          onClose={() => setSubmitFor(null)}
          onSave={onSave}
          audit={audit}
        />
      )}
      {offerOpen && !viewer && (
        <OfferModal
          onClose={() => setOfferOpen(false)}
          onSave={onSave}
          candidates={data.candidates}
          demands={data.demands.filter((x) => x.status === 'Open')}
          preselect={{ demandId: d.id, role: d.title, location: d.location }}
        />
      )}
    </>
  );
}
function ColumnsIcon(props) {
  return <BriefcaseBusiness {...props} />;
}
function ShieldIcon() {
  return <CheckCircle2 size={18} />;
}
export function Pipeline({ data, selectedDemand, setSelectedDemand, onOpen, onNew, onMove, busy }) {
  const viewer = !canWriteForRole(getRole());
  const d = data.demands.find((d) => d.id === selectedDemand) || data.demands[0];
  const [showClosed, setShowClosed] = useState(false);
  const stagePool = d && Array.isArray(d.stageSet) && d.stageSet.length ? d.stageSet : STAGES;
  const demandLocked = Boolean(d) && d.status !== 'Open';
  const stages = showClosed
    ? [...stagePool, ...(stagePool.includes('Rejected') ? [] : ['Rejected', 'Withdrawn'])]
    : stagePool.filter((s) => !['Rejected', 'Withdrawn'].includes(s));
  return (
    <>
      <PageHeader
        eyebrow="A CLEAR PATH FROM FIRST HELLO TO HIRED"
        title="Hiring pipeline"
        description="A separate journey for every candidate and every opportunity."
      >
        {!viewer && (
          <Button icon={Plus} onClick={onNew}>
            Create demand
          </Button>
        )}
      </PageHeader>
      <div className="pipeline-toolbar">
        <Field label="Demand">
          <select value={d?.id || ''} onChange={(e) => setSelectedDemand(e.target.value)}>
            {!d && <option>No demands yet</option>}
            {data.demands.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {d.client}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          Show rejected & withdrawn
        </label>
        <span>{data.considerations.filter((a) => a.demandId === d?.id).length} considerations</span>
        {demandLocked && (
          <span className="constraint-warning">
            This demand is {d.status} — pipeline moves are locked until it reopens.
          </span>
        )}
      </div>
      {d ? (
        <div className="kanban-board">
          {stages.map((stage, i) => {
            const rows = data.considerations.filter(
              (a) => a.demandId === d.id && a.stage === stage,
            );
            return (
              <section className="kanban-column" key={stage}>
                <div className="kanban-heading">
                  <span
                    style={{
                      background: [
                        '#90a8b2',
                        '#77aca5',
                        '#61a698',
                        '#b9a36e',
                        '#6d9da4',
                        '#7b90b7',
                        '#8a8bb5',
                        '#43967b',
                      ][i % 8],
                    }}
                  />
                  <h2>{stageLabel(stage)}</h2>
                  <b>{rows.length}</b>
                </div>
                <div className="kanban-cards">
                  {rows.map((a) => {
                    const c = data.candidates.find((c) => c.id === a.candidateId);
                    if (!c) return null;
                    const match = matchCandidate(c, d, data.assessments);
                    return (
                      <article className="pipeline-card" key={a.id}>
                        <button className="pipeline-person" onClick={() => onOpen(c.id)}>
                          <Avatar name={c.name} size="small" />
                          <strong>{c.name}</strong>
                        </button>
                        <p>{c.title}</p>
                        <div className="pipeline-card-info">
                          <span>{match.score}% fit</span>
                          <span>
                            {c.notice == null
                              ? 'Unknown notice'
                              : c.notice === 0
                                ? 'Immediate'
                                : `${c.notice} days`}
                          </span>
                        </div>
                        <div className="skill-tags">
                          {c.skills.slice(0, 2).map((s) => (
                            <span key={s}>{s}</span>
                          ))}
                        </div>
                        <label>
                          Move to
                          <select
                            aria-label={`Stage for ${c.name}`}
                            value={stage}
                            disabled={busy || demandLocked || viewer}
                            title={
                              viewer
                                ? 'Viewer role is read-only'
                                : demandLocked
                                  ? `This demand is ${d.status}; reopen it to move candidates.`
                                  : undefined
                            }
                            onChange={(e) => onMove(a, e.target.value)}
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {stageLabel(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {a.reason && <small>{a.reason}</small>}
                      </article>
                    );
                  })}
                  {!rows.length && <div className="empty-column">No candidates yet</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty title="Create your first demand" text="Shortlisted candidates will appear here." />
      )}
    </>
  );
}

function CommercialsPanel({ demand: d, data, onSave }) {
  const row = data.demandCommercials.find((x) => x.demandId === d.id);
  const [cost, setCost] = useState(row?.internalCost ?? '');
  const [note, setNote] = useState(row?.notes || '');
  const margin = marginPct(d.budget, cost === '' ? null : Number(cost));
  const dirty = (row?.internalCost ?? '') !== cost || (row?.notes || '') !== note;
  return (
    <details className="commercials-box">
      <summary>
        <strong>Internal commercials</strong> <span className="admin-chip">admin only</span>
      </summary>
      <p className="supporting-text">
        Client budget {money(d.budget)}. Internal cost and margin live in an admin-only table;
        recruiters and viewers never receive it from the API.
      </p>
      <div className="commercials-form">
        <Field label="Internal target cost (LPA)">
          <input
            type="number"
            min="0"
            step="0.1"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="commercials-meta">
        <span>
          Margin: <strong>{margin == null ? '—' : `${margin}%`}</strong>
        </span>
        <Button
          className="small"
          disabled={!dirty}
          onClick={() =>
            onSave('demandCommercials', [
              row
                ? {
                    ...row,
                    internalCost: cost === '' ? null : Number(cost),
                    notes: note,
                    updated: new Date().toISOString(),
                  }
                : {
                    id: crypto.randomUUID(),
                    demandId: d.id,
                    internalCost: cost === '' ? null : Number(cost),
                    currency: 'INR',
                    notes: note,
                    updated: new Date().toISOString(),
                  },
            ])
          }
        >
          Save commercials
        </Button>
      </div>
    </details>
  );
}

export function SubmissionModal({ demand: d, data, onClose, onSave, audit, busy }) {
  const pipeline = data.considerations.filter(
    (a) => a.demandId === d.id && !['Identified', 'Rejected', 'Withdrawn'].includes(a.stage),
  );
  const eligible = pipeline
    .map((a) => data.candidates.find((c) => c.id === a.candidateId))
    .filter(Boolean);
  const [form, setForm] = useState({
    candidateId: eligible[0]?.id || '',
    clientContact: '',
    method: 'Email',
    notes: '',
  });
  const [error, setError] = useState('');
  const candidate = data.candidates.find((c) => c.id === form.candidateId);
  const consent = candidate ? submissionConsentState(data.consents, candidate.id) : null;
  const cool = candidate
    ? coolingOffCheck(
        candidate.id,
        data.submissions,
        data.demands,
        d.client,
        Number(
          (data.settings.find((r) => r && r.id === 'workspace')?.custom || {}).coolingOffDays ?? 30,
        ) || 30,
      )
    : null;
  const pack = candidate ? buildSubmissionPack(candidate, d, data) : null;
  async function submit(e) {
    e.preventDefault();
    if (!form.candidateId) return setError('Choose a candidate from this demand pipeline.');
    if (!form.clientContact.trim()) return setError('Add the client contact this is going to.');
    if (
      cool &&
      cool.blocked &&
      !window.confirm(
        `${candidate.name} was rejected by ${d.client} on ${cool.when} (${cool.daysAgo} days ago), inside the cooling-off window. Submit anyway?`,
      )
    )
      return;
    const record = {
      ...form,
      id: uid(),
      demandId: d.id,
      submittedOn: today(),
      created: new Date().toISOString(),
      pack: pack
        ? { consent: consent.state, assessments: pack.assessments, interviews: pack.interviews }
        : {},
      clientContact: form.clientContact.trim(),
    };
    if (await onSave('submissions', [record])) {
      audit &&
        audit({
          entityType: 'demand',
          entityId: d.id,
          action: 'submitted',
          detail: `${candidate.name} submitted to ${form.clientContact.trim()} (${form.method})`,
        });
      onClose();
    }
  }
  return (
    <Modal
      title="Prepare client submission"
      subtitle="Stage 7 Deliver — an honest, compiled pack from verified workspace facts. Current CTC, contact details and internal commercials are never included."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="Candidate *">
            <select
              value={form.candidateId}
              onChange={(e) => setForm({ ...form, candidateId: e.target.value })}
            >
              <option value="">Select from this demand's pipeline…</option>
              {eligible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Method">
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              {SUBMISSION_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Client contact *" hint="Where the submission goes.">
            <input
              value={form.clientContact}
              onChange={(e) => setForm({ ...form, clientContact: e.target.value })}
              placeholder={`hiring@${(d.client || 'client').toLowerCase().replace(/[^a-z]+/g, '')}.example`}
            />
          </Field>
          <Field label="Internal note">
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Context for your team (never shared)"
            />
          </Field>
          {cool && cool.blocked && (
            <div className="submission-consent warn">
              <ShieldCheck size={16} />
              <span>
                Cooling-off: {candidate.name} was rejected by {d.client} on {cool.when} (
                {cool.daysAgo} days ago). Confirm you want to submit anyway.
              </span>
            </div>
          )}
          {consent && (
            <div className={`submission-consent ${consent.ok ? 'ok' : 'warn'}`}>
              <ShieldCheck size={16} />
              <span>
                {consent.ok
                  ? 'Profile-sharing consent on record — safe to submit.'
                  : `${consent.label}. Record profile-sharing consent on the candidate's Consent & privacy tab before submitting.`}
              </span>
            </div>
          )}
          {pack && (
            <div className="submission-preview wide">
              <span>Pack preview — what the client receives</span>
              <pre>{pack.packText}</pre>
            </div>
          )}
          {error && <p className="form-error wide">{error}</p>}
        </div>
        <div className="modal-actions">
          {candidate && (
            <a
              className="button ghost"
              href={submissionMailHref(pack, candidate, d, form.clientContact)}
            >
              Open email draft
            </a>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!consent || !consent.ok || busy}>
            Log submission
          </Button>
        </div>
      </form>
    </Modal>
  );
}
