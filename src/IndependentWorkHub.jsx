import ControlledWorkflows from './ControlledWorkflows.jsx';
import EnterpriseOperations from './EnterpriseOperations.jsx';
import GoogleWorkspace from './GoogleWorkspace.jsx';
import ProcessingRecovery from './ProcessingRecovery.jsx';
import DeliverySandbox from './DeliverySandbox.jsx';
import React, { lazy, Suspense, useRef, useState, useEffect } from 'react';
import {
  ListTodo,
  MessageSquare,
  Mail,
  ShieldCheck,
  ChartNoAxesCombined,
  Search,
  Plug,
  ArchiveRestore,
  CalendarDays,
  Building2,
  Sparkles,
} from 'lucide-react';
import { DisclosureSection } from './DisclosureSection.jsx';
const CompletionWorkbench = lazy(() => import('./CompletionWorkbench.jsx'));
const FoundationWorkbench = lazy(() => import('./FoundationWorkbench.jsx'));
import { cloud, getRole, getWorkspaceId, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { CandidateCommunications } from './CandidateCommunications.jsx';
import { FeedbackQueue } from './FeedbackLoops.jsx';
import { RecruiterWorklist } from './RecruiterWorklist.jsx';
import { SlaWorklist } from './OperationsConsole.jsx';
import { RepositoryQuality } from './RepositoryQuality.jsx';

// Both repository modes use the same server-backed queues and scope boundaries.
export default function IndependentWorkHub({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  rpc = repositoryRead,
  onOpen,
  onOpenClient,
  onOpenDemand,
  onSettings,
}) {
  const root = useRef(null);
  const [activeTool, setActiveTool] = useState('');
  const scrollTarget = useRef(false);
  const openTool = (tool) => {
    if (!root.current?.querySelector(`[data-completion-target="${tool}"]`)) return;
    scrollTarget.current = true;
    setActiveTool(tool);
  };
  useEffect(() => {
    if (!scrollTarget.current) return;
    scrollTarget.current = false;
    root.current
      ?.querySelector(`[data-completion-target="${activeTool}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeTool]);
  if (!isCloud || !['admin', 'recruiter', 'viewer'].includes(role)) return null;
  const section = (id, title, description, Icon, children) => (
    <DisclosureSection
      key={id}
      title={title}
      description={description}
      icon={Icon}
      data-completion-target={id}
      open={activeTool === id}
      onToggle={(open) => setActiveTool(open ? id : '')}
    >
      {children}
    </DisclosureSection>
  );
  return (
    <section
      ref={root}
      className="workspace-tool-groups"
      aria-label="Independent feature work queues"
      key={`${scope}:${role}`}
    >
      <h2>Your workspace tools</h2>
      <p>Open the area you need. Each section keeps your work when you switch.</p>
      <div className="disclosure-stack">
        {section(
          'tasks',
          'Tasks and follow-ups',
          'Recruiter worklist, deadlines and reminders',
          ListTodo,
          <>
            <RecruiterWorklist rpc={rpc} editable={canWriteForRole(role)} onOpen={onOpen} />
            <SlaWorklist rpc={rpc} scope={scope} onOpen={onOpen} />
          </>,
        )}
        {section(
          'feedback',
          'Feedback and reviews',
          'Candidate responses, client feedback and placement reviews',
          MessageSquare,
          <FeedbackQueue rpc={rpc} onOpen={onOpen} onOpenClient={onOpenClient} />,
        )}
        {section(
          'messages',
          'Candidate communication',
          'Templates, recipient segments and test delivery',
          Mail,
          <CandidateCommunications rpc={rpc} role={role} />,
        )}
        {section(
          'quality',
          'Repository quality',
          'Find profile issues and keep candidate information current',
          ShieldCheck,
          <RepositoryQuality
            rpc={rpc}
            admin={role === 'admin'}
            onOpen={onOpen}
            onSettings={onSettings}
          />,
        )}
      </div>
      <h3 className="import-section-kicker">Reports, integrations and administration</h3>
      <div className="disclosure-stack">
        {section(
          'completion',
          'Reports and operational health',
          'Historical reports, campaigns and recovery guidance',
          ChartNoAxesCombined,
          <Suspense fallback={<p role="status">Loading reports…</p>}>
            <CompletionWorkbench
              isCloud={isCloud}
              role={role}
              scope={scope}
              rpc={rpc}
              onOpenTool={openTool}
            />
          </Suspense>,
        )}
        {section(
          'foundation',
          'Search and repository tools',
          'Saved filters, discovery, reports and ownership',
          Search,
          <Suspense fallback={<p role="status">Loading repository tools…</p>}>
            <FoundationWorkbench
              isCloud={isCloud}
              role={role}
              scope={scope}
              rpc={rpc}
              onOpen={onOpen}
              onOpenClient={onOpenClient}
              onOpenDemand={onOpenDemand}
            />
          </Suspense>,
        )}
        {section(
          'delivery',
          'Integration testing',
          'Provider connections and delivery sandbox',
          Plug,
          <DeliverySandbox isCloud={isCloud} role={role} scope={scope} rpc={rpc} />,
        )}
        {role === 'admin' &&
          section(
            'processing',
            'Document processing and recovery',
            'Private scanning, OCR, backups and isolated restore',
            ArchiveRestore,
            <ProcessingRecovery isCloud={isCloud} role={role} scope={scope} rpc={rpc} />,
          )}
        {['admin', 'recruiter'].includes(role) &&
          section(
            'google',
            'Google Workspace',
            'Email, mailbox review and calendar scheduling',
            CalendarDays,
            <GoogleWorkspace isCloud={isCloud} role={role} scope={scope} rpc={rpc} />,
          )}
        {role === 'admin' &&
          section(
            'enterprise',
            'Enterprise access and retention',
            'Workspace sign-in and retention requests',
            Building2,
            <EnterpriseOperations isCloud={isCloud} role={role} scope={scope} rpc={rpc} />,
          )}
        {['admin', 'recruiter'].includes(role) &&
          section(
            'controlled',
            'AI and external workflows',
            'Reviewed AI highlights, enrichment, job export and offer signing',
            Sparkles,
            <ControlledWorkflows isCloud={isCloud} role={role} scope={scope} rpc={rpc} />,
          )}
      </div>
    </section>
  );
}
