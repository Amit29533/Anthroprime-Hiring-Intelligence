-- Complete blueprint §14 incremental sync coverage for every workspace repository table.
-- Earlier feed revisions omitted enrichment/history tables, consent/taxonomy/settings changes,
-- demand commercials, audit events and workflow rules. Mutable auxiliary rows now carry an
-- updated timestamp, and both RPCs use the same complete per-table filter and projection.
begin;

-- Tables without a write timestamp need one so edits (not only inserts) enter the feed.
alter table public."documents" add column if not exists updated timestamptz not null default now();
alter table public."consents" add column if not exists updated timestamptz not null default now();
alter table public."workflowRules" add column if not exists updated timestamptz not null default now();

create or replace function public.touch_updated_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated := now();
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['documents','consents','taxonomy','demandCommercials','settings','workflowRules'] loop
    execute format('drop trigger if exists touch_updated_column on public.%I', tbl);
    execute format('create trigger touch_updated_column before update on public.%I for each row execute function public.touch_updated_column()', tbl);
  end loop;
end;
$$;

-- The client exposes consideration.stage as an automation trigger; keep the cloud constraint
-- in lockstep so a rule saved from the UI is legal in Supabase too.
do $$
declare
  con record;
begin
  for con in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public."workflowRules"'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%triggerTable%'
  loop
    execute format('alter table public."workflowRules" drop constraint %I', con.conname);
  end loop;
end;
$$;
alter table public."workflowRules"
  add constraint workflow_rules_trigger_table_check
  check ("triggerTable" in ('candidates','demands','offers','interviews','considerations'));

-- Internal commercial figures remain admin-only even though this RPC runs as SECURITY DEFINER.
create or replace function public.api_changes_since(day date default current_date - 30)
returns jsonb
language plpgsql
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
    'since', day,
    'candidates', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select c.* from public.candidates c
       where c.workspace_id=ws and (c.created>=day or c.verified>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='candidates' and h."entityId"=c.id and h.date::date>=day))
       order by c.id) t),
    'demands', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select d.* from public.demands d
       where d.workspace_id=ws and (d.created>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='demands' and h."entityId"=d.id and h.date::date>=day))
       order by d.id) t),
    'considerations', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select c.* from public.considerations c
       where c.workspace_id=ws and (c.created>=day or c.updated>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='considerations' and h."entityId"=c.id and h.date::date>=day))
       order by c.id) t),
    'assessments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select a.* from public.assessments a
       where a.workspace_id=ws and (a.date>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='assessments' and h."entityId"=a.id and h.date::date>=day))
       order by a.id) t),
    'notes', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select n.* from public.notes n
       where n.workspace_id=ws and (n.date>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='notes' and h."entityId"=n.id and h.date::date>=day))
       order by n.id) t),
    'enrichment', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select e.* from public.enrichment e
       where e.workspace_id=ws and (e.created>=day or e.due>=day or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='enrichment' and h."entityId"=e.id and h.date::date>=day))
       order by e.id) t),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select h.id,h."entityId",h."entityType",h.action,h.date,h.actor
        from public.history h where h.workspace_id=ws and h.date::date>=day order by h.id) t),
    'employmentHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select e.* from public."employmentHistory" e where e.workspace_id=ws and (e.created::date>=day or e.verified>=day) order by e.id) t),
    'compensationHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select c.* from public."compensationHistory" c where c.workspace_id=ws and c.verified>=day order by c.id) t),
    'availabilityHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select a.* from public."availabilityHistory" a where a.workspace_id=ws and a.captured>=day order by a.id) t),
    'auditEvents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select a.* from public."auditEvents" a where a.workspace_id=ws and a.date::date>=day order by a.id) t),
    'documents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select d.id,d.workspace_id,d."candidateId",d.kind,d.name,d.mime,d.size,d.version,d.hash,d."parserStatus",d.removed,d.uploaded,d.updated
        from public."documents" d where d.workspace_id=ws and (d.uploaded::date>=day or d.updated::date>=day) order by d.id) t),
    'taxonomy', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select x.* from public."taxonomy" x where x.workspace_id=ws and x.updated::date>=day order by x.id) t),
    'demandCommercials', case when public.is_admin() then
      (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
        select d.* from public."demandCommercials" d where d.workspace_id=ws and d.updated::date>=day order by d.id) t)
      else '[]'::jsonb end,
    'settings', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select s.* from public."settings" s where s.workspace_id=ws and s.updated::date>=day order by s.id) t),
    'consents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select c.* from public."consents" c where c.workspace_id=ws and (c.date::date>=day or c.updated::date>=day) order by c.id) t),
    'interviews', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select i.* from public.interviews i
       where i.workspace_id=ws and (i."scheduledAt"::date>=day or i.created::date>=day or (i.completed is not null and i.completed::date>=day) or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='interviews' and h."entityId"=i.id and h.date::date>=day))
       order by i.id) t),
    'offers', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select o.id,o.workspace_id,o."candidateId",o."demandId",o.role,o.location,o.ctc,o.joining,o.status,o."sentDate",o."decidedDate",o.notes,o.created,o."approvedAt",o."approvedBy",o."approvedTerms"
        from public.offers o
       where o.workspace_id=ws and (o.created::date>=day or o."sentDate"::date>=day or (o."decidedDate" is not null and o."decidedDate"::date>=day) or (o."approvedAt" is not null and o."approvedAt"::date>=day) or exists(
         select 1 from public.history h where h.workspace_id=ws and h."entityType"='offers' and h."entityId"=o.id and h.date::date>=day))
       order by o.id) t),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select t.* from public.tasks t where t.workspace_id=ws and (t.created::date>=day or t.due>=day or exists(
        select 1 from public.history h where h.workspace_id=ws and h."entityType"='tasks' and h."entityId"=t.id and h.date::date>=day)) order by t.id) t),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select s.* from public.submissions s where s.workspace_id=ws and (s."submittedOn">=day or exists(
        select 1 from public.history h where h.workspace_id=ws and h."entityType"='submissions' and h."entityId"=s.id and h.date::date>=day)) order by s.id) t),
    'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select a.* from public."publicApplications" a where a.workspace_id=ws and (a.created::date>=day or exists(
        select 1 from public.history h where h.workspace_id=ws and h."entityType"='publicApplications' and h."entityId"=a.id and h.date::date>=day)) order by a.id) t),
    'workflowRules', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (
      select r.* from public."workflowRules" r where r.workspace_id=ws and (r.created::date>=day or r.updated::date>=day) order by r.id) t)
  );
end;
$$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;

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
  );
$$;
revoke all on function public.api_changes_page_has_more(date,integer) from public, anon;
grant execute on function public.api_changes_page_has_more(date,integer) to authenticated;

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
    'workflowRules', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public."workflowRules" r where r.workspace_id=ws and (r.created::date>=day or r.updated::date>=day) order by r.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;
commit;
