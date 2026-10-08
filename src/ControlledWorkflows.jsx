import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId, getSupabase } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

export async function runExternalWorkflow(p) {
  const client = await getSupabase(),
    { data } = await client.auth.getSession();
  if (!data.session) throw Error('Sign in again.');
  const r = await fetch('/.netlify/functions/controlled-workflow-run', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + data.session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(p),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || 'Workflow unavailable.');
  return body;
}
const versions = {
  ai: 'fixture-model',
  enrichment: 'pdl-v5',
  publishing: 'approved-feed-v1',
  signing: 'neutral-sign-v1',
};
const names = {
  ai: 'Professional AI highlights',
  enrichment: 'Licensed profile enrichment',
  publishing: 'Approved job export',
  signing: 'Offer signing fixture',
};
export default function ControlledWorkflows({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  candidateId = '',
  ...props
}) {
  if (!isCloud || !['admin', 'recruiter'].includes(role)) return null;
  return (
    <Console
      key={`${scope}:${role}:${candidateId}`}
      role={role}
      candidateId={candidateId}
      {...props}
    />
  );
}
function Console({
  role,
  candidateId,
  rpc = repositoryRead,
  server = runExternalWorkflow,
  download = (p) => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `reviewed-job-${p.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
}) {
  const [kind, setKind] = useState('ai'),
    [candidate, setCandidate] = useState(candidateId),
    [locator, setLocator] = useState(''),
    [search, setSearch] = useState(''),
    [catalogOffset, setCatalogOffset] = useState(0),
    [catalog, setCatalog] = useState(null);
  const [context, setContext] = useState(null),
    [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(null),
    [busy, setBusy] = useState(false);
  const [config, setConfig] = useState({
    owner: '',
    purpose: '',
    rights: '',
    processing: '',
    costDecision: '',
    providerVersion: 'fixture-model',
    mode: 'fixture',
    dailyLimit: 20,
    attribution: 'Reviewed partner feed',
    currency: 'INR',
  });
  const [evaluation, setEvaluation] = useState({
    cases: 10,
    baselineUtility: 3,
    providerUtility: 3,
    safetyFailures: 0,
    groundingPercent: 100,
    datasetHash: '',
    evidence: '',
  });
  const [notes, setNotes] = useState({}),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [versionPage, setVersionPage] = useState(null),
    [versionWork, setVersionWork] = useState(''),
    [versionOffset, setVersionOffset] = useState(0);
  const lifecycle = useRef({ live: true, epoch: 0 });
  useEffect(() => {
    const state = lifecycle.current;
    state.live = true;
    return () => {
      state.live = false;
      state.epoch++;
    };
  }, []);
  useEffect(() => {
    lifecycle.current.epoch++;
    setPreview(null);
    setOffset(0);
    setVersionPage(null);
    setVersionWork('');
  }, [candidate, kind]);
  useEffect(() => {
    let active = true;
    setContext(null);
    rpc('api_controlled_workflows', { p_action: 'context' })
      .then((v) => {
        if (!Array.isArray(v?.policies) || v.policies.length > 4)
          throw Error('Invalid policy context.');
        if (active) setContext(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, tick]);
  useEffect(() => {
    const p = context?.policies.find((x) => x.kind === kind);
    setConfig(
      p?.body || {
        owner: context?.actor || '',
        purpose: '',
        rights: '',
        processing: '',
        costDecision: '',
        providerVersion: versions[kind],
        embeddingModel: 'text-embedding-3-small',
        mode: 'fixture',
        dailyLimit: 20,
        attribution: 'Reviewed partner feed',
        currency: 'INR',
      },
    );
  }, [context, kind]);
  useEffect(() => {
    let active = true;
    setPage(null);
    rpc('api_controlled_workflows', {
      p_action: 'browse',
      p_candidate: candidate || null,
      p_offset: offset,
    })
      .then((v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25)
          throw Error('Invalid bounded workflow journal.');
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, candidate, offset, tick]);
  const policy = context?.policies.find((x) => x.kind === kind),
    locked = busy || !!pending;
  const payload = {
    kind,
    ...(kind === 'publishing' ? { demand: locator } : kind === 'signing' ? { offer: locator } : {}),
  };
  async function perform(request) {
    setBusy(true);
    setError('');
    setNotice('');
    const epoch = lifecycle.current.epoch;
    try {
      const value = request.server
        ? await server(request.body)
        : await rpc('api_controlled_workflows', request.body);
      if (!lifecycle.current.live || epoch !== lifecycle.current.epoch) return;
      setPending(null);
      setNotice(value.status || 'Recorded');
      setPreview(null);
      setTick((x) => x + 1);
    } catch (e) {
      if (lifecycle.current.live && epoch === lifecycle.current.epoch) {
        setError(e.message);
        setPending(request);
      }
    } finally {
      if (lifecycle.current.live && epoch === lifecycle.current.epoch) setBusy(false);
    }
  }
  function mutate(action, p, head, c = candidate || null) {
    perform({
      body: {
        p_action: action,
        p_candidate: c,
        p_operation: crypto.randomUUID(),
        p_head: head,
        p_payload: p,
      },
    });
  }
  async function read(action, args, consume) {
    setBusy(true);
    setError('');
    const epoch = lifecycle.current.epoch;
    try {
      const v = await rpc('api_controlled_workflows', { p_action: action, ...args });
      if (lifecycle.current.live && epoch === lifecycle.current.epoch) consume(v);
    } catch (e) {
      if (lifecycle.current.live && epoch === lifecycle.current.epoch) setError(e.message);
    } finally {
      if (lifecycle.current.live && epoch === lifecycle.current.epoch) setBusy(false);
    }
  }
  function picker(off = catalogOffset) {
    const entity = kind === 'publishing' ? 'demands' : kind === 'signing' ? 'offers' : 'candidates';
    read(
      'catalog',
      {
        p_candidate: kind === 'signing' ? candidate || null : null,
        p_payload: { entity, search },
        p_offset: off,
      },
      (v) => {
        if (!Array.isArray(v?.rows) || v.rows.length > 25) throw Error('Invalid picker page.');
        setCatalog(v);
        setCatalogOffset(off);
      },
    );
  }
  function selectedKind(v) {
    setKind(v);
    setLocator('');
    setCatalog(null);
    setCatalogOffset(0);
    setSearch('');
  }
  return (
    <section
      className="panel"
      aria-label="Controlled intelligence and external workflows"
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2>Stage 4 controlled workflows</h2>
      <p>
        Review attributable professional drafts, approved job exports and offer-specific signing
        fixtures. Accepted drafts do not change candidate facts. Signing fixtures are fictional and
        cannot provide a legal signature.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <aside aria-label="Pending controlled workflow">
          <p>
            The acknowledgement is uncertain. Retry the exact operation or discard this local retry
            and refresh history.
          </p>
          <button disabled={busy} onClick={() => perform(pending)}>
            Retry exact controlled operation
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPending(null);
              setPreview(null);
              setTick((x) => x + 1);
            }}
          >
            Discard controlled retry and refresh
          </button>
        </aside>
      )}
      <fieldset disabled={locked}>
        <legend>Workflow and policy</legend>
        <label>
          Controlled workflow
          <select
            aria-label="Controlled workflow"
            value={kind}
            onChange={(e) => selectedKind(e.target.value)}
          >
            {Object.keys(names)
              .filter(
                (k) =>
                  (role === 'admin' || k !== 'signing') && (!candidateId || k !== 'publishing'),
              )
              .map((k) => (
                <option key={k} value={k}>
                  {names[k]}
                </option>
              ))}
          </select>
        </label>
        <p>
          {policy
            ? `${policy.state} · generation ${policy.generation} · ${policy.body.mode} · ${policy.body.providerVersion}`
            : 'Policy not configured'}
          {context?.paused ? ' · Recovery paused' : ''}
        </p>
        <button onClick={() => setTick((x) => x + 1)}>Refresh controlled workflow status</button>
        {role === 'admin' && (
          <details>
            <summary>Administrator policy and baseline evaluation</summary>
            {[
              'owner',
              'purpose',
              'rights',
              'processing',
              'costDecision',
              'providerVersion',
              'embeddingModel',
              'attribution',
              'currency',
            ]
              .filter(
                (f) =>
                  (f !== 'attribution' || kind === 'publishing') &&
                  (f !== 'embeddingModel' || kind === 'ai') &&
                  (f !== 'currency' || kind === 'signing'),
              )
              .map((f) => (
                <label key={f}>
                  Policy {f}
                  <input
                    aria-label={`Controlled policy ${f}`}
                    value={config[f] || ''}
                    maxLength={f === 'rights' || f === 'processing' ? 1000 : 500}
                    onChange={(e) => setConfig({ ...config, [f]: e.target.value })}
                  />
                </label>
              ))}
            <label>
              Policy mode
              <select
                aria-label="Controlled policy mode"
                value={config.mode}
                onChange={(e) => setConfig({ ...config, mode: e.target.value })}
              >
                <option value="fixture">Fixture — no external provider</option>
                {kind !== 'signing' && (
                  <option value="live">Live — requires actual rights and acceptance</option>
                )}
              </select>
            </label>
            <label>
              Daily attempt budget
              <input
                aria-label="Controlled daily budget"
                type="number"
                min="1"
                max="100"
                value={config.dailyLimit}
                onChange={(e) => setConfig({ ...config, dailyLimit: Number(e.target.value) })}
              />
            </label>
            <button
              disabled={!context}
              onClick={() =>
                mutate('configure', { kind, ...config }, policy?.head || context.defaultHead, null)
              }
            >
              Save reviewed controlled policy
            </button>
            <p>
              Changing configuration creates a new generation. Existing originals and uncertain
              outcomes remain in history.
            </p>
            {Object.keys(evaluation).map((f) => (
              <label key={f}>
                Evaluation {f}
                <input
                  aria-label={`Controlled evaluation ${f}`}
                  type={['datasetHash', 'evidence'].includes(f) ? 'text' : 'number'}
                  value={evaluation[f]}
                  maxLength={f === 'evidence' ? 1000 : 64}
                  step="any"
                  onChange={(e) =>
                    setEvaluation({
                      ...evaluation,
                      [f]: ['datasetHash', 'evidence'].includes(f)
                        ? e.target.value
                        : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <button
              disabled={!policy}
              onClick={() =>
                mutate('evaluate', { kind, ...evaluation, mode: config.mode }, policy.head, null)
              }
            >
              Record baseline evaluation evidence
            </button>
            <p>
              At least ten cases, zero safety failures and full literal grounding are required. Live
              AI requires measured utility above the manual baseline. Fixture scores do not prove
              live model performance.
            </p>
            {['accept', 'enable', 'pause', 'revoke'].map((a) => (
              <button
                key={a}
                disabled={!policy}
                onClick={() => mutate(a, { kind }, policy.head, null)}
              >
                {a[0].toUpperCase() + a.slice(1)} controlled policy
              </button>
            ))}
            {(context?.evaluations || [])
              .filter((x) => x.kind === kind && x.generation === policy?.generation)
              .map((x) => (
                <p key={x.id}>
                  {x.body.mode} evaluation · {x.body.cases} cases · baseline{' '}
                  {x.body.baselineUtility}, provider {x.body.providerUtility} · safety failures{' '}
                  {x.body.safetyFailures} · {x.body.evidence}
                </p>
              ))}
          </details>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Review the source before preparing work</legend>
        {kind !== 'publishing' && (
          <label>
            Controlled candidate UUID
            <input
              aria-label="Controlled candidate UUID"
              value={candidate}
              disabled={!!candidateId}
              onChange={(e) => {
                setCandidate(e.target.value);
                setPreview(null);
              }}
            />
          </label>
        )}
        {(kind === 'publishing' || kind === 'signing') && (
          <label>
            {kind === 'publishing' ? 'Demand UUID' : 'Approved offer UUID'}
            <input
              aria-label="Controlled source UUID"
              value={locator}
              onChange={(e) => {
                setLocator(e.target.value);
                setPreview(null);
              }}
            />
          </label>
        )}
        {(!candidateId || kind === 'signing') && (
          <>
            <label>
              Find source
              <input
                aria-label="Controlled source search"
                maxLength="100"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCatalog(null);
                  setCatalogOffset(0);
                }}
              />
            </label>
            <button onClick={() => picker(0)}>Find controlled workflow source</button>
            {catalog && (
              <>
                <select
                  aria-label="Controlled source picker"
                  value=""
                  onChange={(e) => {
                    const item = catalog.rows.find((x) => x.id === e.target.value);
                    if (kind === 'signing') {
                      setLocator(item.id);
                      setCandidate(item.candidate_id);
                    } else if (kind === 'publishing') setLocator(item.id);
                    else setCandidate(item.id);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose a source</option>
                  {catalog.rows.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.anthro_id || x.role || x.title} · {x.name || x.id}
                    </option>
                  ))}
                </select>
                <button disabled={!catalogOffset} onClick={() => picker(catalogOffset - 25)}>
                  Previous source page
                </button>
                <button disabled={!catalog.more} onClick={() => picker(catalogOffset + 25)}>
                  Next source page
                </button>
              </>
            )}
          </>
        )}
        <button
          disabled={
            !context ||
            (kind !== 'publishing' && !candidate) ||
            (['publishing', 'signing'].includes(kind) && !locator)
          }
          onClick={() =>
            read(
              'preview',
              { p_candidate: kind === 'publishing' ? null : candidate, p_payload: payload },
              setPreview,
            )
          }
        >
          Review controlled source
        </button>
        {preview && (
          <>
            <p>{preview.eligible ? 'Current source eligible' : preview.reason}</p>
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(preview.snapshot, null, 2)}
            </pre>
            <button
              disabled={!preview.eligible}
              onClick={() =>
                mutate('prepare', payload, preview.head, kind === 'publishing' ? null : candidate)
              }
            >
              Prepare reviewed controlled workflow
            </button>
          </>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>History, attribution and review</legend>
        <label>
          Independent review reason
          <input
            aria-label="Controlled review reason"
            value={reason}
            maxLength="1000"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label>
          External-copy or uncertainty evidence
          <input
            aria-label="Controlled external evidence"
            value={evidence}
            maxLength="1000"
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        {!page && <p>Loading current journal…</p>}
        {page?.rows.length === 0 && <p>No controlled workflow history for this scope.</p>}
        {page?.rows.map((w) => (
          <article key={w.id} style={{ borderTop: '1px solid #d9dfe8', padding: '12px 0' }}>
            <h3>
              {names[w.kind]} · {w.status}
            </h3>
            <p>
              {w.id} · generation {w.generation} · {w.reason}
            </p>
            <p>{w.source.source}</p>
            {w.source.provenance && (
              <p>
                {w.source.provenance.mode} · {w.source.provenance.provider} ·{' '}
                {w.source.provenance.providerVersion} · projection {w.source.provenance.projection}
              </p>
            )}
            {w.kind === 'enrichment' && (
              <p>
                Provider assertions are unverified. Acceptance records review and does not apply
                them to the candidate.
              </p>
            )}
            {(w.content?.highlights || []).map((x, i) => (
              <p key={i}>
                <strong>{x.field}:</strong> {x.quote}
              </p>
            ))}
            {(w.content?.unknowns || []).map((x, i) => (
              <p key={i}>Missing evidence: {x}</p>
            ))}
            {w.content?.notes && <p>Reviewer narrative (unverified): {w.content.notes}</p>}
            {w.kind === 'signing' && (
              <p>
                Offer {w.source.offer} · recipient {w.source.recipient} · currency{' '}
                {w.source.currency} · fixture envelope {w.provider_id || 'not prepared'}
              </p>
            )}
            {w.status === 'Queued' && (
              <>
                <button
                  onClick={() =>
                    perform({
                      server: true,
                      body: { id: w.id, operation: crypto.randomUUID(), head: w.head },
                    })
                  }
                >
                  Run reviewed {w.kind} workflow
                </button>
                <button onClick={() => mutate('cancel', { id: w.id }, w.head, w.candidate_id)}>
                  Cancel queued controlled work
                </button>
              </>
            )}
            {w.status === 'Review' && (
              <>
                <label>
                  Review notes for {w.id}
                  <textarea
                    aria-label={`Controlled notes ${w.id}`}
                    value={notes[w.id] ?? w.content.notes}
                    maxLength="2000"
                    onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })}
                  />
                </label>
                <button
                  disabled={reason.trim().length < 10}
                  onClick={() =>
                    mutate(
                      'edit',
                      {
                        id: w.id,
                        content: { ...w.content, notes: notes[w.id] ?? w.content.notes },
                        reason,
                      },
                      w.head,
                      w.candidate_id,
                    )
                  }
                >
                  Save independent draft notes
                </button>
                {['accept', 'reject'].map((decision) => (
                  <button
                    key={decision}
                    disabled={reason.trim().length < 10 || w.actor === context?.actor}
                    onClick={() =>
                      mutate('review', { id: w.id, decision, reason }, w.head, w.candidate_id)
                    }
                  >
                    {decision === 'accept' ? 'Accept' : 'Reject'} independently reviewed draft
                  </button>
                ))}
              </>
            )}
            {w.status === 'Export ready' && (
              <button
                onClick={() =>
                  read('export', { p_payload: { id: w.id }, p_head: w.head }, download)
                }
              >
                Download current approved job export
              </button>
            )}
            {role === 'admin' &&
              w.kind === 'publishing' &&
              ['Export ready', 'Reported posted', 'Reported withdrawn', 'Unknown'].includes(
                w.status,
              ) &&
              ['posted', 'withdrawn', 'uncertain'].map((outcome) => (
                <button
                  key={outcome}
                  disabled={evidence.trim().length < 20}
                  onClick={() => mutate('report', { id: w.id, outcome, evidence }, w.head, null)}
                >
                  Record reported {outcome}
                </button>
              ))}
            {role === 'admin' && (w.status === 'Unknown' || w.status === 'Running') && (
              <>
                <button
                  disabled={evidence.trim().length < 20}
                  onClick={() => mutate('resolve', { id: w.id, evidence }, w.head, w.candidate_id)}
                >
                  Close uncertainty by reviewed decision
                </button>
                {w.kind === 'signing' && w.status === 'Unknown' && (
                  <button onClick={() => mutate('reconcile', { id: w.id }, w.head, w.candidate_id)}>
                    Reconcile authenticated signing fixture
                  </button>
                )}
              </>
            )}
            <button
              onClick={() =>
                read('versions', { p_payload: { id: w.id }, p_offset: 0 }, (v) => {
                  setVersionWork(w.id);
                  setVersionOffset(0);
                  setVersionPage(v);
                })
              }
            >
              Review retained workflow versions
            </button>
          </article>
        ))}
        <button disabled={!offset} onClick={() => setOffset(offset - 25)}>
          Previous workflow page
        </button>
        <button disabled={!page?.more} onClick={() => setOffset(offset + 25)}>
          Next workflow page
        </button>
        {versionPage && (
          <aside aria-label="Retained workflow versions">
            <h3>Retained originals and edits · {versionWork}</h3>
            {versionPage.rows.map((v) => (
              <div key={v.id}>
                <p>
                  Version {v.version} · {v.origin} · {v.reason}
                </p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(v.content, null, 2)}</pre>
              </div>
            ))}
            <button
              disabled={!versionOffset}
              onClick={() =>
                read(
                  'versions',
                  { p_payload: { id: versionWork }, p_offset: versionOffset - 25 },
                  (v) => {
                    setVersionOffset(versionOffset - 25);
                    setVersionPage(v);
                  },
                )
              }
            >
              Previous version page
            </button>
            <button
              disabled={!versionPage.more}
              onClick={() =>
                read(
                  'versions',
                  { p_payload: { id: versionWork }, p_offset: versionOffset + 25 },
                  (v) => {
                    setVersionOffset(versionOffset + 25);
                    setVersionPage(v);
                  },
                )
              }
            >
              Next version page
            </button>
          </aside>
        )}
      </fieldset>
    </section>
  );
}
