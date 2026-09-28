-- Batch 16: client and contact records (Zoho Recruit area C, blueprint §4.2 "Client and business
-- unit" and §12 "Tenant/client boundaries"). Until now a demand carried only a free-text `client`
-- string, so two demands for the same account could not be rolled up, and no contact person could
-- be stored, reused on a submission or audited.
--
-- Design notes:
--  * `clients` and `clientContacts` are ordinary workspace-scoped tables: same RLS shape, same
--    record_change() audit trigger and same touch_updated_column() feed stamp as every other table.
--  * `demands."clientId"` is a nullable FK. The legacy `demands.client` text column is retained and
--    kept authoritative for display so existing rows, imports and the careers portal keep working;
--    linking is an opt-in upgrade rather than a destructive migration.
--  * `submissions."contactId"` lets a recruiter point a submission at a real contact record while
--    the existing free-text `clientContact` column stays as the fallback and historical record.
--  * Commercial fields that belong to the client relationship are NOT placed here: internal cost
--    and margin remain admin-only in "demandCommercials" (migration 004), so this table adds no new
--    route to restricted figures.
begin;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  industry text not null default '',
  location text not null default '',
  website text not null default '',
  owner text not null default '',
  status text not null default 'Active' check (status in ('Prospect', 'Active', 'On hold', 'Dormant')),
  tier text not null default 'Standard' check (tier in ('Strategic', 'Key', 'Standard')),
  "paymentTerms" text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id)
);
-- One account record per name per workspace: the whole point is rollup, so silent duplicates
-- would defeat it. Case- and whitespace-insensitive, matching the candidate email/phone pattern.
create unique index if not exists clients_name_unique
  on public.clients (workspace_id, lower(btrim(name)));
create index if not exists clients_workspace on public.clients (workspace_id, status);

create table if not exists public."clientContacts" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  "clientId" uuid not null,
  name text not null check (length(btrim(name)) > 0),
  title text not null default '',
  email text not null default '',
  phone text not null default '',
  "isPrimary" boolean not null default false,
  "decisionMaker" boolean not null default false,
  notes text not null default '',
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id),
  -- A contact must be reachable somehow, mirroring the candidates table's contact check.
  check (btrim(email) <> '' or btrim(phone) <> ''),
  foreign key (workspace_id, "clientId") references public.clients (workspace_id, id) on delete cascade
);
create index if not exists client_contacts_client on public."clientContacts" (workspace_id, "clientId");
-- At most one primary contact per client, enforced in the database rather than in the UI.
create unique index if not exists client_contacts_one_primary
  on public."clientContacts" (workspace_id, "clientId") where "isPrimary";

alter table public.demands add column if not exists "clientId" uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'demands_client_fk' and conrelid = 'public.demands'::regclass
  ) then
    -- The SET NULL column list is essential: without it a composite FK nulls *every*
    -- referencing column, which would blank the demand's workspace_id and orphan the row.
    alter table public.demands
      add constraint demands_client_fk foreign key (workspace_id, "clientId")
      references public.clients (workspace_id, id) on delete set null ("clientId");
  end if;
end $$;
create index if not exists demands_client on public.demands (workspace_id, "clientId");

alter table public.submissions add column if not exists "contactId" uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_contact_fk' and conrelid = 'public.submissions'::regclass
  ) then
    -- Same reasoning as demands_client_fk: only the link column may be cleared.
    alter table public.submissions
      add constraint submissions_contact_fk foreign key (workspace_id, "contactId")
      references public."clientContacts" (workspace_id, id) on delete set null ("contactId");
  end if;
end $$;

do $$
declare tbl text;
begin
  foreach tbl in array array['clients','clientContacts'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from anon', tbl);
    execute format('grant select,insert,update,delete on public.%I to authenticated', tbl);
    execute format('drop policy if exists workspace_read on public.%I', tbl);
    execute format('drop policy if exists workspace_read on public.%I',tbl);
    execute format('create policy workspace_read on public.%I for select to authenticated using (workspace_id=public.current_workspace())', tbl);
    execute format('drop policy if exists workspace_insert on public.%I', tbl);
    execute format('drop policy if exists workspace_insert on public.%I',tbl);
    execute format('create policy workspace_insert on public.%I for insert to authenticated with check (public.can_edit_workspace(workspace_id))', tbl);
    execute format('drop policy if exists workspace_update on public.%I', tbl);
    execute format('drop policy if exists workspace_update on public.%I',tbl);
    execute format('create policy workspace_update on public.%I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))', tbl);
    -- Deleting an account is destructive and cascades to its contacts, so it is admin-only.
    execute format('drop policy if exists workspace_delete on public.%I', tbl);
    execute format('drop policy if exists workspace_delete on public.%I',tbl);
    execute format('create policy workspace_delete on public.%I for delete to authenticated using (public.is_admin() and workspace_id=public.current_workspace())', tbl);
    execute format('drop trigger if exists track_change on public.%I', tbl);
    execute format('drop trigger if exists track_change on public.%I',tbl);
    execute format('create trigger track_change after insert or update on public.%I for each row execute function public.record_change()', tbl);
    execute format('drop trigger if exists touch_updated_column on public.%I', tbl);
    execute format('drop trigger if exists touch_updated_column on public.%I',tbl);
    execute format('create trigger touch_updated_column before update on public.%I for each row execute function public.touch_updated_column()', tbl);
  end loop;
end $$;

-- Extend both incremental-sync RPCs (blueprint §14) so the new tables travel with every other
-- workspace table. The projections drop workspace_id exactly like migration 017 does.
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
  -- Reuse the page RPC's projection for the two new tables and merge them into the existing
  -- payload, so this migration never has to restate the other twenty-two table queries.
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
    'clientContacts', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."clientContacts" c where c.workspace_id=ws and (c.created>=day or c.updated::date>=day) order by c.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
