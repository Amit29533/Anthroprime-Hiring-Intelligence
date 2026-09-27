-- Batch 10: workspace automation rules (evaluated in the app, stored here) and a public
-- application-status lookup for candidates (Zoho candidate-portal "track status" groundwork).
create table if not exists public."workflowRules" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null,
  "triggerTable" text not null check("triggerTable" in ('candidates','demands','offers','interviews')),
  "triggerField" text not null default 'stage',
  op text not null default 'eq' check(op in ('eq','neq','changed')),
  value text not null default '',
  actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created timestamptz not null default now(),
  unique(workspace_id,id)
);
create index if not exists workflow_rules_ws on public."workflowRules"(workspace_id,enabled);
alter table public."workflowRules" enable row level security;
drop policy if exists workflow_rules_read on public."workflowRules";
create policy workflow_rules_read on public."workflowRules" for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists workflow_rules_write on public."workflowRules";
create policy workflow_rules_write on public."workflowRules" for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists workflow_rules_update on public."workflowRules";
create policy workflow_rules_update on public."workflowRules" for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop policy if exists workflow_rules_delete on public."workflowRules";
create policy workflow_rules_delete on public."workflowRules" for delete to authenticated using (public.can_edit_workspace(workspace_id));
grant select,insert,update,delete on public."workflowRules" to authenticated;

-- Candidate-facing status check: exact-email match returns minimal, non-sensitive fields
-- (short reference, role, location, status, date). No contact details or free-text answers.
create or replace function public.api_public_application_status(p_email text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ref', left(a.id::text, 8),
    'role', coalesce(d.title, 'General application'),
    'location', d.location,
    'status', a.status,
    'submittedOn', to_char(a.created, 'YYYY-MM-DD')
  ) order by a.created desc), '[]'::jsonb)
  from public."publicApplications" a
  left join public.demands d on d.id = a."demandId"
  where p_email is not null and lower(btrim(p_email)) = lower(btrim(a.email));
$$;
revoke all on function public.api_public_application_status(text) from public;
grant execute on function public.api_public_application_status(text) to anon, authenticated;
