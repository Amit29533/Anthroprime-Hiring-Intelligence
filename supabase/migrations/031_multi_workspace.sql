-- Multiple workspaces per user.
-- Existing accounts retain their current workspace; the first membership becomes the active
-- workspace until the user explicitly switches.
begin;

do $$
begin
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.memberships'::regclass
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (user_id)'
  ) then
    alter table public.memberships drop constraint memberships_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.memberships'::regclass and c.contype = 'p'
  ) then
    alter table public.memberships add primary key (user_id, workspace_id);
  end if;
end $$;

create table if not exists public."userWorkspacePreferences" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  "activeWorkspaceId" uuid not null references public.workspaces(id) on delete cascade,
  updated timestamptz not null default now(),
  foreign key (user_id, "activeWorkspaceId")
    references public.memberships(user_id, workspace_id) on delete cascade
);

insert into public."userWorkspacePreferences" (user_id, "activeWorkspaceId")
select m.user_id, min(m.workspace_id::text)::uuid
from public.memberships m
group by m.user_id
on conflict (user_id) do nothing;

alter table public."userWorkspacePreferences" enable row level security;
revoke all on public."userWorkspacePreferences" from anon, authenticated;

create or replace function public.current_workspace()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p."activeWorkspaceId"
      from public."userWorkspacePreferences" p
      join public.memberships m
        on m.user_id = p.user_id and m.workspace_id = p."activeWorkspaceId"
      where p.user_id = auth.uid()
    ),
    (
      select m.workspace_id
      from public.memberships m
      where m.user_id = auth.uid()
      order by m.workspace_id
      limit 1
    )
  );
$$;
revoke all on function public.current_workspace() from public, anon;
grant execute on function public.current_workspace() to authenticated;

-- Admin rights are scoped to the selected workspace. An administrator in one workspace must not
-- gain administrator privileges in another workspace where they are only a viewer.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.memberships
    where user_id = auth.uid()
      and workspace_id = public.current_workspace()
      and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.api_my_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_id uuid := public.current_workspace();
begin
  return jsonb_build_object(
    'activeWorkspace', active_id,
    'workspaces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id,
        'name', w.name,
        'role', m.role,
        'active', w.id = active_id
      ) order by lower(w.name), w.id), '[]'::jsonb)
      from public.memberships m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = auth.uid()
    )
  );
end;
$$;
revoke all on function public.api_my_workspaces() from public, anon;
grant execute on function public.api_my_workspaces() to authenticated;

create or replace function public.api_switch_workspace(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_name text;
  selected_role text;
begin
  select w.name, m.role into selected_name, selected_role
  from public.memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid() and m.workspace_id = p_workspace;

  if selected_name is null then
    return jsonb_build_object('error', 'workspace access required');
  end if;

  insert into public."userWorkspacePreferences" (user_id, "activeWorkspaceId", updated)
  values (auth.uid(), p_workspace, now())
  on conflict (user_id) do update
    set "activeWorkspaceId" = excluded."activeWorkspaceId", updated = excluded.updated;

  return jsonb_build_object(
    'ok', true, 'id', p_workspace, 'name', selected_name, 'role', selected_role
  );
end;
$$;
revoke all on function public.api_switch_workspace(uuid) from public, anon;
grant execute on function public.api_switch_workspace(uuid) to authenticated;

create or replace function public.api_create_workspace(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(coalesce(p_name, ''));
  new_workspace uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'sign in required');
  end if;
  if length(clean_name) < 2 or length(clean_name) > 80 then
    return jsonb_build_object('error', 'workspace name must be between 2 and 80 characters');
  end if;
  if (select count(*) from public.memberships where user_id = auth.uid()) >= 20 then
    return jsonb_build_object('error', 'workspace limit reached');
  end if;
  if exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and lower(btrim(w.name)) = lower(clean_name)
  ) then
    return jsonb_build_object('error', 'you already have a workspace with that name');
  end if;

  insert into public.workspaces (name) values (clean_name) returning id into new_workspace;
  insert into public.memberships (user_id, workspace_id, role)
  values (auth.uid(), new_workspace, 'admin');
  insert into public."userWorkspacePreferences" (user_id, "activeWorkspaceId", updated)
  values (auth.uid(), new_workspace, now())
  on conflict (user_id) do update
    set "activeWorkspaceId" = excluded."activeWorkspaceId", updated = excluded.updated;

  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (new_workspace, 'workspace', new_workspace, 'workspace created',
          format('Created workspace %s', clean_name), public.current_actor_label());

  return jsonb_build_object(
    'ok', true, 'id', new_workspace, 'name', clean_name, 'role', 'admin'
  );
end;
$$;
revoke all on function public.api_create_workspace(text) from public, anon;
grant execute on function public.api_create_workspace(text) to authenticated;

-- Invitations can now grant access to every invited workspace. Existing memberships remain
-- untouched and the user's current workspace changes only when they choose it.
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

  for invite in
    select * from public."workspaceInvites"
    where "acceptedAt" is null and lower(btrim(email)) = lower(btrim(p_email))
    order by created asc
  loop
    insert into public.memberships (user_id, workspace_id, role)
    values (p_user, invite.workspace_id, invite.role)
    on conflict (user_id, workspace_id) do nothing;

    insert into public."userWorkspacePreferences" (user_id, "activeWorkspaceId")
    values (p_user, invite.workspace_id)
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
revoke all on function public.accept_workspace_invites_for(uuid, text)
  from public, anon, authenticated;

commit;
