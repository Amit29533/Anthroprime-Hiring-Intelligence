import React, { useEffect, useState } from 'react';
import { PageHeader, Button, Modal, Badge, Field } from './ui.jsx';
import { getRole, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { signedUrlFor } from './documents.js';

const SECTIONS = [
  ['profile', 'Profile'],
  ['notes', 'Notes'],
  ['documents', 'Documents'],
  ['employmentHistory', 'Employment'],
  ['compensationHistory', 'Compensation'],
  ['availabilityHistory', 'Availability'],
  ['assessments', 'Assessments'],
  ['enrichment', 'Training & enrichment'],
  ['personSkills', 'Skills'],
  ['skillEvidence', 'Skill evidence'],
  ['considerations', 'Pipeline'],
  ['interviews', 'Interviews'],
  ['offers', 'Offers'],
  ['placements', 'Placements'],
  ['consents', 'Consent'],
  ['history', 'History'],
];
const DISPLAY_FIELDS = [
  'target',
  'provider',
  'progress',
  'due',
  'evidence',
  'gapSkill',
  'location',
  'startDate',
  'endDate',
  'from',
  'to',
  'effective',
  'source',
  'technical',
  'communication',
  'culture',
  'decision',
  'interviewer',
  'feedback',
  'ctc',
  'joining',
  'mime',
  'size',
  'version',
  'uploaded',
  'uploadedBy',
  'notes',
  'name',
  'company',
  'title',
  'role',
  'skill',
  'proficiency',
  'years',
  'lastUsed',
  'confidence',
  'validated',
  'evidenceType',
  'assessor',
  'note',
  'text',
  'summary',
  'status',
  'stage',
  'recommendation',
  'overall',
  'start',
  'end',
  'date',
  'scheduled',
  'followUp',
  'completed',
  'notice',
  'earliestStart',
  'kind',
  'amount',
  'currency',
  'purpose',
  'granted',
  'action',
  'actor',
  'parserStatus',
];
function valueText(value) {
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '');
}
function fieldLabel(key) {
  const labels = { ctc: 'CTC', mime: 'File type', parserStatus: 'Extraction status' };
  const label = labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2');
  return label[0].toUpperCase() + label.slice(1);
}

export function PagedOverview({ rpc = repositoryRead, onBrowse, onFull }) {
  const [stats, setStats] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setStats(null);
    Promise.resolve()
      .then(() => rpc('api_repository_overview'))
      .then((value) => {
        if (
          !['candidates', 'ready', 'fresh', 'stale', 'openDemands'].every((key) =>
            Number.isFinite(Number(value?.[key])),
          )
        )
          throw new Error('Repository totals returned an invalid response.');
        if (active) setStats(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, revision]);
  return (
    <>
      <PageHeader
        eyebrow="YOUR TALENT, CONNECTED"
        title="Repository overview"
        description="Live workspace totals, with profiles loaded when needed."
      >
        <Button onClick={onBrowse}>Explore repository</Button>
        <Button variant="secondary" onClick={onFull}>
          Open workflow overview
        </Button>
      </PageHeader>
      {error && <p role="alert">{error}</p>}
      {!stats && !error && <p role="status">Loading workspace totals…</p>}
      {stats && (
        <div className="form-grid">
          {[
            ['candidates', 'Candidates'],
            ['ready', 'Ready'],
            ['fresh', 'Fresh profiles'],
            ['stale', 'Stale profiles'],
            ['openDemands', 'Open demands'],
          ].map(([key, label]) => (
            <section className="panel" key={key}>
              <div className="settings-body">
                <h3>{label}</h3>
                <strong>{stats[key]}</strong>
              </div>
            </section>
          ))}
        </div>
      )}
      <Button variant="secondary" onClick={() => setRevision((n) => n + 1)}>
        Refresh totals
      </Button>
    </>
  );
}

export function PagedCandidates({ rpc = repositoryRead, onFull, initialFilter }) {
  const [draft, setDraft] = useState(() => ({
    query: '',
    status: initialFilter?.status || '',
    skill: initialFilter?.skill || '',
  }));
  const [filters, setFilters] = useState(draft),
    [cursors, setCursors] = useState([null]),
    [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    setPending(true);
    setPage(null);
    setError('');
    Promise.resolve()
      .then(() => rpc('api_repository_page', { p_filters: filters, p_cursor: cursor, p_limit: 50 }))
      .then((value) => {
        if (!Array.isArray(value?.rows) || value.rows.length > 50)
          throw new Error('Repository returned an invalid page.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [rpc, filters, cursor, revision]);
  const field = (key, label, type = 'text') => (
    <Field key={key} label={label}>
      <input
        type={type}
        step={type === 'number' ? (key === 'maxNotice' ? '1' : 'any') : undefined}
        min={type === 'number' ? 0 : undefined}
        max={key === 'maxNotice' ? 365 : key === 'minExperience' ? 60 : undefined}
        aria-label={label}
        value={draft[key] ?? ''}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <>
      <PageHeader
        title="Talent repository"
        description="Search profiles and CV text, or enter an Anthro-ID. Each page contains at most 50 candidates."
      >
        <Button variant="secondary" onClick={() => onFull()}>
          More filters & bulk actions
        </Button>
        {canWriteForRole(getRole()) && (
          <Button onClick={() => onFull(null, 'add')}>Add candidate</Button>
        )}
      </PageHeader>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft });
          setCursors([null]);
        }}
      >
        <div className="settings-body">
          <div className="form-grid">
            {field('query', 'Search profiles or Anthro-ID')}
            <Field label="Candidate status">
              <select
                aria-label="Candidate status"
                value={draft.status || ''}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                {['', 'Assessing', 'Near-ready', 'Ready', 'Unavailable'].map((s) => (
                  <option key={s} value={s}>
                    {s || 'All candidates'}
                  </option>
                ))}
              </select>
            </Field>
            {field('location', 'Location (exact)')}
            {field('skill', 'Skill (exact)')}
            {field('employer', 'Employer')}
            {field('minExperience', 'Minimum experience', 'number')}
            {field('maxNotice', 'Maximum notice days', 'number')}
            <Field label="Engagement">
              <select
                aria-label="Engagement"
                value={draft.engagement || ''}
                onChange={(e) => setDraft({ ...draft, engagement: e.target.value })}
              >
                {['', 'Permanent', 'Contract', 'C2H', 'Subcontract'].map((s) => (
                  <option key={s} value={s}>
                    {s || 'Any engagement'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Work mode">
              <select
                aria-label="Work mode"
                value={draft.mode || ''}
                onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
              >
                {['', 'Flexible', 'Remote', 'Hybrid', 'Onsite'].map((s) => (
                  <option key={s} value={s}>
                    {s || 'Any mode'}
                  </option>
                ))}
              </select>
            </Field>
            {getRole() === 'admin' && field('maxExpected', 'Maximum expected (LPA)', 'number')}
          </div>
          <Button type="submit" disabled={pending}>
            Search repository
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft({ query: '', status: '', skill: '' });
              setFilters({});
              setCursors([null]);
            }}
          >
            Clear filters
          </Button>
          <p>
            Search matches words and quoted phrases; use a minus sign to exclude words. For semantic
            ranking, saved views, complete exports or matching, open More filters & bulk actions.
          </p>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">Loading candidates…</p>}
      {page && (
        <>
          <p>
            Page {cursors.length} · {page.rows.length} candidates · sorted by name
          </p>
          {!page.rows.length && <p>No candidates match this search.</p>}
          <div className="cv-review-list">
            {page.rows.map((c) => (
              <article className="panel" key={c.id}>
                <div className="settings-body">
                  <Button variant="secondary" onClick={() => setSelected(c.id)}>
                    {c.name}
                  </Button>{' '}
                  <Badge>{c.anthroId}</Badge> <Badge>{c.status}</Badge>
                  <p>{[c.title, c.company, c.location].filter(Boolean).join(' · ')}</p>
                  <p>{(c.skills || []).join(' · ')}</p>
                </div>
              </article>
            ))}
          </div>
          <Button disabled={cursors.length === 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
            Previous candidate page
          </Button>
          <Button disabled={!page.next} onClick={() => setCursors((c) => [...c, page.next])}>
            Next candidate page
          </Button>
        </>
      )}
      <Button variant="secondary" disabled={pending} onClick={() => setRevision((n) => n + 1)}>
        Refresh candidate page
      </Button>
      {selected && (
        <PagedCandidate360
          key={selected}
          candidateId={selected}
          rpc={rpc}
          onClose={() => setSelected(null)}
          onFull={() => onFull(selected)}
        />
      )}
    </>
  );
}

export function PagedCandidate360({
  candidateId,
  rpc = repositoryRead,
  onClose,
  onFull,
  openDocument = signedUrlFor,
}) {
  const [section, setSection] = useState('profile'),
    [offset, setOffset] = useState(0),
    [profile, setProfile] = useState(null),
    [page, setPage] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setPage(null);
    Promise.resolve()
      .then(() =>
        rpc('api_candidate_section', {
          p_candidate: candidateId,
          p_section: section,
          p_offset: offset,
        }),
      )
      .then((value) => {
        if (section === 'profile') {
          if (!value?.candidate?.id)
            throw new Error('Candidate profile returned an invalid response.');
          if (active) setProfile(value.candidate);
        } else {
          if (!Array.isArray(value?.rows) || value.rows.length > 50)
            throw new Error('Candidate section returned an invalid page.');
          if (active) setPage({ ...value, sectionKey: section });
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, section, offset]);
  return (
    <Modal
      title={profile?.name || 'Candidate 360'}
      subtitle={profile?.anthroId || 'Loading profile on demand'}
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <div className="section-toolbar">
          {SECTIONS.map(([key, label]) => (
            <Button
              key={key}
              variant={section === key ? 'primary' : 'secondary'}
              onClick={() => {
                setSection(key);
                setOffset(0);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {section === 'profile' && !profile && !error && (
          <p role="status">Loading candidate profile…</p>
        )}
        {section === 'profile' && profile && (
          <>
            <p>{[profile.title, profile.company, profile.location].filter(Boolean).join(' · ')}</p>
            <p>{profile.summary}</p>
            <dl>
              {[
                'email',
                'phone',
                'linkedin',
                'status',
                'mode',
                'engagement',
                'experience',
                'relevantExperience',
                'notice',
                'owner',
                'verified',
              ].map((key) => (
                <React.Fragment key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>{valueText(profile[key]) || 'Not recorded'}</dd>
                </React.Fragment>
              ))}
            </dl>
            <h3>Skills</h3>
            <p>{(profile.skills || []).join(' · ') || 'No skills recorded'}</p>
          </>
        )}
        {section !== 'profile' && !page && !error && (
          <p role="status">Loading candidate section…</p>
        )}
        {page && page.sectionKey === section && (
          <>
            {!page.rows.length && <p>No records in this section.</p>}
            {page.rows.map((row) => (
              <article className="panel" key={row.id}>
                <div className="settings-body">
                  <dl>
                    {DISPLAY_FIELDS.filter(
                      (k) => row[k] !== undefined && row[k] !== null && row[k] !== '',
                    ).map((key) => (
                      <React.Fragment key={key}>
                        <dt>{fieldLabel(key)}</dt>
                        <dd>{valueText(row[key])}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  {section === 'documents' && (
                    <Button
                      onClick={async () => {
                        try {
                          const url = await openDocument(row);
                          if (!url) throw new Error('Original is not available.');
                          window.open(url, '_blank', 'noopener,noreferrer');
                        } catch (err) {
                          setError(err.message);
                        }
                      }}
                    >
                      Open {row.name}
                    </Button>
                  )}
                </div>
              </article>
            ))}
            <Button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
              Previous section page
            </Button>
            <Button disabled={!page.more} onClick={() => setOffset((n) => n + 50)}>
              Next section page
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={onFull}>
          {canWriteForRole(getRole())
            ? 'Edit, match & manage candidate'
            : 'Open complete candidate workspace'}
        </Button>
      </div>
    </Modal>
  );
}
