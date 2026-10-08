import './completion.css';
import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { downloadFile } from './downloads.js';

export default function CompletionWorkbench({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  rpc = repositoryRead,
  initialTab = 'history',
  download = downloadFile,
  onOpenTool,
}) {
  if (!isCloud || !['admin', 'recruiter', 'viewer'].includes(role)) return null;
  return (
    <Workbench
      key={`${scope}:${role}`}
      role={role}
      rpc={rpc}
      initialTab={initialTab}
      download={download}
      onOpenTool={onOpenTool}
    />
  );
}
function Workbench({ role, rpc, initialTab, download, onOpenTool }) {
  const [tab, setTab] = useState(initialTab),
    [context, setContext] = useState(null),
    [templates, setTemplates] = useState([]),
    [people, setPeople] = useState(null),
    [health, setHealth] = useState(null);
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [peopleOffset, setPeopleOffset] = useState(0),
    [tick, setTick] = useState(0);
  const [criteria, setCriteria] = useState(() => ({
    source: 'lifecycle',
    group: 'state',
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    targetState: 'Deployed',
  }));
  const [report, setReport] = useState(null),
    [exported, setExported] = useState(null),
    [reportName, setReportName] = useState('');
  const [campaignName, setCampaignName] = useState(''),
    [enabled, setEnabled] = useState(false),
    [steps, setSteps] = useState([{ template: '', day: 0 }]);
  const [definition, setDefinition] = useState(''),
    [candidate, setCandidate] = useState(''),
    [startAt, setStartAt] = useState(() => new Date(Date.now() + 60000).toISOString().slice(0, 16)),
    [preview, setPreview] = useState(null),
    [stopReason, setStopReason] = useState('');
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const live = useRef({ active: false, epoch: 0 });
  useEffect(() => {
    const l = live.current;
    l.active = true;
    return () => {
      l.active = false;
      l.epoch++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setContext(null);
    setPeople(null);
    setHealth(null);
    const reads = [
      rpc('api_completion_workflows', {
        p_action: 'context',
        p_payload: { query: search },
        p_offset: offset,
      }),
    ];
    if (tab === 'campaigns')
      reads.push(
        rpc('api_test_communications', { p_action: 'context' }),
        rpc('api_test_communications', {
          p_action: 'browse',
          p_payload: { query: search, status: '', tag: '' },
          p_offset: peopleOffset,
        }),
      );
    if (tab === 'health' && role === 'admin')
      reads.push(rpc('api_completion_workflows', { p_action: 'health' }));
    Promise.all(reads)
      .then(([ctx, second, third]) => {
        if (!active) return;
        setContext(ctx);
        if (tab === 'campaigns') {
          setTemplates(second.templates || []);
          setPeople(third);
        }
        if (tab === 'health') setHealth(second);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, tab, role, tick, offset, peopleOffset, search]);
  async function read(action, payload, consume) {
    const epoch = live.current.epoch;
    setBusy(true);
    setError('');
    try {
      const result = await rpc('api_completion_workflows', {
        p_action: action,
        p_payload: payload,
      });
      if (live.current.active && epoch === live.current.epoch) consume(result);
    } catch (e) {
      if (live.current.active && epoch === live.current.epoch) setError(e.message);
    } finally {
      if (live.current.active && epoch === live.current.epoch) setBusy(false);
    }
  }
  async function write(request) {
    const epoch = live.current.epoch;
    setBusy(true);
    setError('');
    try {
      const result = await rpc('api_completion_workflows', request);
      if (!live.current.active || epoch !== live.current.epoch) return;
      setPending(null);
      setNotice(result.status || 'Recorded');
      setPreview(null);
      if (request.p_action === 'history-export') setExported(result);
      setTick((n) => n + 1);
    } catch (e) {
      if (live.current.active && epoch === live.current.epoch) {
        setError(e.message);
        setPending(request);
      }
    } finally {
      if (live.current.active && epoch === live.current.epoch) setBusy(false);
    }
  }
  const mutate = (action, payload, head) =>
    write({
      p_action: action,
      p_operation: crypto.randomUUID(),
      p_head: head,
      p_payload: structuredClone(payload),
    });
  const defs = context?.definitions || [],
    editor = role !== 'viewer';
  const nameHead = (kind, name) =>
    defs.find((d) => d.kind === kind && d.name === name.trim())?.head || context?.emptyHead;
  const campaignPayload = () => ({
    definition,
    candidate,
    startAt: `${startAt}:00Z`,
  });
  const changeCriteria = (key, value) => {
    setCriteria({
      ...criteria,
      [key]: value,
      ...(key === 'source' ? { targetState: value === 'readiness' ? 'Ready' : 'Deployed' } : {}),
    });
    setReport(null);
    setExported(null);
  };
  return (
    <section
      className="panel completion-workbench"
      aria-label="Completion milestone tools"
      style={{ overflowWrap: 'anywhere', minWidth: 0 }}
    >
      <h2>Reports, campaigns and operational health</h2>
      <fieldset disabled={busy || !!pending} style={{ minWidth: 0 }}>
        <legend>Workspace tools</legend>
        {['history', 'campaigns', ...(role === 'admin' ? ['health'] : [])].map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setError('');
              setPreview(null);
            }}
          >
            {value === 'history'
              ? 'Historical reports'
              : value === 'campaigns'
                ? 'Re-engagement campaigns'
                : 'Operational health'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setReport(null);
            setPreview(null);
            setTick((n) => n + 1);
          }}
        >
          Refresh recorded state
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <aside>
          <p>
            Outcome needs confirmation. Retry the same operation or refresh its recorded state
            before preparing another.
          </p>
          <button disabled={busy} onClick={() => write(pending)}>
            Retry exact completion operation
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPending(null);
              setPreview(null);
              setReport(null);
              setTick((n) => n + 1);
            }}
          >
            Discard pending controls and refresh
          </button>
        </aside>
      )}
      {context?.definitionsTruncated && (
        <p role="status">
          The definition catalog reached its bound. Review existing definitions before creating
          more.
        </p>
      )}
      {tab === 'history' && (
        <fieldset disabled={busy || !!pending} style={{ minWidth: 0 }}>
          <legend>Historical report builder</legend>
          <label>
            Saved historical report
            <select
              value=""
              onChange={(e) => {
                const d = defs.find((d) => d.id === e.target.value);
                if (d) {
                  setCriteria(d.body);
                  setReportName(d.name);
                  setReport(null);
                  setExported(null);
                }
              }}
            >
              <option value="">Choose saved criteria</option>
              {defs
                .filter((d) => d.kind === 'report')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · v{d.version}
                  </option>
                ))}
            </select>
          </label>
          <label>
            History source
            <select
              value={criteria.source}
              onChange={(e) => changeCriteria('source', e.target.value)}
            >
              <option value="lifecycle">Lifecycle events</option>
              <option value="readiness">Readiness decisions</option>
            </select>
          </label>
          <label>
            Group historical events
            <select
              value={criteria.group}
              onChange={(e) => changeCriteria('group', e.target.value)}
            >
              {['state', 'month', 'source', 'entity'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {['from', 'to'].map((field) => (
            <label key={field}>
              UTC {field}
              <input
                type="date"
                value={criteria[field]}
                onChange={(e) => changeCriteria(field, e.target.value)}
              />
            </label>
          ))}
          <label>
            Cohort target status
            <input
              maxLength={80}
              value={criteria.targetState || ''}
              onChange={(e) => changeCriteria('targetState', e.target.value)}
            />
          </label>
          <button type="button" onClick={() => read('history', criteria, setReport)}>
            Run historical report
          </button>
          {role === 'admin' && (
            <>
              <label>
                Historical report name
                <input
                  maxLength={100}
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                />
              </label>
              <button
                disabled={!context || !reportName.trim()}
                onClick={() =>
                  mutate(
                    'definition',
                    { kind: 'report', name: reportName.trim(), body: criteria },
                    nameHead('report', reportName),
                  )
                }
              >
                Save historical criteria
              </button>
            </>
          )}
          {report && (
            <>
              <p>Lifecycle coverage began: {report.coverageStartedAt || 'No coverage recorded'}</p>
              {criteria.source === 'readiness' && (
                <p>
                  First recorded readiness decision:{' '}
                  {report.firstReadinessDecisionAt || 'None recorded'}
                </p>
              )}
              <p>{report.notice}</p>
              <p>
                {report.cohort?.convertedCandidates || 0} of {report.cohort?.newCandidates || 0} new
                candidates reached {report.cohort?.targetState} within the selected range.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Events</th>
                      <th>Distinct candidates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows?.map((row, i) => (
                      <tr key={i}>
                        <td>{row.label || 'Unspecified'}</td>
                        <td>{row.events}</td>
                        <td>{row.candidates}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!report.rows?.length && <p>No recorded events in this range.</p>}
              {report.truncated && (
                <p role="status">More than 200 groups; narrow the criteria before exporting.</p>
              )}
              {editor && (
                <button
                  disabled={report.truncated}
                  onClick={() => mutate('history-export', report.criteria, report.head)}
                >
                  Record aggregate export
                </button>
              )}
            </>
          )}
          {exported && editor && (
            <button
              onClick={() =>
                download(
                  JSON.stringify(exported, null, 2),
                  'anthro-historical-report.json',
                  'application/json',
                )
              }
            >
              Download recorded aggregate report
            </button>
          )}
        </fieldset>
      )}
      {tab === 'campaigns' && (
        <fieldset disabled={busy || !!pending} style={{ minWidth: 0 }}>
          <legend>Reviewed re-engagement campaigns</legend>
          <p>
            Test-only campaigns use existing confirmed contacts, purpose consent, opt-outs and UTC
            contact windows. No live message is sent. A new definition version stops pending steps.
            Replies explicitly linked in Google Workspace suppress remaining steps at execution.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
              setOffset(0);
              setPeopleOffset(0);
              setPreview(null);
            }}
          >
            <label>
              Find campaign candidate
              <input maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button type="submit">Search campaign candidates and enrollments</button>
          </form>
          {role === 'admin' && (
            <details>
              <summary>Configure campaign</summary>
              <label>
                Existing campaign
                <select
                  value=""
                  onChange={(e) => {
                    const d = defs.find((d) => d.id === e.target.value);
                    if (d) {
                      setCampaignName(d.name);
                      setSteps(d.body.steps);
                      setEnabled(d.body.enabled);
                    }
                  }}
                >
                  <option value="">Choose or create</option>
                  {defs
                    .filter((d) => d.kind === 'campaign')
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · v{d.version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Campaign name
                <input
                  maxLength={100}
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enabled for reviewed test enrollments
              </label>
              <p>
                Create plain-text templates in Candidate communications first. Choose freshness,
                redeployment or custom templates; days must increase from 0 to 29.
              </p>
              {steps.map((step, i) => (
                <div key={i}>
                  <label>
                    Step {i + 1} template
                    <select
                      value={step.template}
                      onChange={(e) =>
                        setSteps(
                          steps.map((s, j) => (j === i ? { ...s, template: e.target.value } : s)),
                        )
                      }
                    >
                      <option value="">Choose template</option>
                      {templates
                        .filter((t) =>
                          ['freshness-check', 'redeployment', 'custom'].includes(t.body.kind),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.key} · v{t.version} · {t.body.purpose}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Step {i + 1} day
                    <input
                      type="number"
                      min={0}
                      max={29}
                      step={1}
                      value={step.day}
                      onChange={(e) =>
                        setSteps(
                          steps.map((s, j) =>
                            j === i ? { ...s, day: Number(e.target.value) } : s,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={steps.length === 1}
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  >
                    Remove step {i + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={steps.length >= 5}
                onClick={() =>
                  setSteps([...steps, { template: '', day: Math.min(29, steps.at(-1).day + 3) }])
                }
              >
                Add campaign step
              </button>
              <button
                type="button"
                disabled={!context || !campaignName.trim() || steps.some((s) => !s.template)}
                onClick={() =>
                  mutate(
                    'definition',
                    { kind: 'campaign', name: campaignName.trim(), body: { enabled, steps } },
                    nameHead('campaign', campaignName),
                  )
                }
              >
                Save campaign version
              </button>
            </details>
          )}
          <label>
            Current enabled campaign
            <select
              value={definition}
              onChange={(e) => {
                setDefinition(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Choose campaign</option>
              {defs
                .filter((d) => d.kind === 'campaign' && d.body.enabled)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · v{d.version}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Campaign candidate
            <select
              value={candidate}
              onChange={(e) => {
                setCandidate(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Choose candidate on this page</option>
              {people?.rows?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.anthroId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={peopleOffset === 0}
            onClick={() => setPeopleOffset(Math.max(0, peopleOffset - 25))}
          >
            Previous candidates
          </button>
          <button
            type="button"
            disabled={!people?.more}
            onClick={() => setPeopleOffset(peopleOffset + 25)}
          >
            Next candidates
          </button>
          <label>
            Campaign start (UTC)
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => {
                setStartAt(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            type="button"
            disabled={!candidate || !definition || !startAt}
            onClick={() => read('campaign-preview', campaignPayload(), setPreview)}
          >
            Review all campaign steps
          </button>
          {preview && (
            <section aria-label="Campaign step previews">
              <h3>
                {preview.name} · {preview.transport}
              </h3>
              {preview.steps.map((s, i) => (
                <article key={i}>
                  <h4>
                    Step {i + 1} · {s.availableAt}
                  </h4>
                  <p>
                    {s.source.preview.recipient} · {s.source.preview.purpose}
                  </p>
                  <strong>{s.source.preview.subject}</strong>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{s.source.preview.text}</p>
                  <p>{s.source.eligible ? 'Eligible' : `Suppressed: ${s.source.reason}`}</p>
                </article>
              ))}
              {editor && (
                <button
                  disabled={!preview.eligible}
                  onClick={() => mutate('campaign-enroll', campaignPayload(), preview.head)}
                >
                  Queue reviewed test campaign
                </button>
              )}
            </section>
          )}
          <h3>Enrollment history</h3>
          <label>
            Stop evidence
            <input
              maxLength={1000}
              value={stopReason}
              onChange={(e) => setStopReason(e.target.value)}
            />
          </label>
          {context?.enrollments?.map((e) => (
            <article key={e.id}>
              <h4>
                {e.candidate} · {e.anthroId} · {e.name}
              </h4>
              <small>{e.at}</small>
              {e.steps.map((s) => (
                <p key={s.id}>
                  {s.availableAt} · {s.status} · {s.reason}
                </p>
              ))}
              {editor && (
                <button
                  disabled={
                    stopReason.trim().length < 10 ||
                    !e.steps.some((s) => ['Queued', 'Retrying', 'Failed'].includes(s.status))
                  }
                  onClick={() =>
                    mutate('campaign-stop', { enrollment: e.id, reason: stopReason.trim() }, e.head)
                  }
                >
                  Stop pending steps for {e.candidate}
                </button>
              )}
            </article>
          ))}
          {!context?.enrollments?.length && <p>No matching enrollments.</p>}
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Previous enrollments
          </button>
          <button type="button" disabled={!context?.more} onClick={() => setOffset(offset + 25)}>
            Next enrollments
          </button>
        </fieldset>
      )}
      {tab === 'health' && role === 'admin' && health && (
        <section aria-label="Recorded operational health">
          <p>
            Captured {health.capturedAt} · Recovery {health.paused ? 'paused' : 'not paused'}
          </p>
          <p>{health.notice}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Pending</th>
                  <th>Oldest</th>
                  <th>Overdue</th>
                  <th>Needs review</th>
                  <th>Expiring</th>
                </tr>
              </thead>
              <tbody>
                {health.queues.map((q) => (
                  <tr key={q.area}>
                    <td>{q.area}</td>
                    <td>{q.pending}</td>
                    <td>{q.oldest || 'None'}</td>
                    <td>{q.overdue}</td>
                    <td>{q.needs_review}</td>
                    <td>{q.expiring}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!health.queues.length && <p>No recorded queue entries.</p>}
          <h3>Synchronization freshness</h3>
          {health.sync.map((s) => (
            <p key={s.kind}>
              {s.kind} · {s.state} · due {s.dueAt} ·{' '}
              {s.overdue ? 'Overdue' : 'Within recorded due window'} ·{' '}
              {s.errorRecorded
                ? 'Error recorded; inspect Google Workspace panel'
                : 'No recorded error'}
            </p>
          ))}
          <h3>Acceptance windows</h3>
          {health.evidence.map((e) => (
            <p key={e.kind}>
              {e.kind} · {e.state} · acceptance window ends{' '}
              {e.acceptanceExpiresAt || 'No acceptance'} ·{' '}
              {e.renewalDue ? 'Renewal due' : 'Review current generation before activation'}
            </p>
          ))}
          <h3>Processing and recovery evidence</h3>
          {health.processingEvidence?.map((e) => (
            <p key={e.component}>
              {e.component} · {e.status} · evidence window ends {e.expiresAt} ·{' '}
              {e.stale ? 'Refresh evidence' : 'Current recorded evidence'}
            </p>
          ))}
          <p>Last passed restore evidence: {health.lastRestoreEvidence || 'None recorded'}</p>
          <h3>Recorded attempt trends (7 days)</h3>
          {health.trend.map((v, i) => (
            <p key={i}>
              {v.day} · {v.area}: {v.failure_signals} failure signals in {v.attempts} attempts
            </p>
          ))}
          <h3>Recovery guidance</h3>
          {onOpenTool && (
            <div>
              {[
                ['processing', 'Open processing and recovery'],
                ['google', 'Open Google Workspace'],
                ['controlled', 'Open controlled workflows'],
                ['delivery', 'Open delivery sandbox'],
              ].map(([tool, label]) => (
                <button key={tool} type="button" onClick={() => onOpenTool(tool)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <ul>
            {health.guidance.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
