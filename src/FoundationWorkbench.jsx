import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { downloadOperationsEvidence } from './OperationsConsole.jsx';

const tabs = {
  filter: 'Advanced filters',
  quality: 'Quality resolution',
  discovery: 'Demand discovery',
  search: 'Cross-entity search',
  report: 'Foundation reports',
  tasks: 'Task ownership',
};
const baseFields = {
  query: 'Name, skill or Anthro-ID',
  location: 'Location contains',
  employer: 'Employer contains',
  skill: 'Exact skill',
  tag: 'Exact tag',
  minExperience: 'Minimum experience',
  maxExperience: 'Maximum experience',
  maxNotice: 'Maximum notice days',
};
const choices = {
  status: ['', 'Assessing', 'Near-ready', 'Ready', 'Unavailable'],
  engagement: ['', 'Permanent', 'Contract', 'C2H', 'Subcontract'],
  mode: ['', 'Flexible', 'Remote', 'Hybrid', 'Onsite'],
  sort: ['name', 'verified', 'experience', 'notice'],
};
export const emptyFoundationFilter = () => ({ version: 1, base: { sort: 'name' }, custom: [] });
export function compileFoundationFilter(draft, fields) {
  const copy = structuredClone(draft);
  for (const [key, value] of Object.entries(copy.base)) if (value === '') delete copy.base[key];
  copy.custom = copy.custom.map((x) => {
    const f = fields.find((f) => f.id === x.id);
    if (!f || f.archived || f.version !== x.version)
      throw Error('A custom definition changed or was archived. Correct or remove that criterion.');
    if (['missing', 'exists'].includes(x.op)) {
      delete x.value;
      return x;
    }
    if (f.type === 'number') {
      if (String(x.value ?? '').trim() === '' || !Number.isFinite(Number(x.value)))
        throw Error('Enter a finite custom-field number; zero is valid.');
      x.value = Number(x.value);
    }
    return x;
  });
  return copy;
}
function Select({ label, value, values, onChange }) {
  return (
    <label>
      {label}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {v || 'Any'}
          </option>
        ))}
      </select>
    </label>
  );
}
function FilterEditor({ draft, setDraft, fields, admin }) {
  const changeBase = (key, value) => setDraft((d) => ({ ...d, base: { ...d.base, [key]: value } }));
  const changeCustom = (i, patch) =>
    setDraft((d) => ({ ...d, custom: d.custom.map((x, n) => (n === i ? { ...x, ...patch } : x)) }));
  return (
    <div className="form-grid">
      {Object.entries(baseFields).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={draft.base[key] ?? ''}
            maxLength={key === 'query' ? 200 : 120}
            type={['minExperience', 'maxExperience', 'maxNotice'].includes(key) ? 'number' : 'text'}
            min="0"
            step={key === 'maxNotice' ? '1' : 'any'}
            onChange={(e) => changeBase(key, e.target.value)}
          />
        </label>
      ))}
      {Object.entries(choices).map(([key, values]) => (
        <Select
          key={key}
          label={key === 'sort' ? 'Repository sort' : key[0].toUpperCase() + key.slice(1)}
          values={values}
          value={draft.base[key]}
          onChange={(v) => changeBase(key, v)}
        />
      ))}
      {admin && (
        <>
          <label>
            Confirmed expected pay ceiling
            <input
              type="number"
              min="0"
              value={draft.base.maxExpected ?? ''}
              onChange={(e) => changeBase('maxExpected', e.target.value)}
            />
          </label>
          <label>
            Pay currency
            <input
              maxLength="3"
              value={draft.base.payCurrency ?? ''}
              onChange={(e) => changeBase('payCurrency', e.target.value.toUpperCase())}
            />
          </label>
          <Select
            label="Pay basis"
            values={['', 'Annual', 'Monthly', 'Hourly', 'Daily']}
            value={draft.base.payBasis}
            onChange={(v) => changeBase('payBasis', v)}
          />
          <p>
            Pay uses the latest applicable confirmed currency-unit observation, at most 120 days
            old. Unknown or unlike units do not pass.
          </p>
        </>
      )}
      {draft.custom.map((x, i) => {
        const f = fields.find((f) => f.id === x.id);
        return (
          <fieldset key={i}>
            <legend>Custom criterion {i + 1}</legend>
            <label>
              Custom field {i + 1}
              <select
                value={x.id}
                onChange={(e) => {
                  const f = fields.find((f) => f.id === e.target.value);
                  changeCustom(i, { id: f.id, version: f.version, op: 'eq', value: '' });
                }}
              >
                {!fields.some((f) => f.id === x.id) && (
                  <option value={x.id}>Unavailable definition</option>
                )}
                {fields.map((f) => (
                  <option key={f.id} value={f.id} disabled={f.archived}>
                    {f.name}
                    {f.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {(!f || f.archived || f.version !== x.version) && (
              <p role="alert">Definition changed or archived. Remove or correct this criterion.</p>
            )}
            <Select
              label={`Operator ${i + 1}`}
              value={x.op}
              values={
                f?.type === 'select'
                  ? ['eq', 'missing', 'exists']
                  : f?.type === 'number' || f?.type === 'date'
                    ? ['eq', 'gte', 'lte', 'missing', 'exists']
                    : ['eq', 'contains', 'missing', 'exists']
              }
              onChange={(v) => changeCustom(i, { op: v })}
            />
            {!['missing', 'exists'].includes(x.op) &&
              (f?.type === 'select' ? (
                <Select
                  label={`Value ${i + 1}`}
                  value={x.value}
                  values={['', ...(f.options || [])]}
                  onChange={(v) => changeCustom(i, { value: v })}
                />
              ) : (
                <label>
                  Value {i + 1}
                  <input
                    type={f?.type === 'date' ? 'date' : f?.type === 'number' ? 'number' : 'text'}
                    step="any"
                    maxLength="500"
                    value={x.value ?? ''}
                    onChange={(e) => changeCustom(i, { value: e.target.value })}
                  />
                </label>
              ))}
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({ ...d, custom: d.custom.filter((_, n) => n !== i) }))
              }
            >
              Remove criterion {i + 1}
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        disabled={draft.custom.length >= 8 || !fields.some((f) => !f.archived)}
        onClick={() => {
          const f = fields.find((f) => !f.archived);
          setDraft((d) => ({
            ...d,
            custom: [...d.custom, { id: f.id, version: f.version, op: 'eq', value: '' }],
          }));
        }}
      >
        Add custom criterion
      </button>
    </div>
  );
}
export default function FoundationWorkbench({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  ...props
}) {
  if (!isCloud || !['admin', 'recruiter', 'viewer'].includes(role)) return null;
  return <Workbench key={`${scope}:${role}`} role={role} {...props} />;
}
function Workbench({
  rpc = repositoryRead,
  role,
  onOpen,
  onOpenClient,
  onOpenDemand,
  initialTab = 'filter',
  initialDemandId = '',
  download = downloadOperationsEvidence,
}) {
  const [tab, setTab] = useState(initialTab),
    [context, setContext] = useState(null),
    [contextRevision, setContextRevision] = useState(0),
    [draft, setDraft] = useState(emptyFoundationFilter),
    [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [selection, setSelection] = useState(null),
    [history, setHistory] = useState(null),
    [historyOffset, setHistoryOffset] = useState(0),
    [reason, setReason] = useState(''),
    [assignee, setAssignee] = useState(''),
    [decision, setDecision] = useState('Reviewed'),
    [done, setDone] = useState(false),
    [name, setName] = useState(''),
    [view, setView] = useState(''),
    [demand, setDemand] = useState(initialDemandId),
    [group, setGroup] = useState(''),
    [query, setQuery] = useState(''),
    [queueFilters, setQueueFilters] = useState({}),
    [eligibleOnly, setEligibleOnly] = useState(false),
    [readyOnly, setReadyOnly] = useState(false),
    [offset, setOffset] = useState(0),
    [cursors, setCursors] = useState([null]),
    [applied, setApplied] = useState(null),
    [exported, setExported] = useState(null);
  const alive = useRef(true),
    epoch = useRef(0),
    intent = useRef(null);
  useEffect(() => {
    const scopeEpoch = epoch;
    alive.current = true;
    return () => {
      alive.current = false;
      scopeEpoch.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setContext(null);
    rpc('api_foundation', { p_action: 'context' })
      .then((v) => {
        if (
          !Array.isArray(v?.fields) ||
          !Array.isArray(v.views) ||
          !Array.isArray(v.members) ||
          !Array.isArray(v.demands)
        )
          throw Error('Invalid foundation context.');
        if (active) setContext(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, contextRevision]);
  const locked = busy || !!pending,
    editor = canWriteForRole(role);
  async function read(action, payload = {}, nextOffset = 0) {
    const generation = ++epoch.current;
    setBusy(true);
    setError('');
    setPage(null);
    setExported(null);
    try {
      const v = await rpc('api_foundation', {
        p_action: action,
        p_payload: payload,
        p_offset: nextOffset,
      });
      if (
        !v ||
        typeof v !== 'object' ||
        (action !== 'report' && (!Array.isArray(v.rows) || v.rows.length > 25))
      )
        throw Error('Invalid foundation result.');
      if (alive.current && generation === epoch.current) {
        setPage(v);
        setApplied({ action, payload });
        setOffset(nextOffset);
      }
    } catch (e) {
      if (alive.current && generation === epoch.current) setError(e.message);
    } finally {
      if (alive.current && generation === epoch.current) setBusy(false);
    }
  }
  async function mutate(action, payload) {
    if (busy || (action && intent.current)) return;
    if (action)
      intent.current = structuredClone({
        p_action: action,
        p_payload: payload,
        p_operation: crypto.randomUUID(),
      });
    if (!intent.current) return;
    const frozen = intent.current,
      generation = epoch.current;
    setPending(frozen);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const v = await rpc('api_foundation', frozen);
      if (!alive.current || generation !== epoch.current) return;
      intent.current = null;
      setPending(null);
      setNotice(`Recorded: ${v.status || 'Saved'}.`);
      if (frozen.p_action === 'export-report') setExported(v);
      else {
        setContextRevision((n) => n + 1);
        setPage(null);
        setSelection(null);
        setHistory(null);
        setNotice('Recorded. Refresh the result queue to see current state.');
      }
    } catch (e) {
      if (alive.current && generation === epoch.current) setError(e.message);
    } finally {
      if (alive.current && generation === epoch.current) setBusy(false);
    }
  }
  function switchTab(next) {
    epoch.current++;
    setTab(next);
    setPage(null);
    setApplied(null);
    setSelection(null);
    setHistory(null);
    setOffset(0);
    setCursors([null]);
    setQueueFilters({});
    setError('');
    setNotice('');
    setExported(null);
  }
  async function run() {
    try {
      setSelection(null);
      setHistory(null);
      setCursors([null]);
      const filters = ['filter', 'discovery', 'report'].includes(tab)
        ? compileFoundationFilter(draft, context.fields)
        : {};
      const payload = ['filter', 'discovery', 'report'].includes(tab)
        ? tab === 'filter'
          ? { filters }
          : {
              filters,
              ...(demand ? { demandId: demand } : {}),
              ...(tab === 'report' && group ? { group } : {}),
              ...(tab === 'discovery' ? { eligibleOnly, readyOnly } : {}),
            }
        : tab === 'search'
          ? { query }
          : queueFilters;
      await read(tab, payload);
    } catch (e) {
      setError(e.message);
    }
  }
  async function historyPage(row, off = 0) {
    const generation = epoch.current;
    setError('');
    setBusy(true);
    try {
      const v = await rpc('api_foundation', {
        p_action: tab === 'quality' ? 'quality-history' : 'task-history',
        p_payload: tab === 'quality' ? { kind: row.kind, target: row.target } : { id: row.id },
        p_offset: off,
      });
      if (!Array.isArray(v?.rows) || v.rows.length > 25) throw Error('Invalid history page.');
      if (alive.current && generation === epoch.current) {
        setHistory(v);
        setHistoryOffset(off);
      }
    } catch (e) {
      if (alive.current && generation === epoch.current) setError(e.message);
    } finally {
      if (alive.current && generation === epoch.current) setBusy(false);
    }
  }
  function choose(row) {
    setSelection(row);
    setHistory(null);
    setReason('');
    setAssignee(row.assignee || '');
    setDone(!!row.done);
    setDecision(row.status === 'Corrected' ? 'Resolved' : 'Reviewed');
    historyPage(row);
  }
  function navigateResult(row) {
    if (row.kind === 'client') onOpenClient?.(row.id);
    else if (row.kind === 'demand') onOpenDemand?.(row.id);
    else onOpen?.(row.id);
  }
  return (
    <section className="panel foundation-workbench" aria-label="Foundation workbench">
      <h2>Foundation workbench</h2>
      <p>
        Independent tools on the existing stack. Review decisions preserve source evidence; matching
        and observed gaps do not certify readiness.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!context && !error && <p role="status">Loading foundation tools…</p>}
      {pending && (
        <div>
          <p>
            The exact request is frozen for retry. A failed acknowledgement may already have
            committed.
          </p>
          <button type="button" disabled={busy} onClick={() => mutate()}>
            Retry foundation request
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              intent.current = null;
              setPending(null);
              setError('');
              setPage(null);
              setSelection(null);
              setHistory(null);
              setExported(null);
              setNotice(
                'Local retry discarded. Refresh and review server history before writing again.',
              );
              setContextRevision((n) => n + 1);
            }}
          >
            Discard foundation retry
          </button>
        </div>
      )}
      <fieldset disabled={locked}>
        <legend>Foundation tools</legend>
        <div className="section-toolbar">
          {Object.entries(tabs).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={tab === key}
              onClick={() => switchTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setError('');
            setContextRevision((n) => n + 1);
          }}
        >
          Refresh foundation definitions
        </button>
        {context && (
          <>
            {['filter', 'discovery', 'report'].includes(tab) && (
              <FilterEditor
                draft={draft}
                setDraft={setDraft}
                fields={context.fields}
                admin={role === 'admin'}
              />
            )}
            {tab === 'filter' && (
              <>
                <label>
                  Saved foundation or legacy view
                  <select
                    value={view}
                    onChange={(e) => {
                      setView(e.target.value);
                      const v = context.views.find((v) => v.id === e.target.value);
                      if (v) {
                        if (v.restricted) {
                          setError(
                            'This view contains restricted financial criteria. It cannot be applied after a role change.',
                          );
                          return;
                        }
                        setDraft(
                          v.filters.version
                            ? v.filters
                            : { version: 1, base: v.filters, custom: [] },
                        );
                        setPage(null);
                        setCursors([null]);
                        setApplied(null);
                        setError('');
                      }
                    }}
                  >
                    <option value="">Choose view</option>
                    {context.views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.legacy ? ' (legacy)' : ''}
                        {v.restricted ? ' (restricted)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Foundation view name
                  <input value={name} maxLength="80" onChange={(e) => setName(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={!name.trim()}
                  onClick={() => {
                    try {
                      mutate('save-view', {
                        name: name.trim(),
                        filters: compileFoundationFilter(draft, context.fields),
                      });
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Save foundation view
                </button>
                <button
                  type="button"
                  disabled={!view || context.views.find((v) => v.id === view)?.legacy}
                  onClick={() => mutate('delete-view', { id: view })}
                >
                  Delete foundation view
                </button>
              </>
            )}
            {['discovery', 'report'].includes(tab) && (
              <>
                <label>
                  Demand context
                  <select value={demand} onChange={(e) => setDemand(e.target.value)}>
                    <option value="">No demand context</option>
                    {demand && !context.demands.some((d) => d.id === demand) && (
                      <option value={demand}>Selected demand UUID</option>
                    )}
                    {context.demands.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Demand UUID (for demands beyond the first 100)
                  <input
                    value={demand}
                    maxLength="36"
                    onChange={(e) => setDemand(e.target.value)}
                  />
                </label>
              </>
            )}
            {tab === 'discovery' && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={eligibleOnly}
                    onChange={(e) => setEligibleOnly(e.target.checked)}
                  />
                  Hard requirements satisfied only
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={readyOnly}
                    onChange={(e) => setReadyOnly(e.target.checked)}
                  />
                  Current validated ready only
                </label>
              </>
            )}
            {tab === 'report' && (
              <label>
                Report custom group
                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">No grouping</option>
                  {context.fields
                    .filter((f) => !f.archived)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {tab === 'search' && (
              <label>
                Cross-entity query
                <input value={query} maxLength="200" onChange={(e) => setQuery(e.target.value)} />
              </label>
            )}
            {['quality', 'tasks'].includes(tab) && (
              <>
                <Select
                  label="Ownership scope"
                  values={['all', 'mine', 'unassigned']}
                  value={queueFilters.scope || 'all'}
                  onChange={(scope) => setQueueFilters((p) => ({ ...p, scope }))}
                />
                {tab === 'quality' ? (
                  <>
                    <Select
                      label="Finding kind"
                      values={['all', 'import', 'taxonomy']}
                      value={queueFilters.kind || 'all'}
                      onChange={(kind) => setQueueFilters((p) => ({ ...p, kind }))}
                    />
                    <Select
                      label="Finding status"
                      values={[
                        'all',
                        'Pending',
                        'Needs review',
                        'Reviewed',
                        'Deferred',
                        'Reopened',
                        'Corrected',
                      ]}
                      value={queueFilters.status || 'all'}
                      onChange={(status) => setQueueFilters((p) => ({ ...p, status }))}
                    />
                    <p>
                      Correct imports in Saved imports and aliases in Settings. Resolved requires
                      the finding to be absent from its source.
                    </p>
                  </>
                ) : (
                  <>
                    <Select
                      label="Task state"
                      values={['pending', 'completed', 'all']}
                      value={queueFilters.state || 'pending'}
                      onChange={(state) => setQueueFilters((p) => ({ ...p, state }))}
                    />
                    <Select
                      label="Task due window"
                      values={['all', 'overdue', 'next30', 'undated']}
                      value={queueFilters.due || 'all'}
                      onChange={(due) => setQueueFilters((p) => ({ ...p, due }))}
                    />
                    <label>
                      Task title contains
                      <input
                        value={queueFilters.query || ''}
                        onChange={(e) => setQueueFilters((p) => ({ ...p, query: e.target.value }))}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <button type="button" onClick={run}>
              Run {tabs[tab].toLowerCase()}
            </button>
          </>
        )}
        {page && (
          <>
            <p>{page.coverage}</p>
            {page.count != null && <p>{page.count} matching current identities.</p>}
            {page.evaluated != null && (
              <p>
                Evaluated {page.evaluated} of {page.total} matching active unheld identities
                {page.bounded ? ' — bounded sample' : ''}.
              </p>
            )}
            {page.rows?.map((row) => (
              <article className="execution-job" key={row.id || `${row.kind}:${row.target}`}>
                <strong>{row.name || row.label || row.title}</strong>
                {row.anthroId && <p>{row.anthroId}</p>}
                {row.score != null && (
                  <>
                    <p>
                      Descriptive score: {row.score}. Skills: {row.matchedSkills}/{row.skillTotal}.
                      Hard requirements: {row.eligibility}. Readiness: {row.readiness}.
                    </p>
                    {row.checks?.map((c) => (
                      <p key={c.id}>
                        {c.name}: {c.status} — {c.reason}
                      </p>
                    ))}
                  </>
                )}
                {row.kind && tab === 'search' && <p>{row.kind}</p>}
                {row.status && (
                  <p>
                    {tab === 'quality' ? 'Review state' : 'Profile status'}: {row.status}
                  </p>
                )}
                {tab === 'tasks' && (
                  <p>
                    {row.done ? 'Completed' : 'Pending'} · Owner: {row.owner || 'Unassigned'} · Due:{' '}
                    {row.due || 'Undated'}
                  </p>
                )}
                {['filter', 'discovery', 'search'].includes(tab) && (
                  <button
                    type="button"
                    disabled={
                      !(row.kind === 'client'
                        ? onOpenClient
                        : row.kind === 'demand'
                          ? onOpenDemand
                          : onOpen)
                    }
                    onClick={() => navigateResult(row)}
                  >
                    Open {row.kind || 'candidate'} {row.anthroId || row.label || row.name}
                  </button>
                )}
                {['quality', 'tasks'].includes(tab) && (
                  <button type="button" onClick={() => choose(row)}>
                    Review {row.label || row.title}
                  </button>
                )}
                {row.candidateId && onOpen && (
                  <button type="button" onClick={() => onOpen(row.candidateId)}>
                    Open task candidate
                  </button>
                )}
              </article>
            ))}
            {page.rows?.length === 0 && <p>No results on this page.</p>}
            {tab === 'report' && (
              <>
                <p>{page.definition}</p>
                <dl>
                  {Object.entries(page.cohorts || {}).map(([k, n]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{n}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                <h3>Custom-field groups</h3>
                {page.groups?.map((g) => (
                  <p key={g.id || g.value}>
                    {g.value}
                    {g.unknown ? ' (missing)' : ''}: {g.count}
                  </p>
                ))}
                <p>Groups omitted: {page.groupsOmitted || 0}.</p>
                <h3>Observed demand skill gaps</h3>
                {page.heatmap?.map((g) => (
                  <p key={g.skill}>
                    {g.skill}: {g.observed} observed, {g.missing} missing; demand skill weight{' '}
                    {g.weight}
                  </p>
                ))}
                <p>Skills omitted: {page.skillsOmitted || 0}.</p>
                {editor && (
                  <button
                    type="button"
                    onClick={() => mutate('export-report', { ...applied.payload, head: page.head })}
                  >
                    Prepare audited foundation report
                  </button>
                )}
              </>
            )}
            {tab !== 'report' && (
              <div className="pagination">
                <button
                  type="button"
                  disabled={tab === 'filter' ? cursors.length === 1 : offset === 0}
                  onClick={() => {
                    if (tab === 'filter') {
                      const c = cursors.slice(0, -1);
                      setCursors(c);
                      read(tab, { ...applied.payload, cursor: c.at(-1) });
                    } else read(tab, applied.payload, Math.max(0, offset - 25));
                  }}
                >
                  Previous foundation page
                </button>
                <button
                  type="button"
                  disabled={tab === 'filter' ? !page.next : !page.more}
                  onClick={() => {
                    if (tab === 'filter') {
                      setCursors((c) => [...c, page.next]);
                      read(tab, { ...applied.payload, cursor: page.next });
                    } else
                      read(
                        tab,
                        { ...applied.payload, ...(tab === 'discovery' ? { head: page.head } : {}) },
                        offset + 25,
                      );
                  }}
                >
                  Next foundation page
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCursors([null]);
                    read(
                      tab,
                      { ...applied.payload, ...(tab === 'filter' ? { cursor: null } : {}) },
                      0,
                    );
                  }}
                >
                  Refresh foundation results
                </button>
              </div>
            )}
          </>
        )}
        {selection && (
          <section>
            <h3>
              Selected {tab === 'quality' ? 'finding' : 'task'}:{' '}
              {selection.label || selection.title}
            </h3>
            <p>{tab === 'quality' ? selection.target : selection.id}</p>
            {history?.canResolve && (
              <p>Source finding is absent. Resolution can now be recorded.</p>
            )}
            {editor && (
              <>
                <label>
                  Foundation review reason
                  <textarea
                    value={reason}
                    maxLength="1000"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  Assign to editor
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Unassigned</option>
                    {context?.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Editor UUID (for editors beyond the first 200)
                  <input
                    value={assignee}
                    maxLength="36"
                    onChange={(e) => setAssignee(e.target.value)}
                  />
                </label>
                {tab === 'quality' ? (
                  <Select
                    label="Quality decision"
                    value={decision}
                    values={
                      history?.canResolve ? ['Resolved'] : ['Reviewed', 'Deferred', 'Reopened']
                    }
                    onChange={setDecision}
                  />
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={(e) => setDone(e.target.checked)}
                    />
                    Task completed
                  </label>
                )}
                <button
                  type="button"
                  disabled={reason.trim().length < 10 || !history}
                  onClick={() =>
                    mutate(
                      tab === 'quality' ? 'quality-decide' : 'task-act',
                      tab === 'quality'
                        ? {
                            kind: selection.kind,
                            target: selection.target,
                            head: history?.head || selection.head,
                            status: history?.canResolve ? 'Resolved' : decision,
                            assignee: assignee || null,
                            reason: reason.trim(),
                          }
                        : {
                            id: selection.id,
                            head: selection.head,
                            assignee: assignee || null,
                            done,
                            reason: reason.trim(),
                          },
                    )
                  }
                >
                  Record {tab === 'quality' ? 'quality decision' : 'task handoff'}
                </button>
              </>
            )}
            {history?.rows.map((r) => (
              <p key={r.id}>
                {r.status || 'Task handoff'} · {r.reason} · {r.at}
              </p>
            ))}
            <button type="button" onClick={() => historyPage(selection)}>
              Refresh selected history
            </button>
            <button
              type="button"
              disabled={!historyOffset}
              onClick={() => historyPage(selection, Math.max(0, historyOffset - 25))}
            >
              Previous history page
            </button>
            <button
              type="button"
              disabled={!history?.more}
              onClick={() => historyPage(selection, historyOffset + 25)}
            >
              Next history page
            </button>
          </section>
        )}
        {exported && (
          <button type="button" onClick={() => download(exported)}>
            Download foundation report
          </button>
        )}
      </fieldset>
    </section>
  );
}
