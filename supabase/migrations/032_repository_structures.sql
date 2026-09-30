begin;

-- Blueprint §§8–9: reusable assessments and hand-curated talent communities.
create or replace function public.valid_assessment_rubric(value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; total numeric := 0; seen text[] := '{}';
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) not between 1 and 20 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if coalesce(length(btrim(item->>'id')),0)=0 or coalesce(length(btrim(item->>'label')),0)=0
      or jsonb_typeof(item->'weight') is distinct from 'number'
      or jsonb_typeof(item->'maxScore') is distinct from 'number'
      or (item->>'weight')::numeric <= 0 or (item->>'weight')::numeric > 100
      or (item->>'maxScore')::numeric < 1 or (item->>'maxScore')::numeric > 100
      or (item->>'id')=any(seen) then return false; end if;
    seen := array_append(seen,item->>'id'); total := total+(item->>'weight')::numeric;
  end loop;
  return abs(total-100)<0.001;
exception when others then return false;
end $$;

create table if not exists public."assessmentTemplates" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  description text not null default '',
  rubric jsonb not null check(public.valid_assessment_rubric(rubric)),
  "validityDays" integer not null default 180 check("validityDays" between 1 and 730),
  version integer not null default 1 check(version>0),
  archived boolean not null default false,
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique(workspace_id,id)
);
create unique index if not exists assessment_templates_name_unique on public."assessmentTemplates"(workspace_id,lower(btrim(name)));

create table if not exists public."talentPools" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  description text not null default '', archived boolean not null default false,
  created date not null default current_date, updated timestamptz not null default now(),
  unique(workspace_id,id)
);
create unique index if not exists talent_pools_name_unique on public."talentPools"(workspace_id,lower(btrim(name)));
create table if not exists public."poolMembers" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  "poolId" uuid not null, "candidateId" uuid not null,
  active boolean not null default true,
  created date not null default current_date, updated timestamptz not null default now(),
  unique(workspace_id,"poolId","candidateId"),
  foreign key(workspace_id,"poolId") references public."talentPools"(workspace_id,id),
  foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);

do $$ declare table_name text; begin
  foreach table_name in array array['assessmentTemplates','talentPools','poolMembers'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from anon,authenticated',table_name);
    execute format('grant select,insert,update on public.%I to authenticated',table_name);
    execute format('drop policy if exists structures_read on public.%I',table_name);
    execute format('create policy structures_read on public.%I for select to authenticated using(workspace_id=public.current_workspace())',table_name);
    execute format('drop policy if exists structures_insert on public.%I',table_name);
    execute format('drop policy if exists structures_update on public.%I',table_name);
    if table_name='assessmentTemplates' then
      execute format('create policy structures_insert on public.%I for insert to authenticated with check(workspace_id=public.current_workspace() and public.is_admin())',table_name);
      execute format('create policy structures_update on public.%I for update to authenticated using(workspace_id=public.current_workspace() and public.is_admin()) with check(workspace_id=public.current_workspace() and public.is_admin())',table_name);
    else
      execute format('create policy structures_insert on public.%I for insert to authenticated with check(public.can_edit_workspace(workspace_id))',table_name);
      execute format('create policy structures_update on public.%I for update to authenticated using(public.can_edit_workspace(workspace_id)) with check(public.can_edit_workspace(workspace_id))',table_name);
    end if;
    execute format('drop trigger if exists track_change on public.%I',table_name);
    execute format('create trigger track_change after insert or update on public.%I for each row execute function public.record_change()',table_name);
    execute format('drop trigger if exists touch_updated_column on public.%I',table_name);
    execute format('create trigger touch_updated_column before update on public.%I for each row execute function public.touch_updated_column()',table_name);
  end loop;
end $$;

create or replace function public.advance_assessment_template_version()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='INSERT' then new.version := 1;
  elsif (new.name,new.description,new.rubric,new."validityDays") is distinct from (old.name,old.description,old.rubric,old."validityDays") then new.version := old.version+1;
  else new.version := old.version; end if;
  return new;
end $$;
drop trigger if exists template_version on public."assessmentTemplates";
create trigger template_version before insert or update on public."assessmentTemplates" for each row execute function public.advance_assessment_template_version();

create or replace function public.check_pool_membership()
returns trigger language plpgsql set search_path='' as $$ begin
  if new.active and exists(select 1 from public."talentPools" p where p.id=new."poolId" and p.workspace_id=new.workspace_id and p.archived) then
    raise exception 'Restore the pool before adding members';
  end if;
  return new;
end $$;
drop trigger if exists check_pool on public."poolMembers";
create trigger check_pool before insert or update on public."poolMembers" for each row execute function public.check_pool_membership();

alter table public.assessments add column if not exists "templateId" uuid;
alter table public.assessments add column if not exists "templateSnapshot" jsonb;
alter table public.assessments add column if not exists "rubricScores" jsonb;
alter table public.assessments add column if not exists "validUntil" date;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='assessments_template_workspace_fk') then
    alter table public.assessments add constraint assessments_template_workspace_fk foreign key(workspace_id,"templateId") references public."assessmentTemplates"(workspace_id,id);
  end if;
end $$;

-- Treat the template as authoritative and snapshot it on insert; never trust a browser-provided
-- version/weight/validity assertion. Old records retain their original evidence after edits.
create or replace function public.snapshot_assessment_rubric()
returns trigger language plpgsql set search_path='' as $$
declare template public."assessmentTemplates"%rowtype; criterion jsonb; score_value numeric; total numeric:=0;
begin
  if tg_op='UPDATE' and old."templateId" is not null then
    if (new."templateId",new."templateSnapshot",new."rubricScores",new.score,new.date,new."validUntil",new.evidence,new.assessor,new."demandId")
      is distinct from (old."templateId",old."templateSnapshot",old."rubricScores",old.score,old.date,old."validUntil",old.evidence,old.assessor,old."demandId") then
      raise exception 'Recorded rubric evidence is immutable; record a reassessment';
    end if;
    return new;
  end if;
  if new."templateId" is null then
    if new."templateSnapshot" is not null or new."rubricScores" is not null then raise exception 'Select a template for rubric evidence'; end if;
    return new;
  end if;
  select * into template from public."assessmentTemplates" where id=new."templateId" and workspace_id=new.workspace_id;
  if not found or template.archived then raise exception 'Assessment template is unavailable'; end if;
  if new.date>current_date then raise exception 'Assessment date cannot be in the future'; end if;
  if jsonb_typeof(new."rubricScores") is distinct from 'object' then raise exception 'Score every rubric criterion'; end if;
  for criterion in select * from jsonb_array_elements(template.rubric) loop
    if jsonb_typeof(new."rubricScores"->(criterion->>'id')) is distinct from 'number' then raise exception 'Score every rubric criterion'; end if;
    score_value := (new."rubricScores"->>(criterion->>'id'))::numeric;
    if score_value<0 or score_value>(criterion->>'maxScore')::numeric then raise exception 'Rubric score is out of range'; end if;
    total := total + score_value/(criterion->>'maxScore')::numeric*(criterion->>'weight')::numeric;
  end loop;
  if (select count(*) from jsonb_object_keys(new."rubricScores")) <> jsonb_array_length(template.rubric) then raise exception 'Unknown rubric criterion'; end if;
  new.score := round(total,2);
  new."validUntil" := new.date+template."validityDays";
  new."templateSnapshot" := jsonb_build_object('name',template.name,'description',template.description,'version',template.version,'validityDays',template."validityDays",'rubric',template.rubric);
  return new;
end $$;
drop trigger if exists assessment_rubric_snapshot on public.assessments;
create trigger assessment_rubric_snapshot before insert or update on public.assessments for each row execute function public.snapshot_assessment_rubric();

-- Extend the feed without losing prior table queries or permission projections.
do $$ begin
  if to_regprocedure('public.api_changes_page_v031(date,integer,integer)') is null then
    alter function public.api_changes_page(date,integer,integer) rename to api_changes_page_v031;
  end if;
  if to_regprocedure('public.api_changes_page_has_more_v031(date,integer)') is null then
    alter function public.api_changes_page_has_more(date,integer) rename to api_changes_page_has_more_v031;
  end if;
end $$;
revoke all on function public.api_changes_page_v031(date,integer,integer) from public,anon,authenticated;
revoke all on function public.api_changes_page_has_more_v031(date,integer) from public,anon,authenticated;

create or replace function public.api_changes_page_has_more(day date,row_offset integer)
returns boolean language sql stable security definer set search_path=public as $$
  select public.api_changes_page_has_more_v031(day,row_offset)
    or exists(select 1 from public."assessmentTemplates" t where t.workspace_id=public.current_workspace() and (t.created>=day or t.updated::date>=day) order by t.id limit 1 offset greatest(row_offset,0))
    or exists(select 1 from public."talentPools" t where t.workspace_id=public.current_workspace() and (t.created>=day or t.updated::date>=day) order by t.id limit 1 offset greatest(row_offset,0))
    or exists(select 1 from public."poolMembers" t where t.workspace_id=public.current_workspace() and (t.created>=day or t.updated::date>=day) order by t.id limit 1 offset greatest(row_offset,0));
$$;
revoke all on function public.api_changes_page_has_more(date,integer) from public,anon;
grant execute on function public.api_changes_page_has_more(date,integer) to authenticated;

create or replace function public.api_changes_page(day date default current_date-30,page_block int default 0,page_size int default 200)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ws uuid:=public.current_workspace(); off integer:=greatest(page_block,0)*greatest(page_size,1); lim integer:=greatest(page_size,1); base jsonb;
begin
  if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
  base:=public.api_changes_page_v031(day,page_block,page_size);
  return base||jsonb_build_object('next',public.api_changes_page_has_more(day,off+lim),
    'assessmentTemplates',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb) from (select t.* from public."assessmentTemplates" t where t.workspace_id=ws and (t.created>=day or t.updated::date>=day) order by t.id limit lim offset off) t),
    'talentPools',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb) from (select t.* from public."talentPools" t where t.workspace_id=ws and (t.created>=day or t.updated::date>=day) order by t.id limit lim offset off) t),
    'poolMembers',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb) from (select t.* from public."poolMembers" t where t.workspace_id=ws and (t.created>=day or t.updated::date>=day) order by t.id limit lim offset off) t));
end $$;
revoke all on function public.api_changes_page(date,integer,integer) from public,anon;
grant execute on function public.api_changes_page(date,integer,integer) to authenticated;
commit;
