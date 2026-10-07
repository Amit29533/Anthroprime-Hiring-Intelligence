import { MotionToggle } from './Visuals.jsx';
import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
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
  ChevronDown,
  Check,
  Plus,
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
  normalizeData,
  deleteRows,
  cloud,
  getSupabase,
  getRole,
  canWriteForRole,
  resetRoleForSessionChange,
  refreshWorkspaceAccess,
  getWorkspace,
  getWorkspaces,
  switchWorkspace,
  createWorkspace,
  emptyData,
  logAuditEvent,
  resetDemo,
} from './repository.js';
import { AUTOMATION_TABLES } from './automation.js';
import { planAutomation } from './automationPlan.js';
import { uid, today } from './domain.js';
import { Button, Avatar, IconButton, Field, Modal } from './ui.jsx';
import Dashboard from './Dashboard.jsx';
import { GlobalSearch, NotificationBell } from './Topbar.jsx';
import { applyAssignment } from './assignment.js';
import { serverExecutionEnabled } from './execution.js';
import { ThemeToggle, useTheme } from './theme.jsx';
import AccountProfile from './AccountProfile.jsx';

const AssignedWork = lazy(() =>
  import('./AssignedWork.jsx').then((module) => ({ default: module.AssignedWork })),
);

// Keep the dashboard fast: each feature area is downloaded only when it is opened. Named-export
// modules use one shared chunk per source file, so opening a form reuses the page's existing chunk.
const lazyNamed = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const candidatesModule = () => import('./Candidates.jsx');
const demandsModule = () => import('./Demands.jsx');
const workflowsModule = () => import('./Workflows.jsx');
const clientsModule = () => import('./Clients.jsx');
const referralsModule = () => import('./Referrals.jsx');
const Candidates = lazyNamed(candidatesModule, 'Candidates');
const CandidateForm = lazyNamed(candidatesModule, 'CandidateForm');
const CandidateProfile = lazyNamed(candidatesModule, 'CandidateProfile');
const PagedCandidates = lazyNamed(() => import('./PagedRepository.jsx'), 'PagedCandidates');
const PagedOverview = lazyNamed(() => import('./PagedRepository.jsx'), 'PagedOverview');
const PagedCandidate360 = lazyNamed(() => import('./PagedRepository.jsx'), 'PagedCandidate360');
const Demands = lazyNamed(demandsModule, 'Demands');
const DemandForm = lazyNamed(demandsModule, 'DemandForm');
const DemandDetail = lazyNamed(demandsModule, 'DemandDetail');
const Pipeline = lazyNamed(demandsModule, 'Pipeline');
const ImportModal = lazyNamed(() => import('./ImportCandidates.jsx'), 'ImportModal');
const AssessmentForm = lazyNamed(workflowsModule, 'AssessmentForm');
const EnrichmentForm = lazyNamed(workflowsModule, 'EnrichmentForm');
const Assessments = lazyNamed(workflowsModule, 'Assessments');
const Activities = lazyNamed(workflowsModule, 'Activities');
const Pools = lazyNamed(workflowsModule, 'Pools');
const Analytics = lazyNamed(workflowsModule, 'Analytics');
const WorkspaceSettings = lazyNamed(workflowsModule, 'Settings');
const Login = lazyNamed(() => import('./Login.jsx'), 'Login');
const DispositionModal = lazyNamed(workflowsModule, 'DispositionModal');
const Interviews = lazyNamed(() => import('./Interviews.jsx'), 'Interviews');
const Clients = lazyNamed(clientsModule, 'Clients');
const ClientForm = lazyNamed(clientsModule, 'ClientForm');
const ClientDetail = lazyNamed(clientsModule, 'ClientDetail');
const ContactForm = lazyNamed(clientsModule, 'ContactForm');
const PlacementForm = lazyNamed(clientsModule, 'PlacementForm');
const DepartmentForm = lazyNamed(() => import('./Requisitions.jsx'), 'DepartmentForm');
const Reports = lazyNamed(() => import('./Reports.jsx'), 'Reports');
const Referrals = lazyNamed(referralsModule, 'Referrals');
const ReferralForm = lazyNamed(referralsModule, 'ReferralForm');
const ConvertReferralModal = lazyNamed(referralsModule, 'ConvertReferralModal');
const AssignmentRuleForm = lazyNamed(() => import('./Assignment.jsx'), 'AssignmentRuleForm');
const featureFallback = (
  <div className="loading" role="status">
    <LoaderCircle className="spin" /> Loading feature…
  </div>
);
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

function CreateWorkspaceModal({ onClose, onCreate, busy }) {
  const [name, setName] = useState('');
  return (
    <Modal
      title="Create workspace"
      subtitle="Start a separate repository with its own candidates, demands, users and documents."
      onClose={onClose}
    >
      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name);
        }}
      >
        <Field label="Workspace name" hint="Use your company, team or business-unit name.">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength="2"
            maxLength="80"
            required
            placeholder="Example: AnthroPrime Consulting"
          />
        </Field>
        <div className="modal-actions workspace-create-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" icon={Plus} disabled={busy || name.trim().length < 2}>
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const [demoSignedOut, setDemoSignedOut] = useState(false);
  const [pageFilter, setPageFilter] = useState(null);
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
    [authReady, setAuthReady] = useState(!cloud),
    [workspaces, setWorkspaces] = useState([]),
    [activeWorkspace, setActiveWorkspace] = useState(null),
    [workspaceMenu, setWorkspaceMenu] = useState(false),
    [workspaceCreate, setWorkspaceCreate] = useState(false);
  const dataRef = useRef(data),
    saving = useRef(false),
    activeSessionUserId = useRef(null),
    reloadSequence = useRef(0);
  dataRef.current = data;
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    let authSubscription;
    const acceptSession = (nextSession) => {
      const nextUserId = nextSession?.user?.id || null;
      if (activeSessionUserId.current !== nextUserId) {
        reloadSequence.current++;
        activeSessionUserId.current = nextUserId;
        resetRoleForSessionChange();
        const cleared = emptyData();
        dataRef.current = cleared;
        setData(cleared);
        setPageFilter(null);
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
        setWorkspaces([]);
        setActiveWorkspace(null);
        setWorkspaceMenu(false);
        setWorkspaceCreate(false);
        setAccountOpen(false);
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
        if (active) {
          setData(d);
          setWorkspaces(getWorkspaces());
          setActiveWorkspace(getWorkspace());
        }
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
    if (!cloud || !userId) return undefined;
    let active = true,
      pending = false;
    async function checkAccess() {
      if (pending) return;
      pending = true;
      const before = getWorkspace();
      let accessSequence = reloadSequence.current;
      let loadingAccess = false;
      try {
        const next = await refreshWorkspaceAccess();
        if (
          !active ||
          accessSequence !== reloadSequence.current ||
          (before?.id === next?.id && before?.role === next?.role)
        )
          return;
        accessSequence = ++reloadSequence.current;
        const cleared = emptyData();
        dataRef.current = cleared;
        setData(cleared);
        setPersonId(null);
        setModal(null);
        setDemandId(null);
        setClientId(null);
        setPageFilter(null);
        setCandidateFilter(null);
        setPipelineDemand(null);
        setQuery('');
        setPage('Overview');
        setWorkspaces(getWorkspaces());
        setActiveWorkspace(next);
        loadingAccess = true;
        setLoading(true);
        const updated = await loadData();
        if (active && accessSequence === reloadSequence.current) {
          dataRef.current = updated;
          setData(updated);
          setError('');
        }
      } catch (err) {
        if (active && accessSequence === reloadSequence.current) {
          setLoading(false);
          ++reloadSequence.current;
          const cleared = emptyData();
          dataRef.current = cleared;
          setData(cleared);
          setPersonId(null);
          setModal(null);
          setDemandId(null);
          setClientId(null);
          resetRoleForSessionChange();
          setActiveWorkspace(null);
          setWorkspaces([]);
          setError(
            'Access could not be verified. Cached workspace data was cleared. ' + err.message,
          );
        }
      } finally {
        pending = false;
        if (active && loadingAccess && accessSequence === reloadSequence.current) setLoading(false);
      }
    }
    const timer = setInterval(checkAccess, 60000);
    window.addEventListener('focus', checkAccess);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', checkAccess);
    };
  }, [userId]);
  function openPerson(id, tab = 'Overview') {
    setPersonTab(tab);
    setPersonId(id);
    setMobile(false);
  }
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function reload() {
    const sequence = ++reloadSequence.current;
    const user = activeSessionUserId.current;
    const workspace = getWorkspace()?.id;
    const currentRequest = () =>
      sequence === reloadSequence.current &&
      user === activeSessionUserId.current &&
      workspace === getWorkspace()?.id;
    setLoading(true);
    setError('');
    try {
      const next = await loadData({ forceFull: !dataRef.current.repositoryPartial });
      if (!currentRequest()) return;
      dataRef.current = next;
      setData(next);
      setWorkspaces(getWorkspaces());
      setActiveWorkspace(getWorkspace());
    } catch (e) {
      if (currentRequest()) setError(e.message);
    } finally {
      if (currentRequest()) setLoading(false);
    }
  }
  function resetWorkspaceView() {
    reloadSequence.current++;
    setPageFilter(null);
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
  }
  async function selectWorkspace(workspace) {
    setWorkspaceMenu(false);
    if (!workspace || workspace.id === activeWorkspace?.id) return;
    setBusy(true);
    setLoading(true);
    setError('');
    resetWorkspaceView();
    try {
      await switchWorkspace(workspace.id);
      const next = await loadData();
      dataRef.current = next;
      setData(next);
      setWorkspaces(getWorkspaces());
      setActiveWorkspace(getWorkspace());
      setToast(`Switched to ${getWorkspace()?.name || workspace.name}.`);
    } catch (workspaceError) {
      setError(workspaceError.message || 'Could not switch workspace.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }
  async function addWorkspace(name) {
    setBusy(true);
    setLoading(true);
    setError('');
    try {
      await createWorkspace(name);
      resetWorkspaceView();
      const next = await loadData();
      dataRef.current = next;
      setData(next);
      setWorkspaces(getWorkspaces());
      setActiveWorkspace(getWorkspace());
      setWorkspaceCreate(false);
      setToast(`${getWorkspace()?.name || name.trim()} is ready.`);
    } catch (workspaceError) {
      setToast(workspaceError.message || 'Could not create workspace.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }
  const audit = useCallback((event) => {
    const user = activeSessionUserId.current;
    const workspace = getWorkspace()?.id;
    logAuditEvent(event, dataRef.current)
      .then(({ row }) => {
        if (user !== activeSessionUserId.current || workspace !== getWorkspace()?.id) return;
        // An audit request can finish after a record save. Merge its row into the
        // latest snapshot instead of replacing the workspace with its old snapshot.
        const current = dataRef.current;
        const next = {
          ...current,
          auditEvents: [row, ...current.auditEvents.filter((item) => item.id !== row.id)].slice(
            0,
            500,
          ),
        };
        dataRef.current = next;
        setData(next);
      })
      .catch(() => {});
  }, []);
  async function fullWorkspace() {
    if (!dataRef.current.repositoryPartial) return true;
    const user = activeSessionUserId.current,
      workspace = getWorkspace()?.id;
    setLoading(true);
    setError('');
    try {
      const next = await loadData({ forceFull: true });
      if (user !== activeSessionUserId.current || workspace !== getWorkspace()?.id) return false;
      dataRef.current = next;
      setData(next);
      return true;
    } catch (e) {
      if (user === activeSessionUserId.current && workspace === getWorkspace()?.id)
        setError(e.message);
      return false;
    } finally {
      if (user === activeSessionUserId.current && workspace === getWorkspace()?.id)
        setLoading(false);
    }
  }
  const navigate = async (p, filter = null) => {
    if (
      dataRef.current.repositoryPartial &&
      (!['Overview', 'Candidates'].includes(p) || filter?.ids || filter?.queue)
    ) {
      if (!(await fullWorkspace())) return;
    }
    setPageFilter(filter);
    setPage(p);
    setMobile(false);
    setWorkspaceMenu(false);
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

  /** Take a global-search result to wherever that record lives. */
  function openSearchResult(result) {
    if (result.type === 'candidate') return openPerson(result.id);
    if (result.type === 'note') return openPerson(result.parentId, 'Notes & follow-ups');
    if (result.type === 'demand') return openDemand(result.id);
    if (result.type === 'client') return openClient(result.id);
    if (result.type === 'contact') return openClient(result.parentId);
    if (result.type === 'referral') {
      if (!canWriteForRole(getRole())) return navigate('Referrals', { query: result.title });
      navigate('Referrals');
      const referral = dataRef.current.referrals.find((row) => row.id === result.id);
      if (referral) setModal({ type: 'referral', referral });
      return;
    }
    if (result.type === 'skill') return navigate('Candidates', { skill: result.title });
    return undefined;
  }

  async function save(table, rows) {
    if (cloud && !canWriteForRole(getRole())) {
      setToast('Your workspace role is view-only. Ask an administrator to change your access.');
      return false;
    }
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    let serverMode = false;
    if (cloud && AUTOMATION_TABLES.includes(table)) {
      try {
        serverMode = await serverExecutionEnabled();
      } catch (error) {
        saving.current = false;
        setBusy(false);
        setToast(error.message);
        return false;
      }
    }
    const before = rows.map((r) => dataRef.current[table].find((x) => x.id === r.id) || null);
    // Assignment rules (Phase D) fill an empty owner as a record is created. They only ever act
    // on rows that are genuinely new and genuinely unowned, so an existing owner is never moved.
    let assignedBy = '';
    if (!serverMode && (table === 'candidates' || table === 'demands')) {
      const fresh = rows.filter((r, i) => !before[i]);
      const assigned = applyAssignment(dataRef.current, table, fresh);
      if (assigned.length) {
        assignedBy = assigned[0]._rule;
        rows = rows.map((r) => {
          const hit = assigned.find((a) => a.id === r.id);
          if (!hit) return r;
          // `_rule` is annotation for the toast, not a column — strip it before saving.
          const row = { ...hit };
          delete row._rule;
          return row;
        });
      }
    }
    let ok = false;
    try {
      const result = await saveRows(table, rows, dataRef.current);
      let next = {
        ...dataRef.current,
        [table]: [
          ...result.rows,
          ...dataRef.current[table].filter((r) => !result.rows.some((n) => n.id === r.id)),
        ],
        history: result.history,
      };
      if (table === 'candidates') next = normalizeData(next, { assignIdentities: !cloud });
      dataRef.current = next;
      setData(next);
      setToast(
        assignedBy
          ? `Saved and assigned by “${assignedBy}”.`
          : rows.length > 1
            ? `${rows.length} records saved.`
            : 'Saved to your repository.',
      );
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
    if (ok && !serverMode && !automating.current && AUTOMATION_TABLES.includes(table))
      await applyAutomation(table, rows, before);
    return ok;
  }
  async function applyAutomation(table, rows, before) {
    const plan = planAutomation(dataRef.current, table, rows, before, { base: today() });
    if (!plan.names.length) return;
    automating.current = true;
    try {
      for (const [target, actions] of plan.batches) {
        if (actions.length && !(await save(target, actions))) {
          setToast(
            (message) =>
              `${message} The original record was saved; automation stopped. Earlier actions may have completed.`,
          );
          return;
        }
      }
      setToast(`Automation: ${plan.names.join(', ')} applied.`);
      audit({
        entityType: table,
        entityId: rows[0]?.id || null,
        action: 'updated',
        detail: `Automation rules applied: ${plan.names.join(', ')}`,
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
  const addCandidate = async () => {
      if (await fullWorkspace()) setModal({ type: 'candidate' });
    },
    newDemand = async () => {
      if (await fullWorkspace()) setModal({ type: 'demand' });
    },
    importCandidates = async () => {
      if (await fullWorkspace()) setModal({ type: 'import' });
    },
    newAssessment = (candidateId) => setModal({ type: 'assessment', candidateId });
  const person = data.candidates.find((c) => c.id === personId),
    demand = data.demands.find((d) => d.id === demandId),
    client = (data.clients || []).find((c) => c.id === clientId);
  const userName = cloud
    ? session?.user?.user_metadata?.full_name ||
      session?.user?.email?.split('@')[0] ||
      'Team member'
    : 'Amit Singh';
  const workspaceName = activeWorkspace?.name || (cloud ? 'Choose workspace' : 'AnthroPrime');
  async function signOutAccount() {
    if (cloud) {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } else {
      setDemoSignedOut(true);
    }
    setAccountOpen(false);
    setModal(null);
    setPersonId(null);
    setDemandId(null);
    setClientId(null);
    setMobile(false);
    setQuery('');
  }
  if (!cloud && demoSignedOut)
    return (
      <div className="account-exit">
        <div className="panel">
          <ShieldCheck size={32} aria-hidden="true" />
          <h1>You’re signed out</h1>
          <p>Your local demo data is saved in this browser.</p>
          <Button
            onClick={() => {
              setPage('Overview');
              setDemoSignedOut(false);
            }}
          >
            Open demo workspace
          </Button>
        </div>
      </div>
    );
  const workspaceAccess = cloud
    ? activeWorkspace
      ? `${activeWorkspace.role === 'admin' ? 'Admin' : activeWorkspace.role === 'recruiter' ? 'Recruiter' : 'Viewer'} access`
      : 'Create or join'
    : 'Local sample data';
  if (!authReady)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Opening your workspace…
      </div>
    );
  if (cloud && !session)
    return (
      <Suspense fallback={featureFallback}>
        <Login theme={theme} onThemeChange={setTheme} />
      </Suspense>
    );
  let content;
  if (data.repositoryPartial)
    content =
      page === 'Candidates' ? (
        <PagedCandidates
          key={`${activeWorkspace?.id || ''}:${JSON.stringify(candidateFilter)}`}
          initialFilter={candidateFilter}
          onFull={async (id, action) => {
            if (!(await fullWorkspace())) return;
            setPage('Candidates');
            if (id) openPerson(id);
            if (action === 'add') setModal({ type: 'candidate' });
          }}
        />
      ) : (
        <PagedOverview
          onBrowse={() => navigate('Candidates')}
          onFull={fullWorkspace}
          onOpenWorklist={openPerson}
          onSettings={() => navigate('Settings')}
        />
      );
  else if (page === 'Overview')
    content = (
      <Dashboard
        data={data}
        navigate={navigate}
        openCandidate={openPerson}
        openDemand={openDemand}
        onNewDemand={newDemand}
        onAdd={addCandidate}
        onImport={importCandidates}
        onComplete={(n) => save('notes', [{ ...n, completed: true }])}
        user={{ name: userName, email: session?.user?.email || '' }}
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
        onOpen={openPerson}
        onAdd={addCandidate}
        onImport={importCandidates}
        notify={setToast}
        audit={audit}
        onSave={save}
        busy={busy}
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
        onOpenCandidate={openPerson}
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
      <Demands data={data} initialFilter={pageFilter} onNew={newDemand} onOpen={openDemand} />
    );
  else if (page === 'Clients')
    content = client ? (
      <ClientDetail
        key={client.id}
        client={client}
        data={data}
        onSave={save}
        busy={busy}
        uploadedBy={userName}
        onBack={() => setClientId(null)}
        onEdit={(c) => setModal({ type: 'client', client: c })}
        onAddContact={(id) => setModal({ type: 'contact', clientId: id })}
        onEditContact={(c) => setModal({ type: 'contact', contact: c, clientId: c.clientId })}
        onOpenDemand={openDemand}
        onOpenCandidate={openPerson}
        onAddPlacement={(id) => setModal({ type: 'placement', clientId: id })}
        onEditPlacement={(placement) =>
          setModal({ type: 'placement', placement, clientId: placement.clientId })
        }
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
        onOpen={openPerson}
        onNew={newDemand}
        onMove={move}
        busy={busy}
      />
    );
  else if (page === 'Talent pools')
    content = <Pools data={data} onOpen={openPerson} onSave={save} busy={busy} />;
  else if (page === 'Assessments')
    content = (
      <Assessments
        data={data}
        onNew={newAssessment}
        onEnrich={() => setModal({ type: 'enrichment' })}
        onOpen={openPerson}
        onSave={save}
        busy={busy}
      />
    );
  else if (page === 'Interviews')
    content = (
      <Interviews
        data={data}
        initialFilter={pageFilter}
        onSave={save}
        onOpen={openPerson}
        busy={busy}
        notify={setToast}
        audit={audit}
      />
    );
  else if (page === 'Activities')
    content = (
      <Activities
        data={
          pageFilter?.ids
            ? {
                ...data,
                tasks: data.tasks.filter((row) => pageFilter.ids.includes(row.id)),
                notes: [],
              }
            : data
        }
        onOpen={openPerson}
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
        key={pageFilter?.query || 'all-referrals'}
        initialQuery={pageFilter?.query || ''}
        data={data}
        onNew={() => setModal({ type: 'referral' })}
        onEdit={(referral) => setModal({ type: 'referral', referral })}
        onConvert={(referral) => setModal({ type: 'convertReferral', referral })}
        onOpenCandidate={openPerson}
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
        onDelete={remove}
        onModal={setModal}
      />
    );
  if (cloud && data.assignedOnly)
    return (
      <div className="app-shell">
        <main>
          <Field label="Assigned workspace">
            <select
              aria-label="Assigned workspace"
              disabled={loading}
              value={activeWorkspace?.id || ''}
              onChange={(event) =>
                selectWorkspace(workspaces.find((workspace) => workspace.id === event.target.value))
              }
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} · {workspace.role}
                </option>
              ))}
            </select>
          </Field>
          {error && <p role="alert">{error}</p>}
          <Suspense fallback={featureFallback}>
            <AssignedWork key={`${activeWorkspace?.id}:${activeWorkspace?.role}`} />
          </Suspense>
          <Button variant="secondary" onClick={reload}>
            Reload workspace access
          </Button>
          <Button
            variant="secondary"
            onClick={() => getSupabase().then((client) => client.auth.signOut())}
          >
            Sign out
          </Button>
        </main>
      </div>
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
        <div className="workspace-switcher">
          <button
            type="button"
            className="workspace-select"
            aria-haspopup={cloud ? 'menu' : undefined}
            aria-expanded={cloud ? workspaceMenu : undefined}
            onClick={() => cloud && setWorkspaceMenu((open) => !open)}
            disabled={loading || busy}
          >
            <img
              className="workspace-logo workspace-brand-image"
              src="/anthroprime-logo.jpg"
              alt=""
              width="34"
              height="28"
            />
            <span>
              <strong>{workspaceName}</strong>
              <small>{workspaceAccess}</small>
            </span>
            {cloud && (
              <ChevronDown className={workspaceMenu ? 'workspace-chevron open' : ''} size={15} />
            )}
          </button>
          {cloud && workspaceMenu && (
            <div className="workspace-menu" role="menu" aria-label="Choose workspace">
              <div className="workspace-menu-label">YOUR WORKSPACES</div>
              {workspaces.map((workspace) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.id === activeWorkspace?.id}
                  key={workspace.id}
                  onClick={() => selectWorkspace(workspace)}
                >
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.role}</small>
                  </span>
                  {workspace.id === activeWorkspace?.id && <Check size={15} />}
                </button>
              ))}
              <button
                type="button"
                className="workspace-create"
                onClick={() => {
                  setWorkspaceMenu(false);
                  setWorkspaceCreate(true);
                }}
              >
                <Plus size={15} />
                <span>Create workspace</span>
              </button>
            </div>
          )}
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              className={page === name ? 'active' : ''}
              aria-current={page === name ? 'page' : undefined}
              key={name}
              onClick={() => navigate(name)}
              disabled={loading}
            >
              <Icon size={19} />
              <span>{name}</span>
              {!data.repositoryPartial && name === 'Candidates' && <b>{data.candidates.length}</b>}
              {!data.repositoryPartial && name === 'Demands' && (
                <b>{data.demands.filter((d) => d.status === 'Open').length}</b>
              )}
              {!data.repositoryPartial && name === 'Clients' && (
                <b>{(data.clients || []).length}</b>
              )}
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
          <button
            type="button"
            className="sidebar-user account-trigger"
            aria-label="Open your account from sidebar"
            aria-haspopup="dialog"
            onClick={() => setAccountOpen(true)}
          >
            <Avatar name={userName} size="small" />
            <span>
              <strong>{userName}</strong>
              <small>{cloud ? 'Team member' : 'Demo recruiter'}</small>
            </span>
            <ShieldCheck size={17} />
          </button>
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
          {!data.repositoryPartial && (
            <GlobalSearch
              data={data}
              isAdmin={getRole() === 'admin'}
              query={query}
              setQuery={setQuery}
              onOpen={openSearchResult}
            />
          )}
          <div className="topbar-actions">
            <button className="mode-pill" onClick={() => navigate('Settings')}>
              <span />
              {cloud ? workspaceName : 'Demo workspace'}
            </button>
            {!data.repositoryPartial && (
              <NotificationBell
                data={data}
                user={{ name: userName, email: session?.user?.email || '' }}
                isAdmin={getRole() === 'admin'}
                navigate={navigate}
              />
            )}
            <MotionToggle />
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button
              type="button"
              className="profile-trigger"
              aria-label="Open your account"
              aria-haspopup="dialog"
              onClick={() => setAccountOpen(true)}
            >
              <Avatar name={userName} size="small" />
            </button>
          </div>
        </header>
        <main id="main-content">
          {(pageFilter?.ids || pageFilter?.skill) && (
            <div className="queue-filter" role="status">
              Showing{' '}
              {pageFilter.label ||
                (pageFilter.skill ? `candidates with ${pageFilter.skill}` : 'selected work')}
              <button className="text-link" onClick={() => navigate(page)}>
                Show all
              </button>
            </div>
          )}
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
            <div className="page-content" key={page}>
              <Suspense fallback={featureFallback}>{content}</Suspense>
            </div>
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
      {accountOpen && (
        <AccountProfile
          name={userName}
          email={session?.user?.email}
          role={getRole()}
          workspace={workspaceName}
          demo={!cloud}
          onClose={() => setAccountOpen(false)}
          onSignOut={signOutAccount}
        />
      )}
      {workspaceCreate && (
        <CreateWorkspaceModal
          busy={busy}
          onClose={() => !busy && setWorkspaceCreate(false)}
          onCreate={addWorkspace}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button onClick={() => setToast('')} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
      <Suspense fallback={modal || person || personId ? featureFallback : null}>
        {data.repositoryPartial && personId && !modal && (
          <PagedCandidate360
            key={`${activeWorkspace?.id}:${personId}:${personTab}`}
            candidateId={personId}
            initialSection={
              {
                Employment: 'employmentHistory',
                Availability: 'availabilityHistory',
                Contacts: 'contacts',
              }[personTab] || 'profile'
            }
            onClose={() => setPersonId(null)}
            onUpdated={reload}
            onFull={async (id) => {
              if (await fullWorkspace()) openPerson(id);
            }}
          />
        )}
        {person && !modal && (
          <CandidateProfile
            candidate={person}
            data={data}
            onClose={() => setPersonId(null)}
            onEdit={(c) => setModal({ type: 'candidate', candidate: c })}
            onSave={save}
            onShortlist={shortlist}
            onReload={reload}
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
        {modal?.type === 'placement' && (
          <PlacementForm
            placement={modal.placement}
            clientId={modal.clientId}
            data={data}
            onClose={() => setModal(null)}
            onSave={save}
            busy={busy}
          />
        )}
        {modal?.type === 'assignmentRule' && (
          <AssignmentRuleForm
            rule={modal.rule}
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
            onReload={reload}
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
      </Suspense>
    </div>
  );
}
