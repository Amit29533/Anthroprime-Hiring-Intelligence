-- Batch 18: requisition approval and departments (Zoho Recruit B2 and B3, blueprint §4.2).
--
-- Two gaps closed together because they are the same conversation: a demand is a *requisition*
-- that somebody in a department asked for and somebody with budget authority signed off.
--
--  * `departments` are reusable records replacing the free-text `demands."businessUnit"` string.
--    As with clients in migration 020, the text column is retained and stays authoritative for
--    display; `departmentId` is a nullable opt-in link, so nothing breaks for existing rows.
--
--  * Requisition approval mirrors the offer-approval design proved in migrations 013/014, and for
--    the same reason: a gate that only exists in the UI is not a gate. Approval is admin-only,
--    stamped server-side, and bound to a snapshot of the exact requisition terms that were
--    reviewed. Changing a material term afterwards withdraws the approval rather than silently
--    carrying it over — so "approved" always means "approved as it now reads".
--
--  * The gate is opt-in per workspace (`settings.custom->>'requisitionApprovals'`), exactly like
--    offer approvals, so existing workspaces keep working unchanged until an admin turns it on.
--    When it is on, an unapproved requisition cannot be published to the public careers page.
begin;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  head text not null default '',
  "costCentre" text not null default '',
  notes text not null default '',
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index if not exists departments_name_unique
  on public.departments (workspace_id, lower(btrim(name)));

alter table public.departments enable row level security;
revoke all on public.departments from anon;
revoke delete on public.departments from authenticated;
grant select, insert, update on public.departments to authenticated;
drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select to authenticated
  using (workspace_id = public.current_workspace());
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='demands' and column_name='departmentId') then
    alter table public.demands add column "departmentId" uuid;
    -- The SET NULL column list matters: a bare composite FK would null workspace_id too.
    alter table public.demands
      add constraint demands_department_fk foreign key (workspace_id, "departmentId")
      references public.departments (workspace_id, id) on delete set null ("departmentId");
  end if;
end $$;
create index if not exists demands_department on public.demands (workspace_id, "departmentId");

-- Requisition approval state.
alter table public.demands add column if not exists "approvalStatus" text not null default 'Draft';
alter table public.demands add column if not exists "approvalNote" text not null default '';
alter table public.demands add column if not exists "approvedBy" text not null default '';
alter table public.demands add column if not exists "approvedAt" timestamptz;
alter table public.demands add column if not exists "approvedTerms" jsonb;
alter table public.demands add column if not exists "submittedForApprovalAt" timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demands_approval_status_check') then
    alter table public.demands add constraint demands_approval_status_check
      check ("approvalStatus" in ('Draft', 'Pending approval', 'Approved', 'Rejected'));
  end if;
end $$;

-- The material terms of a requisition: what an approver is actually signing off. Headcount,
-- money, seniority and where the work happens. Cosmetic edits (description, tags, weights) do
-- not invalidate an approval; these do.
create or replace function public.demand_requisition_terms(d public.demands)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'title', d.title,
    'client', d.client,
    'clientId', d."clientId",
    'departmentId', d."departmentId",
    'positions', d.positions,
    'budget', d.budget,
    'location', d.location,
    'mode', d.mode,
    'engagementType', d."engagementType",
    'minExperience', d."minExperience"
  );
$$;

create or replace function public.demands_requisition_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gate_on boolean;
  user_is_admin boolean := public.is_admin();
  terms jsonb := public.demand_requisition_terms(new);
  decided boolean;
  actor text;
begin
  select coalesce((custom->>'requisitionApprovals')::boolean, false) into gate_on
    from public."settings"
   where workspace_id = coalesce(new.workspace_id, public.current_workspace())
     and id = 'workspace';
  gate_on := coalesce(gate_on, false);

  decided := new."approvalStatus" in ('Approved', 'Rejected');

  if tg_op = 'UPDATE' then
    -- A material change to an approved requisition withdraws the approval. Rejecting the edit
    -- instead would leave a recruiter unable to correct a typo in the headcount; withdrawing is
    -- both recoverable and honest about what "Approved" means.
    if old."approvalStatus" = 'Approved'
       and terms is distinct from public.demand_requisition_terms(old)
       and new."approvalStatus" = old."approvalStatus" then
      new."approvalStatus" := 'Draft';
      new."approvedAt" := null;
      new."approvedBy" := '';
      new."approvedTerms" := null;
      new."approvalNote" := 'Approval withdrawn automatically: the requisition terms changed.';
      new."careersVisible" := false;
      decided := false;
    end if;

    -- Only an admin may decide a requisition, and only on a request that is not their own edit
    -- of the decision fields by hand.
    if decided and (old."approvalStatus" is distinct from new."approvalStatus") and not user_is_admin then
      raise exception 'Only a workspace admin can approve or reject a requisition';
    end if;
    if not user_is_admin and (
         (new."approvedAt" is distinct from old."approvedAt" and new."approvedAt" is not null)
      or (new."approvedTerms" is distinct from old."approvedTerms" and new."approvedTerms" is not null)
    ) then
      raise exception 'Only a workspace admin can set requisition approval fields';
    end if;
  else
    if decided and not user_is_admin then
      raise exception 'Only a workspace admin can approve or reject a requisition';
    end if;
  end if;

  -- Stamps are server-generated. A client can ask for a decision; it cannot author the evidence.
  if new."approvalStatus" = 'Approved' then
    select u.email into actor from auth.users u where u.id = auth.uid();
    new."approvedAt" := coalesce(new."approvedAt", now());
    new."approvedBy" := coalesce(nullif(actor, ''), auth.uid()::text, 'Admin');
    new."approvedTerms" := terms;
  elsif new."approvalStatus" <> 'Approved' then
    new."approvedAt" := null;
    new."approvedTerms" := null;
    if new."approvalStatus" <> 'Rejected' then
      new."approvedBy" := '';
    end if;
  end if;

  if new."approvalStatus" = 'Pending approval'
     and (tg_op = 'INSERT' or old."approvalStatus" is distinct from 'Pending approval') then
    new."submittedForApprovalAt" := now();
  end if;

  -- The publishing gate. Only enforced when the workspace has opted in, so nothing changes for
  -- workspaces that do not run an approval process.
  if gate_on and new."careersVisible" and new."approvalStatus" <> 'Approved' then
    raise exception 'This workspace requires requisition approval before a role can be published';
  end if;

  return new;
end;
$$;

drop trigger if exists demands_requisition_gate on public.demands;
drop trigger if exists demands_requisition_gate on public.demands;
create trigger demands_requisition_gate
  before insert or update on public.demands
  for each row execute function public.demands_requisition_gate();

-- Departments follow the standard audit/stamp shape.
drop trigger if exists track_change on public.departments;
drop trigger if exists track_change on public.departments;
create trigger track_change after insert or update on public.departments
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public.departments;
drop trigger if exists touch_updated_column on public.departments;
create trigger touch_updated_column before update on public.departments
  for each row execute function public.touch_updated_column();

-- Extend both incremental-sync RPCs (blueprint §14) so departments travel with every other
-- workspace table. The demands projection is `d.*`, so the new approval columns come along
-- without any further change.
create or replace function public.api_changes_page_has_more(day date, row_offset integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    (select 1 from public.candidates c where c.workspace_id=public.current_workspace() and (c.created>=day or c.verified>=day or exists(select 1 from public.history h where h.workspace_id=c.workspace_id and h."entityType"='candidates' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.demands d where d.workspace_id=public.current_workspace() and (d.created>=day or exists(select 1 from public.history h where h.workspace_id=d.workspace_id and h."entityType"='demands' and h."entityId"=d.id and h.date::date>=day)) order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.considerations c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated>=day or exists(select 1 from public.history h where h.workspace_id=c.workspace_id and h."entityType"='considerations' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.assessments a where a.workspace_id=public.current_workspace() and (a.date>=day or exists(select 1 from public.history h where h.workspace_id=a.workspace_id and h."entityType"='assessments' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.notes n where n.workspace_id=public.current_workspace() and (n.date>=day or exists(select 1 from public.history h where h.workspace_id=n.workspace_id and h."entityType"='notes' and h."entityId"=n.id and h.date::date>=day)) order by n.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.enrichment e where e.workspace_id=public.current_workspace() and (e.created>=day or e.due>=day or exists(select 1 from public.history h where h.workspace_id=e.workspace_id and h."entityType"='enrichment' and h."entityId"=e.id and h.date::date>=day)) order by e.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.history h where h.workspace_id=public.current_workspace() and h.date::date>=day order by h.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."employmentHistory" e where e.workspace_id=public.current_workspace() and (e.created::date>=day or e.verified>=day) order by e.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."compensationHistory" c where c.workspace_id=public.current_workspace() and c.verified>=day order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."availabilityHistory" a where a.workspace_id=public.current_workspace() and a.captured>=day order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."auditEvents" a where a.workspace_id=public.current_workspace() and a.date::date>=day order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."documents" d where d.workspace_id=public.current_workspace() and (d.uploaded::date>=day or d.updated::date>=day) order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."taxonomy" x where x.workspace_id=public.current_workspace() and x.updated::date>=day order by x.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."demandCommercials" d where public.is_admin() and d.workspace_id=public.current_workspace() and d.updated::date>=day order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."settings" s where s.workspace_id=public.current_workspace() and s.updated::date>=day order by s.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."consents" c where c.workspace_id=public.current_workspace() and (c.date::date>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.interviews i where i.workspace_id=public.current_workspace() and (i."scheduledAt"::date>=day or i.created::date>=day or (i.completed is not null and i.completed::date>=day) or exists(select 1 from public.history h where h.workspace_id=i.workspace_id and h."entityType"='interviews' and h."entityId"=i.id and h.date::date>=day)) order by i.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.offers o where o.workspace_id=public.current_workspace() and (o.created::date>=day or o."sentDate"::date>=day or (o."decidedDate" is not null and o."decidedDate"::date>=day) or (o."approvedAt" is not null and o."approvedAt"::date>=day) or exists(select 1 from public.history h where h.workspace_id=o.workspace_id and h."entityType"='offers' and h."entityId"=o.id and h.date::date>=day)) order by o.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.tasks t where t.workspace_id=public.current_workspace() and (t.created::date>=day or t.due>=day or exists(select 1 from public.history h where h.workspace_id=t.workspace_id and h."entityType"='tasks' and h."entityId"=t.id and h.date::date>=day)) order by t.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.submissions s where s.workspace_id=public.current_workspace() and (s."submittedOn">=day or exists(select 1 from public.history h where h.workspace_id=s.workspace_id and h."entityType"='submissions' and h."entityId"=s.id and h.date::date>=day)) order by s.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."publicApplications" a where a.workspace_id=public.current_workspace() and (a.created::date>=day or exists(select 1 from public.history h where h.workspace_id=a.workspace_id and h."entityType"='publicApplications' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."workflowRules" r where r.workspace_id=public.current_workspace() and (r.created::date>=day or r.updated::date>=day) order by r.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.clients c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."clientContacts" c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.departments d where d.workspace_id=public.current_workspace() and (d.created>=day or d.updated::date>=day) order by d.id limit 1 offset greatest(row_offset,0))
  );
$$;
revoke all on function public.api_changes_page_has_more(date,integer) from public, anon;
grant execute on function public.api_changes_page_has_more(date,integer) to authenticated;

create or replace function public.api_changes_since(day date default current_date - 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  base jsonb;
begin
  if ws is null then
    return jsonb_build_object('error', 'no workspace membership');
  end if;
  -- Delegates to the page RPC so there is exactly one place where the table list lives.
  base := public.api_changes_page(day, 0, 1000000);
  return base - 'block' - 'size' - 'next';
end;
$$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;

create or replace function public.api_changes_page(day date default current_date - 30, page_block int default 0, page_size int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  off integer := greatest(page_block, 0) * greatest(page_size, 1);
  lim integer := greatest(page_size, 1);
begin
  if ws is null then
    return jsonb_build_object('error', 'no workspace membership');
  end if;
  return jsonb_build_object(
    'since', day, 'block', page_block, 'size', page_size,
    'next', public.api_changes_page_has_more(day, off + lim),
    'candidates', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.candidates c where c.workspace_id=ws and (c.created>=day or c.verified>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='candidates' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit lim offset off) t),
    'demands', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public.demands d where d.workspace_id=ws and (d.created>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='demands' and h."entityId"=d.id and h.date::date>=day)) order by d.id limit lim offset off) t),
    'considerations', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.considerations c where c.workspace_id=ws and (c.created>=day or c.updated>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='considerations' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit lim offset off) t),
    'assessments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public.assessments a where a.workspace_id=ws and (a.date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='assessments' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit lim offset off) t),
    'notes', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select n.* from public.notes n where n.workspace_id=ws and (n.date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='notes' and h."entityId"=n.id and h.date::date>=day)) order by n.id limit lim offset off) t),
    'enrichment', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public.enrichment e where e.workspace_id=ws and (e.created>=day or e.due>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='enrichment' and h."entityId"=e.id and h.date::date>=day)) order by e.id limit lim offset off) t),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select h.id,h."entityId",h."entityType",h.action,h.date,h.actor from public.history h where h.workspace_id=ws and h.date::date>=day order by h.id limit lim offset off) t),
    'employmentHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public."employmentHistory" e where e.workspace_id=ws and (e.created::date>=day or e.verified>=day) order by e.id limit lim offset off) t),
    'compensationHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."compensationHistory" c where c.workspace_id=ws and c.verified>=day order by c.id limit lim offset off) t),
    'availabilityHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."availabilityHistory" a where a.workspace_id=ws and a.captured>=day order by a.id limit lim offset off) t),
    'auditEvents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."auditEvents" a where a.workspace_id=ws and a.date::date>=day order by a.id limit lim offset off) t),
    'documents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.id,d.workspace_id,d."candidateId",d.kind,d.name,d.mime,d.size,d.version,d.hash,d."parserStatus",d.removed,d.uploaded,d.updated from public."documents" d where d.workspace_id=ws and (d.uploaded::date>=day or d.updated::date>=day) order by d.id limit lim offset off) t),
    'taxonomy', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select x.* from public."taxonomy" x where x.workspace_id=ws and x.updated::date>=day order by x.id limit lim offset off) t),
    'demandCommercials', case when public.is_admin() then (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public."demandCommercials" d where d.workspace_id=ws and d.updated::date>=day order by d.id limit lim offset off) t) else '[]'::jsonb end,
    'settings', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public."settings" s where s.workspace_id=ws and s.updated::date>=day order by s.id limit lim offset off) t),
    'consents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."consents" c where c.workspace_id=ws and (c.date::date>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'interviews', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select i.* from public.interviews i where i.workspace_id=ws and (i."scheduledAt"::date>=day or i.created::date>=day or (i.completed is not null and i.completed::date>=day) or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='interviews' and h."entityId"=i.id and h.date::date>=day)) order by i.id limit lim offset off) t),
    'offers', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select o.id,o.workspace_id,o."candidateId",o."demandId",o.role,o.location,o.ctc,o.joining,o.status,o."sentDate",o."decidedDate",o.notes,o.created,o."approvedAt",o."approvedBy",o."approvedTerms" from public.offers o where o.workspace_id=ws and (o.created::date>=day or o."sentDate"::date>=day or (o."decidedDate" is not null and o."decidedDate"::date>=day) or (o."approvedAt" is not null and o."approvedAt"::date>=day) or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='offers' and h."entityId"=o.id and h.date::date>=day)) order by o.id limit lim offset off) t),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select t.* from public.tasks t where t.workspace_id=ws and (t.created::date>=day or t.due>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='tasks' and h."entityId"=t.id and h.date::date>=day)) order by t.id limit lim offset off) t),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public.submissions s where s.workspace_id=ws and (s."submittedOn">=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='submissions' and h."entityId"=s.id and h.date::date>=day)) order by s.id limit lim offset off) t),
    'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."publicApplications" a where a.workspace_id=ws and (a.created::date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='publicApplications' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit lim offset off) t),
    'workflowRules', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public."workflowRules" r where r.workspace_id=ws and (r.created::date>=day or r.updated::date>=day) order by r.id limit lim offset off) t),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.clients c where c.workspace_id=ws and (c.created>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'clientContacts', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."clientContacts" c where c.workspace_id=ws and (c.created>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'departments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public.departments d where d.workspace_id=ws and (d.created>=day or d.updated::date>=day) order by d.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
