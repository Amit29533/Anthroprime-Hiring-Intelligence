-- Harden the public careers surface: publish roles explicitly, return a safe workspace-scoped
-- projection, and enforce application consent and role eligibility at the database boundary.
begin;

alter table public.demands
  add column if not exists "careersVisible" boolean not null default false;

-- The original anonymous SELECT grant exposed every column on every open demand, including
-- internal budgets and other workspaces' rows. Public callers must use the curated RPC below.
drop policy if exists demands_public_read on public.demands;
revoke select on public.demands from anon, public;

-- Dropped first: migration 023 widens this function's return type, and a
-- `create or replace` cannot change one. Without this, re-running the chain fails here.
drop function if exists public.api_public_open_roles(uuid);
create or replace function public.api_public_open_roles(p_workspace uuid)
returns table (
  id uuid,
  title text,
  client text,
  location text,
  mode text,
  "engagementType" text,
  positions integer,
  description text,
  skills text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.title, d.client, d.location, d.mode, d."engagementType",
         d.positions, d.description, d.skills
  from public.demands d
  where d.workspace_id = p_workspace
    and d.status = 'Open'
    and d."careersVisible" is true
  order by d.created desc, d.id;
$$;
revoke all on function public.api_public_open_roles(uuid) from public;
grant execute on function public.api_public_open_roles(uuid) to anon, authenticated;

-- Keep the email-based, no-account status feature inside the workspace named by the careers URL.
-- The former one-argument RPC aggregated matching applications across every workspace.
drop function if exists public.api_public_application_status(text);
-- Dropped first: this function's return type changes later in the chain, and a
-- `create or replace` cannot change one. Without this, re-running the chain fails here.
drop function if exists public.api_public_application_status(uuid, text);
create or replace function public.api_public_application_status(p_workspace uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ref', left(a.id::text, 8),
    'role', coalesce(d.title, 'General application'),
    'location', d.location,
    'status', a.status,
    'submittedOn', to_char(a.created, 'YYYY-MM-DD')
  ) order by a.created desc), '[]'::jsonb)
  from public."publicApplications" a
  left join public.demands d on d.workspace_id = a.workspace_id and d.id = a."demandId"
  where p_workspace is not null
    and a.workspace_id = p_workspace
    and p_email is not null
    and lower(btrim(p_email)) = lower(btrim(a.email));
$$;
revoke all on function public.api_public_application_status(uuid, text) from public;
grant execute on function public.api_public_application_status(uuid, text) to anon, authenticated;

-- Direct RPC calls receive the same consent and role checks as the browser form. Applications
-- can only target an explicitly published role which is still open in the supplied workspace.
-- Dropped first: this function's return type changes later in the chain, and a
-- `create or replace` cannot change one. Without this, re-running the chain fails here.
drop function if exists public.api_public_apply(uuid, jsonb);
create or replace function public.api_public_apply(ws uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_id uuid;
  role_id uuid;
begin
  if payload is null
     or coalesce(trim(payload->>'name'), '') = ''
     or coalesce(trim(payload->>'email'), '') = '' then
    raise exception 'name and email are required';
  end if;
  if payload->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address';
  end if;
  if not coalesce((payload->>'consentContact')::boolean, false) then
    raise exception 'consent to contact is required';
  end if;

  if not exists (select 1 from public.workspaces w where w.id = ws) then
    raise exception 'unknown workspace';
  end if;

  begin
    role_id := nullif(payload->>'demandId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'select an open role';
  end;
  if role_id is null then
    raise exception 'select an open role';
  end if;
  if not exists (
    select 1
    from public.demands d
    where d.id = role_id
      and d.workspace_id = ws
      and d.status = 'Open'
      and d."careersVisible" is true
  ) then
    raise exception 'role is no longer accepting applications';
  end if;

  insert into public."publicApplications"(
    workspace_id, "demandId", name, email, phone, linkedin, message,
    "consentContact", "consentSharing"
  )
  values (
    ws, role_id, trim(payload->>'name'), lower(trim(payload->>'email')),
    coalesce(trim(payload->>'phone'), ''), coalesce(trim(payload->>'linkedin'), ''),
    coalesce(payload->>'message', ''), true,
    coalesce((payload->>'consentSharing')::boolean, false)
  )
  returning id into app_id;
  return app_id;
end;
$$;
revoke all on function public.api_public_apply(uuid, jsonb) from public;
grant execute on function public.api_public_apply(uuid, jsonb) to anon, authenticated;

commit;
