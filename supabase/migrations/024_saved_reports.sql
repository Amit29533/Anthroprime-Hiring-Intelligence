-- Batch 20: saved custom reports (Zoho Recruit K2, blueprint §17).
--
-- The Analytics page answers a fixed set of questions well. Anything else meant exporting the
-- whole repository to a spreadsheet — which is exactly the uncontrolled-export behaviour §12 and
-- §16 are trying to discourage. A saved report keeps the question inside the product, where the
-- role model and the audit trail still apply.
--
-- A report stores only a *definition*: which entity, which filters, how to group, what to
-- measure. It never stores results. That matters for three reasons:
--   * a stale cached number is worse than no number;
--   * results would duplicate personal data into a second table with its own retention problem;
--   * a report shared with a colleague must render through *their* permissions, not the author's,
--     so a viewer can never see admin-only commercials by opening somebody else's report.
-- The last point is enforced where the data is read (src/reports.js), because the row-level
-- security that hides `demandCommercials` from non-admins already governs what is in memory.
--
-- Scheduled/emailed reports are deliberately NOT part of this: there is no server-side scheduler
-- in this architecture, and a "schedule" that only runs while somebody has a browser tab open
-- would be a false promise. That remains an Edge Functions task.
begin;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  entity text not null,
  config jsonb not null default '{}',
  owner text not null default '',
  shared boolean not null default true,
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index if not exists reports_name_unique
  on public.reports (workspace_id, lower(btrim(name)));
create index if not exists reports_workspace on public.reports (workspace_id, entity);

alter table public.reports enable row level security;
revoke all on public.reports from anon;
grant select, insert, update, delete on public.reports to authenticated;
create policy reports_read on public.reports for select to authenticated
  using (workspace_id = public.current_workspace());
create policy reports_insert on public.reports for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
create policy reports_update on public.reports for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
-- Unlike repository records, a saved report is disposable metadata: an editor who can create one
-- can delete it. Nothing in the talent repository is lost when a report definition goes away.
create policy reports_delete on public.reports for delete to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

drop trigger if exists track_change on public.reports;
create trigger track_change after insert or update on public.reports
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public.reports;
create trigger touch_updated_column before update on public.reports
  for each row execute function public.touch_updated_column();

-- Extend both incremental-sync RPCs (blueprint §14) so saved reports travel with every other
-- workspace table.
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
    union all (select 1 from public.reports r where r.workspace_id=public.current_workspace() and (r.created>=day or r.updated::date>=day) order by r.id limit 1 offset greatest(row_offset,0))
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
    'departments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public.departments d where d.workspace_id=ws and (d.created>=day or d.updated::date>=day) order by d.id limit lim offset off) t),
    'reports', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public.reports r where r.workspace_id=ws and (r.created>=day or r.updated::date>=day) order by r.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
