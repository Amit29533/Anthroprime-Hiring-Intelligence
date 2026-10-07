import React, { useEffect, useState } from 'react';
import { PageHeader, Button, Modal, Badge, Field } from './ui.jsx';
import { getRole, getWorkspaceId, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { signedUrlFor } from './documents.js';
import { CandidateContacts } from './CandidateContacts.jsx';
import { CandidateReadiness } from './CandidateReadiness.jsx';
import { CandidateScorecards } from './CandidateScorecards.jsx';
import { RecruiterWorklist } from './RecruiterWorklist.jsx';
import { RepositoryQuality } from './RepositoryQuality.jsx';
import CandidateProfileEditor from './CandidateProfileEditor.jsx';
import { CandidateFacts } from './CandidateFacts.jsx';
import { CandidateCommunications } from './CandidateCommunications.jsx';

const SORTS = {
  name: 'Name',
  verified: 'Recently verified',
  experience: 'Most experience',
  notice: 'Shortest notice',
};

const SECTIONS = [
  ['profile', 'Profile'],
  ['contacts', 'Contacts'],
  ['communications', 'Communication tests'],
  ['readiness', 'Readiness review'],
  ['scorecards', 'Scorecards'],
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

export function PagedOverview({
  rpc = repositoryRead,
  onBrowse,
  onFull,
  onOpenWorklist,
  onSettings,
}) {
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
      {onOpenWorklist && (
        <>
          <CandidateCommunications key={`communications-${getWorkspaceId()}`} />
          <RecruiterWorklist key={`worklist-${getWorkspaceId()}`} onOpen={onOpenWorklist} />
        </>
      )}
      {onOpenWorklist && (
        <RepositoryQuality
          key={`quality-${getWorkspaceId()}`}
          onOpen={onOpenWorklist}
          onSettings={onSettings}
        />
      )}
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
  const [views, setViews] = useState([]),
    [viewId, setViewId] = useState(''),
    [viewName, setViewName] = useState(''),
    [viewError, setViewError] = useState(''),
    [viewBusy, setViewBusy] = useState(false),
    [viewsLoaded, setViewsLoaded] = useState(false);
  const [viewsRevision, setViewsRevision] = useState(0);
  const viewOperation = React.useRef(null),
    mounted = React.useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setViewsLoaded(false);
    setViewError('');
    Promise.resolve()
      .then(() => rpc('api_repository_views'))
      .then((value) => {
        if (!Array.isArray(value?.views) || value.views.length > 50)
          throw new Error('Saved views returned an invalid response.');
        if (active) {
          setViews(value.views);
          setViewsLoaded(true);
        }
      })
      .catch((err) => {
        if (active) setViewError(err.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, viewsRevision]);
  async function changeView(action) {
    setViewBusy(true);
    setViewError('');
    try {
      const signature = JSON.stringify({ name: viewName.trim(), filters: draft });
      if (action === 'save' && viewOperation.current?.signature !== signature)
        viewOperation.current = { signature, id: crypto.randomUUID() };
      const value = await rpc(
        'api_repository_views',
        action === 'save'
          ? {
              p_action: 'save',
              p_id: viewOperation.current.id,
              p_name: viewName.trim(),
              p_filters: { ...draft },
            }
          : { p_action: 'delete', p_id: viewId },
      );
      if (!Array.isArray(value?.views) || value.views.length > 50)
        throw new Error('Saved views returned an invalid response.');
      if (mounted.current) {
        setViews(value.views);
        setViewName('');
        setViewId('');
        viewOperation.current = null;
      }
    } catch (err) {
      if (mounted.current) setViewError(err.message);
    } finally {
      if (mounted.current) setViewBusy(false);
    }
  }
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
        max={
          key === 'maxNotice'
            ? 365
            : ['minExperience', 'maxExperience'].includes(key)
              ? 60
              : undefined
        }
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
            {field('maxExperience', 'Maximum experience', 'number')}
            {field('maxNotice', 'Maximum notice days', 'number')}
            {field('tag', 'Tag (exact)')}
            <Field label="Sort candidates">
              <select
                aria-label="Sort candidates"
                value={draft.sort || 'name'}
                onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
              >
                {Object.entries(SORTS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
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
            ranking, shared legacy views, complete exports or matching, open More filters & bulk
            actions.
          </p>
        </div>
      </form>
      <section className="panel" aria-label="Personal repository views">
        <div className="settings-body">
          <h3>My saved views</h3>
          <p>
            Personal to your account and this workspace. Save the filters currently entered above.
          </p>
          {viewError && <p role="alert">{viewError}</p>}
          <Field label="Saved repository view">
            <select
              aria-label="Saved repository view"
              value={viewId}
              disabled={viewBusy || !viewsLoaded}
              onChange={(e) => {
                const view = views.find((v) => v.id === e.target.value);
                setViewId(e.target.value);
                setViewError('');
                if (!view) return;
                if (view.restricted) {
                  setViewError(
                    'This view requires administrator compensation access. Choose another view or delete it.',
                  );
                  return;
                }
                setDraft({ ...view.filters });
                setFilters({ ...view.filters });
                setCursors([null]);
              }}
            >
              <option value="">Choose a view</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New view name">
            <input
              aria-label="New view name"
              disabled={viewBusy}
              maxLength={80}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
          </Field>
          <Button
            disabled={viewBusy || !viewsLoaded || !viewName.trim() || views.length >= 50}
            onClick={() => changeView('save')}
          >
            Save personal view
          </Button>
          <Button
            variant="secondary"
            disabled={viewBusy || !viewId}
            onClick={() => {
              const view = views.find((v) => v.id === viewId);
              if (view && window.confirm(`Delete your saved view “${view.name}”?`))
                changeView('delete');
            }}
          >
            Delete selected view
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={viewBusy}
            onClick={() => setViewsRevision((n) => n + 1)}
          >
            Refresh saved views
          </Button>
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">Loading candidates…</p>}
      {page && (
        <>
          <p>
            Page {cursors.length} · {page.rows.length} candidates · {SORTS[filters.sort || 'name']}
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
          onUpdated={() => setRevision((n) => n + 1)}
        />
      )}
    </>
  );
}

export function PagedCandidate360({
  candidateId,
  initialSection = 'profile',
  rpc = repositoryRead,
  onClose,
  onFull,
  openDocument = signedUrlFor,
  onUpdated = () => {},
}) {
  const [section, setSection] = useState(initialSection),
    [offset, setOffset] = useState(0),
    [profile, setProfile] = useState(null),
    [page, setPage] = useState(null),
    [error, setError] = useState('');
  const [edit, setEdit] = useState(null),
    [editError, setEditError] = useState(''),
    [editBusy, setEditBusy] = useState(false);
  const alive = React.useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function loadQuickEdit() {
    setEditBusy(true);
    setEditError('');
    try {
      const value = await rpc('api_candidate_quick_context', { p_candidate: profile.id });
      if (value?.candidateId !== profile.id || !value.token)
        throw new Error('Quick edit returned an invalid response.');
      if (alive.current) setEdit(value);
    } catch (err) {
      if (alive.current) setEditError(err.message);
    } finally {
      if (alive.current) setEditBusy(false);
    }
  }
  async function saveQuickEdit(e) {
    e.preventDefault();
    setEditBusy(true);
    setEditError('');
    try {
      const value = await rpc('api_candidate_quick_edit', {
        p_candidate: edit.candidateId,
        p_token: edit.token,
        p_owner: edit.owner || '',
        p_next_action: edit.nextAction || '',
      });
      if (value?.candidateId !== profile.id || !value.token)
        throw new Error('Quick edit returned an invalid response.');
      if (alive.current) {
        setProfile((p) => ({ ...p, owner: value.owner, nextAction: value.nextAction }));
        setEdit(null);
        onUpdated();
      }
    } catch (err) {
      if (alive.current) setEditError(err.message);
    } finally {
      if (alive.current) setEditBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    setError('');
    setPage(null);
    if (
      [
        'contacts',
        'communications',
        'readiness',
        'scorecards',
        'availabilityHistory',
        'employmentHistory',
        'compensationHistory',
      ].includes(section)
    )
      return undefined;
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
          {SECTIONS.filter(([key]) => key !== 'compensationHistory' || getRole() === 'admin').map(
            ([key, label]) => (
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
            ),
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {section === 'communications' && (
          <CandidateCommunications key={candidateId} candidateId={candidateId} rpc={rpc} />
        )}
        {section === 'contacts' && (
          <CandidateContacts key={candidateId} candidateId={candidateId} rpc={rpc} enabled />
        )}
        {section === 'readiness' && (
          <CandidateReadiness key={candidateId} candidateId={candidateId} rpc={rpc} enabled />
        )}
        {section === 'scorecards' && (
          <CandidateScorecards key={candidateId} candidateId={candidateId} rpc={rpc} enabled />
        )}
        {['availabilityHistory', 'employmentHistory', 'compensationHistory'].includes(section) && (
          <CandidateFacts
            kind={
              section === 'employmentHistory'
                ? 'employment'
                : section === 'compensationHistory'
                  ? 'compensation'
                  : 'availability'
            }
            key={candidateId}
            candidateId={candidateId}
            rpc={rpc}
            enabled
            onUpdated={(fields) => {
              setProfile((p) => (p ? { ...p, ...fields } : p));
              onUpdated();
            }}
          />
        )}
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
                'nextAction',
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
            {canWriteForRole(getRole()) && (
              <>
                <CandidateProfileEditor
                  key={candidateId}
                  candidateId={candidateId}
                  rpc={rpc}
                  onUpdated={(fields) => {
                    setProfile((p) => ({ ...p, ...fields }));
                    onUpdated();
                  }}
                />
                {editError && <p role="alert">{editError}</p>}
                {edit ? (
                  <form onSubmit={saveQuickEdit} aria-label="Candidate quick edit">
                    <Field label="Candidate owner">
                      <input
                        aria-label="Candidate owner"
                        maxLength={120}
                        disabled={editBusy}
                        value={edit.owner || ''}
                        onChange={(e) => setEdit({ ...edit, owner: e.target.value })}
                      />
                    </Field>
                    <Field label="Next action">
                      <textarea
                        aria-label="Next action"
                        maxLength={1000}
                        disabled={editBusy}
                        value={edit.nextAction || ''}
                        onChange={(e) => setEdit({ ...edit, nextAction: e.target.value })}
                      />
                    </Field>
                    <Button type="submit" disabled={editBusy}>
                      Save quick edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={editBusy}
                      onClick={loadQuickEdit}
                    >
                      Reload quick-edit fields
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={editBusy}
                      onClick={() => {
                        setEdit(null);
                        setEditError('');
                      }}
                    >
                      Cancel quick edit
                    </Button>
                  </form>
                ) : (
                  <Button disabled={editBusy} onClick={loadQuickEdit}>
                    Edit owner & next action
                  </Button>
                )}
              </>
            )}
          </>
        )}
        {![
          'profile',
          'contacts',
          'communications',
          'readiness',
          'scorecards',
          'availabilityHistory',
          'employmentHistory',
          'compensationHistory',
        ].includes(section) &&
          !page &&
          !error && <p role="status">Loading candidate section…</p>}
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
