import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';
import { canWriteForRole, getRole } from './repository.js';
const today = () => new Date().toISOString().slice(0, 10);
const later = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const kinds = [
  'skill',
  'experience',
  'language',
  'certification',
  'eligibility',
  'location',
  'engagement',
  'mode',
  'notice',
  'compensation',
];
const seed = (d) => ({
  requirements: [
    ...(d.skills || []).map((name, i) => ({
      id: `skill_${i}`,
      kind: 'skill',
      name,
      minimum: 0,
      level: d.minProficiency || 'Working',
      recencyDays: 365,
    })),
    {
      id: 'experience',
      kind: 'experience',
      name: 'Relevant experience',
      minimum: d.minExperience || 0,
      recencyDays: 120,
    },
    {
      id: 'notice',
      kind: 'notice',
      name: 'Notice period',
      minimum: d.maxNotice ?? 30,
      recencyDays: 120,
    },
  ],
  kit: [
    { id: 'technical', label: 'Technical exercise', weight: 70 },
    { id: 'communication', label: 'Communication exercise', weight: 30 },
  ],
  threshold: 80,
  assessmentDays: 90,
  reviewers: 1,
  requireReadyForSubmission: true,
});
const actions = {
  claim: 'Record sourced eligibility evidence',
  start: 'Start independent assessment',
  debrief: 'Record debrief',
  gap_plan: 'Create gap plan',
  gap_complete: 'Record gap completion',
  gap_validate: 'Validate gap completion',
  decide: 'Record demand validation',
};
function checkPage(v) {
  if (!v || typeof v.head !== 'string') throw new Error('Journey returned an invalid context.');
  return v;
}
export function DemandJourney({ demand, rpc = repositoryRead, onOpenCandidate }) {
  const editor = canWriteForRole(getRole()),
    admin = getRole() === 'admin';
  const [candidate, setCandidate] = useState(null),
    [page, setPage] = useState(null),
    [shortlist, setShortlist] = useState(null),
    [report, setReport] = useState(null),
    [offset, setOffset] = useState(0),
    [historyOffset, setHistoryOffset] = useState(0),
    [filters, setFilters] = useState({ query: '', readyOnly: false, eligibleOnly: false }),
    [revision, setRevision] = useState(0),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const operation = useRef(null),
    epoch = useRef(0);
  useEffect(() => {
    setCandidate(null);
    setOffset(0);
    setHistoryOffset(0);
    setDraft(null);
    operation.current = null;
  }, [demand.id]);
  useEffect(() => {
    setDraft(null);
    operation.current = null;
    setHistoryOffset(0);
  }, [candidate]);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    const generation = ++ref.current;
    setPage(null);
    setError('');
    setBusy(false);
    Promise.all([
      rpc('api_demand_journey', {
        p_action: 'context',
        p_demand: demand.id,
        p_candidate: candidate,
        p_offset: historyOffset,
      }),
      rpc('api_demand_journey', {
        p_action: 'shortlist',
        p_demand: demand.id,
        p_offset: offset,
        p_payload: filters,
      }),
    ])
      .then(([p, s]) => {
        checkPage(p);
        if (!Array.isArray(s?.rows) || s.rows.length > 25 || typeof s.more !== 'boolean')
          throw new Error('Invalid shortlist/report response.');
        if (active && generation === epoch.current) {
          setPage(p);
          setShortlist(s);
        }
      })
      .catch((e) => {
        if (active) {
          setPage(null);
          setShortlist(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
      ref.current++;
    };
  }, [demand.id, candidate, rpc, offset, historyOffset, filters, revision]);
  useEffect(() => {
    let active = true;
    setReport(null);
    rpc('api_demand_journey', { p_action: 'report', p_demand: demand.id })
      .then((r) => {
        if (!Number.isInteger(r?.reviewedPopulation)) throw new Error('Invalid readiness report.');
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demand.id, rpc, revision]);
  function begin(action, payload) {
    operation.current = null;
    setMessage('');
    setError('');
    setDraft({ action, payload, head: page.head });
  }
  function edit(next) {
    operation.current = null;
    setDraft({ ...draft, payload: next });
  }
  async function save(e) {
    e.preventDefault();
    const generation = epoch.current;
    setBusy(true);
    setError('');
    operation.current ??= crypto.randomUUID();
    const args = {
      p_action: draft.action,
      p_demand: demand.id,
      p_candidate: draft.action === 'configure' ? null : candidate,
      p_operation: operation.current,
      p_head: draft.head,
      p_payload: draft.payload,
    };
    try {
      await rpc('api_demand_journey', args);
      if (generation === epoch.current) {
        setDraft(null);
        operation.current = null;
        setMessage('Recorded with server provenance.');
        setRevision((n) => n + 1);
      }
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function refreshDraft() {
    setBusy(true);
    const generation = epoch.current;
    try {
      const p = checkPage(
        await rpc('api_demand_journey', {
          p_demand: demand.id,
          p_candidate: draft.action === 'configure' ? null : candidate,
        }),
      );
      if (generation === epoch.current) {
        setPage(p);
        setDraft({ ...draft, head: p.head });
        operation.current = null;
        setMessage('New version loaded. Recheck the draft before saving.');
      }
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="settings-body">
        <h2>Demand-specific ECOD journey</h2>
        <p>
          Hard requirements, independent evidence and validated readiness for this demand. Profile
          status and legacy fit scores do not certify readiness.
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh demand journey
        </Button>
        {report && (
          <p>
            {report.validatedReady} validated ready / {report.reviewedPopulation} active unheld
            candidates. {report.bounded ? 'Population limited to the first 1,000 candidates.' : ''}{' '}
            Hard requirements satisfied: {report.hardRequirementsSatisfied}. Counts use current
            evidence.
          </p>
        )}
        {!page && !error && <p role="status">Loading demand evidence…</p>}
        {page && (
          <>
            <p>
              Requirements and interview kit version{' '}
              {page.configuration?.version || 'not configured'}.
            </p>
            {admin && !candidate && (
              <Button
                type="button"
                disabled={busy || !!draft}
                onClick={() =>
                  begin('configure', structuredClone(page.configuration?.body || seed(demand)))
                }
              >
                Review requirements and interview kit
              </Button>
            )}
            {!page.configuration && (
              <p>
                A workspace administrator must review the requirements and kit before this demand
                can be validated.
              </p>
            )}
            <Field label="Demand shortlist search">
              <input
                value={filters.query}
                maxLength={200}
                onChange={(e) => {
                  setOffset(0);
                  setFilters({ ...filters, query: e.target.value });
                }}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={filters.readyOnly}
                onChange={(e) => {
                  setOffset(0);
                  setFilters({ ...filters, readyOnly: e.target.checked });
                }}
              />
              Validated ready only
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.eligibleOnly}
                onChange={(e) => {
                  setOffset(0);
                  setFilters({ ...filters, eligibleOnly: e.target.checked });
                }}
              />
              Current hard requirements satisfied only
            </label>
            {shortlist?.rows.map((row) => (
              <article key={row.id}>
                <h3>
                  {row.name} · {row.anthroId}
                </h3>
                <p>
                  {row.state}
                  {row.validatedReady ? ` until ${row.validUntil}` : ''}
                </p>
                <p>
                  {row.checks
                    .filter((c) => c.status !== 'satisfied')
                    .map((c) => `${c.name}: ${c.status}`)
                    .join('; ') ||
                    'Current requirements satisfied; validator review still required.'}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !!draft}
                  onClick={() => setCandidate(row.id)}
                >
                  Review demand evidence for {row.anthroId}
                </Button>
              </article>
            ))}
            {shortlist && !shortlist.rows.length && <p>No candidates on this filtered page.</p>}
            <Button
              type="button"
              variant="secondary"
              disabled={offset === 0 || busy}
              onClick={() => setOffset((n) => Math.max(0, n - 25))}
            >
              Previous demand candidates
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!shortlist?.more || busy}
              onClick={() => setOffset((n) => n + 25)}
            >
              Next demand candidates
            </Button>
            {candidate && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setCandidate(null)}
                >
                  Back to demand configuration
                </Button>
                <h3>
                  {page.candidate?.name} · {page.candidate?.anthroId}
                </h3>
                <p>
                  {page.state}
                  {page.validatedReady ? ` until ${page.validUntil}` : ''}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenCandidate?.(candidate)}
                >
                  Open candidate evidence
                </Button>
                <ul>
                  {page.checks?.map((c) => (
                    <li key={c.id}>
                      {c.name}: <strong>{c.status}</strong> — {c.reason}
                    </li>
                  ))}
                </ul>
                {editor && !draft && page.configuration && (
                  <>
                    <Button
                      type="button"
                      onClick={() =>
                        begin('claim', {
                          kind: 'experience',
                          name: 'Relevant experience',
                          value: 0,
                          source: '',
                          observed: today(),
                          validUntil: later(30),
                          confirmed: false,
                          supersedes: null,
                        })
                      }
                    >
                      Record sourced eligibility evidence
                    </Button>
                    <Button type="button" onClick={() => begin('start', { members: [] })}>
                      Start independent assessment
                    </Button>
                    {page.cycle && (
                      <Button
                        type="button"
                        onClick={() => begin('debrief', { decision: 'Gap', reason: '' })}
                      >
                        Record debrief
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() =>
                        begin('gap_plan', {
                          objective: '',
                          evidenceRequired: '',
                          owner: '',
                          due: later(7),
                          readyEstimate: later(14),
                        })
                      }
                    >
                      Create gap plan
                    </Button>
                    {admin && (
                      <Button
                        type="button"
                        onClick={() =>
                          begin('decide', { decision: 'Near-ready', reason: '', days: 30 })
                        }
                      >
                        Record demand validation
                      </Button>
                    )}
                  </>
                )}
                <h4>Independent scorecards and debrief</h4>
                {page.evaluations?.map((row) => (
                  <article key={row.id}>
                    <p>
                      {row.score}/100 · recorded {row.at} · valid until {row.valid_until}
                    </p>
                    <ul>
                      {Object.entries(row.evidence).map(([k, v]) => (
                        <li key={k}>
                          {k}: {row.scores[k]} — {v}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
                {page.debrief && (
                  <p>
                    Debrief: {page.debrief.decision} — {page.debrief.reason}
                  </p>
                )}
                <h4>Assessment history</h4>
                {page.cycleHistory?.map((cycle) => (
                  <details key={cycle.id}>
                    <summary>
                      Kit version {cycle.configuration.version} · {cycle.at} ·{' '}
                      {cycle.debrief?.decision || 'Awaiting debrief'}
                    </summary>
                    <p>Historical evidence is preserved; it does not certify current readiness.</p>
                    <ul>
                      {cycle.configuration.kit.map((k) => (
                        <li key={k.id}>
                          {k.label} · weight {k.weight}% · floor {k.minScore ?? 0}/100
                        </li>
                      ))}
                    </ul>
                    {cycle.evaluations.map((e) => (
                      <article key={e.id}>
                        <p>
                          {e.score}/100 · valid until {e.valid_until} · recorded {e.at}
                        </p>
                        <ul>
                          {Object.entries(e.evidence).map(([k, v]) => (
                            <li key={k}>
                              {k}: {e.scores[k]} — {v}
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))}
                    {cycle.debrief && <p>{cycle.debrief.reason}</p>}
                  </details>
                ))}
                <h4>Gap plans</h4>
                {page.gaps?.map((row) => (
                  <article key={row.plan_id}>
                    <p>
                      {row.body.objective} · {row.action} · due {row.body.due} · estimated ready{' '}
                      {row.body.readyEstimate}
                    </p>
                    <p>Required evidence: {row.body.evidenceRequired}</p>
                    <p>{row.body.gap_complete || row.body.gap_validate || ''}</p>
                    {editor && !draft && row.action === 'Planned' && (
                      <Button
                        type="button"
                        onClick={() => begin('gap_complete', { plan: row.plan_id, evidence: '' })}
                      >
                        Record gap completion
                      </Button>
                    )}
                    {admin && !draft && row.action === 'Complete' && (
                      <Button
                        type="button"
                        onClick={() => begin('gap_validate', { plan: row.plan_id, evidence: '' })}
                      >
                        Validate gap completion
                      </Button>
                    )}
                  </article>
                ))}
                <h4>Sourced eligibility evidence</h4>
                {page.claims?.map((row) => (
                  <article key={row.id}>
                    <p>
                      {row.kind}: {row.name} · {String(row.value)} ·{' '}
                      {row.superseded
                        ? 'Superseded evidence'
                        : row.confirmed
                          ? 'Human confirmed'
                          : 'Observed claim'}{' '}
                      · {row.observed} until {row.valid_until}
                    </p>
                    <p>{row.source}</p>
                    {editor && !draft && !row.superseded && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          begin('claim', {
                            kind: row.kind,
                            name: row.name,
                            value: row.value,
                            source: row.source,
                            observed: today(),
                            validUntil: later(30),
                            confirmed: false,
                            supersedes: row.id,
                          })
                        }
                      >
                        Correct evidence for {row.name}
                      </Button>
                    )}
                  </article>
                ))}
                <h4>Validator history</h4>
                {page.history?.map((row) => (
                  <article key={row.id}>
                    <p>
                      {row.decision} until {row.valid_until} · {row.at}
                    </p>
                    <p>{row.reason}</p>
                  </article>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={historyOffset === 0 || busy || !!draft}
                  onClick={() => setHistoryOffset((n) => Math.max(0, n - 25))}
                >
                  Previous journey history
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    (!page.historyMore &&
                      !page.claimsMore &&
                      !page.gapsMore &&
                      !page.cycleHistoryMore) ||
                    busy ||
                    !!draft
                  }
                  onClick={() => setHistoryOffset((n) => n + 25)}
                >
                  Next journey history
                </Button>
              </>
            )}
          </>
        )}
        {draft && (
          <form
            aria-label={
              draft.action === 'configure' ? 'Reviewed demand configuration' : actions[draft.action]
            }
            onSubmit={save}
          >
            <h3>
              {draft.action === 'configure'
                ? 'Review demand requirements and interview kit'
                : actions[draft.action]}
            </h3>
            {draft.action === 'configure' ? (
              <ConfigurationEditor value={draft.payload} onChange={edit} disabled={busy} />
            ) : (
              <ActionFields
                action={draft.action}
                value={draft.payload}
                onChange={edit}
                evaluators={page?.evaluators || []}
                editors={page?.editors || []}
                disabled={busy}
              />
            )}
            <Button type="submit" disabled={busy}>
              Save reviewed {draft.action.replaceAll('_', ' ')}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={refreshDraft}>
              Refresh version and keep draft
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                operation.current = null;
                setDraft(null);
              }}
            >
              Cancel draft
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
function ConfigurationEditor({ value, onChange, disabled }) {
  const update = (key, v) => onChange({ ...value, [key]: v });
  return (
    <>
      <p>
        These constraints are reviewed settings. Unknown evidence cannot pass. Compensation uses
        declared currency units; no automatic FX conversion.
      </p>
      {value.requirements.map((r, i) => (
        <fieldset key={r.id} disabled={disabled}>
          <legend>Hard requirement {i + 1}</legend>
          <Field label={`Requirement ${i + 1} type`}>
            <select
              value={r.kind}
              onChange={(e) => {
                const next = {
                  id: r.id,
                  kind: e.target.value,
                  name: '',
                  recencyDays: e.target.value === 'skill' ? 365 : 120,
                  ...(e.target.value === 'skill' ? { level: 'Working' } : {}),
                  ...(e.target.value === 'language'
                    ? { minimum: 'Working' }
                    : ['skill', 'experience', 'notice', 'compensation'].includes(e.target.value)
                      ? { minimum: 0 }
                      : {}),
                };
                update(
                  'requirements',
                  value.requirements.map((x, j) => (j === i ? next : x)),
                );
              }}
            >
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          {Object.entries(r)
            .filter(([k]) => !['id', 'kind'].includes(k))
            .map(([k, v]) => (
              <Field key={k} label={`Requirement ${i + 1} ${k}`}>
                <input
                  required
                  value={v}
                  type={
                    ['minimum', 'recencyDays'].includes(k) && r.kind !== 'language'
                      ? 'number'
                      : 'text'
                  }
                  min="0"
                  maxLength="160"
                  onChange={(e) =>
                    update(
                      'requirements',
                      value.requirements.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value,
                            }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          {r.kind === 'compensation' &&
            ['currency', 'basis']
              .filter((k) => !(k in r))
              .map((k) => (
                <Field key={k} label={`Requirement ${i + 1} ${k}`}>
                  <input
                    required
                    onChange={(e) =>
                      update(
                        'requirements',
                        value.requirements.map((x, j) =>
                          j === i ? { ...x, [k]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              update(
                'requirements',
                value.requirements.filter((_, j) => j !== i),
              )
            }
          >
            Remove requirement {i + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || value.requirements.length >= 40}
        onClick={() =>
          update('requirements', [
            ...value.requirements,
            { id: `r_${crypto.randomUUID().slice(0, 8)}`, kind: 'eligibility', name: '' },
          ])
        }
      >
        Add hard requirement
      </Button>
      {value.kit.map((r, i) => (
        <fieldset key={r.id} disabled={disabled}>
          <legend>Interview criterion {i + 1}</legend>
          {['label', 'weight', 'minScore'].map((k) => (
            <Field key={k} label={`Criterion ${i + 1} ${k}`}>
              <input
                required
                type={k !== 'label' ? 'number' : 'text'}
                step={k !== 'label' ? '0.01' : undefined}
                min={k === 'weight' ? 0.01 : 0}
                max={k !== 'label' ? 100 : undefined}
                value={r[k] ?? 0}
                onChange={(e) =>
                  update(
                    'kit',
                    value.kit.map((x, j) =>
                      j === i
                        ? { ...x, [k]: k !== 'label' ? Number(e.target.value) : e.target.value }
                        : x,
                    ),
                  )
                }
              />
            </Field>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={value.kit.length === 1}
            onClick={() =>
              update(
                'kit',
                value.kit.filter((_, j) => j !== i),
              )
            }
          >
            Remove criterion {i + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || value.kit.length >= 20}
        onClick={() =>
          update('kit', [
            ...value.kit,
            { id: `c_${crypto.randomUUID().slice(0, 8)}`, label: '', weight: 10 },
          ])
        }
      >
        Add interview criterion
      </Button>
      {['threshold', 'assessmentDays', 'reviewers'].map((k) => (
        <Field key={k} label={`Journey ${k}`}>
          <input
            required
            disabled={disabled}
            type="number"
            min="1"
            max={k === 'reviewers' ? 5 : k === 'threshold' ? 100 : 180}
            value={value[k]}
            onChange={(e) => update(k, Number(e.target.value))}
          />
        </Field>
      ))}
      <label>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.requireReadyForSubmission}
          onChange={(e) => update('requireReadyForSubmission', e.target.checked)}
        />
        Require current demand validation before submission or client sharing
      </label>
    </>
  );
}
function ActionFields({ action, value, onChange, evaluators, editors, disabled }) {
  if (action === 'start')
    return (
      <>
        <p>
          Choose the configured number of distinct assessors. Administrators grant candidate
          evaluation access in Users & roles first.
        </p>
        {evaluators.map((e) => (
          <label key={e.assignment}>
            <input
              disabled={disabled}
              type="checkbox"
              checked={value.members.some((m) => m.assignment === e.assignment)}
              onChange={(ev) =>
                onChange({
                  members: ev.target.checked
                    ? [...value.members, { member: e.member, assignment: e.assignment }]
                    : value.members.filter((m) => m.assignment !== e.assignment),
                })
              }
            />
            {e.label}
          </label>
        ))}
        {!evaluators.length && <p>No active assessor grants for this candidate.</p>}
      </>
    );
  return Object.entries(value)
    .filter(([k]) => !['supersedes', 'plan'].includes(k))
    .map(([k, v]) => {
      const set = (next) => onChange({ ...value, [k]: next });
      if (typeof v === 'boolean')
        return (
          <label key={k}>
            <input
              disabled={disabled}
              type="checkbox"
              checked={v}
              onChange={(e) => set(e.target.checked)}
            />
            {k === 'confirmed'
              ? 'I reviewed the source and confirm this evidence'
              : k === 'value'
                ? 'Evidence supports this certification or eligibility'
                : k}
          </label>
        );
      if (k === 'owner')
        return (
          <Field key={k} label="Gap owner">
            <select required disabled={disabled} value={v} onChange={(e) => set(e.target.value)}>
              <option value="">Choose an active owner</option>
              {editors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
        );
      const choices =
        k === 'kind'
          ? ['experience', 'language', 'certification', 'eligibility']
          : k === 'decision'
            ? action === 'debrief'
              ? ['Pass', 'Gap', 'Not-ready', 'Cancelled']
              : ['Ready', 'Near-ready', 'Not-ready', 'Revoked']
            : k === 'value' && value.kind === 'language'
              ? ['Basic', 'Working', 'Fluent']
              : null;
      return (
        <Field key={k} label={`Journey ${k}`}>
          {choices ? (
            <select
              disabled={disabled}
              value={v}
              onChange={(e) => {
                if (k === 'kind')
                  onChange({
                    ...value,
                    kind: e.target.value,
                    value:
                      e.target.value === 'experience'
                        ? 0
                        : e.target.value === 'language'
                          ? 'Working'
                          : false,
                  });
                else set(e.target.value);
              }}
            >
              {choices.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : (
            <input
              required
              disabled={disabled}
              type={
                typeof v === 'number'
                  ? 'number'
                  : ['observed', 'validUntil', 'due', 'readyEstimate'].includes(k)
                    ? 'date'
                    : 'text'
              }
              min={typeof v === 'number' ? 0 : undefined}
              maxLength={['reason', 'evidence'].includes(k) ? 4000 : 2000}
              value={v ?? ''}
              onChange={(e) => set(typeof v === 'number' ? Number(e.target.value) : e.target.value)}
            />
          )}
        </Field>
      );
    });
}
export function AssignedDemandJourney({ rpc = repositoryRead }) {
  const [list, setList] = useState(null),
    [cycle, setCycle] = useState(null),
    [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [draft, setDraft] = useState({ scores: {}, evidence: {} }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const operation = useRef(null),
    epoch = useRef(0),
    draftContext = useRef(null);
  useEffect(() => {
    operation.current = null;
    draftContext.current = null;
  }, [cycle]);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    const generation = ++ref.current;
    setPage(null);
    setList(null);
    setError('');
    setBusy(false);
    async function read() {
      try {
        const v = await rpc('api_assigned_demand_journey', { p_cycle: cycle, p_offset: offset });
        if (active && generation === epoch.current) {
          if (cycle) {
            checkPage(v);
            setPage(v);
            const sameContext = draftContext.current === `${cycle}:${v.head}`;
            draftContext.current = `${cycle}:${v.head}`;
            setDraft((previous) =>
              v.ownEvaluation
                ? { scores: v.ownEvaluation.scores, evidence: v.ownEvaluation.evidence }
                : sameContext
                  ? previous
                  : {
                      scores: Object.fromEntries(v.kit.map((k) => [k.id, ''])),
                      evidence: Object.fromEntries(v.kit.map((k) => [k.id, ''])),
                    },
            );
          } else {
            if (!Array.isArray(v.rows) || v.rows.length > 25 || typeof v.more !== 'boolean')
              throw new Error('Invalid assigned cycle list.');
            setList(v);
          }
        }
      } catch (e) {
        if (active) {
          setPage(null);
          setList(null);
          setError(e.message);
        }
      }
    }
    read();
    const recheck = () => {
      if (active) setRevision((n) => n + 1);
    };
    const timer = setInterval(recheck, 45000);
    window.addEventListener('focus', recheck);
    return () => {
      active = false;
      ref.current++;
      clearInterval(timer);
      window.removeEventListener('focus', recheck);
    };
  }, [rpc, cycle, offset, revision]);
  async function save(e) {
    e.preventDefault();
    const generation = epoch.current;
    operation.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const result = await rpc('api_assigned_demand_journey', {
        p_cycle: cycle,
        p_operation: operation.current,
        p_head: page.head,
        p_payload: {
          scores: Object.fromEntries(Object.entries(draft.scores).map(([k, v]) => [k, Number(v)])),
          evidence: draft.evidence,
        },
      });
      if (generation === epoch.current)
        setPage({ ...page, ownEvaluation: { ...draft, score: result.score } });
    } catch (err) {
      if (generation === epoch.current) setError(err.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="settings-body">
        <h2>Assigned demand assessments</h2>
        <p>
          Submit independently against the frozen interview kit. Other assessors’ feedback is
          hidden.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh assigned demand access
        </Button>
        {list?.rows.map((r) => (
          <article key={r.id}>
            <h3>{r.demand_title}</h3>
            <Button
              type="button"
              onClick={() => {
                setCycle(r.id);
                setOffset(0);
              }}
            >
              Open demand assessment
            </Button>
          </article>
        ))}
        {list && !list.rows.length && <p>No active assigned demand cycles.</p>}
        {cycle && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setCycle(null)}>
            Back to demand assessments
          </Button>
        )}
        {page && (
          <>
            <h3>
              {page.candidate.name} · {page.candidate.anthroId}
            </h3>
            <p>Frozen kit version {page.configurationVersion}</p>
            {page.ownEvaluation && (
              <p>
                Your sealed score: {page.ownEvaluation.score}/100. Reassessment requires a new
                assigned cycle.
              </p>
            )}
            {page.closed && !page.ownEvaluation && <p>This cycle is closed.</p>}
            <form aria-label="Blind demand scorecard" onSubmit={save}>
              {page.kit.map((k) => (
                <fieldset key={k.id} disabled={busy || !!page.ownEvaluation || page.closed}>
                  <legend>
                    {k.label} · weight {k.weight}%
                  </legend>
                  <Field label={`Score ${k.label}`}>
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={draft.scores[k.id] ?? ''}
                      onChange={(e) => {
                        operation.current = null;
                        setDraft({ ...draft, scores: { ...draft.scores, [k.id]: e.target.value } });
                      }}
                    />
                  </Field>
                  <Field label={`Evidence ${k.label}`}>
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      value={draft.evidence[k.id] ?? ''}
                      onChange={(e) => {
                        operation.current = null;
                        setDraft({
                          ...draft,
                          evidence: { ...draft.evidence, [k.id]: e.target.value },
                        });
                      }}
                    />
                  </Field>
                </fieldset>
              ))}
              {!page.ownEvaluation && !page.closed && (
                <Button type="submit" disabled={busy}>
                  Seal independent scorecard
                </Button>
              )}
            </form>
          </>
        )}
        {!cycle && (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((n) => Math.max(0, n - 25))}
            >
              Previous assigned cycles
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!list?.more}
              onClick={() => setOffset((n) => n + 25)}
            >
              Next assigned cycles
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
export function DemandReadinessReport({ demands = [], rpc = repositoryRead, role = getRole() }) {
  const [demand, setDemand] = useState(demands[0]?.id || ''),
    [page, setPage] = useState(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const operation = useRef(null),
    epoch = useRef(0);
  useEffect(() => {
    let active = true;
    const ref = epoch;
    const generation = ++ref.current;
    setPage(null);
    setError('');
    setBusy(false);
    operation.current = null;
    if (demand)
      rpc('api_demand_readiness_report', { p_demand: demand })
        .then((v) => {
          checkPage(v);
          if (
            !Number.isInteger(v.snapshot?.reviewedPopulation) ||
            typeof v.snapshot?.validatedReady !== 'number'
          )
            throw new Error('Invalid readiness report.');
          if (active && generation === epoch.current) setPage(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
      ref.current++;
    };
  }, [demand, rpc, revision]);
  async function exportReport() {
    const generation = epoch.current;
    operation.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const receipt = await rpc('api_export_demand_readiness_report', {
        p_demand: demand,
        p_operation: operation.current,
        p_head: page.head,
      });
      if (
        !receipt?.reportExport ||
        !receipt.receiptId ||
        !receipt.snapshot ||
        !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')
      )
        throw new Error('Report export receipt unavailable.');
      const { downloadFile } = await import('./downloads.js');
      if (generation === epoch.current) {
        downloadFile(
          JSON.stringify(receipt, null, 2),
          'demand-readiness-report.json',
          'application/json',
        );
        operation.current = null;
      }
    } catch (e) {
      if (generation === epoch.current) setError(e.message);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="settings-body">
        <h2>Demand readiness report</h2>
        <p>
          Current demand validation and recorded ECOD events. General profile status is excluded
          from validated-ready counts.
        </p>
        <Field label="Readiness report demand">
          <select value={demand} disabled={busy} onChange={(e) => setDemand(e.target.value)}>
            <option value="">Choose a demand</option>
            {demands.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {d.client}
              </option>
            ))}
          </select>
        </Field>
        {error && <p role="alert">{error}</p>}
        {demand && !page && !error && <p role="status">Computing current readiness…</p>}
        {page && (
          <>
            <p>
              {page.snapshot.validatedReady} validated ready / {page.snapshot.reviewedPopulation}{' '}
              current active unheld candidates.{' '}
              {page.snapshot.bounded ? 'Population limited to the first 1,000 identities.' : ''}
            </p>
            <p>
              {page.snapshot.hardRequirementsSatisfied} have current confirmed evidence satisfying
              the hard requirements available to this role.
            </p>
            <h3>Recorded events in the past 90 days</h3>
            <dl>
              {Object.entries(page.snapshot.cohorts || {})
                .filter(([k]) => !['periodDays', 'coverage'].includes(k))
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k.replaceAll(/([A-Z])/g, ' $1')}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            <p>{page.snapshot.cohorts?.coverage}.</p>
            {canWriteForRole(role) && (
              <Button type="button" disabled={busy} onClick={exportReport}>
                Export audited readiness snapshot
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !demand}
          onClick={() => {
            operation.current = null;
            setRevision((n) => n + 1);
          }}
        >
          Refresh readiness report
        </Button>
      </div>
    </section>
  );
}
