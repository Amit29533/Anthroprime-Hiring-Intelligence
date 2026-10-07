begin;

-- Extend the append-only journal without reconstructing mutable business dates.
alter table public."lifecycleEvents" drop constraint if exists "lifecycleEvents_entity_type_check";
alter table public."lifecycleEvents" add constraint "lifecycleEvents_entity_type_check"
 check(entity_type in ('candidate','consideration','demand','assessment','enrichment','placement'));
alter table public."lifecycleEvents" alter column candidate_id drop not null;
alter table public."lifecycleEvents" drop constraint if exists lifecycle_candidate_required;
alter table public."lifecycleEvents" add constraint lifecycle_candidate_required
 check((entity_type='demand' and candidate_id is null) or (entity_type<>'demand' and candidate_id is not null));
alter table public."lifecycleEvents" add column if not exists facts jsonb not null default '{}';
create index if not exists lifecycle_candidate_events
 on public."lifecycleEvents"(workspace_id,candidate_id,entity_type,occurred_at,id);

create table if not exists public."ecodAnalyticsCoverage" (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 started_at timestamptz not null default clock_timestamp()
);
alter table public."ecodAnalyticsCoverage" enable row level security;
revoke all on public."ecodAnalyticsCoverage" from public,anon,authenticated;
grant select on public."ecodAnalyticsCoverage" to authenticated;
drop policy if exists coverage_read on public."ecodAnalyticsCoverage";
create policy coverage_read on public."ecodAnalyticsCoverage" for select to authenticated
 using(workspace_id=(select public.current_workspace()));
insert into public."ecodAnalyticsCoverage"(workspace_id) select id from public.workspaces on conflict do nothing;
create or replace function ecod_private.start_ecod_analytics()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public."ecodAnalyticsCoverage"(workspace_id) values(new.id) on conflict do nothing;
 return new;
end $$;
revoke all on function ecod_private.start_ecod_analytics() from public,anon,authenticated;
drop trigger if exists ecod_analytics_workspace on public.workspaces;
create trigger ecod_analytics_workspace after insert on public.workspaces
 for each row execute function ecod_private.start_ecod_analytics();

create or replace function ecod_private.record_ecod_outcome()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; candidate uuid; demand uuid;
 entity text; state text; previous text; kind text; origin text; evidence jsonb:='{}';
begin
 entity:=case tg_table_name when 'demands' then 'demand' when 'assessments' then 'assessment'
  when 'enrichment' then 'enrichment' else 'placement' end;
 if entity='demand' then demand:=new.id;
 else candidate:=(row_data->>'candidateId')::uuid; demand:=(row_data->>'demandId')::uuid;
 end if;
 state:=case when entity='assessment' then 'Recorded' else row_data->>'status' end;
 if entity in ('assessment','enrichment') then
  evidence:=jsonb_build_object('skill',coalesce(row_data->>'skill',row_data->>'gapSkill',''));
 end if;
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  previous:=case when entity='assessment' then 'Recorded' else old_data->>'status' end;
  if old_data->>'candidateId' is distinct from row_data->>'candidateId'
   or old_data->>'demandId' is distinct from row_data->>'demandId'
   or (entity='enrichment' and old_data->>'gapSkill' is distinct from row_data->>'gapSkill') then
   kind:='relinked';
  elsif previous is not distinct from state then return new;
  end if;
 end if;
 if candidate is not null then
  select source into origin from public.candidates where workspace_id=new.workspace_id and id=candidate;
 end if;
 insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,demand_id,kind,from_state,to_state,source,actor_id,facts)
 values(new.workspace_id,entity,new.id,candidate,demand,coalesce(kind,case when tg_op='INSERT' then 'created' else 'transition' end),previous,state,coalesce(origin,''),auth.uid(),evidence);
 return new;
end $$;
revoke all on function ecod_private.record_ecod_outcome() from public,anon,authenticated;
do $$ declare name text; entity text; begin
 foreach name in array array['demands','assessments','enrichment','placements'] loop
  entity:=case name when 'demands' then 'demand' when 'assessments' then 'assessment' when 'enrichment' then 'enrichment' else 'placement' end;
  execute format('drop trigger if exists ecod_outcome on public.%I',name);
  execute format('create trigger ecod_outcome after insert or update on public.%I for each row execute function ecod_private.record_ecod_outcome()',name);
  if entity='demand' then
   insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,demand_id,kind,to_state)
    select workspace_id,'demand',id,id,'baseline',status from public.demands on conflict do nothing;
  else
   execute format('insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,demand_id,kind,to_state,source,facts)
    select r.workspace_id,%L,r.id,r."candidateId",r."demandId",''baseline'',%s,c.source,%s
    from public.%I r join public.candidates c on c.workspace_id=r.workspace_id and c.id=r."candidateId" on conflict do nothing',
    entity,case when entity='assessment' then '''Recorded''' else 'r.status' end,
    case when entity='assessment' then 'jsonb_build_object(''skill'',coalesce(r.skill,''''))'
     when entity='enrichment' then 'jsonb_build_object(''skill'',coalesce(r."gapSkill",''''))' else '''{}''::jsonb' end,name);
  end if;
 end loop;
end $$;

create or replace function public.api_ecod_outcome_analytics(p_days integer default 90)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; workspace uuid:=public.current_workspace(); coverage timestamptz; as_of timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or workspace is null then raise exception 'Workspace membership required'; end if;
 if p_days is null or p_days not in (30,90,365) then raise exception 'Choose 30, 90 or 365 days'; end if;
 select started_at into coverage from public."ecodAnalyticsCoverage" where workspace_id=workspace;
 with events as materialized (
  select * from public."lifecycleEvents" e where e.workspace_id=workspace and e.occurred_at<=as_of
 ), clean as materialized (
  select e.* from events e where not exists(select 1 from events r
   where r.entity_type=e.entity_type and r.entity_id=e.entity_id and r.kind='relinked')
 ), people as (
  select e.entity_id,e.source,e.occurred_at from clean e join public.candidates c
   on c.workspace_id=workspace and c.id=e.entity_id
  where e.entity_type='candidate' and e.kind='created' and c."mergedInto" is null
   and e.occurred_at>=greatest(as_of-make_interval(days=>p_days),coverage)
 ), candidate_outcomes as (
  select p.*,
   (select min(e.occurred_at) from clean e where e.candidate_id=p.entity_id and e.entity_type='assessment' and e.kind='created') assessed_at,
   (select min(e.occurred_at) from clean e where e.candidate_id=p.entity_id and e.entity_type='placement' and e.kind in ('created','transition') and e.to_state='Active') placed_at
  from people p
 ), source_counts as (
  select source,count(*) as total,count(assessed_at) as assessed,count(placed_at) as placed
  from candidate_outcomes group by source
 ), journeys as (
  select e.* from clean e join public.considerations a on a.workspace_id=workspace and a.id=e.entity_id
   join public.candidates c on c.workspace_id=workspace and c.id=a."candidateId" and c."mergedInto" is null
  where e.entity_type='consideration' and e.kind='created' and e.occurred_at>=greatest(as_of-make_interval(days=>p_days),coverage)
 ), submissions as (
  select j.entity_id,j.occurred_at,
   (select min(e.occurred_at) from clean e where e.entity_type='consideration' and e.entity_id=j.entity_id
    and e.kind in ('created','transition') and e.to_state='Submitted' and e.occurred_at>=j.occurred_at) finished_at
  from journeys j
 ), demands as (
  select e.entity_id,e.occurred_at from clean e join public.demands d on d.workspace_id=workspace and d.id=e.entity_id
  where e.entity_type='demand' and e.kind='created' and e.occurred_at>=greatest(as_of-make_interval(days=>p_days),coverage)
 ), shortlists as (
  select d.*,(select min(j.occurred_at) from journeys j where j.demand_id=d.entity_id and j.occurred_at>=d.occurred_at) finished_at
  from demands d
 ), plans as (
  select e.* from clean e join people p on p.entity_id=e.candidate_id
   join public.enrichment n on n.workspace_id=workspace and n.id=e.entity_id
  where e.entity_type='enrichment' and e.kind='created'
 ), completions as (
  select p.*,(select min(e.occurred_at) from clean e where e.entity_type='enrichment' and e.entity_id=p.entity_id
   and e.kind in ('created','transition') and e.to_state in ('Complete','Validated') and e.occurred_at>=p.occurred_at) complete_at
  from plans p
 ), reassessments as (
  select p.*,(select min(e.occurred_at) from clean e where e.entity_type='assessment' and e.kind='created'
   and e.candidate_id=p.candidate_id and e.occurred_at>p.complete_at
   and (e.demand_id is null or e.demand_id=p.demand_id)
   and (coalesce(p.facts->>'skill','')='' or e.facts->>'skill'=p.facts->>'skill')) reassessed_at
  from completions p
 ), uplift as (
  select p.*,(select min(e.occurred_at) from clean e where e.entity_type='candidate' and e.entity_id=p.candidate_id
   and e.kind='transition' and e.to_state='Ready' and e.occurred_at>p.reassessed_at) ready_at
  from reassessments p
 ), samples as (
  select 'shortlist' as metric,occurred_at,finished_at from shortlists
  union all select 'submission',occurred_at,finished_at from submissions
  union all select 'placement',occurred_at,placed_at from candidate_outcomes
  union all select 'reassessment',complete_at,reassessed_at from uplift where complete_at is not null
 ), timing_names(metric,ord) as (values('shortlist',1),('submission',2),('placement',3),('reassessment',4)), timings as (
  select n.metric,n.ord,count(s.occurred_at) as tracked,count(s.finished_at) as completed,
   round(avg(extract(epoch from(s.finished_at-s.occurred_at))/86400)::numeric,2) as average_days,
   round((percentile_cont(0.5) within group(order by extract(epoch from(s.finished_at-s.occurred_at))/86400))::numeric,2) as median_days,
   round((percentile_cont(0.9) within group(order by extract(epoch from(s.finished_at-s.occurred_at))/86400))::numeric,2) as p90_days
  from timing_names n left join samples s on s.metric=n.metric group by n.metric,n.ord
 )
 select jsonb_build_object('days',p_days,'asOf',as_of,'trackingSince',coverage,
  'candidates',(select count(*) from people),'assessedCandidates',(select count(assessed_at) from candidate_outcomes),
  'placedCandidates',(select count(placed_at) from candidate_outcomes),
  'enrichment',jsonb_build_object('plans',(select count(*) from uplift),'completed',(select count(complete_at) from uplift),
   'reassessed',(select count(reassessed_at) from uplift),'readyAfterReassessment',(select count(ready_at) from uplift)),
  'timings',(select jsonb_agg(jsonb_build_object('metric',metric,'tracked',tracked,'completed',completed,'unobserved',tracked-completed,
   'averageDays',average_days,'medianDays',median_days,'p90Days',p90_days) order by ord) from timings),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('source',source,'total',total,'assessed',assessed,'placed',placed,
   'placementPct',round(100.0*placed/nullif(total,0),1)) order by total desc,source),'[]') from source_counts)
 ) into result;
 return result;
end $$;
revoke all on function public.api_ecod_outcome_analytics(integer) from public,anon;
grant execute on function public.api_ecod_outcome_analytics(integer) to authenticated;

create table if not exists public."ecodAnalyticsExports" (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null, prepared_at timestamptz not null default clock_timestamp(), days integer not null,
 summary jsonb not null
);
alter table public."ecodAnalyticsExports" enable row level security;
revoke all on public."ecodAnalyticsExports" from public,anon,authenticated;
grant select on public."ecodAnalyticsExports" to authenticated;
drop policy if exists analytics_exports_read on public."ecodAnalyticsExports";
create policy analytics_exports_read on public."ecodAnalyticsExports" for select to authenticated
 using(workspace_id=(select public.current_workspace()) and public.can_edit_workspace(workspace_id));
create index if not exists analytics_exports_actor on public."ecodAnalyticsExports"(workspace_id,actor_id,prepared_at);

create or replace function public.api_prepare_ecod_analytics_export(p_days integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare workspace uuid:=public.current_workspace(); actor uuid:=auth.uid(); metrics jsonb; receipt public."ecodAnalyticsExports";
begin
 if actor is null or workspace is null or not public.can_edit_workspace(workspace) then raise exception 'Editor access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ecod-analytics-export:'||workspace::text||':'||actor::text,0));
 if (select count(*) from public."ecodAnalyticsExports" where workspace_id=workspace and actor_id=actor and prepared_at>clock_timestamp()-interval '1 minute')>=5 then
  raise exception 'Analytics export limit reached. Try again in one minute';
 end if;
 metrics:=public.api_ecod_outcome_analytics(p_days);
 insert into public."ecodAnalyticsExports"(workspace_id,actor_id,days,summary) values(workspace,actor,p_days,metrics) returning * into receipt;
 return jsonb_build_object('receiptId',receipt.id,'preparedAt',receipt.prepared_at,'workspaceId',workspace,'actor',actor,'schemaVersion',1,'metrics',metrics);
end $$;
revoke all on function public.api_prepare_ecod_analytics_export(integer) from public,anon;
grant execute on function public.api_prepare_ecod_analytics_export(integer) to authenticated;
commit;
