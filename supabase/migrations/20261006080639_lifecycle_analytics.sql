-- Phase A: observed transitions, never reconstructed from mutable dates.
begin;
create schema if not exists ecod_private;
revoke all on schema ecod_private from public, anon, authenticated;

create table if not exists public."lifecycleEvents" (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 entity_type text not null check(entity_type in ('candidate','consideration')),
 entity_id uuid not null,
 candidate_id uuid not null,
 demand_id uuid,
 kind text not null check(kind in ('baseline','created','transition','relinked')),
 from_state text,
 to_state text not null,
 source text not null default '',
 actor_id uuid,
 occurred_at timestamptz not null default clock_timestamp()
);
alter table public."lifecycleEvents" enable row level security;
revoke all on public."lifecycleEvents" from public, anon, authenticated;
grant select on public."lifecycleEvents" to authenticated;
drop policy if exists lifecycle_read on public."lifecycleEvents";
create policy lifecycle_read on public."lifecycleEvents" for select to authenticated
 using(workspace_id=(select public.current_workspace()));
create index if not exists lifecycle_cohort on public."lifecycleEvents"(workspace_id,entity_type,occurred_at,entity_id) where kind='created';
create index if not exists lifecycle_entity on public."lifecycleEvents"(workspace_id,entity_type,entity_id,occurred_at,id);
create unique index if not exists lifecycle_initial on public."lifecycleEvents"(workspace_id,entity_type,entity_id) where kind in ('baseline','created');

create or replace function ecod_private.record_lifecycle_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_kind text; previous text; next_state text; candidate uuid; demand uuid; origin text;
begin
 if tg_table_name='candidates' then
  candidate:=new.id; next_state:=new.status; origin:=new.source;
  if tg_op='UPDATE' then
   if old.status is not distinct from new.status then return new; end if;
   previous:=old.status;
  end if;
 else
  candidate:=new."candidateId"; demand:=new."demandId"; next_state:=new.stage;
  select c.source into origin from public.candidates c where c.workspace_id=new.workspace_id and c.id=candidate;
  if tg_op='UPDATE' then
   if old."candidateId" is distinct from candidate or old."demandId" is distinct from demand then
    event_kind:='relinked';
   elsif old.stage is not distinct from next_state then return new;
   end if;
   previous:=old.stage;
  end if;
 end if;
 event_kind:=coalesce(event_kind,case when tg_op='INSERT' then 'created' else 'transition' end);
 insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,demand_id,kind,from_state,to_state,source,actor_id)
 values(new.workspace_id,case when tg_table_name='candidates' then 'candidate' else 'consideration' end,new.id,candidate,demand,event_kind,previous,next_state,coalesce(origin,''),auth.uid());
 return new;
end $$;
revoke all on function ecod_private.record_lifecycle_event() from public,anon,authenticated;
drop trigger if exists lifecycle_candidate on public.candidates;
create trigger lifecycle_candidate after insert or update on public.candidates for each row execute function ecod_private.record_lifecycle_event();
drop trigger if exists lifecycle_consideration on public.considerations;
create trigger lifecycle_consideration after insert or update on public.considerations for each row execute function ecod_private.record_lifecycle_event();

-- Existing rows are explicitly incomplete histories, not new cohorts.
insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,kind,to_state,source)
 select workspace_id,'candidate',id,id,'baseline',status,source from public.candidates
 on conflict do nothing;
insert into public."lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,demand_id,kind,to_state,source)
 select a.workspace_id,'consideration',a.id,a."candidateId",a."demandId",'baseline',a.stage,c.source
 from public.considerations a join public.candidates c on c.workspace_id=a.workspace_id and c.id=a."candidateId"
 on conflict do nothing;

create or replace function public.api_lifecycle_analytics(p_days integer default 90)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.current_workspace() is null then raise exception 'Workspace membership required'; end if;
 if p_days is null or p_days not in (30,90,365) then raise exception 'Choose 30, 90 or 365 days'; end if;
 with events as materialized (
  select * from public."lifecycleEvents" where workspace_id=public.current_workspace()
 ), cohorts as (
  select e.* from events e
  join public.considerations a on a.workspace_id=e.workspace_id and a.id=e.entity_id
  join public.candidates c on c.workspace_id=a.workspace_id and c.id=a."candidateId"
  where e.entity_type='consideration' and e.kind='created' and c."mergedInto" is null
   and not exists(select 1 from events r where r.entity_type=e.entity_type and r.entity_id=e.entity_id and r.kind='relinked')
   and e.occurred_at>=now()-make_interval(days=>p_days)
 ), visits as (
  select e.entity_id,e.to_state,min(e.occurred_at) as first_at
  from events e join cohorts c on c.entity_id=e.entity_id
  where e.entity_type='consideration' and e.kind in ('created','transition')
  group by e.entity_id,e.to_state
 ), stages(stage,ord) as (
  values ('Submitted',1),('Interview',2),('Offer',3),('Deployed',4)
 ), stage_counts as (
  select s.stage,s.ord,count(v.entity_id)::integer as reached
  from stages s left join visits v on v.to_state=s.stage group by s.stage,s.ord
 ), pairs(from_stage,to_stage,ord) as (
  values ('Submitted','Interview',1),('Interview','Offer',2),('Offer','Deployed',3)
 ), progression as (
  select p.*,count(f.entity_id)::integer as entered,
   count(t.first_at)::integer as progressed
  from pairs p left join visits f on f.to_state=p.from_stage
  left join lateral (
   select min(e.occurred_at) as first_at from events e
   where e.entity_type='consideration' and e.entity_id=f.entity_id
    and e.kind in ('created','transition') and e.to_state=p.to_stage
    and e.occurred_at>=f.first_at
  ) t on true
  group by p.from_stage,p.to_stage,p.ord
 ), people as (
  select e.* from events e join public.candidates c on c.workspace_id=e.workspace_id and c.id=e.entity_id
  where e.entity_type='candidate' and e.kind='created' and c."mergedInto" is null
   and e.occurred_at>=now()-make_interval(days=>p_days)
 ), readiness as (
  select p.entity_id,p.source,p.occurred_at,min(e.occurred_at) as ready_at
  from people p left join events e on e.entity_type='candidate' and e.entity_id=p.entity_id
   and e.kind in ('created','transition') and e.to_state='Ready'
  group by p.entity_id,p.source,p.occurred_at
 ), source_counts as (
  select source,count(*)::integer as total,count(ready_at)::integer as ready
  from readiness group by source
 )
 select jsonb_build_object(
  'days',p_days,'asOf',now(),
  'trackingSince',(select min(occurred_at) from events),
  'baselineRecords',(select count(*) from events where kind='baseline'),
  'considerations',(select count(*) from cohorts),
  'openJourneys',(select count(*) from cohorts c join public.considerations a on a.id=c.entity_id and a.workspace_id=c.workspace_id where a.stage not in ('Deployed','Rejected','Withdrawn')),
  'stages',(select coalesce(jsonb_agg(jsonb_build_object('stage',stage,'reached',reached) order by ord),'[]') from stage_counts),
  'progression',(select coalesce(jsonb_agg(jsonb_build_object('from',from_stage,'to',to_stage,'entered',entered,'progressed',progressed,'pct',case when entered>0 then round(100.0*progressed/entered,1) else null end) order by ord),'[]') from progression),
  'candidates',(select count(*) from readiness),
  'readyCandidates',(select count(ready_at) from readiness),
  'averageDaysToReady',(select round(avg(extract(epoch from (ready_at-occurred_at))/86400)::numeric,1) from readiness where ready_at is not null),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('source',source,'total',total,'ready',ready) order by total desc,source),'[]') from source_counts)
 ) into result;
 return result;
end $$;
revoke all on function public.api_lifecycle_analytics(integer) from public,anon;
grant execute on function public.api_lifecycle_analytics(integer) to authenticated;
commit;
