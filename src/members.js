// Workspace user administration — blueprint §12 ("Authorization: RBAC") and Zoho Recruit's
// Users & Roles admin screen. Every mutation in this module is a thin call to a SECURITY DEFINER
// RPC that re-checks administrator rights in the database; nothing here is a security boundary.
// The client-side guards exist so the UI can explain a refusal before making the round trip.
import { cloud, getSupabase } from './repository.js';

export const ROLES = ['admin', 'recruiter', 'viewer'];

/** What each role may do, shown in the admin UI so an assignment is an informed choice. */
export const ROLE_GUIDE = {
  admin: {
    label: 'Admin',
    summary: 'Full access, including workspace settings, user administration and commercials.',
    detail:
      'Sees internal cost and margin, manages the taxonomy, retention and automation rules, and can anonymise or export records.',
  },
  recruiter: {
    label: 'Recruiter',
    summary: 'Day-to-day recruiting: create and edit candidates, demands, interviews and offers.',
    detail: 'Cannot see internal commercials, manage users, or change workspace-level settings.',
  },
  viewer: {
    label: 'Viewer',
    summary: 'Read-only access to the repository.',
    detail:
      'Editing, restore and export controls are hidden, and the database rejects writes. Treat this as a reporting seat, not a confidentiality control — anything visible on screen can be copied.',
  },
};

export const roleLabel = (role) => ROLE_GUIDE[role]?.label || role || 'Unknown';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors api_invite_member's validation so the UI can refuse before the round trip. */
export function validateInvite(email, role, members = []) {
  const clean = String(email || '')
    .trim()
    .toLowerCase();
  if (!clean) return 'Enter the email address to invite.';
  if (!EMAIL.test(clean)) return 'Enter a valid email address.';
  if (!ROLES.includes(role)) return 'Choose a role for the invitation.';
  if (
    members.some(
      (m) =>
        String(m.email || '')
          .trim()
          .toLowerCase() === clean,
    )
  )
    return 'That person is already a member of this workspace.';
  return '';
}

/**
 * Mirrors the database's last-administrator guard. Returns a reason string when the change must
 * be refused, or '' when it is allowed. The database enforces this too — this copy only lets the
 * UI disable the control and say why.
 */
export function blockedReason(member, nextRole, adminCount) {
  if (!member) return 'That person is no longer a member of this workspace.';
  if (member.role === 'admin' && nextRole !== 'admin' && adminCount <= 1)
    return 'This is the last administrator. Promote somebody else first.';
  return '';
}

export const removalBlockedReason = (member, adminCount) =>
  blockedReason(member, 'removed', adminCount);

/** Sort for display: admins first, then by email, with the signed-in user pinned to the top. */
export function orderMembers(members = []) {
  const rank = { admin: 0, recruiter: 1, viewer: 2 };
  return [...members].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const byRole = (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
    return byRole || String(a.email || '').localeCompare(String(b.email || ''));
  });
}

/** Headline counts for the panel. */
export function memberSummary(members = []) {
  const counts = { admin: 0, recruiter: 0, viewer: 0 };
  for (const m of members) if (counts[m.role] !== undefined) counts[m.role] += 1;
  return { total: members.length, ...counts };
}

/**
 * RPC plumbing. Each call returns `{ error }` rather than throwing so the panel can show the
 * database's own refusal text — which is the authoritative one — instead of inventing a message.
 */
async function rpc(name, args = undefined) {
  if (!cloud)
    return {
      error:
        'User administration needs the shared team workspace. The local demo has no accounts to manage.',
    };
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { error: error.message };
    return data ?? {};
  } catch (e) {
    return { error: e.message || 'The request could not be completed.' };
  }
}

export const fetchMembers = () => rpc('api_workspace_members');
export const fetchInvites = () => rpc('api_workspace_invites');
export const inviteMember = (email, role) =>
  rpc('api_invite_member', {
    p_email: String(email || '')
      .trim()
      .toLowerCase(),
    p_role: role,
  });
export const revokeInvite = (id) => rpc('api_revoke_invite', { p_id: id });
export const setMemberRole = (userId, role) =>
  rpc('api_set_member_role', { p_user: userId, p_role: role });
export const removeMember = (userId) => rpc('api_remove_member', { p_user: userId });

/** The API surface the panel consumes, so tests can inject a stub. */
export const membersApi = {
  fetchMembers,
  fetchInvites,
  inviteMember,
  revokeInvite,
  setMemberRole,
  removeMember,
};
