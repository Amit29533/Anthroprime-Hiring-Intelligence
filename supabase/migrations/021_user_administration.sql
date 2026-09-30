-- Batch 17: user and role administration (Zoho Recruit M2/M3, blueprint §12 "Authorization:
-- RBAC. Suggested roles: Admin, Recruiter, Assessor, Sales/Account, Read-only" and §16 "Admin can
-- determine who viewed/exported/edited sensitive candidate information").
--
-- Until now a workspace membership could only be created by hand in the Supabase SQL editor, and
-- nothing in the product could list who had access or change a role. That made the RBAC model real
-- in the database but unmanageable in the product, and role changes left no audit trail.
--
-- Design notes:
--  * Memberships stay locked down at the table level: migration 001 revoked insert/update/delete
--    from `authenticated` and that is unchanged. All mutation happens through SECURITY DEFINER
--    RPCs that re-check `is_admin()` themselves, so a compromised client cannot escalate by
--    writing to the table directly.
--  * Every RPC writes an auditEvents row. Role changes and access removals are exactly the events
--    §12 asks to be auditable.
--  * A last-admin guard is enforced in the database. Locking every administrator out of a
--    workspace is unrecoverable without Supabase console access, so it is refused at the source
--    rather than only in the UI.
--  * Invites are deliberately NOT added to the incremental sync feed or to the client's bulk table
--    load. They are administrative records holding the email addresses of staff — not repository
--    data — and belong with `memberships`, which is likewise excluded. They are read on demand
--    through an admin-only RPC.
begin;

create table if not exists public."workspaceInvites" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  email text not null check (length(btrim(email)) > 0 and position('@' in email) > 1),
  role text not null check (role in ('admin', 'recruiter', 'viewer')) default 'recruiter',
  "invitedBy" text not null default '',
  created timestamptz not null default now(),
  "acceptedAt" timestamptz,
  "acceptedBy" uuid
);
-- One outstanding invite per address per workspace; accepted invites are kept as history.
create unique index if not exists workspace_invites_pending
  on public."workspaceInvites" (workspace_id, lower(btrim(email)))
  where "acceptedAt" is null;
create index if not exists workspace_invites_email
  on public."workspaceInvites" (lower(btrim(email))) where "acceptedAt" is null;

alter table public."workspaceInvites" enable row level security;
revoke all on public."workspaceInvites" from anon, authenticated;
-- No direct table grants at all: the RPCs below are the only route in or out.

-- Helper: how many administrators does a workspace still have?
create or replace function public.workspace_admin_count(ws uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.memberships where workspace_id = ws and role = 'admin';
$$;
revoke all on function public.workspace_admin_count(uuid) from public, anon;
grant execute on function public.workspace_admin_count(uuid) to authenticated;

-- A readable actor label for audit rows: the signed-in user's email, not a bare uuid.
create or replace function public.current_actor_label()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.email from auth.users u where u.id = auth.uid()), 'System administrator');
$$;
revoke all on function public.current_actor_label() from public, anon;
grant execute on function public.current_actor_label() to authenticated;

-- Who has access to my workspace? Visible to every member: colleagues are not a secret, and a
-- recruiter needs to know who to ask for an admin action. Only identity and role are returned.
create or replace function public.api_workspace_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
begin
  if ws is null then
    return jsonb_build_object('error', 'no workspace membership');
  end if;
  return jsonb_build_object(
    'workspace', ws,
    'isAdmin', public.is_admin(),
    'adminCount', public.workspace_admin_count(ws),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'email', u.email,
        'role', m.role,
        'isSelf', m.user_id = auth.uid()
      ) order by m.role, u.email), '[]'::jsonb)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.workspace_id = ws
    )
  );
end;
$$;
revoke all on function public.api_workspace_members() from public, anon;
grant execute on function public.api_workspace_members() to authenticated;

-- Pending invitations are an admin concern only.
create or replace function public.api_workspace_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'email', i.email, 'role', i.role,
      'invitedBy', i."invitedBy", 'created', i.created
    ) order by i.created desc)
    from public."workspaceInvites" i
    where i.workspace_id = ws and i."acceptedAt" is null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.api_workspace_invites() from public, anon;
grant execute on function public.api_workspace_invites() to authenticated;

create or replace function public.api_invite_member(p_email text, p_role text default 'recruiter')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  clean text := lower(btrim(coalesce(p_email, '')));
  invite_id uuid;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;
  if position('@' in clean) < 2 or clean like '% %' then
    return jsonb_build_object('error', 'enter a valid email address');
  end if;
  if p_role is null or p_role not in ('admin', 'recruiter', 'viewer') then
    return jsonb_build_object('error', 'unknown role');
  end if;
  -- Someone who already has access does not need an invitation.
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
     where m.workspace_id = ws and lower(btrim(u.email)) = clean
  ) then
    return jsonb_build_object('error', 'that person is already a member of this workspace');
  end if;

  insert into public."workspaceInvites" (workspace_id, email, role, "invitedBy")
  values (ws, clean, p_role, public.current_actor_label())
  on conflict (workspace_id, lower(btrim(email))) where ("acceptedAt" is null)
  do update set role = excluded.role, "invitedBy" = excluded."invitedBy", created = now()
  returning id into invite_id;

  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (ws, 'membership', invite_id, 'invited',
          format('Invited %s as %s', clean, p_role), public.current_actor_label());

  -- If the person already has an account, grant access immediately rather than making them
  -- sign up again; otherwise the trigger below picks the invite up at sign-up.
  perform public.accept_workspace_invites_for(u.id, u.email)
     from auth.users u where lower(btrim(u.email)) = clean;

  return jsonb_build_object('ok', true, 'id', invite_id, 'email', clean, 'role', p_role);
end;
$$;
revoke all on function public.api_invite_member(text, text) from public, anon;
grant execute on function public.api_invite_member(text, text) to authenticated;

create or replace function public.api_revoke_invite(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  gone text;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;
  delete from public."workspaceInvites"
   where id = p_id and workspace_id = ws and "acceptedAt" is null
   returning email into gone;
  if gone is null then
    return jsonb_build_object('error', 'invitation not found');
  end if;
  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (ws, 'membership', p_id, 'invite revoked',
          format('Revoked the invitation for %s', gone), public.current_actor_label());
  return jsonb_build_object('ok', true, 'email', gone);
end;
$$;
revoke all on function public.api_revoke_invite(uuid) from public, anon;
grant execute on function public.api_revoke_invite(uuid) to authenticated;

create or replace function public.api_set_member_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  was text;
  who text;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;
  if p_role is null or p_role not in ('admin', 'recruiter', 'viewer') then
    return jsonb_build_object('error', 'unknown role');
  end if;
  select m.role, u.email into was, who
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.user_id = p_user and m.workspace_id = ws;
  if was is null then
    return jsonb_build_object('error', 'that person is not a member of this workspace');
  end if;
  if was = p_role then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  -- Removing the final administrator would lock the workspace out of its own settings.
  if was = 'admin' and public.workspace_admin_count(ws) <= 1 then
    return jsonb_build_object('error', 'this workspace would be left without an administrator');
  end if;

  update public.memberships set role = p_role where user_id = p_user and workspace_id = ws;
  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (ws, 'membership', null, 'role changed',
          format('%s changed from %s to %s', who, was, p_role), public.current_actor_label());
  return jsonb_build_object('ok', true, 'email', who, 'from', was, 'to', p_role);
end;
$$;
revoke all on function public.api_set_member_role(uuid, text) from public, anon;
grant execute on function public.api_set_member_role(uuid, text) to authenticated;

create or replace function public.api_remove_member(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  was text;
  who text;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;
  select m.role, u.email into was, who
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.user_id = p_user and m.workspace_id = ws;
  if was is null then
    return jsonb_build_object('error', 'that person is not a member of this workspace');
  end if;
  if was = 'admin' and public.workspace_admin_count(ws) <= 1 then
    return jsonb_build_object('error', 'this workspace would be left without an administrator');
  end if;

  delete from public.memberships where user_id = p_user and workspace_id = ws;
  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (ws, 'membership', null, 'access removed',
          format('Removed %s (%s) from the workspace', who, was), public.current_actor_label());
  return jsonb_build_object('ok', true, 'email', who);
end;
$$;
revoke all on function public.api_remove_member(uuid) from public, anon;
grant execute on function public.api_remove_member(uuid) to authenticated;

-- Redeem any pending invitation for this address. Called at sign-up by the trigger below and
-- directly by api_invite_member when the person already has an account.
create or replace function public.accept_workspace_invites_for(p_user uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed integer := 0;
  invite record;
begin
  if p_user is null or coalesce(btrim(p_email), '') = '' then
    return 0;
  end if;
  -- A membership is one workspace per user (memberships.user_id is the primary key), so the
  -- oldest outstanding invitation wins and the rest stay pending.
  for invite in
    select * from public."workspaceInvites"
     where "acceptedAt" is null and lower(btrim(email)) = lower(btrim(p_email))
     order by created asc
  loop
    exit when exists (select 1 from public.memberships where user_id = p_user);
    insert into public.memberships (user_id, workspace_id, role)
    values (p_user, invite.workspace_id, invite.role)
    on conflict (user_id) do nothing;

    update public."workspaceInvites"
       set "acceptedAt" = now(), "acceptedBy" = p_user
     where id = invite.id;

    insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
    values (invite.workspace_id, 'membership', invite.id, 'invite accepted',
            format('%s joined as %s', lower(btrim(p_email)), invite.role), lower(btrim(p_email)));
    claimed := claimed + 1;
  end loop;
  return claimed;
end;
$$;
revoke all on function public.accept_workspace_invites_for(uuid, text) from public, anon, authenticated;

create or replace function public.claim_workspace_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.accept_workspace_invites_for(new.id, new.email);
  return new;
end;
$$;
revoke all on function public.claim_workspace_invite() from public, anon, authenticated;

-- Sign-up hook. In a hosted Supabase project this statement must be run by the `postgres` role
-- (the SQL editor does so); it is what turns an invitation into access without any service-role
-- key ever reaching the browser.
drop trigger if exists claim_workspace_invite on auth.users;
create trigger claim_workspace_invite
  after insert on auth.users
  for each row execute function public.claim_workspace_invite();

commit;
