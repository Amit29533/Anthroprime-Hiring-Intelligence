begin;

-- Phase 1 after the blueprint audit: a Deployed pipeline label is not a placement record. Keep
-- operational deployment history separate from admin-only commercial outcomes.
do $$
begin
  if not exists(select 1 from pg_constraint where conname='demands_workspace_id_client_unique') then
    alter table public.demands add constraint demands_workspace_id_client_unique
      unique(workspace_id,id,"clientId");
  end if;
  if not exists(select 1 from pg_constraint where conname='considerations_workspace_id_unique') then
    alter table public.considerations add constraint considerations_workspace_id_unique
      unique(workspace_id,id);
  end if;
end $$;

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id) on delete cascade,
  "candidateId" uuid not null,
  "demandId" uuid not null,
  "clientId" uuid not null,
  "considerationId" uuid,
  "offerId" uuid,
  status text not null default 'Planned' check (status in ('Planned','Active','Completed','Terminated','Cancelled')),
  "startDate" date not null,
  "endDate" date,
  "engagementType" text not null default '',
  "workMode" text not null default '',
  location text not null default '',
  recruiter text not null default '',
  notes text not null default '',
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  unique (workspace_id,id),
  foreign key (workspace_id,"candidateId") references public.candidates(workspace_id,id),
  foreign key (workspace_id,"demandId","clientId") references public.demands(workspace_id,id,"clientId"),
  foreign key (workspace_id,"considerationId") references public.considerations(workspace_id,id) on delete set null ("considerationId"),
  foreign key (workspace_id,"offerId") references public.offers(workspace_id,id) on delete set null ("offerId"),
  check ("endDate" is null or "endDate">="startDate")
);
create index if not exists placements_workspace_status on public.placements(workspace_id,status,"startDate");
create unique index if not exists placements_live_candidate_demand
  on public.placements(workspace_id,"candidateId","demandId")
  where status not in ('Terminated','Cancelled');

create table if not exists public."placementCommercials" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id) on delete cascade,
  "placementId" uuid not null,
  "billRate" numeric check ("billRate">=0),
  "costRate" numeric check ("costRate">=0),
  currency text not null default 'INR' check (currency in ('INR','USD','GBP','EUR','AED','SGD')),
  basis text not null default 'Annual' check (basis in ('Annual','Monthly','Daily','Hourly','Fixed')),
  "billedAmount" numeric check ("billedAmount">=0),
  "collectedAmount" numeric check ("collectedAmount">=0),
  notes text not null default '',
  updated timestamptz not null default now(),
  unique (workspace_id,id),
  unique (workspace_id,"placementId"),
  foreign key (workspace_id,"placementId") references public.placements(workspace_id,id) on delete cascade
);

alter table public.placements enable row level security;
revoke all on public.placements from anon;
revoke delete on public.placements from authenticated;
grant select,insert,update on public.placements to authenticated;
drop policy if exists placements_read on public.placements;
create policy placements_read on public.placements for select to authenticated
  using (workspace_id=public.current_workspace());
drop policy if exists placements_insert on public.placements;
create policy placements_insert on public.placements for insert to authenticated
  with check (public.can_edit_workspace(workspace_id));
drop policy if exists placements_update on public.placements;
create policy placements_update on public.placements for update to authenticated
  using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop trigger if exists track_change on public.placements;
create trigger track_change after insert or update on public.placements
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public.placements;
create trigger touch_updated_column before update on public.placements
  for each row execute function public.touch_updated_column();

alter table public."placementCommercials" enable row level security;
revoke all on public."placementCommercials" from anon;
revoke all on public."placementCommercials" from authenticated;
grant select,insert,update on public."placementCommercials" to authenticated;
drop policy if exists placement_commercials_admin on public."placementCommercials";
create policy placement_commercials_admin on public."placementCommercials" for all to authenticated
  using (workspace_id=public.current_workspace() and public.is_admin())
  with check (workspace_id=public.current_workspace() and public.is_admin());
drop trigger if exists track_change on public."placementCommercials";
create trigger track_change after insert or update on public."placementCommercials"
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public."placementCommercials";
create trigger touch_updated_column before update on public."placementCommercials"
  for each row execute function public.touch_updated_column();

-- Preserve the complete batch-26 feed as an internal implementation, then add these tables in a
-- wrapper. This avoids restating thirty-two queries and keeps the migration safely re-runnable.
do $$
begin
  if to_regprocedure('public.api_changes_page_v028(date,integer,integer)') is null then
    alter function public.api_changes_page(date,integer,integer) rename to api_changes_page_v028;
  end if;
  if to_regprocedure('public.api_changes_page_has_more_v028(date,integer)') is null then
    alter function public.api_changes_page_has_more(date,integer) rename to api_changes_page_has_more_v028;
  end if;
end $$;

revoke all on function public.api_changes_page_v028(date,integer,integer) from public,anon,authenticated;
revoke all on function public.api_changes_page_has_more_v028(date,integer) from public,anon,authenticated;

create or replace function public.api_changes_page_has_more(day date, row_offset integer)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.api_changes_page_has_more_v028(day,row_offset)
    or exists(select 1 from public.placements p where p.workspace_id=public.current_workspace()
      and (p.created::date>=day or p.updated::date>=day)
      order by p.id limit 1 offset greatest(row_offset,0))
    or (public.is_admin() and exists(select 1 from public."placementCommercials" c
      where c.workspace_id=public.current_workspace() and c.updated::date>=day
      order by c.id limit 1 offset greatest(row_offset,0)));
$$;
revoke all on function public.api_changes_page_has_more(date,integer) from public,anon;
grant execute on function public.api_changes_page_has_more(date,integer) to authenticated;

create or replace function public.api_changes_page(day date default current_date-30, page_block int default 0, page_size int default 200)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ws uuid := public.current_workspace();
  off integer := greatest(page_block,0)*greatest(page_size,1);
  lim integer := greatest(page_size,1);
  base jsonb;
begin
  if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
  base := public.api_changes_page_v028(day,page_block,page_size);
  return base || jsonb_build_object(
    'next',public.api_changes_page_has_more(day,off+lim),
    'placements',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb)
      from (select p.* from public.placements p where p.workspace_id=ws
        and (p.created::date>=day or p.updated::date>=day) order by p.id limit lim offset off) t),
    'placementCommercials',case when public.is_admin() then
      (select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb)
       from (select c.* from public."placementCommercials" c where c.workspace_id=ws
         and c.updated::date>=day order by c.id limit lim offset off) t)
      else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public,anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
