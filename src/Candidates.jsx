import { AttachmentProcessing } from './AttachmentProcessing.jsx';
import { CandidateContacts } from './CandidateContacts.jsx';
import { CandidateAvailability } from './CandidateAvailability.jsx';
import { CandidateReadiness } from './CandidateReadiness.jsx';
import { CandidateScorecards } from './CandidateScorecards.jsx';
import { SubjectRequests } from './SubjectRequests.jsx';
import { CvEvidenceReview } from './CvEvidenceReview.jsx';
import { CustomFieldInputs, CustomFieldValues } from './CustomFields.jsx';
import { HostedIntelligence } from './HostedIntelligence.jsx';
import { anthroIdFor } from './anthroId.js';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus,
  Upload,
  Download,
  SlidersHorizontal,
  MapPin,
  Mail,
  Phone,
  Check,
  FileText,
  ExternalLink,
  Pencil,
  ArrowRight,
} from 'lucide-react';
import {
  PageHeader,
  Button,
  SearchBox,
  Badge,
  PersonName,
  Empty,
  Field,
  Modal,
  Avatar,
} from './ui.jsx';
import { SkillEvidencePanel } from './Skills.jsx';
import { PresentationModal } from './Presentation.jsx';
import { BulkBar, UndoBar } from './BulkBar.jsx';
import {
  freshness,
  money,
  uid,
  today,
  validateCandidate,
  duplicate,
  matchCandidate,
  candidateSearchText,
  skillList,
  MAX_EXPERIENCE_YEARS,
  MAX_NOTICE_DAYS,
} from './domain.js';
import { ScheduleModal, InterviewWhen, OfferModal } from './Interviews.jsx';
import { overallOf, RECOMMENDATION_TONES } from './feedback.js';
import { OFFER_TONES } from './offers.js';
import { rankByRelevance, similarCandidates, sharedSkills } from './semantic.js';
import {
  PROFICIENCY_LEVELS,
  EVIDENCE_SOURCES,
  ENGAGEMENT_TYPES,
  skillDetail,
  domainOf,
  blankSkillDetail,
} from './taxonomy.js';
import { captureChanges } from './history.js';
import { queueById } from './quality.js';
import { deriveGaps } from './gaps.js';
import {
  cloud,
  getRole,
  getWorkspaceId,
  canWriteForRole,
  queryRepositoryIds,
} from './repository.js';
import {
  blankRepositoryFilters,
  hasRepositoryFilters,
  validateRepositoryFilters,
  matchesRepositoryFilters,
} from './repositoryFilters.js';
import {
  classifyFile,
  extractDocumentText,
  privateAttachmentsEnabled,
  sha256,
  buildDocumentRecord,
  persistBinary,
  contentSignatureOk,
  signedUrlFor,
} from './documents.js';
import { documentTemplatesFor, mergeContext, renderTemplate, dossierHtml } from './templates.js';
import { parseTalentQuery, matchesSemantic, skillsUnder, allSkillDomains } from './semantic.js';
import { placementsForCandidate } from './placements.js';
export { downloadFile, canExportData, exportSensitiveFile, exportCandidates } from './downloads.js';
import { exportSensitiveFile } from './downloads.js';
import { exportCandidateData } from './candidateExports.js';
export function Candidates({
  data,
  query,
  setQuery,
  initialFilter,
  onOpen,
  onAdd,
  onImport,
  notify,
  audit,
  onSave,
  busy,
}) {
  const settingsRow = data.settings.find((r) => r && r.id === 'workspace');
  const savedViews = settingsRow?.custom?.savedViews || [];
  const [columns, setColumns] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ecod-columns-v1')) || {};
    } catch {
      return {};
    }
  });
  const col = (k, label) => ({ k, label, visible: columns[k] !== false });
  const [semantic, setSemantic] = useState(false);
  const [status, setStatus] = useState(initialFilter?.status || 'All candidates'),
    [queue, setQueue] = useState(initialFilter?.queue || ''),
    [filters, setFilters] = useState(false),
    [location, setLocation] = useState(''),
    [notice, setNotice] = useState(''),
    [minExp, setMinExp] = useState(''),
    [skill, setSkill] = useState(initialFilter?.skill || ''),
    [tag, setTag] = useState(''),
    [sort, setSort] = useState('name'),
    [selected, setSelected] = useState([]),
    [bulkUndo, setBulkUndo] = useState(null),
    [page, setPage] = useState(1);
  const queueDef = queueById(queue);
  const [repositoryFilters, setRepositoryFilters] = useState(blankRepositoryFilters);
  const [serverFilter, setServerFilter] = useState({ ids: null, pending: false, error: '' });
  const serverIds = useMemo(() => new Set(serverFilter.ids || []), [serverFilter.ids]);
  const advancedActive = hasRepositoryFilters(repositoryFilters);
  const filterError = validateRepositoryFilters(repositoryFilters, getRole() === 'admin');
  useEffect(() => {
    let current = true;
    if (!cloud || !advancedActive || filterError) {
      setServerFilter({ ids: null, pending: false, error: '' });
      return undefined;
    }
    setServerFilter({ ids: null, pending: true, error: '' });
    const timer = setTimeout(() => {
      queryRepositoryIds(repositoryFilters)
        .then((ids) => {
          if (current) setServerFilter({ ids, pending: false, error: '' });
        })
        .catch((error) => {
          if (current) setServerFilter({ ids: [], pending: false, error: error.message });
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [repositoryFilters, advancedActive, filterError, data.candidates]);
  const filteredRows = useMemo(() => {
    const parsed = semantic ? parseTalentQuery(query) : null;
    const skillDomainSkills = skill && skill !== ' ' ? skillsUnder(skill) : null;
    return data.candidates
      .filter((c) => {
        if (
          filterError ||
          (cloud &&
            advancedActive &&
            (serverFilter.pending || !serverFilter.ids || !serverIds.has(c.id)))
        )
          return false;
        if (!cloud && !matchesRepositoryFilters(c, repositoryFilters)) return false;
        const text = candidateSearchText(c, data.documents);
        if (parsed && parsed.used) {
          if (!matchesSemantic(c, parsed, text)) return false;
        } else {
          const tokens = query.toLowerCase().match(/"[^"]+"|\S+/g) || [];
          if (
            !tokens
              .filter((t) => t !== 'and')
              .every((t) =>
                t.startsWith('-')
                  ? !text.includes(t.slice(1).replaceAll('"', ''))
                  : text.includes(t.replaceAll('"', '')),
              )
          )
            return false;
        }
        return (
          (!initialFilter?.ids || initialFilter.ids.includes(c.id)) &&
          (status === 'All candidates' ||
            c.status === status ||
            freshness(c.verified) === status) &&
          (!queueDef || queueDef.test(c)) &&
          (location === '' || c.location === location) &&
          (notice === '' || (c.notice != null && c.notice <= Number(notice))) &&
          (minExp === '' || (c.experience != null && c.experience >= Number(minExp))) &&
          (!skill ||
            c.skills.includes(skill) ||
            (skillDomainSkills && skillDomainSkills.some((d) => c.skills.includes(d)))) &&
          (!tag || c.tags.includes(tag))
        );
      })
      .sort((a, b) =>
        sort === 'experience'
          ? (b.experience || 0) - (a.experience || 0)
          : sort === 'recent'
            ? b.verified.localeCompare(a.verified)
            : a.name.localeCompare(b.name),
      );
  }, [
    data.candidates,
    data.documents,
    query,
    semantic,
    status,
    queueDef,
    location,
    notice,
    minExp,
    skill,
    tag,
    sort,
    initialFilter,
    repositoryFilters,
    serverFilter,
    serverIds,
    advancedActive,
    filterError,
  ]);
  const parsed = useMemo(() => (semantic ? parseTalentQuery(query) : null), [semantic, query]);
  const rows =
    sort === 'relevance' ? rankByRelevance(query, filteredRows, data.documents) : filteredRows;
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const activePage = Math.min(page, pages);
  const visible = rows.slice((activePage - 1) * 10, activePage * 10);
  const toggle = (id) =>
    setSelected((old) => (old.includes(id) ? old.filter((i) => i !== id) : [...old, id]));
  return (
    <>
      <PageHeader
        eyebrow="YOUR REUSABLE TALENT NETWORK"
        title="Talent repository"
        description="Every profile. Every possibility. One connected home."
      >
        {(!cloud || canWriteForRole(getRole())) && (
          <>
            <Button icon={Upload} variant="secondary" onClick={onImport}>
              Import candidates
            </Button>
            <Button icon={Plus} onClick={onAdd}>
              Add candidate
            </Button>
          </>
        )}
      </PageHeader>
      <HostedIntelligence candidates={data.candidates} onOpen={onOpen} />
      <div className="repository-tabs">
        {['All candidates', 'Ready', 'Near-ready', 'Assessing', 'Stale'].map((s) => (
          <button
            key={s}
            className={status === s ? 'active' : ''}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s}
            <span>
              {
                data.candidates.filter(
                  (c) => s === 'All candidates' || c.status === s || freshness(c.verified) === s,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <section className="panel repository">
        <div className="table-toolbar">
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <Button
            variant={semantic ? '' : 'secondary'}
            onClick={() => {
              setSemantic(!semantic);
              setPage(1);
            }}
            title="Natural-language search: the query is parsed into visible, editable criteria"
          >
            Semantic
          </Button>
          <Button
            variant={filters ? '' : 'secondary'}
            icon={SlidersHorizontal}
            onClick={() => setFilters(!filters)}
          >
            Filters
            {[location, notice, minExp, skill, tag].filter(Boolean).length
              ? ` (${[location, notice, minExp, skill, tag].filter(Boolean).length})`
              : ''}
          </Button>
          <select
            aria-label="Sort candidates"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="name">Name A–Z</option>
            <option value="experience">Most experienced</option>
            <option value="recent">Recently verified</option>
            <option value="relevance">Relevance (semantic)</option>
          </select>
          <Button
            icon={Download}
            variant="secondary"
            disabled={
              (cloud && !canWriteForRole(getRole())) ||
              serverFilter.pending ||
              Boolean(filterError || serverFilter.error)
            }
            title={
              cloud && !canWriteForRole(getRole()) ? 'Viewer role cannot export candidate data' : ''
            }
            onClick={async () => {
              const exported = await exportCandidateData(
                selected.length ? rows.filter((c) => selected.includes(c.id)) : rows,
                notify,
              );
              if (!exported) return;
              notify('Candidate CSV exported.');
              audit &&
                audit({
                  entityType: 'candidates',
                  entityId: null,
                  action: 'exported',
                  detail: `${selected.length || rows.length} candidates`,
                });
            }}
          >
            Export{selected.length ? ` (${selected.length})` : ''}
          </Button>
        </div>
        {filters && (
          <div className="filter-bar">
            <Field label="Current employer">
              <input
                value={repositoryFilters.employer}
                maxLength={120}
                placeholder="Any employer"
                onChange={(e) => {
                  setRepositoryFilters({ ...repositoryFilters, employer: e.target.value });
                  setPage(1);
                }}
              />
            </Field>
            <Field label="Engagement preference">
              <select
                value={repositoryFilters.engagement}
                onChange={(e) => {
                  setRepositoryFilters({ ...repositoryFilters, engagement: e.target.value });
                  setPage(1);
                }}
              >
                <option value="">Any engagement</option>
                {['Permanent', 'Contract', 'C2H', 'Subcontract'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            {getRole() === 'admin' && (
              <Field label="Maximum expected CTC (₹ LPA)">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={repositoryFilters.maxExpected}
                  placeholder="Any compensation"
                  onChange={(e) => {
                    setRepositoryFilters({ ...repositoryFilters, maxExpected: e.target.value });
                    setPage(1);
                  }}
                />
              </Field>
            )}
            <Field label="Location">
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All locations</option>
                {[...new Set(data.candidates.map((c) => c.location))].sort().map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Must-have skill">
              <select value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="">Any skill</option>
                {[...new Set(data.candidates.flatMap((c) => c.skills))].sort().map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Tag">
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Any tag</option>
                {[...new Set(data.candidates.flatMap((c) => c.tags || []))].sort().map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Minimum experience">
              <input
                type="number"
                min="0"
                placeholder="Any"
                value={minExp}
                onChange={(e) => setMinExp(e.target.value)}
              />
            </Field>
            <Field label="Maximum notice (days)">
              <select value={notice} onChange={(e) => setNotice(e.target.value)}>
                <option value="">Any notice</option>
                <option value="0">Immediate</option>
                <option value="15">15 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
              </select>
            </Field>
            <Button
              variant="ghost"
              onClick={() => {
                setLocation('');
                setSkill('');
                setNotice('');
                setMinExp('');
                setTag('');
                setRepositoryFilters(blankRepositoryFilters());
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {(filterError || serverFilter.error) && (
          <p className="form-error" role="alert">
            {filterError || serverFilter.error}
          </p>
        )}
        {serverFilter.pending && (
          <p className="repository-filter-status" role="status">
            Filtering your workspace…
          </p>
        )}
        <div className="views-bar">
          <span className="views-label">Views:</span>
          <select
            aria-label="Saved views"
            value=""
            onChange={(e) => {
              const v = savedViews.find((x) => x.id === e.target.value);
              if (!v) return;
              setQuery(v.filters.query || '');
              setStatus(v.filters.status || 'All candidates');
              setQueue(v.filters.queue || '');
              setLocation(v.filters.location || '');
              setNotice(v.filters.notice || '');
              setMinExp(v.filters.minExp || '');
              setSkill(v.filters.skill || '');
              setTag(v.filters.tag || '');
              setSort(v.filters.sort || 'name');
              setRepositoryFilters({
                ...blankRepositoryFilters(),
                ...(v.filters.repositoryFilters || {}),
                ...(getRole() !== 'admin' ? { maxExpected: '' } : {}),
              });
              setPage(1);
            }}
          >
            <option value="">Apply a saved view…</option>
            {savedViews.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            className="small"
            onClick={async () => {
              const name = window.prompt('Name this view (search, filters and sort are saved):');
              if (!name) return;
              const view = {
                id: uid(),
                name,
                filters: {
                  query,
                  status,
                  queue,
                  location,
                  notice,
                  minExp,
                  skill,
                  tag,
                  sort,
                  repositoryFilters,
                },
              };
              if (
                await onSave('settings', [
                  {
                    id: 'workspace',
                    custom: { ...settingsRow?.custom, savedViews: [...savedViews, view] },
                  },
                ])
              )
                notify(`View "${name}" saved.`);
            }}
          >
            Save current view
          </Button>
          {savedViews.length > 0 && (
            <Button
              variant="ghost"
              className="small"
              onClick={async () => {
                const name = window.prompt(
                  `Delete which view? Options: ${savedViews.map((v) => v.name).join(', ')}`,
                );
                if (!name) return;
                const remaining = savedViews.filter((v) => v.name !== name.trim());
                if (remaining.length === savedViews.length)
                  return notify(`No saved view is named “${name}”.`);
                if (
                  await onSave('settings', [
                    { id: 'workspace', custom: { ...settingsRow?.custom, savedViews: remaining } },
                  ])
                )
                  notify('View deleted.');
              }}
            >
              Delete a view
            </Button>
          )}
          <span className="views-spacer" />
          <span className="views-label">Columns:</span>
          <div className="column-chooser">
            {[
              col('expertise', 'Expertise'),
              col('experience', 'Experience'),
              col('availability', 'Availability'),
              col('readiness', 'Readiness'),
              col('profile', 'Profile freshness'),
            ].map((c) => (
              <label key={c.k}>
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={(e) => {
                    const next = { ...columns, [c.k]: e.target.checked };
                    setColumns(next);
                    try {
                      localStorage.setItem('ecod-columns-v1', JSON.stringify(next));
                    } catch {
                      /* private mode or quota — the chooser still works for this session */
                    }
                  }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        {selected.length > 0 && canWriteForRole(getRole()) && (
          <BulkBar
            data={data}
            selected={selected}
            onSave={onSave}
            notify={notify}
            busy={busy}
            onClear={() => setSelected([])}
            onUndoReady={setBulkUndo}
          />
        )}
        {selected.length === 0 && bulkUndo && (
          <UndoBar
            undo={bulkUndo}
            onSave={onSave}
            notify={notify}
            busy={busy}
            onDismiss={() => setBulkUndo(null)}
          />
        )}
        {parsed && parsed.used && (
          <div className="sem-chips">
            <span className="sem-label">Reading your search as:</span>
            {parsed.interpretation.map((x, i) => (
              <span key={i} className="chip">
                {x}
              </span>
            ))}
            {parsed.terms.map((x, i) => (
              <span key={`t${i}`} className="chip">
                Text: {x}
              </span>
            ))}
            <button className="text-link" onClick={() => setSemantic(false)}>
              use plain search
            </button>
          </div>
        )}
        <div className="table-summary">
          <span>
            {rows.length} candidates {query && 'matching your search'}
            {queueDef && (
              <button className="text-link" onClick={() => setQueue('')}>
                {' '}
                · Quality filter: {queueDef.label} (clear)
              </button>
            )}
          </span>
          <span>Profiles live independently of job applications</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    aria-label="Select visible candidates"
                    checked={visible.length > 0 && visible.every((c) => selected.includes(c.id))}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...new Set([...selected, ...visible.map((c) => c.id)])]
                          : selected.filter((id) => !visible.some((c) => c.id === id)),
                      )
                    }
                  />
                </th>
                <th>Candidate</th>
                {columns.expertise !== false && <th>Expertise</th>}
                {columns.experience !== false && <th>Experience</th>}
                {columns.availability !== false && <th>Availability</th>}
                {columns.readiness !== false && <th>Readiness</th>}
                {columns.profile !== false && <th>Profile</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      checked={selected.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                  </td>
                  <td>
                    <PersonName person={c} index={i} onClick={() => onOpen(c.id)} />
                    <div className="person-location">
                      <MapPin size={11} />
                      {c.location} · {c.company}
                    </div>
                  </td>
                  <td>
                    {columns.expertise !== false && (
                      <div className="skill-tags">
                        {c.skills.slice(0, 2).map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                        {c.skills.length > 2 && (
                          <span title={c.skills.slice(2).join(', ')}>+{c.skills.length - 2}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {columns.experience !== false && (
                    <td>
                      {c.experience ?? '—'} <span className="muted">years</span>
                    </td>
                  )}
                  {columns.availability !== false && (
                    <td>
                      <span className={c.notice === 0 ? 'text-green' : ''}>
                        {c.notice === null
                          ? 'Not verified'
                          : c.notice === 0
                            ? 'Immediate'
                            : `${c.notice} days`}
                      </span>
                      <small className="block">{money(c.expected)}</small>
                    </td>
                  )}
                  {columns.readiness !== false && (
                    <td>
                      <Badge>{c.status}</Badge>
                    </td>
                  )}
                  {columns.profile !== false && (
                    <td>
                      <Badge>{freshness(c.verified)}</Badge>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && !serverFilter.pending && !filterError && !serverFilter.error && (
          <Empty
            title="No candidates match these filters"
            text="Adjust your search, or add a new candidate to the repository."
          />
        )}
        <div className="table-pagination">
          <span>
            Showing {rows.length ? (activePage - 1) * 10 + 1 : 0}–
            {Math.min(activePage * 10, rows.length)} of {rows.length}
          </span>
          <div>
            <Button
              variant="secondary"
              className="small"
              disabled={activePage === 1}
              onClick={() => setPage(activePage - 1)}
            >
              Previous
            </Button>
            <span>
              {activePage} / {pages}
            </span>
            <Button
              variant="secondary"
              className="small"
              disabled={activePage === pages}
              onClick={() => setPage(activePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
const blank = {
  name: '',
  email: '',
  phone: '',
  title: '',
  company: '',
  location: '',
  experience: '',
  relevantExperience: '',
  notice: '',
  current: '',
  expected: '',
  skills: [],
  status: 'Assessing',
  mode: 'Flexible',
  source: 'Manual entry',
  summary: '',
  linkedin: '',
  verified: today(),
  engagement: '',
  earliestStart: '',
  activeStatus: 'Active',
};
export function CandidateForm({ candidate, data, onClose, onSave, busy }) {
  const [form, setForm] = useState(candidate || blank),
    [skills, setSkills] = useState(candidate?.skills.join(', ') || ''),
    [tags, setTags] = useState(candidate?.tags?.join(', ') || ''),
    [error, setError] = useState('');
  const field = (key, type = 'text', extra = {}) => (
    <input
      type={type}
      value={form[key] ?? ''}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      {...extra}
    />
  );
  async function submit(e) {
    e.preventDefault();
    const c = {
      ...form,
      id: form.id || uid(),
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      skills: skillList(skills),
      created: form.created || today(),
      // Deliberately left empty rather than defaulted to a placeholder like "Recruiter". A
      // fake owner makes "assigned to me" meaningless and stops assignment rules from ever
      // firing, because a rule only fills an owner that is genuinely absent.
      owner: form.owner || '',
    };
    for (const k of ['experience', 'relevantExperience', 'notice', 'current', 'expected'])
      c[k] = form[k] === '' || form[k] == null ? null : Number(form[k]);
    c.engagement = form.engagement || '';
    c.tags = skillList(tags);
    c.earliestStart = form.earliestStart || null;
    c.activeStatus = form.activeStatus || 'Active';
    c.skillsDetail = c.skills.map((sk) => {
      const hit = (form.skillsDetail || []).find((x) => (x.skill || '') === sk);
      return hit || blankSkillDetail(sk);
    });
    const validation = validateCandidate(c);
    if (validation) return setError(validation);
    const dupe = duplicate(c, data.candidates);
    if (dupe)
      return setError(
        `A profile for ${dupe.name} already uses this email or phone. Open that profile to update it.`,
      );
    if (await onSave('candidates', [c])) {
      const histories = captureChanges(candidate, c);
      for (const t of ['employmentHistory', 'compensationHistory', 'availabilityHistory'])
        if (histories[t].length) await onSave(t, histories[t]);
      onClose();
    }
  }
  return (
    <Modal
      title={candidate ? 'Edit candidate' : 'Add to your talent repository'}
      subtitle="A reusable profile for every future opportunity."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="Anthro-ID">
            <input
              readOnly
              value={candidate ? anthroIdFor(candidate) : 'Assigned automatically when saved'}
            />
          </Field>
          <Field label="Full name *">
            {field('name', 'text', { required: true, maxLength: 120 })}
          </Field>
          <Field label="Email">{field('email', 'email')}</Field>
          <Field label="Phone">{field('phone', 'tel')}</Field>
          <Field label="Location *">{field('location', 'text', { required: true })}</Field>
          <Field label="Current title *">{field('title', 'text', { required: true })}</Field>
          <Field label="Current employer">{field('company')}</Field>
          <Field label="Total experience (years)">
            {field('experience', 'number', { min: 0, max: MAX_EXPERIENCE_YEARS, step: 0.5 })}
          </Field>
          <Field label="Relevant experience (years)">
            {field('relevantExperience', 'number', {
              min: 0,
              max: MAX_EXPERIENCE_YEARS,
              step: 0.5,
            })}
          </Field>
          <Field label="Notice period (days)">
            {field('notice', 'number', { min: 0, max: MAX_NOTICE_DAYS })}
          </Field>
          <Field label="Current CTC (₹ LPA)">
            {field('current', 'number', { min: 0, step: 0.1 })}
          </Field>
          <Field label="Expected CTC (₹ LPA)">
            {field('expected', 'number', { min: 0, step: 0.1 })}
          </Field>
          <Field label="Work preference">
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {['Flexible', 'Remote', 'Hybrid', 'Onsite'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Engagement preference">
            <select
              value={form.engagement || ''}
              onChange={(e) => setForm({ ...form, engagement: e.target.value })}
            >
              <option value="">Not stated</option>
              {ENGAGEMENT_TYPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Registry status">
            <select
              value={form.activeStatus || 'Active'}
              onChange={(e) => setForm({ ...form, activeStatus: e.target.value })}
            >
              {['Active', 'Passive'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Earliest start date">
            <input
              type="date"
              value={form.earliestStart || ''}
              onChange={(e) => setForm({ ...form, earliestStart: e.target.value })}
            />
          </Field>
          <Field
            label="Skills *"
            hint="Separate skills with commas. Common aliases are normalized."
            wide
          >
            <input
              required
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Databricks, Python, SQL, Azure"
            />
          </Field>
          <Field label="Readiness">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {['Assessing', 'Near-ready', 'Ready', 'Unavailable'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              {[
                'Manual entry',
                'Referral',
                'LinkedIn',
                'Career page',
                'Community',
                'CSV import',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Last verified *">
            {field('verified', 'date', { required: true, max: today() })}
          </Field>
          <Field label="LinkedIn URL">
            {field('linkedin', 'url', { placeholder: 'https://www.linkedin.com/in/…' })}
          </Field>
          <Field label="Preferred locations">
            <input
              value={form.preferredLocations || ''}
              onChange={(e) => setForm({ ...form, preferredLocations: e.target.value })}
              placeholder="Bengaluru, Remote"
            />
          </Field>
          <Field label="Timezone">
            <input
              value={form.timezone || ''}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              placeholder="Asia/Kolkata"
            />
          </Field>
          <Field label="Next action">
            <input
              value={form.nextAction || ''}
              onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
              placeholder="e.g. Schedule client interview"
            />
          </Field>
          <Field label="External ID">
            <input
              value={form.externalId || ''}
              onChange={(e) => setForm({ ...form, externalId: e.target.value })}
              placeholder="Reference in your source system"
            />
          </Field>
          <Field
            label="Tags"
            hint="Comma-separated labels for your own segmentation, e.g. Client favourite, Fast-track."
          >
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Client favourite, Fast-track"
            />
          </Field>
          <CustomFieldInputs
            data={data}
            module="candidates"
            values={form.custom}
            onChange={(custom) => setForm({ ...form, custom })}
          />
          <Field label="Professional summary" wide>
            <textarea
              rows={3}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </Field>
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
          <Button disabled={busy} type="submit">
            {busy ? 'Saving…' : candidate ? 'Save profile' : 'Add candidate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CandidateProfile({
  candidate: c,
  data,
  onClose,
  onEdit,
  onSave,
  onShortlist,
  onAssess,
  busy,
  audit,
  initialTab,
  onTabChange,
  notify,
  onReload,
}) {
  const viewer = cloud && !canWriteForRole(getRole());
  const [tab, setTab] = useState(initialTab || 'Overview'),
    [note, setNote] = useState(''),
    [followUp, setFollowUp] = useState(''),
    [channel, setChannel] = useState('Note'),
    [demand, setDemand] = useState(data.demands.find((d) => d.status === 'Open')?.id || ''),
    [offerOpen, setOfferOpen] = useState(false),
    [presentationOpen, setPresentationOpen] = useState(false);
  useEffect(() => {
    onTabChange && onTabChange(tab);
  }, [tab, onTabChange]);
  // Record the current name without making a rename look like a second profile view.
  const candidateName = useRef(c.name);
  candidateName.current = c.name;
  // Blueprint §12: opening a profile is a sensitive-area view and is audited once per person.
  useEffect(() => {
    audit &&
      audit({
        entityType: 'candidate',
        entityId: c.id,
        action: 'viewed',
        detail: candidateName.current,
      });
  }, [c.id, audit]);
  const [letterOpen, setLetterOpen] = useState(false);
  const similar = similarCandidates(c, data.candidates, data.documents, 4);
  const applications = data.considerations.filter((a) => a.candidateId === c.id),
    placements = placementsForCandidate(data, c.id),
    assessments = data.assessments
      .filter((a) => a.candidateId === c.id)
      .sort((a, b) => b.date.localeCompare(a.date)),
    notes = data.notes
      .filter((n) => n.candidateId === c.id)
      .sort((a, b) => b.date.localeCompare(a.date)),
    history = data.history
      .filter((h) => h.entityId === c.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  async function addNote(e) {
    e.preventDefault();
    if (
      await onSave('notes', [
        {
          id: uid(),
          candidateId: c.id,
          text: note.trim(),
          date: today(),
          followUp: followUp || null,
          completed: false,
          author: 'Recruiter',
          channel,
        },
      ])
    ) {
      setNote('');
      setFollowUp('');
      setChannel('Note');
    }
  }
  return (
    <>
      <Modal title="Candidate 360" onClose={onClose} drawer>
        <div className="profile-header">
          <Avatar name={c.name} size="large" />
          <div>
            <h1>{c.name}</h1>
            <div className="anthro-identity">
              <span className="anthro-id">Anthro-ID: {anthroIdFor(c)}</span>
              <Button
                variant="secondary"
                className="small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(anthroIdFor(c));
                    notify('Anthro-ID copied.');
                  } catch {
                    notify('Copy unavailable. Select the Anthro-ID above to copy it.');
                  }
                }}
              >
                Copy ID
              </Button>
            </div>
            {!!c.anthroAliases?.filter((id) => /^ANTHRO-\d{5}$/.test(id)).length && (
              <small className="anthro-id">
                Former Anthro-IDs:{' '}
                {c.anthroAliases.filter((id) => /^ANTHRO-\d{5}$/.test(id)).join(', ')}
              </small>
            )}
            <p>
              {c.title} · {c.company}
            </p>
            <div className="profile-badges">
              <Badge>{c.status}</Badge>
              <Badge>{freshness(c.verified)}</Badge>
              {c.processingRestricted && <Badge tone="amber">Outbound recruiting hold</Badge>}
              {viewer && <Badge>Read only</Badge>}
              <span>
                <MapPin size={13} />
                {c.location}
              </span>
              {(c.tags || []).map((t) => (
                <span className="tag-chip" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
          {!viewer && (
            <Button variant="secondary" icon={Pencil} onClick={() => onEdit(c)}>
              Edit
            </Button>
          )}
          {!viewer && (
            <>
              <a
                className="button secondary"
                href={`mailto:${c.email || ''}?subject=${encodeURIComponent('AnthroPrime candidate portal — your login')}&body=${encodeURIComponent(`Hi ${c.name.split(' ')[0]},\n\nYou can now track your applications, interviews, offers and consents — and keep your availability up to date — on our candidate portal:\n\n${typeof location !== 'undefined' ? location.origin : ''}/portal.html\n\nSign up or sign in with this email address and the portal links to your profile automatically.\n\n— AnthroPrime talent team`)}`}
                onClick={() =>
                  audit &&
                  audit({
                    entityType: 'candidate',
                    entityId: c.id,
                    action: 'exported',
                    detail: `Portal invite drafted for ${c.name}`,
                  })
                }
              >
                Portal invite
              </a>
              <button className="button secondary" onClick={() => setLetterOpen(true)}>
                Generate letter
              </button>
              <button
                className="button secondary"
                title="Branded profile for sending to a client — consent-gated, contact details withheld by default"
                onClick={() => setPresentationOpen(true)}
              >
                Client-ready profile
              </button>
              <button
                className="button secondary"
                title="Printable internal dossier (audited export)"
                onClick={() => {
                  const downloaded = exportSensitiveFile(
                    dossierHtml(c, data),
                    `dossier-${c.name.toLowerCase().replace(/\s+/g, '-')}.html`,
                    'text/html',
                    notify,
                  );
                  if (!downloaded) return;
                  audit &&
                    audit({
                      entityType: 'candidate',
                      entityId: c.id,
                      action: 'exported',
                      detail: `Full profile dossier exported for ${c.name}`,
                    });
                }}
              >
                Dossier
              </button>
            </>
          )}
        </div>
        <div className="profile-contact">
          {c.email && (
            <a href={`mailto:${c.email}`}>
              <Mail size={14} />
              {c.email}
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`}>
              <Phone size={14} />
              {c.phone}
            </a>
          )}
          {/^https:\/\/(www\.)?linkedin\.com\//i.test(c.linkedin) && (
            <a href={c.linkedin} target="_blank" rel="noreferrer">
              LinkedIn <ExternalLink size={13} />
            </a>
          )}
        </div>
        <div className="profile-tabs">
          {[
            'Overview',
            'Contacts',
            'Availability',
            'Readiness review',
            'Scorecards',
            'Skills & assessments',
            'Employment',
            'Documents',
            'ECOD',
            'Interviews',
            'Consent & privacy',
            'Applications',
            'Notes & follow-ups',
            'History',
          ].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="profile-body">
          {tab === 'Contacts' && <CandidateContacts key={c.id} candidateId={c.id} />}
          {tab === 'Availability' && (
            <CandidateAvailability key={c.id} candidateId={c.id} onUpdated={() => onReload?.()} />
          )}
          {tab === 'Readiness review' && <CandidateReadiness key={c.id} candidateId={c.id} />}
          {tab === 'Scorecards' && <CandidateScorecards key={c.id} candidateId={c.id} />}
          {tab === 'Overview' && (
            <>
              <div className="profile-section">
                <h3>About {c.name.split(' ')[0]}</h3>
                <p>{c.summary || 'No professional summary added yet.'}</p>
                <CustomFieldValues data={data} module="candidates" values={c.custom} />
              </div>
              <div className="profile-facts">
                {[
                  ['Total experience', `${c.experience ?? 'Unverified'} years`],
                  [
                    'Relevant experience',
                    c.relevantExperience == null ? 'Unverified' : `${c.relevantExperience} years`,
                  ],
                  ['Current employer', c.company || 'Not provided'],
                  ['Work preference', c.mode],
                  [
                    'Notice period',
                    c.notice == null
                      ? 'Not verified'
                      : c.notice === 0
                        ? 'Immediate'
                        : `${c.notice} days`,
                  ],
                  ['Current CTC', money(c.current)],
                  ['Expected CTC', money(c.expected)],
                  ['Engagement', c.engagement || 'Not stated'],
                  ['Registry status', c.activeStatus || 'Active'],
                  ['Earliest start', c.earliestStart || 'Unknown'],
                  ['Preferred locations', c.preferredLocations || 'Not stated'],
                  ['Timezone', c.timezone || 'Not stated'],
                  ['Next action', c.nextAction || '—'],
                  ['External ID', c.externalId || '—'],
                  ['Last verified', c.verified],
                  ['Source', c.source],
                  ['Profile owner', c.owner],
                  ...Object.entries(c.custom || {}),
                ].map(([l, v]) => (
                  <div key={l}>
                    <span>{l}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div className="profile-section">
                <h3>Core expertise</h3>
                <div className="skill-tags large-tags">
                  {c.skills.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
              </div>
              {similar.length > 0 && (
                <div className="profile-section">
                  <h3>Similar talent in your repository</h3>
                  <p className="supporting-text" style={{ margin: '6px 0 14px' }}>
                    Ranked by in-browser vector-space similarity (TF-IDF over profile and CV text) —
                    the blueprint's Phase 1.5 retrieval, computed locally with no external vendor.
                  </p>
                  <div className="similar-list">
                    {similar.map(({ candidate: sc, score }) => (
                      <div className="similar-row" key={sc.id}>
                        <span className="person-compact">
                          <strong>{sc.name}</strong>
                          <small className="block">
                            {sc.title} · {sc.company}
                          </small>
                        </span>
                        <span className="similar-shared">
                          {sharedSkills(c, sc).slice(0, 3).join(', ') || 'adjacent skills'}
                        </span>
                        <b>{score}%</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!viewer && (
                <div className="shortlist-box">
                  <h3>Connect this person to an opportunity</h3>
                  <p>Their profile and history stay with them across every demand.</p>
                  <div>
                    <select
                      aria-label="Demand to shortlist into"
                      value={demand}
                      onChange={(e) => setDemand(e.target.value)}
                    >
                      {!demand && <option value="">No open demands</option>}
                      {data.demands
                        .filter((d) => d.status === 'Open')
                        .map((d) => (
                          <option value={d.id} key={d.id}>
                            {d.title} · {d.client}
                          </option>
                        ))}
                    </select>
                    <Button
                      disabled={
                        c.processingRestricted ||
                        !demand ||
                        busy ||
                        applications.some((a) => a.demandId === demand)
                      }
                      onClick={() => onShortlist(c.id, demand)}
                    >
                      {applications.some((a) => a.demandId === demand)
                        ? 'In pipeline'
                        : 'Shortlist'}
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === 'Skills & assessments' && (
            <>
              <div className="section-toolbar">
                <h3>Skills & evidence</h3>
                {!viewer && (
                  <Button icon={Plus} onClick={() => onAssess(c.id)}>
                    Record assessment
                  </Button>
                )}
              </div>
              <SkillEvidencePanel
                candidate={c}
                data={data}
                onSave={onSave}
                notify={notify}
                busy={busy}
              />
              <SkillsEditor candidate={c} onSave={onSave} busy={busy} readOnly={viewer} />
              <DomainSkills c={c} />
              <p className="supporting-text">
                Listed skills are profile claims. Set proficiency and evidence per skill; validated
                skills count toward demand minimums. Assessment records sit below.
              </p>
              {assessments.map((a) => (
                <article key={a.id} className="assessment-record">
                  <div>
                    <h3>{a.title}</h3>
                    <strong>
                      {a.score}
                      <small>/100</small>
                    </strong>
                  </div>
                  <p>{a.evidence}</p>
                  {a.gap && <div className="gap-note">Gap to address: {a.gap}</div>}
                  <small>
                    {a.assessor} · {a.date}
                  </small>
                </article>
              ))}
              {!assessments.length && (
                <Empty
                  title="No assessment evidence yet"
                  text="Record a review to give this profile an evidence-backed readiness score."
                />
              )}
            </>
          )}
          {tab === 'Employment' && (
            <>
              <EmploymentTab
                candidate={c}
                data={data}
                onSave={onSave}
                busy={busy}
                readOnly={viewer}
              />
              <CvEvidenceReview value={c.cvEvidence} />
            </>
          )}
          {tab === 'Documents' && (
            <DocumentsTab candidate={c} data={data} onSave={onSave} busy={busy} readOnly={viewer} />
          )}
          {tab === 'ECOD' && (
            <EcodTab candidate={c} data={data} onSave={onSave} busy={busy} readOnly={viewer} />
          )}
          {tab === 'Interviews' && (
            <InterviewsTab
              candidate={c}
              data={data}
              onSave={onSave}
              busy={busy}
              readOnly={viewer}
            />
          )}
          {tab === 'Consent & privacy' && (
            <ConsentTab
              candidate={c}
              data={data}
              onSave={onSave}
              audit={audit}
              busy={busy}
              readOnly={viewer}
              notify={notify}
              onReload={onReload}
            />
          )}
          {tab === 'Applications' && (
            <>
              <div className="section-toolbar">
                <h3>Pipeline and offers</h3>
                {!viewer && (
                  <Button className="small" disabled={busy} onClick={() => setOfferOpen(true)}>
                    Create offer
                  </Button>
                )}
              </div>
              {data.offers
                .filter((o) => o.candidateId === c.id)
                .map((o) => {
                  const od = data.demands.find((x) => x.id === o.demandId);
                  return (
                    <article className="application-record" key={o.id}>
                      <div>
                        <h3>Offer · {o.role || od?.title || 'Role'}</h3>
                        <p>
                          {o.ctc != null ? `${money(o.ctc)} LPA` : 'Package in offer letter'}
                          {o.joining ? ` · joining ${o.joining}` : ''}
                        </p>
                        {o.notes && <p>{o.notes}</p>}
                      </div>
                      <Badge tone={OFFER_TONES[o.status] || 'gray'}>{o.status}</Badge>
                    </article>
                  );
                })}
              {placements.map((placement) => {
                const demand = data.demands.find((row) => row.id === placement.demandId);
                return (
                  <article className="application-record" key={placement.id}>
                    <div>
                      <h3>Placement · {demand?.title || 'Role'}</h3>
                      <p>
                        {demand?.client || 'Client'} · started{' '}
                        {placement.startDate || 'date pending'}
                        {placement.endDate ? ` · ends ${placement.endDate}` : ''}
                      </p>
                      {placement.notes && <p>{placement.notes}</p>}
                    </div>
                    <Badge tone={placement.status === 'Active' ? 'green' : 'gray'}>
                      {placement.status}
                    </Badge>
                  </article>
                );
              })}
              {applications.map((a) => {
                const d = data.demands.find((d) => d.id === a.demandId);
                return (
                  <article className="application-record" key={a.id}>
                    <div>
                      <h3>{d?.title || 'Archived demand'}</h3>
                      <p>{d?.client}</p>
                      <small>Added {a.created}</small>
                      {a.reason && <p>Disposition: {a.reason}</p>}
                    </div>
                    <Badge>{a.stage}</Badge>
                  </article>
                );
              })}
              {!applications.length &&
                !placements.length &&
                !data.offers.some((o) => o.candidateId === c.id) && (
                  <Empty
                    title="A fresh start"
                    text="Shortlist this person for an open demand to begin their hiring process."
                  />
                )}
            </>
          )}
          {offerOpen && !viewer && (
            <OfferModal
              onClose={() => setOfferOpen(false)}
              onSave={onSave}
              candidates={[c]}
              demands={data.demands.filter((d) => d.status === 'Open')}
              preselect={{ candidateId: c.id }}
            />
          )}
          {tab === 'Notes & follow-ups' && (
            <>
              {!viewer && (
                <form onSubmit={addNote} className="note-form">
                  <Field label="Recruiter note">
                    <textarea
                      required
                      rows={3}
                      placeholder="Capture the conversation, context or next step…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                  <Field label="Channel">
                    <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                      {['Note', 'Call', 'Email', 'WhatsApp'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <div>
                    <Field label="Follow-up date (optional)">
                      <input
                        type="date"
                        value={followUp}
                        onChange={(e) => setFollowUp(e.target.value)}
                      />
                    </Field>
                    <Button type="submit" disabled={busy || !note.trim()}>
                      Save note
                    </Button>
                  </div>
                </form>
              )}
              {notes.map((n) => (
                <article className="note-record" key={n.id}>
                  <p>{n.text}</p>
                  <small>
                    {n.channel && n.channel !== 'Note' ? `${n.channel} · ` : ''}
                    {n.author} · {n.date}
                  </small>
                  {n.followUp && (
                    <div className="note-followup">
                      <Badge tone={n.completed ? 'green' : 'amber'}>
                        {n.completed ? 'Completed' : `Follow up ${n.followUp}`}
                      </Badge>
                      {!n.completed && !viewer && (
                        <Button
                          variant="ghost"
                          className="small"
                          icon={Check}
                          disabled={busy}
                          onClick={() => onSave('notes', [{ ...n, completed: true }])}
                        >
                          Mark done
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
          {tab === 'History' && (
            <>
              <p className="supporting-text">
                Profile snapshots preserve changes to employment, compensation, skills and
                availability.
              </p>
              {history.map((h) => (
                <article className="history-record" key={h.id}>
                  <span className="history-dot" />
                  <div>
                    <h3>{h.action}</h3>
                    <small>
                      {new Date(h.date).toLocaleString()} · {h.actor}
                    </small>
                    {h.snapshot && (
                      <details>
                        <summary>View previous profile values</summary>
                        <dl>
                          {[
                            ['Employer', h.snapshot.company],
                            ['Title', h.snapshot.title],
                            ['Current CTC', money(h.snapshot.current)],
                            ['Expected CTC', money(h.snapshot.expected)],
                            [
                              'Notice',
                              h.snapshot.notice == null ? 'Unknown' : `${h.snapshot.notice} days`,
                            ],
                            ['Skills', (h.snapshot.skills || []).join(', ')],
                          ].map(([k, v]) => (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd>{v || 'Not provided'}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </div>
                </article>
              ))}
              {!history.length && (
                <Empty
                  title="History starts with the next change"
                  text="Edits to this profile will preserve previous values here."
                />
              )}
            </>
          )}
        </div>
      </Modal>
      {letterOpen && !viewer && (
        <ProfileLetterModal
          c={c}
          data={data}
          onClose={() => setLetterOpen(false)}
          audit={audit}
          notify={notify}
        />
      )}
      {presentationOpen && !viewer && (
        <PresentationModal
          candidate={c}
          demand={data.demands.find((d) => d.id === demand) || null}
          data={data}
          onClose={() => setPresentationOpen(false)}
          audit={audit}
          notify={notify}
        />
      )}
    </>
  );
}
function SkillsEditor({ candidate: c, onSave, busy, readOnly = false }) {
  const [rows, setRows] = useState(() => skillDetail(c).map((r) => ({ ...r })));
  const dirty = JSON.stringify(rows) !== JSON.stringify(skillDetail(c));
  return (
    <fieldset className="skill-editor" disabled={readOnly}>
      {rows.map((r, i) => (
        <div className="skill-row" key={r.skill}>
          <div className="skill-row-name">
            <strong>{r.skill}</strong>
            <small>{domainOf(r.skill)}</small>
          </div>
          <select
            aria-label={`Proficiency for ${r.skill}`}
            value={r.proficiency}
            onChange={(e) =>
              setRows(rows.map((x, j) => (j === i ? { ...x, proficiency: e.target.value } : x)))
            }
          >
            {PROFICIENCY_LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select
            aria-label={`Evidence for ${r.skill}`}
            value={r.evidence}
            onChange={(e) =>
              setRows(
                rows.map((x, j) =>
                  j === i
                    ? {
                        ...x,
                        evidence: e.target.value,
                        validated:
                          e.target.value !== 'Unverified' && e.target.value !== 'Self-declared'
                            ? x.validated
                            : false,
                      }
                    : x,
                ),
              )
            }
          >
            {EVIDENCE_SOURCES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder="Years"
            aria-label={`Years with ${r.skill}`}
            value={r.years ?? ''}
            onChange={(e) =>
              setRows(
                rows.map((x, j) =>
                  j === i
                    ? { ...x, years: e.target.value === '' ? null : Number(e.target.value) }
                    : x,
                ),
              )
            }
          />
          <input
            type="month"
            aria-label={`Last used ${r.skill}`}
            value={r.lastUsed ?? ''}
            onChange={(e) =>
              setRows(
                rows.map((x, j) => (j === i ? { ...x, lastUsed: e.target.value || null } : x)),
              )
            }
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!r.validated}
              aria-label={`Validated ${r.skill}`}
              onChange={(e) =>
                setRows(
                  rows.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          validated: e.target.checked,
                          confidence: e.target.checked ? 90 : null,
                        }
                      : x,
                  ),
                )
              }
            />
            Validated
          </label>
        </div>
      ))}
      {!readOnly && (
        <Button
          disabled={!dirty || busy}
          onClick={async () => {
            if (await onSave('candidates', [{ ...c, skillsDetail: rows }]))
              setRows(rows.map((r) => ({ ...r })));
          }}
        >
          Save skill evidence
        </Button>
      )}
    </fieldset>
  );
}
function EmploymentTab({ candidate: c, data, onSave, busy, readOnly = false }) {
  const [form, setForm] = useState({
    company: '',
    title: '',
    employmentType: 'Permanent',
    startDate: '',
    endDate: '',
    location: '',
  });
  const jobs = data.employmentHistory
    .filter((h) => h.candidateId === c.id)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const comp = data.compensationHistory
    .filter((h) => h.candidateId === c.id)
    .sort((a, b) => (b.verified || '').localeCompare(a.verified || ''));
  const avail = data.availabilityHistory
    .filter((h) => h.candidateId === c.id)
    .sort((a, b) => (b.captured || '').localeCompare(a.captured || ''));
  return (
    <>
      <div className="section-toolbar">
        <h3>Employment history</h3>
      </div>
      {jobs.map((j) => (
        <article className="history-record" key={j.id}>
          <span className="history-dot" />
          <div>
            <h3>
              {j.title || 'Role unstated'} · {j.company || 'Employer unstated'}
            </h3>
            <small>
              {j.startDate || '?'} – {j.endDate || 'Present'}
              {j.location ? ` · ${j.location}` : ''}
              {j.employmentType ? ` · ${j.employmentType}` : ''}
            </small>
            <small className="block">
              Recorded {j.verified} · {j.source}
            </small>
          </div>
        </article>
      ))}
      {!jobs.length && (
        <Empty
          title="No employment history yet"
          text="Add previous roles below, or edit the profile to capture employer changes automatically."
        />
      )}
      {!readOnly && (
        <details className="employment-add">
          <summary>Add a role manually</summary>
          <form
            className="employment-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await onSave('employmentHistory', [
                  {
                    id: uid(),
                    candidateId: c.id,
                    ...form,
                    startDate: form.startDate || null,
                    endDate: form.endDate || null,
                    source: 'Recruiter entry',
                    verified: today(),
                    created: new Date().toISOString(),
                  },
                ])
              )
                setForm({
                  company: '',
                  title: '',
                  employmentType: 'Permanent',
                  startDate: '',
                  endDate: '',
                  location: '',
                });
            }}
          >
            <Field label="Employer">
              <input
                required
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="Job title">
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Employment type">
              <select
                value={form.employmentType}
                onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
              >
                {ENGAGEMENT_TYPES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
            <Field label="Start date">
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </Field>
            <Field label="End date (blank = present)">
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </Field>
            <div>
              <Button type="submit" disabled={busy}>
                Save role
              </Button>
            </div>
          </form>
        </details>
      )}
      <h3 className="history-heading">Compensation history</h3>
      {comp.map((h) => (
        <article className="history-record" key={h.id}>
          <span className="history-dot" />
          <div>
            <h3>
              {h.kind === 'expected' ? 'Expected' : 'Current'} {money(h.amount)}
            </h3>
            <small>
              Verified {h.verified} · {h.source} · {h.currency} {h.basis}
            </small>
          </div>
        </article>
      ))}
      {!comp.length && (
        <p className="supporting-text">
          Compensation snapshots appear when CTC values change on the profile.
        </p>
      )}
      <h3 className="history-heading">Availability history</h3>
      {avail.map((h) => (
        <article className="history-record" key={h.id}>
          <span className="history-dot" />
          <div>
            <h3>
              {h.notice == null ? 'Notice unknown' : `${h.notice}-day notice`} · {h.status}
            </h3>
            <small>
              {h.earliestStart ? `Earliest start ${h.earliestStart} · ` : ''}Captured {h.captured}
            </small>
          </div>
        </article>
      ))}
      {!avail.length && (
        <p className="supporting-text">
          Availability snapshots appear when notice, earliest start or registry status change.
        </p>
      )}
    </>
  );
}

function DocumentsTab({ candidate: c, data, onSave, busy, readOnly = false }) {
  const [fileBusy, setFileBusy] = useState(false),
    [err, setErr] = useState('');
  const docs = data.documents
    .filter((d) => d.candidateId === c.id && !d.removed)
    .sort((a, b) => (b.uploaded || '').localeCompare(a.uploaded || ''));
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || fileBusy) return;
    setErr('');
    const cls = classifyFile(file);
    if (!cls.ok) return setErr(cls.error);
    if (!(await contentSignatureOk(file, cls.ext)))
      return setErr(
        `The file content does not look like a real ${cls.ext.toUpperCase()} - upload rejected.`,
      );
    setFileBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const quarantine = await privateAttachmentsEnabled();
      const extraction = quarantine
        ? {
            text: '',
            status: 'quarantined',
            warning:
              'Original is quarantined until private scanning and background extraction finish.',
          }
        : await extractDocumentText(buffer, cls.ext);
      const extracted = extraction.text;
      const hash = await sha256(buffer);
      const record = buildDocumentRecord({
        file,
        ext: cls.ext,
        hash,
        extracted,
        candidateId: c.id,
        parserStatusHint: extraction.status,
      });
      await persistBinary(record, file);
      await onSave('documents', [record]);
      if (extraction.warning) setErr(`Original saved. ${extraction.warning}`);
    } catch (saveErr) {
      setErr(saveErr.message);
    } finally {
      setFileBusy(false);
    }
  }
  return (
    <>
      <div className="section-toolbar">
        <h3>Documents</h3>
        {!readOnly && (
          <label className={`button secondary upload-label${fileBusy || busy ? ' disabled' : ''}`}>
            <Upload size={16} />
            {fileBusy ? 'Reading…' : 'Upload CV or document'}
            <input
              type="file"
              hidden
              accept=".pdf,.docx,.txt,.md,.csv"
              disabled={fileBusy || busy}
              onChange={upload}
            />
          </label>
        )}
      </div>
      {!cloud && (
        <p className="supporting-text">
          Demo mode keeps files up to 1 MB inside this browser; cloud mode stores originals in
          private workspace storage.
        </p>
      )}
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
      {docs.map((d) => (
        <article className="document-row" key={d.id}>
          <FileText size={20} />
          <div className="document-info">
            <strong>{d.name}</strong>
            <AttachmentProcessing record={d} readOnly={readOnly} onSave={onSave} />
            <small className="block">
              {d.kind} · v{d.version} · {(d.size / 1024).toFixed(0)} KB ·{' '}
              {d.uploaded ? new Date(d.uploaded).toLocaleString() : ''} · {d.uploadedBy}
            </small>
            <small>
              {['quarantined', 'scan-error', 'blocked', 'queued', 'extracting'].includes(
                d.parserStatus,
              )
                ? 'Private scan/extraction is pending or blocked. Refresh processing status for details.'
                : d.parserStatus === 'parsed'
                  ? `Parsed text captured (${(d.extracted || '').length} characters) — evidence stays with the profile.`
                  : 'Text could not be extracted automatically; the original is kept for reference.'}
            </small>
            {d.stored === false && (
              <small className="block text-amber">
                {d.storageError
                  ? `Original file not stored: ${d.storageError}`
                  : 'No original file was stored with this record — the parsed text is all that is kept.'}
              </small>
            )}
          </div>
          <Badge tone={d.parserStatus === 'parsed' ? 'green' : 'amber'}>{d.parserStatus}</Badge>
          <Button
            variant="ghost"
            className="small"
            onClick={async () => {
              try {
                const url = await signedUrlFor(d);
                if (!url) return setErr('No stored file for this document.');
                window.open(url, '_blank', 'noopener');
              } catch (e) {
                setErr(e.message || 'Could not open the document.');
              }
            }}
          >
            Open
          </Button>
          {!readOnly && (
            <Button
              variant="ghost"
              className="small"
              disabled={busy}
              onClick={() => onSave('documents', [{ ...d, removed: true }])}
            >
              Remove
            </Button>
          )}
        </article>
      ))}
      {!docs.length && (
        <Empty
          title="No documents yet"
          text="Upload the CV, certifications or assessment files. Originals stay private to the workspace."
        />
      )}
    </>
  );
}

function EcodTab({ candidate: c, data, onSave, busy, readOnly = false }) {
  const [action, setAction] = useState(c.nextAction || '');
  const applications = data.considerations.filter((a) => a.candidateId === c.id);
  const plans = data.enrichment.filter((e) => e.candidateId === c.id);
  const openDemands = data.demands.filter((d) => d.status === 'Open');
  const gapRows = [];
  for (const d of openDemands) {
    const m = matchCandidate(c, d, data.assessments);
    if (m.score >= 40)
      for (const g of deriveGaps(c, d, m, {
        assessments: data.assessments,
        enrichment: data.enrichment,
      }))
        gapRows.push({ ...g, demandTitle: d.title });
  }
  return (
    <>
      <div className="section-toolbar">
        <h3>ECOD readiness</h3>
        <Badge tone={c.status === 'Ready' ? 'green' : c.status === 'Near-ready' ? 'amber' : 'blue'}>
          {c.status}
        </Badge>
      </div>
      <div className="profile-facts">
        {[
          ['Readiness status', c.status],
          ['Last validated', c.verified],
          ['Next action', c.nextAction || '—'],
          [
            'Open considerations',
            applications.filter((a) => !['Deployed', 'Rejected', 'Withdrawn'].includes(a.stage))
              .length,
          ],
          ['Enrichment plans', plans.length],
          ['Open gaps', gapRows.filter((g) => g.status === 'Open').length],
        ].map(([l, v]) => (
          <div key={l}>
            <span>{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className="section-toolbar">
        <h3>Next action</h3>
      </div>
      <div className="next-action-row">
        <input
          value={action}
          placeholder="e.g. Reassess Unity Catalog after the lab"
          disabled={readOnly}
          onChange={(e) => setAction(e.target.value)}
        />
        {!readOnly && (
          <Button
            className="small"
            disabled={busy || action === (c.nextAction || '')}
            onClick={() => onSave('candidates', [{ ...c, nextAction: action }])}
          >
            Save
          </Button>
        )}
      </div>
      <h3 className="history-heading">Gap map across open demands</h3>
      <div className="gap-list">
        {gapRows.length ? (
          <table>
            <thead>
              <tr>
                <th>Demand</th>
                <th>Skill</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {gapRows.map((g) => (
                <tr key={g.demandTitle + g.skill}>
                  <td>{g.demandTitle}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No open gaps"
            text="This profile meets every requirement of the open demands it is near."
          />
        )}
      </div>
      <h3 className="history-heading">Enrichment plans</h3>
      {plans.map((p) => (
        <article className="history-record" key={p.id}>
          <span className="history-dot" />
          <div>
            <h3>{p.title}</h3>
            <small>
              {p.status} · due {p.due} · owner {p.owner}
            </small>
          </div>
        </article>
      ))}
      {!plans.length && (
        <p className="supporting-text">
          No enrichment plans yet — create one from a demand match or the Assessments page.
        </p>
      )}
    </>
  );
}
function ConsentTab({
  candidate: c,
  data,
  onSave,
  audit,
  busy,
  readOnly = false,
  notify,
  onReload,
}) {
  const purposes = ['recruiting-contact', 'profile-sharing', 'assessment', 'marketing'];
  const [form, setForm] = useState({
    purpose: 'recruiting-contact',
    noticeVersion: 'v1.1',
    source: '',
    note: '',
  });
  const consents = data.consents
    .filter((x) => x.candidateId === c.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  async function addConsent(e) {
    e.preventDefault();
    if (
      await onSave('consents', [
        {
          id: uid(),
          candidateId: c.id,
          ...form,
          status: 'granted',
          date: new Date().toISOString(),
        },
      ])
    ) {
      audit &&
        audit({
          entityType: 'candidate',
          entityId: c.id,
          action: 'consent',
          detail: `${form.purpose} recorded for ${c.name}`,
        });
      setForm({ ...form, source: '', note: '' });
    }
  }
  function exportMyData() {
    const bundle = {
      candidate: { ...c, skillsDetail: c.skillsDetail },
      considerations: data.considerations.filter((a) => a.candidateId === c.id),
      assessments: data.assessments.filter((a) => a.candidateId === c.id),
      notes: data.notes.filter((n) => n.candidateId === c.id),
      documents: data.documents
        .filter((d) => d.candidateId === c.id && !d.removed)
        .map((d) => ({ ...d, extracted: d.extracted })),
      employmentHistory: data.employmentHistory.filter((h) => h.candidateId === c.id),
      compensationHistory: data.compensationHistory.filter((h) => h.candidateId === c.id),
      availabilityHistory: data.availabilityHistory.filter((h) => h.candidateId === c.id),
      consents,
    };
    if (
      !exportSensitiveFile(
        JSON.stringify(bundle, null, 2),
        `candidate-data-${(c.name || 'profile').replace(/\s+/g, '-').toLowerCase()}.json`,
        'application/json',
        notify,
      )
    )
      return;
    audit &&
      audit({
        entityType: 'candidate',
        entityId: c.id,
        action: 'exported',
        detail: `Data-subject export: ${c.name}`,
      });
  }
  return (
    <>
      <div className="section-toolbar">
        <h3>Consent record</h3>
        {!readOnly && (
          <Button variant="secondary" className="small" onClick={exportMyData}>
            Export this profile's data
          </Button>
        )}
      </div>
      <p className="supporting-text">
        Blueprint §12: record what consent covers, which notice version the person saw, and when.
        Profile export includes the records available in this workspace view and may exclude
        originals or history. Correction is via Edit. Profile anonymization does not remove all
        linked records; request review tracks the wider work.
      </p>
      {getRole() === 'admin' && (
        <SubjectRequests
          key={`${getWorkspaceId()}:${c.id}`}
          candidateId={c.id}
          onHoldChange={onReload}
        />
      )}
      {!readOnly && (
        <form className="consent-form" onSubmit={addConsent}>
          <Field label="Purpose">
            <select
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            >
              {purposes.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Notice version">
            <input
              value={form.noticeVersion}
              onChange={(e) => setForm({ ...form, noticeVersion: e.target.value })}
            />
          </Field>
          <Field label="Source">
            <input
              required
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Phone call, email…"
            />
          </Field>
          <Field label="Note">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div>
            <Button type="submit" disabled={busy}>
              Record consent
            </Button>
          </div>
        </form>
      )}
      {consents.map((x) => (
        <article className="consent-row" key={x.id}>
          <Badge tone={x.status === 'granted' ? 'green' : x.status === 'revoked' ? 'red' : 'gray'}>
            {x.status}
          </Badge>
          <div className="document-info">
            <strong>{x.purpose}</strong>
            <small className="block">
              Notice {x.noticeVersion} · {new Date(x.date).toLocaleString()} · {x.source || '—'}
              {x.note ? ` · ${x.note}` : ''}
            </small>
          </div>
          {x.status === 'granted' && !readOnly && (
            <Button
              variant="ghost"
              className="small"
              disabled={busy}
              onClick={() => onSave('consents', [{ ...x, status: 'revoked' }])}
            >
              Revoke
            </Button>
          )}
        </article>
      ))}
      {!consents.length && (
        <Empty
          title="No consent recorded yet"
          text="Record the purpose, notice version and source when the person agrees."
        />
      )}
    </>
  );
}

function InterviewsTab({ candidate: c, data, onSave, busy, readOnly = false }) {
  const ivs = data.interviews
    .filter((iv) => iv.candidateId === c.id)
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const [scheduling, setScheduling] = useState(false);
  return (
    <>
      <div className="section-toolbar">
        <h3>Interviews</h3>
        {!readOnly && (
          <Button className="small" disabled={busy} onClick={() => setScheduling(true)}>
            Schedule interview
          </Button>
        )}
      </div>
      {ivs.length ? (
        <div className="iv-list">
          {ivs.map((iv) => {
            const d = data.demands.find((x) => x.id === iv.demandId),
              overall = overallOf(iv.feedback);
            return (
              <article className="iv-row compact" key={iv.id}>
                <InterviewWhen iv={iv} />
                <div className="iv-who">
                  <span className="iv-meta">
                    <Badge>{iv.round}</Badge>
                    <Badge>{iv.mode}</Badge>
                    {iv.interviewers.length > 0 && (
                      <small>Panel: {iv.interviewers.join(', ')}</small>
                    )}
                  </span>
                  {d && (
                    <small className="block">
                      {d.title} · {d.client}
                    </small>
                  )}
                  {iv.notes && <small className="iv-notes">{iv.notes}</small>}
                </div>
                <div className="iv-state">
                  <Badge
                    tone={
                      iv.status === 'Completed'
                        ? 'green'
                        : iv.status === 'Scheduled'
                          ? 'blue'
                          : iv.status === 'No-show'
                            ? 'red'
                            : 'gray'
                    }
                  >
                    {iv.status}
                  </Badge>
                  {iv.recommendation && (
                    <Badge tone={RECOMMENDATION_TONES[iv.recommendation] || 'gray'}>
                      {iv.recommendation}
                      {overall != null ? ` · ${overall}` : ''}
                    </Badge>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No interviews yet"
          text="Schedule the first panel for this candidate — rounds, mode, interviewers and outcome feedback are tracked per interview."
        />
      )}
      {scheduling && !readOnly && (
        <ScheduleModal
          onClose={() => setScheduling(false)}
          onSave={onSave}
          candidates={[c]}
          demands={data.demands.filter((d) => d.status === 'Open')}
          preselect={{ candidateId: c.id }}
        />
      )}
    </>
  );
}

function ProfileLetterModal({ c, data, onClose, audit, notify }) {
  const tpls = documentTemplatesFor(data.settings);
  const [tplId, setTplId] = useState(tpls[0]?.id || '');
  const chosen = tpls.find((t) => t.id === tplId) || tpls[0];
  const letter = renderTemplate(chosen.body, mergeContext({ candidate: c }));
  const fname = `${chosen.name.toLowerCase().replace(/\s+/g, '-')}-${c.name.toLowerCase().replace(/\s+/g, '-')}.txt`;
  return (
    <Modal
      title={`Generate letter — ${c.name}`}
      subtitle="Rendered from an admin-managed document template with merge fields. Download it, or open an email draft in your mail client."
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <Field label="Template">
          <select value={tplId} onChange={(e) => setTplId(e.target.value)}>
            {tpls.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="submission-preview wide">
          <span>Letter preview</span>
          <pre>{letter}</pre>
        </div>
      </div>
      <div className="modal-actions">
        <Button
          variant="ghost"
          onClick={() => exportSensitiveFile(letter, fname, 'text/plain', notify)}
        >
          Download letter
        </Button>
        <a
          className="button ghost"
          href={`mailto:${c.email || ''}?subject=${encodeURIComponent(chosen.name)}&body=${encodeURIComponent(letter)}`}
          onClick={() =>
            audit &&
            audit({
              entityType: 'candidate',
              entityId: c.id,
              action: 'exported',
              detail: `${chosen.name} generated for ${c.name} (email draft)`,
            })
          }
        >
          Open email draft
        </a>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function DomainSkills({ c }) {
  const domains = allSkillDomains().filter((d) =>
    (c.skills || []).some((sk) => skillsUnder(d).includes(sk)),
  );
  if (!domains.length) return null;
  return (
    <div className="domain-groups">
      <p className="supporting-text">Skill domains (admin-managed taxonomy):</p>
      {domains.map((d) => (
        <div key={d} className="domain-group">
          <strong>{d}</strong>
          <span>{(c.skills || []).filter((sk) => skillsUnder(d).includes(sk)).join(' · ')}</span>
        </div>
      ))}
    </div>
  );
}
