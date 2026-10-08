import ControlledWorkflows from './ControlledWorkflows.jsx';
import EnterpriseOperations from './EnterpriseOperations.jsx';
import GoogleWorkspace from './GoogleWorkspace.jsx';
import ProcessingRecovery from './ProcessingRecovery.jsx';
import DeliverySandbox from './DeliverySandbox.jsx';
import React, { lazy, Suspense } from 'react';
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
  if (!isCloud || !['admin', 'recruiter', 'viewer'].includes(role)) return null;
  return (
    <section aria-label="Independent feature work queues" key={`${scope}:${role}`}>
      <details>
        <summary>Foundation tools: filters, quality, discovery, reports and ownership</summary>
        <Suspense fallback={<p role="status">Loading foundation workbench…</p>}>
          <FoundationWorkbench
            isCloud={isCloud}
            role={role}
            scope={scope}
            rpc={rpc}
            onOpen={onOpen}
            onOpenClient={onOpenClient}
            onOpenDemand={onOpenDemand}
          />
        </Suspense>
      </details>
      <details>
        <summary>Dependent delivery sandbox</summary>
        <DeliverySandbox isCloud={isCloud} role={role} scope={scope} rpc={rpc} />
      </details>
      {role === 'admin' && (
        <details>
          <summary>Private processing and recovery</summary>
          <ProcessingRecovery isCloud={isCloud} role={role} scope={scope} rpc={rpc} />
        </details>
      )}
      {['admin', 'recruiter'].includes(role) && (
        <details>
          <summary>Google Workspace communication and scheduling</summary>
          <GoogleWorkspace isCloud={isCloud} role={role} scope={scope} rpc={rpc} />
        </details>
      )}
      {role === 'admin' && (
        <details>
          <summary>Enterprise operation and fulfillment</summary>
          <EnterpriseOperations isCloud={isCloud} role={role} scope={scope} rpc={rpc} />
        </details>
      )}
      {['admin', 'recruiter'].includes(role) && (
        <details>
          <summary>Controlled intelligence and external workflows</summary>
          <ControlledWorkflows isCloud={isCloud} role={role} scope={scope} rpc={rpc} />
        </details>
      )}
      <CandidateCommunications rpc={rpc} role={role} />
      <FeedbackQueue rpc={rpc} onOpen={onOpen} onOpenClient={onOpenClient} />
      <RecruiterWorklist rpc={rpc} editable={canWriteForRole(role)} onOpen={onOpen} />
      <SlaWorklist rpc={rpc} scope={scope} onOpen={onOpen} />
      <RepositoryQuality
        rpc={rpc}
        admin={role === 'admin'}
        onOpen={onOpen}
        onSettings={onSettings}
      />
    </section>
  );
}
