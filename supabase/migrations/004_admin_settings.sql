-- ECOD blueprint R1 batch 3. Apply AFTER 001, 002 and 003.
-- Adds: workspace settings (pipeline stage labels, retention policy) editable by admins and
-- readable by every member, and demand commercials (internal cost/margin data) restricted to
-- the admin role at the database level — Blueprint §4.2 and §12 field-level security.
begin;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.memberships where user_id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public."demandCommercials" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "demandId" uuid not null, "internalCost" numeric, currency text not null default 'INR',
 notes text not null default '', updated timestamptz not null default now(),
 unique(workspace_id,"demandId"),
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id)
);

create table if not exists public."settings" (
 id text not null, workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 custom jsonb not null default '{}', updated timestamptz not null default now(),
 unique(workspace_id,id)
);

alter table public."demandCommercials" enable row level security;
revoke all on public."demandCommercials" from anon;
revoke all on public."demandCommercials" from authenticated;
grant select,insert,update on public."demandCommercials" to authenticated;
create policy commercials_admin_all on public."demandCommercials" for all to authenticated
 using (public.is_admin()) with check (public.is_admin());

alter table public."settings" enable row level security;
revoke all on public."settings" from anon;
revoke delete on public."settings" from authenticated;
grant select,insert,update on public."settings" to authenticated;
create policy settings_read on public."settings" for select to authenticated using (workspace_id=public.current_workspace());
create policy settings_write on public."settings" for insert to authenticated with check (public.is_admin());
create policy settings_update on public."settings" for update to authenticated using (public.is_admin()) with check (public.is_admin());
commit;
