-- Prevent concurrent administrator changes from both passing the last-admin check
-- against the same stale membership count. All role/removal operations for one workspace
-- serialize on its workspace row, then re-read the caller's role and the admin count.
begin;

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
  admin_count integer;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;

  perform 1 from public.workspaces where id = ws for update;
  -- Recheck after waiting for the workspace lock: the caller may have been demoted meanwhile.
  if not exists (
    select 1 from public.memberships
    where user_id = auth.uid() and workspace_id = ws and role = 'admin'
  ) then
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
  if was = 'admin' then
    select count(*)::int into admin_count
      from public.memberships where workspace_id = ws and role = 'admin';
    if admin_count <= 1 then
      return jsonb_build_object('error', 'this workspace would be left without an administrator');
    end if;
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
  admin_count integer;
begin
  if ws is null or not public.is_admin() then
    return jsonb_build_object('error', 'administrator access required');
  end if;

  perform 1 from public.workspaces where id = ws for update;
  -- Recheck after waiting for the workspace lock: the caller may have been demoted meanwhile.
  if not exists (
    select 1 from public.memberships
    where user_id = auth.uid() and workspace_id = ws and role = 'admin'
  ) then
    return jsonb_build_object('error', 'administrator access required');
  end if;

  select m.role, u.email into was, who
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.user_id = p_user and m.workspace_id = ws;
  if was is null then
    return jsonb_build_object('error', 'that person is not a member of this workspace');
  end if;
  if was = 'admin' then
    select count(*)::int into admin_count
      from public.memberships where workspace_id = ws and role = 'admin';
    if admin_count <= 1 then
      return jsonb_build_object('error', 'this workspace would be left without an administrator');
    end if;
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

commit;
