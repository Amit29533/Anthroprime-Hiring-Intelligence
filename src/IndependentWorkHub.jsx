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
