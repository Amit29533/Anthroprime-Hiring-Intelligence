import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  BriefcaseBusiness,
  Columns3,
  Layers,
  ClipboardCheck,
  ChartNoAxesCombined,
  Handshake,
  FileBarChart,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Menu,
  X,
  Activity,
  ShieldCheck,
  LoaderCircle,
  CalendarClock,
  Building2,
} from 'lucide-react';
import {
  loadData,
  saveRows,
  deleteRows,
  cloud,
  getSupabase,
  getRole,
  canWriteForRole,
  resetRoleForSessionChange,
  emptyData,
  logAuditEvent,
  resetDemo,
} from './repository.js';
import { actionsFor, buildActions, AUTOMATION_TABLES } from './automation.js';
import { uid, today } from './domain.js';
import { Button, Avatar, IconButton } from './ui.jsx';
import Dashboard from './Dashboard.jsx';
import { Candidates, CandidateForm, CandidateProfile } from './Candidates.jsx';
import { Demands, DemandForm, DemandDetail, Pipeline } from './Demands.jsx';
import {
  ImportModal,
  AssessmentForm,
  EnrichmentForm,
  Assessments,
  Activities,
  Pools,
  Analytics,
  Settings as WorkspaceSettings,
  Login,
  DispositionModal,
} from './Workflows.jsx';
import { Interviews } from './Interviews.jsx';
import { Clients, ClientForm, ClientDetail, ContactForm } from './Clients.jsx';
import { DepartmentForm } from './Requisitions.jsx';
import { Reports } from './Reports.jsx';
import { Referrals, ReferralForm, ConvertReferralModal } from './Referrals.jsx';
const nav = [
  ['Overview', LayoutDashboard],
  ['Candidates', Users],
  ['Demands', BriefcaseBusiness],
  ['Clients', Building2],
  ['Pipeline', Columns3],
  ['Talent pools', Layers],
  ['Assessments', ClipboardCheck],
  ['Interviews', CalendarClock],
  ['Activities', Activity],
  ['Referrals', Handshake],
  ['Analytics', ChartNoAxesCombined],
  ['Reports', FileBarChart],
];
export default function App() {
  const [data, setData] = useState(emptyData()),
    [page, setPage] = useState('Overview'),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(''),
    [modal, setModal] = useState(null),
    [personId, setPersonId] = useState(null),
    [personTab, setPersonTab] = useState('Overview'),
    [demandId, setDemandId] = useState(null),
    [clientId, setClientId] = useState(null),
    [pipelineDemand, setPipelineDemand] = useState(null),
    [candidateFilter, setCandidateFilter] = useState(null),
    [busy, setBusy] = useState(false),
    [session, setSession] = useState(null),
    [authReady, setAuthReady] = useState(!cloud);
  const dataRef = useRef(data),
    saving = useRef(false),
    activeSessionUserId = useRef(null);
  dataRef.current = data;
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    let authSubscription;
    const acceptSession = (nextSession) => {
      const nextUserId = nextSession?.user?.id || null;
      if (activeSessionUserId.current !== nextUserId) {
        activeSessionUserId.current = nextUserId;
        resetRoleForSessionChange();
        const cleared = emptyData();
        dataRef.current = cleared;
        setData(cleared);
        setPage('Overview');
        setQuery('');
        setPersonId(null);
        setPersonTab('Overview');
        setDemandId(null);
        setClientId(null);
        setPipelineDemand(null);
        setCandidateFilter(null);
        setModal(null);
        setMobile(false);
        setToast('');
        setError('');
        setLoading(Boolean(nextUserId));
      }
      setSession(nextSession);
      setAuthReady(true);
    };
    getSupabase()
      .then(async (supabase) => {
        if (!active) return;
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          acceptSession(nextSession);
        });
        authSubscription = subscription.subscription;
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) setError(error.message);
        acceptSession(data.session);
      })
      .catch((authError) => {
        if (!active) return;
        setError(authError.message || 'Could not initialize sign-in.');
        setAuthReady(true);
      });
    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);
  const userId = session?.user?.id || null;
  useEffect(() => {
    if (!authReady) return;
    if (cloud && !userId) {
      setData(emptyData());
      setLoading(false);
      setPersonId(null);
      setModal(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    loadData()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authReady, userId]);
  useEffect(() => {
    setPersonTab('Overview');
  }, [personId]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function reload() {
    setLoading(true);
    setError('');
    try {
      const next = await loadData();
      dataRef.current = next;
      setData(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  const audit = useCallback((event) => {
    logAuditEvent(event, dataRef.current)
      .then(({ data: next }) => {
        dataRef.current = next;
        setData(next);
      })
      .catch(() => {});
  }, []);
  const navigate = (p, filter = null) => {
    setPage(p);
    setMobile(false);
    setPersonId(null);
    setDemandId(null);
    setClientId(null);
    setCandidateFilter(filter);
    if (p !== 'Candidates') setQuery('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openClient = (id) => {
    setPage('Clients');
    setClientId(id);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openDemand = (id) => {
    setPage('Demands');
    setDemandId(id);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const automating = useRef(false);
  async function remove(table, ids) {
    if (cloud && !canWriteForRole(getRole())) {
      setToast('Your workspace role is view-only. Ask an administrator to change your access.');
      return false;
    }
    setBusy(true);
    try {
      const next = await deleteRows(table, ids, dataRef.current);
      dataRef.current = next;
      setData(next);
      return true;
    } catch (e) {
      setToast(e.message || 'That could not be deleted.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(table, rows) {
    if (cloud && !canWriteForRole(getRole())) {
      setToast('Your workspace role is view-only. Ask an administrator to change your access.');
      return false;
    }
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    const before = rows.map((r) => dataRef.current[table].find((x) => x.id === r.id) || null);
    let ok = false;
    try {
      const result = await saveRows(table, rows, dataRef.current);
      const next = {
        ...dataRef.current,
        [table]: [
          ...result.rows,
          ...dataRef.current[table].filter((r) => !result.rows.some((n) => n.id === r.id)),
        ],
        history: result.history,
      };
      dataRef.current = next;
      setData(next);
      setToast(rows.length > 1 ? `${rows.length} records saved.` : 'Saved to your repository.');
      ok = true;
    } catch (e) {
      let message = e.message;
      if (cloud && table === 'candidates' && e.code === '23505') {
        try {
          const refreshed = await loadData();
          dataRef.current = refreshed;
          setData(refreshed);
          message =
            'A candidate with matching contact details already exists. The repository refreshed; review duplicates or change the contact details and retry.';
        } catch (refreshError) {
          message = `A candidate with matching contact details may already exist, and the repository could not refresh: ${refreshError.message}`;
        }
      }
      setToast(`Could not save: ${message}`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
    if (ok && !automating.current && AUTOMATION_TABLES.includes(table))
      await applyAutomation(table, rows, before);
    return ok;
  }
  async function applyAutomation(table, rows, before) {
    const rules = (dataRef.current.workflowRules || []).filter((r) => r && r.enabled);
    if (!rules.length) return;
    const fired = [];
    const updatesById = {};
    let taskRows = [],
      noteRows = [];
    rows.forEach((row, i) => {
      const matched = actionsFor(rules, table, before[i], row);
      if (!matched.length) return;
      fired.push(...matched.map((m) => m.name));
      const candidate =
        table === 'candidates'
          ? row
          : dataRef.current.candidates.find((c) => c.id === row.candidateId) || null;
      const demand =
        table === 'demands'
          ? row
          : dataRef.current.demands.find((d) => d.id === row.demandId) || null;
      const built = buildActions(matched, {
        candidate,
        demand,
        actor: 'Automation',
        base: today(),
      });
      taskRows = taskRows.concat(built.tasks);
      noteRows = noteRows.concat(built.notes);
      for (const t of built.tagUpdates) {
        const u =
          updatesById[t.candidateId] ||
          (updatesById[t.candidateId] = {
            base: dataRef.current.candidates.find((c) => c.id === t.candidateId),
            tags: null,
            nextAction: null,
          });
        if (u.base && !(u.base.tags || []).includes(t.tag))
          u.tags = [...(u.tags || u.base.tags || []), t.tag];
      }
      for (const na of built.nextActions) {
        const u =
          updatesById[na.candidateId] ||
          (updatesById[na.candidateId] = {
            base: dataRef.current.candidates.find((c) => c.id === na.candidateId),
            tags: null,
            nextAction: null,
          });
        if (u.base) u.nextAction = na.text;
      }
    });
    if (!fired.length) return;
    automating.current = true;
    try {
      if (taskRows.length) await save('tasks', taskRows);
      if (noteRows.length) await save('notes', noteRows);
      const updates = Object.entries(updatesById).map(([id, u]) => ({
        ...u.base,
        tags: u.tags || u.base.tags || [],
        nextAction: u.nextAction || u.base.nextAction || '',
        updated: today(),
      }));
      if (updates.length) await save('candidates', updates);
      setToast(`Automation: ${[...new Set(fired)].join(', ')} applied.`);
      audit({
        entityType: table,
        entityId: rows[0]?.id || null,
        action: 'updated',
        detail: `Automation rules applied: ${[...new Set(fired)].join(', ')}`,
      });
    } finally {
      automating.current = false;
    }
  }
  async function shortlist(candidateId, demandId) {
    if (
      dataRef.current.considerations.some(
        (a) => a.candidateId === candidateId && a.demandId === demandId,
      )
    ) {
      setToast('This candidate is already in this demand’s pipeline.');
      return;
    }
    if (
      await save('considerations', [
        {
          id: uid(),
          candidateId,
          demandId,
          stage: 'Identified',
          created: today(),
          updated: today(),
          reason: '',
        },
      ])
    )
      setToast('Candidate added to the shortlist. Find them in the hiring pipeline.');
  }
  async function move(application, stage) {
    if (['Rejected', 'Withdrawn'].includes(stage)) {
      setModal({ type: 'disposition', application, stage });
      return;
    }
    const priorDisposition =
      ['Rejected', 'Withdrawn'].includes(application.stage) && application.reason
        ? application.reason
        : '';
    const priorStage = application.stage;
    if (!(await save('considerations', [{ ...application, stage, updated: today(), reason: '' }])))
      return;
    // The live row can only carry a reason while it is dispositioned (DB CHECK), so a reversal
    // is preserved as a dated interaction note instead of being dropped on the floor.
    if (priorDisposition)
      await save('notes', [
        {
          id: uid(),
          candidateId: application.candidateId,
          text: `Moved from ${priorStage} to ${stage} on this demand. Previously recorded disposition: ${priorDisposition}`,
          date: today(),
          followUp: null,
          completed: false,
          author: cloud ? 'Team member' : 'Demo recruiter',
          channel: 'Note',
        },
      ]);
  }
  const addCandidate = () => setModal({ type: 'candidate' }),
    newDemand = () => setModal({ type: 'demand' }),
    importCandidates = () => setModal({ type: 'import' }),
    newAssessment = (candidateId) => setModal({ type: 'assessment', candidateId });
  const person = data.candidates.find((c) => c.id === personId),
    demand = data.demands.find((d) => d.id === demandId),
    client = (data.clients || []).find((c) => c.id === clientId);
  const userName = cloud
    ? session?.user?.user_metadata?.full_name ||
      session?.user?.email?.split('@')[0] ||
      'Team member'
    : 'Amit Singh';
  if (!authReady)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Opening your workspace…
      </div>
    );
  if (cloud && !session) return <Login />;
  let content;
  if (page === 'Overview')
    content = (
      <Dashboard
        data={data}
        navigate={navigate}
        openCandidate={setPersonId}
        openDemand={openDemand}
        onNewDemand={newDemand}
        onAdd={addCandidate}
        onImport={importCandidates}
        onComplete={(n) => save('notes', [{ ...n, completed: true }])}
      />
    );
  else if (page === 'Candidates')
    content = (
      <Candidates
        key={JSON.stringify(candidateFilter)}
        data={data}
        query={query}
        setQuery={setQuery}
        initialFilter={candidateFilter}
        onOpen={setPersonId}
        onAdd={addCandidate}
        onImport={importCandidates}
        notify={setToast}
        audit={audit}
        onSave={save}
      />
    );
  else if (page === 'Demands')
    content = demand ? (
      <DemandDetail
        key={demand.id}
        demand={demand}
        data={data}
        onBack={() => setDemandId(null)}
        onEdit={(d) => setModal({ type: 'demand', demand: d })}
        onOpenCandidate={setPersonId}
        onShortlist={shortlist}
        onPipeline={(id) => {
          setPipelineDemand(id);
          navigate('Pipeline');
        }}
        onEnrich={(preset) => setModal({ type: 'enrichment', preset })}
        onSave={save}
        busy={busy}
        audit={audit}
        onOpenClient={openClient}
        notify={setToast}
      />
    ) : (
      <Demands data={data} onNew={newDemand} onOpen={openDemand} />
    );
  else if (page === 'Clients')
    content = client ? (
      <ClientDetail
        key={client.id}
        client={client}
        data={data}
        onBack={() => setClientId(null)}
        onEdit={(c) => setModal({ type: 'client', client: c })}
        onAddContact={(id) => setModal({ type: 'contact', clientId: id })}
        onEditContact={(c) => setModal({ type: 'contact', contact: c, clientId: c.clientId })}
        onOpenDemand={openDemand}
        onOpenCandidate={setPersonId}
      />
    ) : (
      <Clients
        data={data}
        onNew={() => setModal({ type: 'client' })}
        onOpen={setClientId}
        onSave={save}
        busy={busy}
      />
    );
  else if (page === 'Pipeline')
    content = (
      <Pipeline
        data={data}
        selectedDemand={pipelineDemand}
        setSelectedDemand={setPipelineDemand}
        onOpen={setPersonId}
        onNew={newDemand}
        onMove={move}
        busy={busy}
      />
    );
  else if (page === 'Talent pools') content = <Pools data={data} onOpen={setPersonId} />;
  else if (page === 'Assessments')
    content = (
      <Assessments
        data={data}
        onNew={newAssessment}
        onEnrich={() => setModal({ type: 'enrichment' })}
        onOpen={setPersonId}
        onSave={save}
        busy={busy}
      />
    );
  else if (page === 'Interviews')
    content = (
      <Interviews
        data={data}
        onSave={save}
        onOpen={setPersonId}
        busy={busy}
        notify={setToast}
        audit={audit}
      />
    );
  else if (page === 'Activities')
    content = (
      <Activities
        data={data}
        onOpen={setPersonId}
        onSave={save}
        busy={busy}
        notify={setToast}
        audit={audit}
      />
    );
  else if (page === 'Analytics') content = <Analytics data={data} navigate={navigate} />;
  else if (page === 'Referrals')
    content = (
      <Referrals
        data={data}
        onNew={() => setModal({ type: 'referral' })}
        onEdit={(referral) => setModal({ type: 'referral', referral })}
        onConvert={(referral) => setModal({ type: 'convertReferral', referral })}
        onOpenCandidate={setPersonId}
        busy={busy}
      />
    );
  else if (page === 'Reports')
    content = (
      <Reports
        data={data}
        onSave={save}
        onDelete={remove}
        notify={setToast}
        audit={audit}
        busy={busy}
      />
    );
  else
    content = (
      <WorkspaceSettings
        data={data}
        session={session}
        onReload={reload}
        notify={setToast}
        audit={audit}
        onSave={save}
        onModal={setModal}
      />
    );
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${mobile ? 'is-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('Overview');
          }}
        >
          <img
            className="brand-image"
            src="/anthroprime-logo.jpg"
            alt="AnthroPrime logo"
            width="62"
            height="48"
          />
          <span className="brand-wordmark">
            AnthroPrime<small>ECOD · TALENT INTELLIGENCE</small>
          </span>
        </a>
        <div className="workspace-select">
          <img
            className="workspace-logo workspace-brand-image"
            src="/anthroprime-logo.jpg"
            alt=""
            width="34"
            height="28"
          />
          <span>
            <strong>AnthroPrime</strong>
            <small>Talent workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              className={page === name ? 'active' : ''}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === 'Candidates' && <b>{data.candidates.length}</b>}
              {name === 'Demands' && (
                <b>{data.demands.filter((d) => d.status === 'Open').length}</b>
              )}
              {name === 'Clients' && <b>{(data.clients || []).length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-symbol">
              <Layers size={19} />
            </span>
            <strong>Great talent. Lasting value.</strong>
            <p>Every connection is a future opportunity.</p>
          </div>
          <button
            className={`settings-nav ${page === 'Settings' ? 'active' : ''}`}
            onClick={() => navigate('Settings')}
          >
            <Settings size={19} /> Workspace settings
          </button>
          <div className="sidebar-user">
            <Avatar name={userName} size="small" />
            <span>
              <strong>{userName}</strong>
              <small>{cloud ? 'Team member' : 'Demo recruiter'}</small>
            </span>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      {mobile && <div className="mobile-scrim" onClick={() => setMobile(false)} />}
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              icon={Menu}
              label="Open navigation"
              className="icon-button mobile-toggle"
              onClick={() => setMobile(!mobile)}
            />
            <span>Workspace</span>
            <span className="crumb-divider">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate('Candidates');
              }}
            >
              <Search size={16} />
              <input
                aria-label="Search your repository"
                placeholder="Search your repository"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <button className="mode-pill" onClick={() => navigate('Settings')}>
              <span />
              {cloud ? 'Team workspace' : 'Demo workspace'}
            </button>
            <IconButton
              icon={Bell}
              label="View follow-ups"
              onClick={() => navigate('Activities')}
            />
            <Avatar name={userName} size="small" />
          </div>
        </header>
        <main id="main-content">
          {cloud && !canWriteForRole(getRole()) && !loading && !error && (
            <div className="readonly-banner" role="status">
              Viewer access is read-only. Editing, restore and data-export actions are unavailable.
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Loading your workspace…
            </div>
          ) : error ? (
            <div className="error-state">
              <h2>Unable to open the workspace</h2>
              <p>{error}</p>
              <Button onClick={reload}>Retry</Button>
              {!cloud && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await resetDemo();
                    await reload();
                  }}
                >
                  Reset demo data
                </Button>
              )}
              {cloud && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const supabase = await getSupabase();
                    await supabase.auth.signOut();
                  }}
                >
                  Sign out
                </Button>
              )}
            </div>
          ) : (
            content
          )}
          <footer className="workspace-footer">
            <span>AnthroPrime · ECOD Talent Intelligence</span>
            <span>
              {cloud
                ? 'Authenticated team workspace'
                : 'Fictional sample data · Changes saved in this browser'}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button onClick={() => setToast('')} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
      {person && !modal && (
        <CandidateProfile
          candidate={person}
          data={data}
          onClose={() => setPersonId(null)}
          onEdit={(c) => setModal({ type: 'candidate', candidate: c })}
          onSave={save}
          onShortlist={shortlist}
          onAssess={newAssessment}
          busy={busy}
          audit={audit}
          notify={setToast}
          initialTab={personTab}
          onTabChange={setPersonTab}
        />
      )}
      {modal?.type === 'candidate' && (
        <CandidateForm
          candidate={modal.candidate}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'demand' && (
        <DemandForm
          demand={modal.demand}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          onCreated={openDemand}
          busy={busy}
        />
      )}
      {modal?.type === 'client' && (
        <ClientForm
          client={modal.client}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          onCreated={openClient}
          busy={busy}
        />
      )}
      {modal?.type === 'contact' && (
        <ContactForm
          contact={modal.contact}
          clientId={modal.clientId}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'referral' && (
        <ReferralForm
          referral={modal.referral}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'convertReferral' && (
        <ConvertReferralModal
          referral={modal.referral}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          audit={audit}
          notify={setToast}
          busy={busy}
        />
      )}
      {modal?.type === 'department' && (
        <DepartmentForm
          department={modal.department}
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'import' && (
        <ImportModal
          data={data}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
          notify={setToast}
        />
      )}
      {modal?.type === 'assessment' && (
        <AssessmentForm
          data={data}
          candidateId={modal.candidateId}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'enrichment' && (
        <EnrichmentForm
          data={data}
          preset={modal.preset}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
      {modal?.type === 'disposition' && (
        <DispositionModal
          application={modal.application}
          stage={modal.stage}
          onClose={() => setModal(null)}
          onSave={save}
          busy={busy}
        />
      )}
    </div>
  );
}
