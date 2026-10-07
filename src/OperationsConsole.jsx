import React, { useEffect, useRef, useState } from 'react';
import { intelligenceRpc } from './intelligence.js';
import { cloud, getWorkspaceId } from './repository.js';
import { Badge, Button, Field, PanelHeading } from './ui.jsx';
import { SubjectRequests } from './SubjectRequests.jsx';

const labels = {
  report: 'Selected profile report',
  retention: 'Retention and subject-request coverage',
  erasure: 'Erasure scope dry run',
  bulk: 'Bulk owner and next-action preview',
};
const defaults = {
  enabled: false,
  subjectDays: 30,
  feedbackHours: 48,
  taskGraceHours: 24,
  retentionMonths: 24,
  retentionReference: '',
};
export function downloadOperationsEvidence(value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `anthro-operations-${value.id || 'health'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function PageButtons({ offset, more, busy, setOffset, label }) {
  return (
    <div className="pagination">
      <Button
        variant="secondary"
        disabled={busy || offset === 0}
        onClick={() => setOffset(Math.max(0, offset - 25))}
      >
        Previous {label}
      </Button>
      <span>Page {offset / 25 + 1}</span>
      <Button variant="secondary" disabled={busy || !more} onClick={() => setOffset(offset + 25)}>
        Next {label}
      </Button>
    </div>
  );
}
export function OperationsConsole({
  rpc = intelligenceRpc,
  isCloud = cloud,
  scope = getWorkspaceId(),
  download = downloadOperationsEvidence,
  onHoldChange,
}) {
  const [page, setPage] = useState(null),
    [policy, setPolicy] = useState(defaults),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [jobId, setJobId] = useState(null),
    [detail, setDetail] = useState(null),
    [itemOffset, setItemOffset] = useState(0);
  const [reviewCandidate, setReviewCandidate] = useState(null);
  const [form, setForm] = useState({
    kind: 'report',
    ids: '',
    reason: '',
    owner: '',
    nextAction: '',
  });
  const [query, setQuery] = useState(''),
    [selectionFilter, setSelectionFilter] = useState('all'),
    [search, setSearch] = useState(null),
    [searchOffset, setSearchOffset] = useState(0),
    [searchVersion, setSearchVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState(null),
    [notice, setNotice] = useState(''),
    [exported, setExported] = useState(null);
  const epoch = useRef(0),
    intent = useRef(null),
    inFlight = useRef(false);
  useEffect(() => {
    const generation = ++epoch.current;
    intent.current = null;
    inFlight.current = false;
    setPage(null);
    setDetail(null);
    setJobId(null);
    setReviewCandidate(null);
    setOffset(0);
    setItemOffset(0);
    setSearchOffset(0);
    setSearchVersion(0);
    setQuery('');
    setSelectionFilter('all');
    setNotice('');
    setSearch(null);
    setPending(null);
    setExported(null);
    setBusy(false);
    setError('');
    setForm({ kind: 'report', ids: '', reason: '', owner: '', nextAction: '' });
    return () => {
      if (epoch.current === generation) epoch.current = generation + 1;
    };
  }, [scope]);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setPage(null);
    rpc('api_operations', { p_action: 'context', p_offset: offset })
      .then((value) => {
        if (
          !Array.isArray(value?.jobs) ||
          value.jobs.length > 25 ||
          !Array.isArray(value.health?.queues) ||
          !value.policy ||
          !Number.isInteger(value.policyVersion)
        )
          throw new Error('Invalid operations overview.');
        if (active) {
          setPage(value);
          setPolicy(value.policy);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, isCloud, scope, offset, revision]);
  useEffect(() => {
    if (!isCloud || !jobId) return;
    let active = true;
    setDetail(null);
    setExported(null);
    rpc('api_operations', { p_action: 'detail', p_job: jobId, p_offset: itemOffset })
      .then((value) => {
        if (
          !value?.job?.id ||
          !Array.isArray(value.rows) ||
          value.rows.length > 25 ||
          typeof value.more !== 'boolean'
        )
          throw new Error('Invalid operations job page.');
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, isCloud, scope, jobId, itemOffset, revision]);
  useEffect(() => {
    if (!isCloud || !searchVersion) return;
    let active = true;
    setSearch(null);
    rpc('api_operations', {
      p_action: 'search',
      p_payload: { query, filter: selectionFilter },
      p_offset: searchOffset,
    })
      .then((value) => {
        if (
          !Array.isArray(value?.rows) ||
          value.rows.length > 25 ||
          typeof value.more !== 'boolean'
        )
          throw new Error('Invalid selection page.');
        if (active) setSearch(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, isCloud, scope, searchVersion, searchOffset, query, selectionFilter]);
  async function execute(args = null) {
    if (inFlight.current || (args && intent.current)) return;
    if (args) intent.current = structuredClone({ ...args, p_operation: crypto.randomUUID() });
    const frozen = intent.current;
    if (!frozen) return;
    const generation = epoch.current;
    inFlight.current = true;
    setBusy(true);
    setPending(frozen);
    setError('');
    setNotice('');
    try {
      const value = await rpc('api_operations', frozen);
      if (generation !== epoch.current) return;
      if (!value || (frozen.p_action === 'start' && !value.id))
        throw new Error('Missing operation receipt; retry the unchanged request.');
      intent.current = null;
      setPending(null);
      if (frozen.p_action.endsWith('export')) {
        setExported(value);
        setNotice('Evidence prepared. Download the reviewed JSON below.');
      } else {
        if (frozen.p_action === 'start') {
          setJobId(value.id);
          setItemOffset(0);
        }
        setRevision((n) => n + 1);
        setNotice(`Recorded: ${value.status || 'policy saved'}.`);
      }
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  if (!isCloud) return null;
  const locked = busy || !!pending;
  const job = detail?.job;
  const action = (name) =>
    execute({ p_action: name, p_job: job.id, p_version: job.version, p_payload: {} });
  const ids = form.ids.split(/[\s,;]+/).filter(Boolean);
  return (
    <section className="panel">
      <PanelHeading
        title="Operations and governance"
        subtitle="Bounded jobs, review policy and redacted operational evidence"
      />
      <div className="settings-body">
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {pending && (
          <div>
            <p>
              The server may have recorded this action. Retry preserves the operation and its exact
              contents.
            </p>
            <Button disabled={busy} onClick={() => execute()}>
              Retry pending operation
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                intent.current = null;
                setPending(null);
                setError('');
                setRevision((n) => n + 1);
                setNotice(
                  'Local retry discarded. Review server history before creating another action.',
                );
              }}
            >
              Discard local retry and refresh
            </Button>
          </div>
        )}
        <fieldset disabled={locked}>
          <legend>SLA and retention review policy</legend>
          <p>
            UTC elapsed-time targets. Explicit subject-request due dates take precedence. The
            retention window selects reviews; it never deletes records. Existing reminder worker
            policies are configured separately below.
          </p>
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
            Enable optional internal SLA notices
          </label>
          {[
            ['subjectDays', 'Subject review target (days)', 1, 365],
            ['feedbackHours', 'Feedback review target (hours)', 1, 720],
            ['taskGraceHours', 'Task overdue grace (hours)', 0, 168],
            ['retentionMonths', 'Unverified profile review (months)', 1, 120],
          ].map(([key, label, min, max]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min={min}
                max={max}
                value={policy[key]}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    [key]: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
              />
            </Field>
          ))}
          <Field label="Retention policy reference">
            <input
              maxLength={500}
              value={policy.retentionReference}
              onChange={(e) => setPolicy({ ...policy, retentionReference: e.target.value })}
            />
          </Field>
          <Button
            disabled={!page || policy.retentionReference.trim().length < 10}
            onClick={() =>
              execute({ p_action: 'policy', p_version: page.policyVersion, p_payload: policy })
            }
          >
            Save operations policy
          </Button>
        </fieldset>
        <h3>Queue health</h3>
        <p>
          Workspace counts and global worker heartbeats. A heartbeat proves a database batch ran,
          not delivery, complete coverage or scheduler reliability. Recover individual failures in
          their existing queue panels.
        </p>
        {page?.health.queues.map((q) => (
          <p key={q.kind}>
            <strong>{q.kind}</strong>: {q.pending} pending · {q.failed} failed{' '}
            {q.lastRun ? `· last global run ${new Date(q.lastRun).toLocaleString()}` : ''}
            {q.oldest ? ` · oldest ${new Date(q.oldest).toLocaleString()}` : ''}
          </p>
        ))}
        <Button
          disabled={locked || !page}
          variant="secondary"
          onClick={() => execute({ p_action: 'health-export', p_payload: {} })}
        >
          Prepare redacted health evidence
        </Button>
        {exported && (
          <div>
            <p>{exported.coverage || exported.scope}</p>
            <Button onClick={() => download(exported)}>Download operations evidence</Button>
          </div>
        )}
        <fieldset disabled={locked}>
          <legend>Prepare an explicit selection</legend>
          <Field label="Candidate review filter">
            <select
              value={selectionFilter}
              onChange={(e) => {
                setSelectionFilter(e.target.value);
                setSearchOffset(0);
              }}
            >
              <option value="all">All current identities</option>
              <option value="retention">Retention review due</option>
              <option value="held">Processing hold active</option>
            </select>
          </Field>
          <Field label="Candidate selection search">
            <input
              maxLength={100}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOffset(0);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              setSearchOffset(0);
              setSearchVersion((n) => n + 1);
            }}
          >
            Find candidates for job
          </Button>
          {search?.rows.map((row) => (
            <p key={row.id}>
              {row.anthroId} · {row.name}{' '}
              <Button
                variant="ghost"
                disabled={ids.includes(row.anthroId) || ids.length >= 250}
                onClick={() => setForm({ ...form, ids: [...ids, row.anthroId].join('\n') })}
              >
                Add {row.anthroId}
              </Button>
            </p>
          ))}
          {search && (
            <PageButtons
              offset={searchOffset}
              more={search.more}
              busy={locked}
              setOffset={setSearchOffset}
              label="selection"
            />
          )}
          <Field label="Job type">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Selected Anthro-IDs">
            <textarea
              rows={5}
              maxLength={5000}
              placeholder="ANTHRO-00001, ANTHRO-00002"
              value={form.ids}
              onChange={(e) => setForm({ ...form, ids: e.target.value })}
            />
          </Field>
          <p>
            {ids.length}/250 explicit identities. Jobs preserve their selection and policy version.
            A report describes this selection, not the whole repository.
          </p>
          <Field label="Job review reason">
            <textarea
              maxLength={1000}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Field>
          {form.kind === 'bulk' && (
            <>
              <Field label="Proposed owner">
                <input
                  maxLength={120}
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                />
              </Field>
              <Field label="Proposed next action">
                <textarea
                  maxLength={1000}
                  value={form.nextAction}
                  onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
                />
              </Field>
              <p>
                Blank values explicitly clear these fields. Each current profile will be checked
                again before application. Verified facts are preserved.
              </p>
            </>
          )}
          <Button
            disabled={
              !page ||
              ids.length < 1 ||
              ids.length > 250 ||
              new Set(ids).size !== ids.length ||
              ids.some((id) => !/^ANTHRO-\d{5}$/.test(id)) ||
              form.reason.trim().length < 10
            }
            onClick={() =>
              execute({
                p_action: 'start',
                p_job: crypto.randomUUID(),
                p_payload: {
                  kind: form.kind,
                  anthroIds: ids,
                  reason: form.reason,
                  ...(form.kind === 'bulk'
                    ? { owner: form.owner, nextAction: form.nextAction }
                    : {}),
                },
              })
            }
          >
            Create bounded job
          </Button>
        </fieldset>
        <h3>Job history</h3>
        <Button
          disabled={locked}
          variant="secondary"
          onClick={() => {
            setError('');
            setRevision((n) => n + 1);
          }}
        >
          Refresh operations
        </Button>
        {page?.jobs.map((row) => (
          <p key={row.id}>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => {
                setJobId(row.id);
                setItemOffset(0);
                setError('');
              }}
            >
              {labels[row.kind]} · {row.processed}/{row.total} · {row.status}
            </Button>{' '}
            <small>{new Date(row.created_at).toLocaleString()}</small>
          </p>
        ))}
        {page && (
          <PageButtons
            offset={offset}
            more={page.more}
            busy={locked}
            setOffset={setOffset}
            label="jobs"
          />
        )}
        {job && (
          <fieldset disabled={locked}>
            <legend>
              {labels[job.kind]} · {job.status}
            </legend>
            <p>
              Policy version {job.policyVersion} · {job.body.reason}
            </p>
            <p>
              {Object.entries(detail.counts)
                .map(([state, n]) => `${state}: ${n}`)
                .join(' · ')}
            </p>
            {job.kind === 'erasure' && (
              <p>
                Dry run only. Counts do not prove erasure. Operations review metadata, unlinked
                private records, external copies, file existence and backups require separate review
                in the subject-request case.
              </p>
            )}
            {job.status === 'Review' && (
              <p>
                Review every page before confirming the proposed owner/action changes. The server
                verifies all previews before accepting confirmation; batches recheck current source
                and holds.
              </p>
            )}
            {detail.rows.map((row) => (
              <article className="execution-job" key={row.id}>
                <strong>{row.result?.anthroId || `Identity ${row.ordinal}`}</strong>{' '}
                <Badge>{row.state}</Badge>
                <Button variant="ghost" onClick={() => setReviewCandidate(row.candidate_id)}>
                  Review subject requests for {row.result?.anthroId || `identity ${row.ordinal}`}
                </Button>
                {row.code && (
                  <p>
                    {row.code} · attempt {row.attempts}
                  </p>
                )}
                {row.result && (
                  <>
                    <p>
                      Verified {row.result.verified || 'Unknown'} ·{' '}
                      {row.result.status || 'Inventory preview'}
                      {row.result.retentionDue ? ' · Retention review due' : ''}
                      {row.result.held ? ' · Hold active' : ''}
                      {row.result.futureProfileDate ? ' · Future profile date' : ''}
                    </p>
                    {row.result.activeSubjectRequests !== undefined && (
                      <p>Active family subject requests: {row.result.activeSubjectRequests}</p>
                    )}
                    {job.kind === 'bulk' && (
                      <p>
                        Owner: {row.result.owner || '(blank)'} →{' '}
                        {row.result.proposedOwner || '(blank)'}; next action:{' '}
                        {row.result.nextAction || '(blank)'} →{' '}
                        {row.result.proposedNextAction || '(blank)'}
                      </p>
                    )}
                    {row.result.inventory && (
                      <details>
                        <summary>
                          {row.result.inventory.total} linked records ·{' '}
                          {row.result.inventory.identities} identities
                        </summary>
                        {row.result.inventory.counts.map((c) => (
                          <p key={c.category}>
                            {c.category}: {c.count}
                          </p>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </article>
            ))}
            <PageButtons
              offset={itemOffset}
              more={detail.more}
              busy={locked}
              setOffset={setItemOffset}
              label="items"
            />
            {['Pending', 'Applying'].includes(job.status) && (
              <Button onClick={() => action('step')}>
                {job.kind === 'erasure' ? 'Process next scope' : 'Process next 10 items'}
              </Button>
            )}
            {job.status === 'Review' && (
              <Button
                disabled={Object.keys(detail.counts).some((state) => state !== 'Prepared')}
                onClick={() => action('confirm')}
              >
                Confirm reviewed bulk changes
              </Button>
            )}
            {!['Completed', 'Cancelled'].includes(job.status) && (
              <Button variant="secondary" onClick={() => action('cancel')}>
                Cancel remaining work
              </Button>
            )}
            {job.status !== 'Cancelled' && (detail.counts.Failed || detail.counts.Stale) && (
              <Button variant="secondary" onClick={() => action('retry')}>
                Re-prepare failed or stale items
              </Button>
            )}
            {job.status === 'Completed' &&
              Object.keys(detail.counts).every((state) => state === 'Completed') && (
                <Button variant="secondary" onClick={() => action('export')}>
                  Prepare selected job evidence
                </Button>
              )}
          </fieldset>
        )}
      </div>
      {reviewCandidate && (
        <div className="settings-body">
          <Button variant="secondary" onClick={() => setReviewCandidate(null)}>
            Close selected subject review
          </Button>
          <SubjectRequests
            key={`${scope}-${reviewCandidate}`}
            candidateId={reviewCandidate}
            isCloud={isCloud}
            rpc={rpc}
            onHoldChange={onHoldChange}
          />
        </div>
      )}
    </section>
  );
}

export function SlaWorklist({ rpc = intelligenceRpc, onOpen, scope = getWorkspaceId() }) {
  const [page, setPage] = useState(null),
    [prefs, setPrefs] = useState({ enabled: false, quietStart: 0, quietEnd: 0 }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setPage(null);
    setError('');
    setBusy(false);
    rpc('api_sla_worklist', { p_offset: offset })
      .then((v) => {
        if (
          !Array.isArray(v?.rows) ||
          v.rows.length > 25 ||
          !v.preferences ||
          typeof v.more !== 'boolean'
        )
          throw new Error('Invalid SLA worklist.');
        if (generation === epoch.current) {
          setPage(v);
          setPrefs(v.preferences);
        }
      })
      .catch((e) => {
        if (generation === epoch.current) setError(e.message);
      });
    return () => {
      if (epoch.current === generation) epoch.current = generation + 1;
    };
  }, [rpc, scope, revision, offset]);
  const save = async () => {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    try {
      await rpc('api_sla_worklist', { p_save: true, p_preferences: prefs });
      if (generation === epoch.current) setRevision((n) => n + 1);
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  };
  return (
    <section className="panel">
      <PanelHeading
        title="Internal SLA review"
        subtitle="Current elapsed-time review targets; UTC quiet hours apply to optional notices"
      />
      <div className="settings-body">
        {error && <p role="alert">{error}</p>}
        {page?.noticeEnabled && (
          <p role="status">
            Review targets exceeded: {Object.values(page.counts).reduce((a, n) => a + n, 0)}.
          </p>
        )}
        {!page?.policyEnabled && (
          <p>
            Optional SLA notices are paused by the workspace policy. The review queue remains
            available.
          </p>
        )}
        {page?.quiet && <p>Optional notices are quiet for this UTC hour.</p>}
        <fieldset disabled={busy || !page}>
          <legend>Your internal notice preferences</legend>
          <label>
            <input
              type="checkbox"
              checked={prefs.enabled}
              onChange={(e) => setPrefs({ ...prefs, enabled: e.target.checked })}
            />
            Show internal SLA notices
          </label>
          {[
            ['quietStart', 'Quiet start hour (UTC)'],
            ['quietEnd', 'Quiet end hour (UTC)'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min={0}
                max={23}
                value={prefs[key]}
                onChange={(e) => setPrefs({ ...prefs, [key]: Number(e.target.value) })}
              />
            </Field>
          ))}
          <p>
            Equal hours disable the quiet window. A window can cross midnight. These preferences
            control in-app notices only.
          </p>
          <Button onClick={save}>Save internal notice preferences</Button>
        </fieldset>
        {page?.rows.map((row) => (
          <p key={`${row.kind}-${row.id}`}>
            {row.kind} · target {new Date(row.deadline).toLocaleString()}{' '}
            {row.candidateId && onOpen && (
              <Button variant="ghost" onClick={() => onOpen(row.candidateId)}>
                Open candidate for {row.kind}
              </Button>
            )}
          </p>
        ))}
        {page && (
          <PageButtons
            offset={offset}
            more={page.more}
            busy={busy}
            setOffset={setOffset}
            label="SLA items"
          />
        )}
        <Button variant="secondary" disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Refresh SLA review
        </Button>
      </div>
    </section>
  );
}
