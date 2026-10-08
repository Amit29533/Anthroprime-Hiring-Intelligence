import React, { useEffect, useRef, useState } from 'react';
import { cloud, getRole, getWorkspaceId } from './repository.js';
import { repositoryRead } from './pagedRepository.js';

export default function EnterpriseOperations({
  isCloud = cloud,
  role = getRole(),
  scope = getWorkspaceId(),
  rpc = repositoryRead,
}) {
  if (!isCloud || role !== 'admin') return null;
  return <Console key={scope + ':' + role} rpc={rpc} />;
}
function Console({ rpc }) {
  const [ctx, setCtx] = useState(null),
    [dashboard, setDashboard] = useState(null),
    [tick, setTick] = useState(0);
  const [kind, setKind] = useState('sso'),
    [config, setConfig] = useState({});
  const [accessHistory, setAccessHistory] = useState(null),
    [accessOffset, setAccessOffset] = useState(0),
    [externalAccess, setExternalAccess] = useState({
      idp: 'unresolved',
      sessions: 'unresolved',
      downloads: 'retained',
    });
  const [members, setMembers] = useState(null),
    [memberOffset, setMemberOffset] = useState(0),
    [user, setUser] = useState(''),
    [memberHead, setMemberHead] = useState(''),
    [role, setRole] = useState('viewer'),
    [reason, setReason] = useState('');
  const [cases, setCases] = useState(null),
    [caseOffset, setCaseOffset] = useState(0),
    [caseId, setCaseId] = useState(''),
    [preview, setPreview] = useState(null);
  const [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [detail, setDetail] = useState(null),
    [detailOffset, setDetailOffset] = useState(0);
  const [area, setArea] = useState('external'),
    [outcome, setOutcome] = useState('unknown'),
    [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const live = useRef({ active: false, epoch: 0 });
  useEffect(() => {
    const state = live.current;
    state.active = true;
    return () => {
      state.active = false;
      state.epoch++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const read = (a, off = 0) => rpc('api_enterprise_operations', { p_action: a, p_offset: off });
    Promise.all([
      read('context'),
      read('dashboard'),
      read('members', memberOffset),
      read('cases', caseOffset),
      read('browse', offset),
      read('access-history', accessOffset),
    ])
      .then(([c, d, m, s, p, access]) => {
        if (active) {
          setCtx(c);
          setDashboard(d);
          setMembers(m);
          setCases(s);
          setPage(p);
          setAccessHistory(access);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, tick, offset, memberOffset, caseOffset, accessOffset]);
  const policy = ctx?.policies?.find((p) => p.kind === kind);
  useEffect(() => {
    setConfig(
      policy?.body || {
        kind,
        owner: ctx?.actor || '',
        purpose: '',
        rights: '',
        entitlement: '',
        recovery: '',
        basis: '',
        ...(kind === 'sso' ? { provider: '' } : { retentionDays: '730' }),
      },
    );
  }, [ctx, kind, policy]);
  async function read(action, payload, consume, off = 0) {
    setBusy(true);
    setError('');
    const epoch = live.current.epoch;
    try {
      const v = await rpc('api_enterprise_operations', {
        p_action: action,
        p_payload: payload,
        p_offset: off,
      });
      if (live.current.active && live.current.epoch === epoch) consume(v);
    } catch (e) {
      if (live.current.active && live.current.epoch === epoch) setError(e.message);
    } finally {
      if (live.current.active && live.current.epoch === epoch) setBusy(false);
    }
  }
  async function mutate(request) {
    setBusy(true);
    setError('');
    const epoch = live.current.epoch;
    try {
      const v = await rpc('api_enterprise_operations', request);
      if (!live.current.active || epoch !== live.current.epoch) return;
      setPending(null);
      setNotice(v.status || 'Recorded');
      setPreview(null);
      setDetail(null);
      setMemberHead('');
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
  const write = (a, p, h) =>
    mutate({ p_action: a, p_payload: p, p_head: h, p_operation: crypto.randomUUID() });
  async function reviewMember() {
    setBusy(true);
    setError('');
    const epoch = live.current.epoch;
    try {
      const h = await rpc('api_enterprise_member_head', { p_user: user });
      if (live.current.active && epoch === live.current.epoch) setMemberHead(h);
    } catch (e) {
      if (live.current.active && epoch === live.current.epoch) setError(e.message);
    } finally {
      if (live.current.active && epoch === live.current.epoch) setBusy(false);
    }
  }
  const pages = (off, set, more, label) => (
    <div>
      <button disabled={busy || !!pending || off === 0} onClick={() => set(Math.max(0, off - 25))}>
        Previous {label}
      </button>
      <button disabled={busy || !!pending || !more} onClick={() => set(off + 25)}>
        Next {label}
      </button>
    </div>
  );
  return (
    <section
      className="panel"
      aria-label="Enterprise operation and fulfillment"
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2>Enterprise operation and fulfillment</h2>
      <p>
        Explicit workspace grants, current-access offboarding and reviewed retention plans.
        Destructive execution is disabled. Human copy reports do not prove provider deletion or
        legal fulfillment.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div>
          <p>
            Outcome needs confirmation. Retry the identical operation or refresh before preparing
            another decision.
          </p>
          <button disabled={busy} onClick={() => mutate(pending)}>
            Retry exact enterprise operation
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPending(null);
              setDetail(null);
              setPreview(null);
              setMemberHead('');
              setTick((n) => n + 1);
            }}
          >
            Discard pending controls and refresh
          </button>
        </div>
      )}
      <button disabled={busy || !!pending} onClick={() => setTick((n) => n + 1)}>
        Refresh enterprise status
      </button>
      {ctx?.paused && (
        <p role="alert">
          Recovery lockdown is active. Enterprise policies remain paused after recovery.
        </p>
      )}
      <details>
        <summary>Operating dashboard</summary>
        <p>{dashboard?.notice}</p>
        <p>
          Open subject requests: {dashboard?.cases ?? 'Unavailable'} · Last recorded restore:{' '}
          {dashboard?.restoreEvidence || 'No passing drill recorded'}
        </p>
        <table>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Recorded status</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {['plans', 'delivery', 'google', 'controlled'].flatMap((kind) =>
              Object.entries(dashboard?.[kind] || {}).map(([status, count]) => (
                <tr key={kind + status}>
                  <td>
                    {
                      {
                        plans: 'Fulfillment plans',
                        delivery: 'Delivery sandbox',
                        google: 'Google Workspace',
                        controlled: 'Controlled external workflows',
                      }[kind]
                    }
                  </td>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <p>Status captured: {dashboard?.capturedAt || 'Unavailable'}</p>
      </details>
      <fieldset disabled={busy || !!pending}>
        <legend>Enterprise policy and acceptance</legend>
        <label>
          Enterprise capability
          <select
            aria-label="Enterprise capability"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="sso">SAML workspace access</option>
            <option value="fulfillment">Retention and fulfillment</option>
          </select>
        </label>
        <p>{policy ? `${policy.state} · generation ${policy.generation}` : 'Not configured'}</p>
        <details>
          <summary>Policy evidence and configuration</summary>
          {Object.keys(config)
            .filter((k) => k !== 'kind')
            .map((k) => (
              <label key={k}>
                Policy {k}
                <input
                  aria-label={`Enterprise policy ${k}`}
                  value={config[k] || ''}
                  maxLength={1000}
                  onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
                />
              </label>
            ))}
          <button
            onClick={() =>
              write('configure', { ...config, kind }, policy?.head || ctx?.defaultHead)
            }
          >
            Save enterprise policy
          </button>
        </details>
        <p>
          Acceptance requires current matching backup/restore drill evidence. SSO also needs a
          non-SSO administrator and configured project entitlement.
        </p>
        {['accept', 'enable', 'pause', 'revoke'].map((a) => (
          <button key={a} disabled={!policy} onClick={() => write(a, { kind }, policy.head)}>
            {a} enterprise policy
          </button>
        ))}
      </fieldset>
      <fieldset disabled={busy || !!pending}>
        <legend>Workspace access and offboarding</legend>
        <p>
          SSO uses an exact verified Auth identity and a reviewed nonadministrator role. Domains and
          email invitations never grant SSO access. IdP access and global sessions require separate
          offboarding reconciliation.
        </p>
        {members?.rows?.map((m) => (
          <p key={m.user_id}>
            <button
              onClick={() => {
                setUser(m.user_id);
                setMemberHead('');
              }}
            >
              {m.email} · {m.role}
            </button>{' '}
            {m.provider ? 'Managed SSO' : 'Existing workspace member'}
          </p>
        ))}
        {pages(memberOffset, setMemberOffset, members?.more, 'members')}
        <label>
          Exact Auth user UUID
          <input
            aria-label="Enterprise user UUID"
            value={user}
            maxLength={36}
            onChange={(e) => {
              setUser(e.target.value);
              setMemberHead('');
            }}
          />
        </label>
        <label>
          Reviewed role
          <select
            aria-label="Enterprise grant role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setMemberHead('');
            }}
          >
            {['viewer', 'recruiter', 'assessor', 'sales'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Access review reason
          <input
            aria-label="Enterprise member reason"
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setMemberHead('');
            }}
          />
        </label>
        <button disabled={!user || reason.trim().length < 20} onClick={reviewMember}>
          Review current membership
        </button>
        <button
          disabled={!memberHead}
          onClick={() => write('grant', { user, role, reason }, memberHead)}
        >
          Grant reviewed SSO workspace access
        </button>
        <button
          disabled={!memberHead}
          onClick={() => write('offboard', { user, reason }, memberHead)}
        >
          Offboard reviewed workspace member
        </button>
        <details>
          <summary>Offboarding history and external limitations</summary>
          {accessHistory?.rows?.map((r) => (
            <p key={r.id}>
              <button
                onClick={() => {
                  setUser(r.body.user);
                  setMemberHead('');
                }}
              >
                {r.action} · {r.body.user}
              </button>{' '}
              · {r.body.reason} · {r.result.status}
            </p>
          ))}
          {pages(accessOffset, setAccessOffset, accessHistory?.more, 'access history')}
          {['idp', 'sessions', 'downloads'].map((field) => (
            <label key={field}>
              External {field}
              <select
                aria-label={`Enterprise external ${field}`}
                value={externalAccess[field]}
                onChange={(e) => {
                  setExternalAccess({ ...externalAccess, [field]: e.target.value });
                  setMemberHead('');
                }}
              >
                {['unresolved', 'reported_revoked', 'retained'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
          <p>
            Select the revoked user, record the follow-up evidence above and review the current
            membership before reporting. Reports do not revoke an IdP account or verify
            global-session/download deletion.
          </p>
          <button
            disabled={!memberHead}
            onClick={() =>
              write('offboard-report', { user, reason, ...externalAccess }, memberHead)
            }
          >
            Record human offboarding reconciliation
          </button>
        </details>
      </fieldset>
      <fieldset disabled={busy || !!pending}>
        <legend>Verified case and exact retention scope</legend>
        {cases?.rows?.map((c) => (
          <p key={c.id}>
            <button
              onClick={() => {
                setCaseId(c.id);
                setPreview(null);
              }}
            >
              {c.kind} · {c.status} · {c.id}
            </button>
          </p>
        ))}
        {pages(caseOffset, setCaseOffset, cases?.more, 'cases')}
        <label>
          Subject request case UUID
          <input
            aria-label="Enterprise case UUID"
            value={caseId}
            maxLength={36}
            onChange={(e) => {
              setCaseId(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <button disabled={!caseId} onClick={() => read('preview', { case: caseId }, setPreview)}>
          Preview current retention scope
        </button>
        {preview && (
          <>
            <p>
              Processing hold: {String(preview.processingHold)} · document holds:{' '}
              {preview.documentHolds?.length || 0}. All local records are preserved.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview, null, 2)}</pre>
            <button onClick={() => write('prepare', { case: caseId }, preview.head)}>
              Prepare exact fulfillment plan
            </button>
          </>
        )}
      </fieldset>
      <fieldset disabled={busy || !!pending}>
        <legend>Retained plans and reconciliation</legend>
        {page?.rows?.map((p) => (
          <p key={p.id}>
            <button
              onClick={() => {
                setDetailOffset(0);
                read('detail', { id: p.id }, setDetail);
              }}
            >
              {p.status} · {p.id}
            </button>
          </p>
        ))}
        {pages(offset, setOffset, page?.more, 'plans')}
        {detail && (
          <>
            <h3>{detail.plan.status}</h3>
            <p>
              Plan {detail.plan.id} · candidate {detail.plan.candidate_id} · policy generation{' '}
              {detail.plan.generation}
            </p>
            <details>
              <summary>Frozen approved source</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(detail.plan.source, null, 2)}
              </pre>
            </details>
            <label>
              Reconciliation evidence
              <textarea
                aria-label="Enterprise reconciliation evidence"
                value={evidence}
                maxLength={1000}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </label>
            {detail.plan.status === 'Prepared' && (
              <button
                disabled={detail.plan.actor === ctx?.actor || evidence.trim().length < 20}
                onClick={() => write('approve', { id: detail.plan.id, evidence }, detail.head)}
              >
                Approve independently reviewed exact scope
              </button>
            )}
            {detail.plan.status === 'Approved' && (
              <>
                <label>
                  Scoped area
                  <select
                    aria-label="Enterprise reconciliation area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                  >
                    {[
                      ...(detail.plan.source.inventory?.counts || [])
                        .filter((x) => x.count > 0)
                        .map((x) => x.category),
                      'objects',
                      'external',
                      'backups',
                      'unlinked',
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Human outcome
                  <select
                    aria-label="Enterprise reconciliation outcome"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                  >
                    {['unknown', 'retained', 'excluded', 'reported_removed', 'not_applicable'].map(
                      (x) => (
                        <option key={x}>{x}</option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  disabled={evidence.trim().length < 20}
                  onClick={() =>
                    write('record', { id: detail.plan.id, area, outcome, evidence }, detail.head)
                  }
                >
                  Record human copy reconciliation
                </button>
                <button onClick={() => write('complete', { id: detail.plan.id }, detail.head)}>
                  Finish reconciliation with limitations
                </button>
              </>
            )}
            {['Prepared', 'Approved'].includes(detail.plan.status) && (
              <button onClick={() => write('cancel', { id: detail.plan.id }, detail.head)}>
                Cancel plan without deletion
              </button>
            )}
            {detail.rows.map((d) => (
              <p key={d.id}>
                {d.area} · {d.outcome} · {d.evidence}
              </p>
            ))}
            <button
              disabled={detailOffset === 0}
              onClick={() => {
                const n = Math.max(0, detailOffset - 25);
                setDetailOffset(n);
                read('detail', { id: detail.plan.id }, setDetail, n);
              }}
            >
              Previous receipts
            </button>
            <button
              disabled={!detail.more}
              onClick={() => {
                const n = detailOffset + 25;
                setDetailOffset(n);
                read('detail', { id: detail.plan.id }, setDetail, n);
              }}
            >
              Next receipts
            </button>
          </>
        )}
      </fieldset>
    </section>
  );
}
