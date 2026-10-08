import { AssignmentAdmin } from './AssignedWork.jsx';
import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, ShieldCheck, RefreshCw, Trash2, Info } from 'lucide-react';
import { PanelHeading, Button, Field, Badge } from './ui.jsx';
import { cloud } from './repository.js';
import {
  ROLES,
  ROLE_GUIDE,
  roleLabel,
  validateInvite,
  blockedReason,
  removalBlockedReason,
  orderMembers,
  memberSummary,
  membersApi,
} from './members.js';

const roleTone = { admin: 'green', recruiter: 'blue', viewer: 'gray' };

/**
 * Users & roles administration (blueprint §12). Every action here is a database RPC that
 * re-checks administrator rights server-side; this component only decides what to show and
 * reports whatever the database says back verbatim.
 */
export function Members({ api = membersApi, notify, audit, available = cloud }) {
  const [state, setState] = useState({ members: [], isAdmin: false, adminCount: 0 });
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('recruiter');
  const [formError, setFormError] = useState('');

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    const view = await api.fetchMembers();
    if (view.error) {
      setError(view.error);
      setLoading(false);
      return;
    }
    setError('');
    setState({
      members: view.members || [],
      isAdmin: !!view.isAdmin,
      adminCount: view.adminCount || 0,
    });
    // Invitations are admin-only; a recruiter simply does not get the list.
    if (view.isAdmin) {
      const pending = await api.fetchInvites();
      setInvites(Array.isArray(pending) ? pending : []);
    } else setInvites([]);
    setLoading(false);
  }, [api, available]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Run a mutation, surface the database's own message, and reload the truth. */
  async function run(key, action, describe) {
    setBusy(key);
    const result = await action();
    setBusy('');
    if (result?.error) {
      notify?.(result.error);
      return false;
    }
    notify?.(describe);
    audit?.({ entityType: 'membership', action: 'updated', detail: describe });
    await refresh();
    return true;
  }

  async function submitInvite(e) {
    e.preventDefault();
    const problem = validateInvite(email, role, state.members);
    setFormError(problem);
    if (problem) return;
    const clean = email.trim().toLowerCase();
    if (
      await run(
        'invite',
        () => api.inviteMember(clean, role),
        `Invited ${clean} as ${roleLabel(role)}.`,
      )
    ) {
      setEmail('');
      setRole('recruiter');
    }
  }

  if (!available)
    return (
      <section className="panel">
        <PanelHeading
          title="Users & roles"
          subtitle="Who can reach this workspace, and what they may do."
        />
        <div className="settings-body">
          <p className="supporting-text">
            User administration needs the shared team workspace. The local demo workspace has no
            accounts to manage — every action here runs as an administrator.
          </p>
          {cloud && state.isAdmin && <AssignmentAdmin members={state.members} />}
          <RoleReference />
        </div>
      </section>
    );

  const members = orderMembers(state.members);
  const counts = memberSummary(members);

  return (
    <section className="panel">
      <PanelHeading
        title="Users & roles"
        subtitle="Who can reach this workspace, and what they may do."
        action={
          <Button variant="secondary" icon={RefreshCw} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        }
      />
      <div className="settings-body">
        {error ? (
          <p className="form-error">{error}</p>
        ) : loading ? (
          <p className="supporting-text">Loading workspace members…</p>
        ) : (
          <>
            <p className="supporting-text">
              {counts.total} {counts.total === 1 ? 'person has' : 'people have'} access ·{' '}
              {counts.admin} admin · {counts.recruiter} recruiter · {counts.viewer} viewer ·{' '}
              {counts.assessor} assessor · {counts.sales} sales/account. Role changes and removals
              are recorded in the workspace audit log.
            </p>

            <ul className="member-list">
              {members.map((m) => {
                const refuse = (next) => blockedReason(m, next, state.adminCount);
                const removeRefusal = removalBlockedReason(m, state.adminCount);
                return (
                  <li key={m.userId}>
                    <div>
                      <strong>
                        {m.email} {m.isSelf && <Badge tone="blue">You</Badge>}
                      </strong>
                      <small>{ROLE_GUIDE[m.role]?.summary || 'Unknown role.'}</small>
                    </div>
                    <span className="member-actions">
                      {state.isAdmin ? (
                        <>
                          <label className="member-role">
                            <select
                              aria-label={`Role for ${m.email}`}
                              value={m.role}
                              disabled={busy === m.userId}
                              onChange={(e) => {
                                const next = e.target.value;
                                const stop = refuse(next);
                                if (stop) return notify?.(stop);
                                run(
                                  m.userId,
                                  () => api.setMemberRole(m.userId, next),
                                  `${m.email} is now ${roleLabel(next)}.`,
                                );
                              }}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            variant="secondary"
                            icon={Trash2}
                            disabled={busy === m.userId || !!removeRefusal}
                            title={removeRefusal || `Remove ${m.email} from this workspace`}
                            onClick={() => {
                              if (removeRefusal) return notify?.(removeRefusal);
                              if (
                                !window.confirm(
                                  `Remove ${m.email} from this workspace? They lose access immediately. Records they created are kept.`,
                                )
                              )
                                return;
                              run(
                                m.userId,
                                () => api.removeMember(m.userId),
                                `${m.email} no longer has access.`,
                              );
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      ) : (
                        <Badge tone={roleTone[m.role]}>{roleLabel(m.role)}</Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {state.isAdmin && (
              <>
                <form className="invite-form" onSubmit={submitInvite}>
                  <Field label="Invite by email" hint={formError}>
                    <input
                      type="text"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="colleague@anthroprime.example"
                      aria-invalid={!!formError}
                    />
                  </Field>
                  <Field label="Invitation role">
                    <select
                      aria-label="Invitation role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" icon={UserPlus} disabled={busy === 'invite'}>
                    Send invitation
                  </Button>
                </form>
                <p className="supporting-text">
                  <Info size={13} /> An invitation grants access the moment that address signs in or
                  signs up — this product never sends the email itself, so pass the sign-in link on
                  yourself.
                </p>

                {invites.length > 0 && (
                  <>
                    <h3 className="member-subheading">Pending invitations</h3>
                    <ul className="member-list">
                      {invites.map((i) => (
                        <li key={i.id}>
                          <div>
                            <strong>{i.email}</strong>
                            <small>
                              Invited as {roleLabel(i.role)}
                              {i.invitedBy ? ` by ${i.invitedBy}` : ''}
                            </small>
                          </div>
                          <span className="member-actions">
                            <Badge tone={roleTone[i.role]}>{roleLabel(i.role)}</Badge>
                            <Button
                              variant="secondary"
                              disabled={busy === i.id}
                              onClick={() =>
                                run(
                                  i.id,
                                  () => api.revokeInvite(i.id),
                                  `The invitation for ${i.email} was revoked.`,
                                )
                              }
                            >
                              Revoke
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {!state.isAdmin && (
              <p className="supporting-text">
                <ShieldCheck size={13} /> Only an administrator can invite people or change roles.
              </p>
            )}
            {cloud && state.isAdmin && <AssignmentAdmin members={state.members} />}
            <RoleReference />
          </>
        )}
      </div>
    </section>
  );
}

function RoleReference() {
  return (
    <dl className="role-reference">
      {ROLES.map((r) => (
        <div key={r}>
          <dt>{ROLE_GUIDE[r].label}</dt>
          <dd>
            {ROLE_GUIDE[r].summary} <small>{ROLE_GUIDE[r].detail}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}
