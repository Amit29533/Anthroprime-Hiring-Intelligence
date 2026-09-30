import React, { useState } from 'react';
import { Plus, UserPlus, Gift, TrendingUp, ShieldCheck, ArrowRight } from 'lucide-react';
import {
  PageHeader,
  PanelHeading,
  Button,
  Field,
  Modal,
  Badge,
  Empty,
  SearchBox,
  Stat,
} from './ui.jsx';
import { uid, today } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import {
  REFERRAL_STATUSES,
  REFERRER_TYPES,
  REWARD_STATUSES,
  STATUS_TONE,
  REWARD_TONE,
  blankReferral,
  validateReferral,
  referralList,
  referralTotals,
  referrerLeaderboard,
  existingCandidateFor,
  convertReferral,
} from './referrals.js';

export function ReferralForm({ referral, data, onClose, onSave, busy }) {
  const [form, setForm] = useState(referral || blankReferral());
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const openRoles = (data.demands || []).filter((d) => d.status === 'Open');

  async function submit(e) {
    e.preventDefault();
    const found = validateReferral(form, data.referrals, referral?.id || null);
    setErrors(found);
    if (Object.keys(found).length) return;
    const row = {
      ...form,
      referrerName: form.referrerName.trim(),
      referrerEmail: form.referrerEmail.trim().toLowerCase(),
      refereeName: form.refereeName.trim(),
      refereeEmail: form.refereeEmail.trim().toLowerCase(),
      demandId: form.demandId || null,
      id: referral?.id || uid(),
      created: referral?.created || today(),
    };
    if (!(await onSave('referrals', [row]))) return;
    onClose();
  }

  return (
    <Modal
      title={referral ? `Referral — ${referral.refereeName}` : 'Record a referral'}
      subtitle="The person being referred has not applied. Their details are held only so we can make contact."
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={submit}>
        <h3 className="member-subheading">Who is referring</h3>
        <div className="form-grid">
          <Field label="Referrer name" hint={errors.referrerName}>
            <input
              value={form.referrerName}
              onChange={set('referrerName')}
              aria-invalid={!!errors.referrerName}
            />
          </Field>
          <Field label="Referrer email" hint={errors.referrerEmail}>
            <input
              value={form.referrerEmail}
              onChange={set('referrerEmail')}
              aria-invalid={!!errors.referrerEmail}
            />
          </Field>
          <Field label="Referrer type">
            <select value={form.referrerType} onChange={set('referrerType')}>
              {REFERRER_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Relationship">
            <input
              value={form.relationship}
              onChange={set('relationship')}
              placeholder="Former colleague"
            />
          </Field>
        </div>

        <h3 className="member-subheading">Who is being referred</h3>
        <div className="form-grid">
          <Field label="Name" hint={errors.refereeName}>
            <input
              value={form.refereeName}
              onChange={set('refereeName')}
              aria-invalid={!!errors.refereeName}
            />
          </Field>
          <Field label="Email" hint={errors.refereeEmail}>
            <input
              value={form.refereeEmail}
              onChange={set('refereeEmail')}
              aria-invalid={!!errors.refereeEmail}
            />
          </Field>
          <Field label="Phone">
            <input value={form.refereePhone} onChange={set('refereePhone')} />
          </Field>
          <Field label="LinkedIn">
            <input value={form.refereeLinkedin} onChange={set('refereeLinkedin')} />
          </Field>
          <Field label="Role">
            <select value={form.demandId || ''} onChange={set('demandId')}>
              <option value="">No specific role</option>
              {openRoles.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} — {d.client}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={set('status')}>
              {REFERRAL_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Reward">
            <select value={form.rewardStatus} onChange={set('rewardStatus')}>
              {REWARD_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Reward note" hint="Recorded only — no payment is made from here.">
            <input value={form.rewardNote} onChange={set('rewardNote')} />
          </Field>
          <Field label="Why they would be a fit" wide>
            <textarea rows={2} value={form.note} onChange={set('note')} />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {referral ? 'Save referral' : 'Record referral'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Converting is deliberate: the recruiter states the consent basis, and it is written down. */
export function ConvertReferralModal({ referral, data, onClose, onSave, audit, notify, busy }) {
  const [basis, setBasis] = useState('Referrer confirmed the person is happy to be contacted');
  const clash = existingCandidateFor(data, referral);

  async function submit(e) {
    e.preventDefault();
    const { candidate, consent, referral: updated } = convertReferral(referral, { basis });
    if (!(await onSave('candidates', [candidate]))) return;
    if (!(await onSave('consents', [consent]))) return;
    if (!(await onSave('referrals', [updated]))) return;
    audit?.({
      entityType: 'referrals',
      entityId: referral.id,
      action: 'converted',
      detail: `${referral.refereeName} added as a candidate — basis: ${basis}`,
    });
    notify?.(`${referral.refereeName} is now a candidate.`);
    onClose();
  }

  return (
    <Modal
      title={`Add ${referral.refereeName} as a candidate`}
      subtitle="A referred person never consented to a profile. Record why it is lawful to create one."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        {clash && (
          <div className="constraint-warning">
            <strong>Already in the repository.</strong> {clash.name} has the same email address.
            Converting will create a second profile — consider opening the existing one instead.
          </div>
        )}
        <Field label="Consent basis" hint="Written to the consent ledger with this profile.">
          <textarea rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} />
        </Field>
        <p className="supporting-text">
          <ShieldCheck size={13} /> The profile is created as <strong>Sourced</strong> with source{' '}
          <strong>Referral</strong>, and a contact consent record is written at the same moment.
        </p>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !basis.trim()}>
            Create candidate
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Referrals({
  data,
  onNew,
  onEdit,
  onConvert,
  onOpenCandidate,
  busy,
  role = getRole(),
  initialQuery = '',
}) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState('All');
  const [reward, setReward] = useState('All');
  const canEdit = canWriteForRole(role);
  const rows = referralList(data, { query, status, reward });
  const totals = referralTotals(data);
  const leaders = referrerLeaderboard(data);

  return (
    <>
      <PageHeader
        eyebrow="REFERRALS"
        title="The best hires usually come from someone you know."
        description="Referrals from employees, clients and partners — tracked from introduction to reward."
      >
        {canEdit && (
          <Button icon={Plus} onClick={onNew}>
            Record referral
          </Button>
        )}
      </PageHeader>

      <div className="stats-grid">
        <Stat
          label="Referrals"
          value={totals.total}
          detail={`${totals.open} open`}
          icon={UserPlus}
        />
        <Stat
          label="Hired"
          value={totals.hired}
          detail={
            totals.hireRate === null ? 'None resolved yet' : `${totals.hireRate}% of resolved`
          }
          icon={TrendingUp}
          tone="green"
        />
        <Stat
          label="Awaiting reward"
          value={totals.awaitingReward}
          detail="Pending or approved"
          icon={Gift}
          tone={totals.awaitingReward ? 'amber' : 'teal'}
        />
        <Stat
          label="Not yet contacted"
          value={totals.unconverted}
          detail="Open, no profile created"
          icon={ArrowRight}
          tone={totals.unconverted ? 'amber' : 'teal'}
        />
      </div>

      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search people or referrers…" />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option>All</option>
            {REFERRAL_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Filter by reward"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
          >
            <option>All</option>
            {REWARD_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {rows.length === 0 ? (
          <Empty
            title="No referrals yet"
            text="Record one here, or let people refer from the careers page — every referral lands in this list."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Referred person</th>
                  <th>Referred by</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Reward</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const demand = (data.demands || []).find((d) => d.id === r.demandId);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.refereeName}</strong>
                        <small className="block muted">
                          {r.refereeEmail ||
                            r.refereePhone ||
                            r.refereeLinkedin ||
                            'No contact recorded'}
                        </small>
                      </td>
                      <td>
                        {r.referrerName}
                        <small className="block muted">
                          {r.referrerType}
                          {r.relationship ? ` · ${r.relationship}` : ''}
                        </small>
                      </td>
                      <td>{demand ? demand.title : <small className="muted">Any role</small>}</td>
                      <td>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      </td>
                      <td>
                        <Badge tone={REWARD_TONE[r.rewardStatus]}>{r.rewardStatus}</Badge>
                      </td>
                      <td>
                        <span className="member-actions">
                          {r.candidateId ? (
                            <Button
                              variant="secondary"
                              onClick={() => onOpenCandidate(r.candidateId)}
                            >
                              Open profile
                            </Button>
                          ) : (
                            canEdit && (
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() => onConvert(r)}
                              >
                                Add as candidate
                              </Button>
                            )
                          )}
                          {canEdit && (
                            <Button variant="secondary" onClick={() => onEdit(r)}>
                              Edit
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {leaders.length > 0 && (
        <section className="panel">
          <PanelHeading
            title="Who refers well"
            subtitle="A hire rate needs at least three referrals before it means anything."
          />
          <ul className="client-list">
            {leaders.slice(0, 8).map((l) => (
              <li key={l.email || l.name}>
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.type}
                    {l.email ? ` · ${l.email}` : ''} · {l.total} referral
                    {l.total === 1 ? '' : 's'} · {l.inPipeline} in pipeline
                  </small>
                </div>
                <span className="member-actions">
                  {l.rewardsPending > 0 && (
                    <Badge tone="amber">{l.rewardsPending} reward due</Badge>
                  )}
                  <Badge tone={l.hired ? 'green' : 'gray'}>{l.hired} hired</Badge>
                  {l.hireRate !== null && <Badge tone="blue">{l.hireRate}%</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
