-- Completion milestone: existing-stack queues, cited records, reports and campaigns.
begin;
do $$ declare d text; t text; begin
 d:=pg_get_functiondef('public.validate_custom_field_definitions()'::regprocedure);
 if strpos(d,'''placements''')=0 then d:=replace(d,'''candidates'',''demands'',''clients'',''clientContacts''', '''candidates'',''demands'',''clients'',''clientContacts'',''interviews'',''assessments'',''enrichment'',''placements'''); execute d;end if;
 foreach t in array array['interviews','assessments','enrichment','placements'] loop
  execute format('alter table public.%I add column if not exists custom jsonb not null default ''{}''',t);
  execute format('drop trigger if exists validate_custom_values on public.%I',t);
  execute format('create trigger validate_custom_values before insert or update on public.%I for each row execute function public.validate_custom_field_values()',t);
 end loop;
end $$;
-- Preserve the existing strict excerpt validator and extend it with cited records.
do $$ declare d text; begin
 if to_regprocedure('ecod_private.valid_cv_excerpt_envelope(jsonb,boolean)')is null then
 d:=pg_get_functiondef('ecod_private.valid_cv_evidence(jsonb,boolean)'::regprocedure);
 d:=replace(d,'ecod_private.valid_cv_evidence(', 'ecod_private.valid_cv_excerpt_envelope('); execute d;end if;
end $$;
create or replace function ecod_private.valid_cv_evidence(v jsonb,require_review boolean)returns boolean language plpgsql immutable set search_path=''as $$
declare r jsonb; k text; line jsonb; dt text;
begin
 if not ecod_private.valid_cv_excerpt_envelope(v-'records',require_review) then return false;end if;
 if not(v?'records')then return true;end if;
 if octet_length(v::text)>24000 or jsonb_typeof(v->'records')is distinct from'array'or jsonb_array_length(v->'records')>16 then return false;end if;
 for r in select value from jsonb_array_elements(v->'records')loop
  if jsonb_typeof(r)is distinct from'object'or exists(select 1 from jsonb_object_keys(r)x where x not in('section','label','organization','start','end','ongoing','sourceLines','reviewed'))or coalesce(r->>'section','')not in('employment','education','certifications','projects')or jsonb_typeof(r->'label')is distinct from'string'or length(btrim(r->>'label'))not between 1 and 160 or jsonb_typeof(r->'organization')is distinct from'string'or length(r->>'organization')>160 or jsonb_typeof(r->'ongoing')is distinct from'boolean'or jsonb_typeof(r->'reviewed')is distinct from'boolean'or(require_review and r->'reviewed'is distinct from'true'::jsonb)then return false;end if;
  foreach k in array array['start','end']loop
   if jsonb_typeof(r->k)is distinct from'string'then return false;end if;dt:=r->>k;
   if dt<>''then
    if dt!~'^(19|20)[0-9]{2}(-(0[1-9]|1[0-2]))?(-(0[1-9]|[12][0-9]|3[01]))?$'then return false;end if;
    if length(dt)=10 and (dt::date)::text<>dt then return false;end if;
   end if;
  end loop;
  if(r->'ongoing'='true'::jsonb and r->>'end'<>'')or(r->>'start'<>''and r->>'end'<>''and r->>'start'>r->>'end'and strpos(r->>'start',r->>'end')<>1)then return false;end if;
  if jsonb_typeof(r->'sourceLines')is distinct from'array'or jsonb_array_length(r->'sourceLines')not between 1 and 16 or(select count(distinct value)from jsonb_array_elements(r->'sourceLines'))<>jsonb_array_length(r->'sourceLines')then return false;end if;
  for line in select value from jsonb_array_elements(r->'sourceLines')loop
   if not exists(select 1 from jsonb_array_elements(v->'items')item where item->'sourceLine'=line and item->>'section'=r->>'section')then return false;end if;
  end loop;
 end loop;return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function ecod_private.valid_cv_excerpt_envelope(jsonb,boolean),ecod_private.valid_cv_evidence(jsonb,boolean)from public,anon,authenticated;

-- Search is applied before pagination; no client-side filtering of truncated pages.
do $$ declare d text;begin
 d:=pg_get_functiondef('ecod_enterprise_private.api(text,uuid,text,jsonb,integer)'::regprocedure);
 if strpos(d,'Bounded text search required')=0 then
 d:=replace(d,'if a=''context''then', 'if a in(''members'',''cases'',''browse'',''access-history'')and (jsonb_typeof(coalesce(p->''query'',''""''::jsonb))<>''string''or length(coalesce(p->>''query'',''''))>200 or jsonb_typeof(coalesce(p->''status'',''""''::jsonb))<>''string''or length(coalesce(p->>''status'',''''))>80)then raise exception ''Bounded text search required'';end if; if a=''context''then');
 d:=replace(d,'where m.workspace_id=ws order by m.user_id','where m.workspace_id=ws and (coalesce(p->>''query'','''')=''''or strpos(lower(u.email||'' ''||m.user_id::text),lower(p->>''query''))>0)and(coalesce(p->>''status'','''')=''''or m.role=p->>''status'')order by m.user_id');
 d:=replace(d,'where workspace_id=ws and request->>''action''in(''grant'',''offboard'',''offboard-report'')order by','where workspace_id=ws and request->>''action''in(''grant'',''offboard'',''offboard-report'')and(coalesce(p->>''query'','''')=''''or strpos(lower(actor::text||'' ''||request::text),lower(p->>''query''))>0)and(coalesce(p->>''status'','''')=''''or request->>''action''=p->>''status'')order by');
 d:=replace(d,'and status not in(''closed'',''declined'')order by created_at','and(coalesce(p->>''status'','''')=''''and status not in(''closed'',''declined'')or status=p->>''status'')and(coalesce(p->>''query'','''')=''''or strpos(lower(id::text||'' ''||candidate_id::text),lower(p->>''query''))>0 or exists(select 1 from public.candidates c where c.workspace_id=ws and c.id=candidate_id and strpos(lower(c.name||'' ''||c."anthroId"),lower(p->>''query''))>0))order by created_at');
 d:=replace(d,'where workspace_id=ws order by at desc,id limit 26 offset off)x;', 'where workspace_id=ws and(coalesce(p->>''status'','''')=''''or t.status=p->>''status'')and(coalesce(p->>''query'','''')=''''or strpos(lower(t.id::text||'' ''||t.candidate_id::text),lower(p->>''query''))>0 or exists(select 1 from public.candidates c where c.workspace_id=ws and c.id=t.candidate_id and strpos(lower(c.name||'' ''||c."anthroId"),lower(p->>''query''))>0))order by at desc,id limit 26 offset off)x;');execute d;end if;
end $$;

create schema if not exists ecod_completion_private;
revoke all on schema ecod_completion_private from public,anon,authenticated;
grant usage on schema ecod_completion_private to authenticated;
-- Definitions contain configuration only. Candidate activity reuses the covered communication journal.
create table if not exists ecod_completion_private.definitions(id uuid primary key,workspace_id uuid not null references public.workspaces(id),kind text not null check(kind in('campaign','report')),name text not null,version integer not null,body jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp(),unique(workspace_id,kind,name,version));
alter table ecod_completion_private.definitions enable row level security;
revoke all on ecod_completion_private.definitions from public,anon,authenticated;
drop trigger if exists completion_lockdown on ecod_completion_private.definitions;
create trigger completion_lockdown before insert or update or delete on ecod_completion_private.definitions for each row execute function ecod_processing_private.guard_lockdown();
drop trigger if exists completion_truncate_lockdown on ecod_completion_private.definitions;
create trigger completion_truncate_lockdown before truncate on ecod_completion_private.definitions for each statement execute function ecod_processing_private.guard_lockdown();
create index if not exists completion_definitions_workspace on ecod_completion_private.definitions(workspace_id,kind,name,version desc);

-- Ordinary intent deduplication stays intact; repeated campaign steps have explicit identity.
alter table ecod_comms_private.intents add column if not exists campaign_enrollment uuid,add column if not exists campaign_step integer;
do $$begin if not exists(select 1 from pg_constraint where conrelid='ecod_comms_private.intents'::regclass and conname='comms_campaign_pair')then alter table ecod_comms_private.intents add constraint comms_campaign_pair check((campaign_enrollment is null and campaign_step is null)or(campaign_enrollment is not null and campaign_step is not null and campaign_step between 1 and 5));end if;end $$;
do $$begin if not exists(select 1 from pg_constraint where conrelid='ecod_comms_private.intents'::regclass and conname='comms_campaign_receipt')then alter table ecod_comms_private.intents add constraint comms_campaign_receipt foreign key(workspace_id,actor,campaign_enrollment)references ecod_comms_private.receipts(workspace_id,actor,id)deferrable initially deferred;end if;end $$;
drop index ecod_comms_private.comms_pending_unique;
create unique index comms_pending_unique on ecod_comms_private.intents(workspace_id,candidate_id,template_id,source_head)where status in('Queued','Retrying')and campaign_enrollment is null;
create unique index if not exists comms_campaign_step_unique on ecod_comms_private.intents(workspace_id,candidate_id,campaign_enrollment,campaign_step)where campaign_enrollment is not null;
create index if not exists comms_campaign_receipts on ecod_comms_private.receipts(workspace_id,candidate_id,at desc,id)where request->>'action'='campaign-enroll';

create or replace function ecod_completion_private.history(ws uuid,p jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare lo date;hi date;src text:=p->>'source';grp text:=p->>'group';rows jsonb;coverage timestamptz;cohort jsonb;
begin
 if exists(select 1 from jsonb_object_keys(p)x where x not in('source','group','from','to','targetState'))or src is null or src not in('lifecycle','readiness')or grp is null or grp not in('state','month','source','entity')or coalesce(p->>'from','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'or coalesce(p->>'to','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'or length(coalesce(p->>'targetState',''))>80 or jsonb_typeof(coalesce(p->'targetState','""'::jsonb))<>'string' then raise exception 'Choose curated history, grouping and dates';end if;
 lo:=(p->>'from')::date;hi:=(p->>'to')::date;
 if lo::text<>p->>'from'or hi::text<>p->>'to'or hi<lo or hi-lo>366 or hi>(clock_timestamp()at time zone'UTC')::date then raise exception 'Use a valid UTC range up to 366 days ending no later than today';end if;
 select started_at into coverage from public."ecodAnalyticsCoverage"where workspace_id=ws;
 with events as(
 select occurred_at at time zone'UTC'at,entity_type entity,to_state state,source,candidate_id candidate from public."lifecycleEvents"where workspace_id=ws and src='lifecycle'and kind in('created','transition')and occurred_at>=lo::timestamp at time zone'UTC'and occurred_at<(hi+1)::timestamp at time zone'UTC'and occurred_at<=clock_timestamp()
 union all select at at time zone'UTC','candidate',decision,'Readiness decision',"candidateId"from public."readinessDecisions"where workspace_id=ws and src='readiness'and at>=lo::timestamp at time zone'UTC'and at<(hi+1)::timestamp at time zone'UTC'and at<=clock_timestamp()), grouped as(
 select case grp when'state'then state when'month'then to_char(at,'YYYY-MM')when'source'then source else entity end label,count(*)events,count(distinct candidate)candidates from events group by 1 order by 1 limit 201)
 select coalesce(jsonb_agg(to_jsonb(grouped)),'[]')into rows from grouped;
 with created as(select candidate_id,min(occurred_at)at from public."lifecycleEvents"where workspace_id=ws and entity_type='candidate'and kind='created'and occurred_at>=lo::timestamp at time zone'UTC'and occurred_at<(hi+1)::timestamp at time zone'UTC'and occurred_at<=clock_timestamp()group by candidate_id),converted as(
 select c.candidate_id from created c where exists(select 1 from public."lifecycleEvents"e where e.workspace_id=ws and e.candidate_id=c.candidate_id and src='lifecycle'and e.entity_type='candidate'and e.kind='transition'and e.to_state=coalesce(nullif(p->>'targetState',''),'Deployed')and e.occurred_at>=c.at and e.occurred_at<(hi+1)::timestamp at time zone'UTC'and e.occurred_at<=clock_timestamp())or(src='readiness'and exists(select 1 from public."readinessDecisions"r where r.workspace_id=ws and r."candidateId"=c.candidate_id and r.decision=coalesce(nullif(p->>'targetState',''),'Ready')and r.at>=c.at and r.at<(hi+1)::timestamp at time zone'UTC'and r.at<=clock_timestamp())))
 select jsonb_build_object('newCandidates',(select count(*)from created),'convertedCandidates',(select count(*)from converted),'targetState',coalesce(nullif(p->>'targetState',''),case when src='readiness'then'Ready'else'Deployed'end))into cohort;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>200 then rows-200 else rows end,'truncated',jsonb_array_length(rows)>200,'coverageStartedAt',coverage,'firstReadinessDecisionAt',(select min(at)from public."readinessDecisions"where workspace_id=ws),'cohort',cohort,'criteria',p,'notice','Recorded UTC events only. Baselines and relinks excluded. Cohort conversion is observed within this range; it is not causal and does not include candidates created before recording. Historical readiness does not assert current eligibility.');
end $$;
create or replace function ecod_completion_private.health(ws uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with work as(
 select 'test-outbox'area,status,created_at,available_at,expires_at from ecod_comms_private.intents where workspace_id=ws
 union all select 'delivery',status,created_at,available_at,expires_at from ecod_delivery_private.intents where workspace_id=ws
 union all select 'google',status,created_at,available_at,expires_at from ecod_collaboration_private.work where workspace_id=ws
 union all select 'controlled',status,created_at,created_at,expires_at from ecod_external_private.work where workspace_id=ws),q as(
 select area,count(*)filter(where status in('Queued','Retrying','Deferred','Leased','Reconciling','Running','Ambiguous','Unknown'))pending,min(created_at)filter(where status in('Queued','Retrying','Deferred','Leased','Reconciling','Running','Ambiguous','Unknown'))oldest,count(*)filter(where status in('Queued','Retrying','Deferred')and available_at<clock_timestamp()-interval'1 hour')overdue,count(*)filter(where status in('Failed','Uncertain','Reconciling','Ambiguous','Unknown','Manual review','Review'))needs_review,count(*)filter(where status in('Queued','Retrying','Deferred','Running')and expires_at<clock_timestamp()+interval'1 day')expiring from work group by area),attempts as(
 select 'test-outbox'area,at,outcome from ecod_comms_private.attempts where workspace_id=ws
 union all select 'delivery',at,outcome from ecod_delivery_private.attempts where workspace_id=ws
 union all select 'google',at,body->>'outcome'from ecod_collaboration_private.attempts where workspace_id=ws),trend as(
 select area,(at at time zone'UTC')::date as day,count(*)attempts,count(*)filter(where outcome~*'fail|permanent|reject|unavailable|uncertain')failure_signals from attempts where at>=clock_timestamp()-interval'7 days'and at<=clock_timestamp()group by area,(at at time zone'UTC')::date)
 select jsonb_build_object('capturedAt',clock_timestamp(),'paused',(select paused from ecod_processing_private.lockdown),'queues',coalesce((select jsonb_agg(to_jsonb(q)order by area)from q),'[]'),'trend',coalesce((select jsonb_agg(to_jsonb(trend)order by day,area)from trend),'[]'),'sync',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'state',state,'dueAt',due_at,'overdue',state='enabled'and due_at<clock_timestamp()-interval'10 minutes','leaseUntil',lease_until,'errorRecorded',coalesce(error,'')<>''))from ecod_collaboration_private.connections where workspace_id=ws),'[]'),'evidence',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'state',state,'acceptedAt',accepted_at,'acceptanceExpiresAt',accepted_at+make_interval(days=>window_days),'renewalDue',accepted_at is not null and accepted_at<clock_timestamp()-make_interval(days=>window_days-1)))from(select 'processing/'||kind kind,state,accepted_at,7 window_days from ecod_processing_private.policies where workspace_id=ws union all select 'enterprise/'||kind,state,accepted_at,30 from ecod_enterprise_private.policies where workspace_id=ws union all select 'controlled/'||kind,state,accepted_at,30 from ecod_external_private.policies where workspace_id=ws union all select 'delivery/'||kind,state,accepted_at,7 from ecod_delivery_private.connections where workspace_id=ws union all select 'google/'||kind,state,accepted_at,7 from ecod_collaboration_private.connections where workspace_id=ws)x),'[]'),'processingEvidence',coalesce((select jsonb_agg(jsonb_build_object('component',component,'status',status,'expiresAt',expires_at,'stale',expires_at<clock_timestamp()))from(select distinct on(e.component)e.component,e.status,e.at+case when e.component in('scan','ocr')then interval'15 minutes'when e.component='restore'then interval'7 days'else make_interval(hours=>coalesce((p.body->>'rpoHours')::integer,24))end expires_at from ecod_processing_private.evidence e join ecod_processing_private.policies p on p.workspace_id=e.workspace_id and p.kind=e.kind and p.generation=e.generation where e.workspace_id=ws order by e.component,e.at desc,e.id desc)x),'[]'),'lastRestoreEvidence',(select max(at)from ecod_processing_private.evidence where workspace_id=ws and component='restore'and status='passed'),'guidance',jsonb_build_array('Review old or expiring intents in their original panel. Refresh changed sources before preparing a new operation.','Reconcile uncertain provider outcomes before retrying; a failure signal is not proof of nondelivery.','Renew acceptance on the current configuration generation. Enablement uses its acceptance window; enterprise and controlled execution also recheck current acceptance.','During recovery, preserve lockdown and validate restore evidence before unlocking.'),'notice','Observed database states only; no network reachability, provider credential expiry or latency is inferred. Trends count recorded attempt outcomes matching failure classifications, not every external failure.');
$$;

create or replace function ecod_completion_private.campaign_preview(ws uuid,p jsonb)returns jsonb language plpgsql volatile security invoker set search_path=''as $$
declare d ecod_completion_private.definitions;c uuid;at timestamptz;step jsonb;s jsonb;rows jsonb:='[]';eligible boolean:=true;
begin
 if exists(select 1 from jsonb_object_keys(p)x where x not in('definition','candidate','startAt'))or jsonb_typeof(p->'startAt')is distinct from'string'then raise exception 'Choose a campaign, candidate and explicit start time';end if;
 c:=(p->>'candidate')::uuid;at:=(p->>'startAt')::timestamptz;
 if at is null or at<clock_timestamp()-interval'5 minutes'or at>clock_timestamp()+interval'1 day'then raise exception 'Start within five minutes ago to one day ahead';end if;
 select *into d from ecod_completion_private.definitions where workspace_id=ws and kind='campaign'and id=(p->>'definition')::uuid;
 if not found or d.body->'enabled'is distinct from'true'::jsonb or exists(select 1 from ecod_completion_private.definitions where workspace_id=ws and kind=d.kind and name=d.name and version>d.version)then raise exception 'Choose the current enabled campaign';end if;
 for step in select value from jsonb_array_elements(d.body->'steps')loop
  s:=ecod_comms_private.source(ws,c,(step->>'template')::uuid,'{}');eligible:=eligible and s->'eligible'='true'::jsonb;
  rows:=rows||jsonb_build_array(jsonb_build_object('template',step->>'template','availableAt',at+interval'1 day'*(step->>'day')::integer,'source',s));
 end loop;
 s:=jsonb_build_object('definition',d.id,'version',d.version,'name',d.name,'candidate',c,'steps',rows,'eligible',eligible,'transport','test-only');
 return s||jsonb_build_object('head',ecod_journey_private.token(ws,s));
end $$;

create or replace function ecod_completion_private.api(a text,op uuid,h text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid;d ecod_completion_private.definitions;prior ecod_comms_private.receipts;req jsonb;r jsonb;rows jsonb;s jsonb;step jsonb;tpl ecod_comms_private.templates;k text;n text;last_day integer:=-1;day integer;cid uuid;intent uuid;step_number integer:=0;ids jsonb:='[]';target ecod_comms_private.receipts;name_head text;
begin
 if a is null or a not in('context','history','health','campaign-preview','definition','history-export','campaign-enroll','campaign-stop')or p is null or jsonb_typeof(p)<>'object'or octet_length(p::text)>12000 or off is null or off not between 0 and 10000 then raise exception 'Bounded completion request required';end if;
 if a='context'and(jsonb_typeof(coalesce(p->'query','""'::jsonb))<>'string'or length(coalesce(p->>'query',''))>200)then raise exception 'Bounded text search required';end if;
 ws:=ecod_access_private.member_workspace(a in('definition','history-export','campaign-enroll','campaign-stop'));
 if a='health'then perform ecod_ops_private.admin();return ecod_completion_private.health(ws);
 elsif a='history'then s:=ecod_completion_private.history(ws,p);return s||jsonb_build_object('head',ecod_journey_private.token(ws,s));
 elsif a='campaign-preview'then return ecod_completion_private.campaign_preview(ws,p);
 elsif a='context'then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select distinct on(kind,name)id,kind,name,version,body,at,ecod_journey_private.token(ws,to_jsonb(t))head from ecod_completion_private.definitions t where workspace_id=ws order by kind,name,version desc limit 101)x;
  r:=jsonb_build_object('definitions',case when jsonb_array_length(rows)>100 then rows-100 else rows end,'definitionsTruncated',jsonb_array_length(rows)>100,'emptyHead',ecod_journey_private.token(ws,'null'::jsonb));
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select e.id,e.candidate_id,e.result->>'name'name,e.result->>'definition'definition,e.at,c.name candidate,c."anthroId",coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'availableAt',i.available_at,'reason',i.reason)order by i.available_at,i.id)from ecod_comms_private.intents i where i.workspace_id=ws and e.result->'intents'@>jsonb_build_array(i.id)),'[]')steps,ecod_journey_private.token(ws,to_jsonb(e))head from ecod_comms_private.receipts e join public.candidates c on c.workspace_id=ws and c.id=e.candidate_id where e.workspace_id=ws and e.request->>'action'='campaign-enroll'and(coalesce(p->>'query','')=''or strpos(lower(c.name||' '||c."anthroId"),lower(p->>'query'))>0)order by e.at desc,e.id limit 26 offset off)x;
  return r||jsonb_build_object('enrollments',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'offset',off);
 end if;
 if op is null or h is null then raise exception 'Exact operation and reviewed head required';end if;
 perform 1 from public.workspaces where id=ws for update;
 req:=jsonb_build_object('action',a,'head',h,'payload',p);
 select *into prior from ecod_comms_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;
 if found then if prior.request<>req then raise exception 'Operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if a='definition'then
  if not public.is_admin()then raise exception 'Administrator required';end if;perform ecod_private.require_privileged_mfa(ws);
  k:=p->>'kind';n:=btrim(p->>'name');
  if k is null or k not in('campaign','report')or n is null or length(n)not between 1 and 100 or exists(select 1 from jsonb_object_keys(p)x where x not in('kind','name','body'))or jsonb_typeof(p->'body')is distinct from'object'then raise exception 'Named curated definition required';end if;
  select *into d from ecod_completion_private.definitions where workspace_id=ws and kind=k and name=n order by version desc limit 1;
  name_head:=ecod_journey_private.token(ws,case when d.id is null then'null'::jsonb else to_jsonb(d)end);
  if d.id is null and(select count(distinct(kind,name))from ecod_completion_private.definitions where workspace_id=ws)>=100 then raise exception 'Definition catalog limit reached';end if;
  if name_head is distinct from h then raise exception 'Definition changed; refresh and review';end if;
  if k='report'then perform ecod_completion_private.history(ws,p->'body');else
   if exists(select 1 from jsonb_object_keys(p->'body')x where x not in('enabled','steps'))or jsonb_typeof(p->'body'->'enabled')is distinct from'boolean'or jsonb_typeof(p->'body'->'steps')is distinct from'array'then raise exception 'Bounded campaign steps and enabled flag required';end if;
   if jsonb_array_length(p->'body'->'steps')not between 1 and 5 then raise exception 'Use one to five steps';end if;
   for step in select value from jsonb_array_elements(p->'body'->'steps')loop
    if jsonb_typeof(step)is distinct from'object'or exists(select 1 from jsonb_object_keys(step)x where x not in('template','day'))or jsonb_typeof(step->'day')is distinct from'number'or coalesce(step->>'day','')!~'^[0-9]{1,2}$'then raise exception 'A step needs a reviewed template and integer day';end if;
    day:=(step->>'day')::integer;if day not between 0 and 29 or day<=last_day then raise exception 'Step days must increase from 0 to 29';end if;last_day:=day;
    select *into tpl from ecod_comms_private.templates where workspace_id=ws and id=(step->>'template')::uuid;
    if not found or tpl.body->>'kind'not in('freshness-check','redeployment','custom')or exists(select 1 from ecod_comms_private.templates where workspace_id=ws and key=tpl.key and version>tpl.version)then raise exception 'Choose current re-engagement templates';end if;
   end loop;
   -- A new version (including pause) retires pending steps of the previous version.
   update ecod_comms_private.intents i set status='Cancelled',reason='Campaign definition changed; prepare a new reviewed enrollment',updated_at=clock_timestamp()where i.workspace_id=ws and i.status in('Queued','Retrying','Failed')and exists(select 1 from ecod_comms_private.receipts e where e.workspace_id=ws and e.request->>'action'='campaign-enroll'and e.result->>'name'=n and e.result->'intents'@>jsonb_build_array(i.id));
  end if;
  insert into ecod_completion_private.definitions(id,workspace_id,kind,name,version,body,actor)values(op,ws,k,n,coalesce(d.version,0)+1,p->'body',auth.uid());
  r:=jsonb_build_object('definition',op,'version',coalesce(d.version,0)+1,'status','Definition recorded');
 elsif a='history-export'then
  s:=ecod_completion_private.history(ws,p);if s->'truncated'='true'::jsonb then raise exception 'Narrow the grouping before aggregate export';end if;if ecod_journey_private.token(ws,s)is distinct from h then raise exception 'History changed; refresh before export';end if;
  r:=s||jsonb_build_object('status','Aggregate export recorded','operation',op);
 elsif a='campaign-enroll'then
  cid:=(p->>'candidate')::uuid;perform 1 from public.candidates where workspace_id=ws and id=cid for update;
  s:=ecod_completion_private.campaign_preview(ws,p);
  if s->>'head'is distinct from h or s->'eligible'is distinct from'true'::jsonb then raise exception 'Campaign source changed or suppressed; refresh and review';end if;
  if not exists(select 1 from ecod_comms_private.policy where workspace_id=ws and enabled)then raise exception 'Enable the test communication policy first';end if;
  if exists(select 1 from ecod_comms_private.receipts e join ecod_comms_private.intents i on i.workspace_id=e.workspace_id and e.result->'intents'@>jsonb_build_array(i.id)where e.workspace_id=ws and e.candidate_id=any(ecod_access_private.identity_family(ws,cid))and e.request->>'action'='campaign-enroll'and i.status in('Queued','Retrying'))then raise exception 'Candidate already has an active campaign';end if;
  if exists(select 1 from ecod_comms_private.intents i cross join lateral jsonb_array_elements(s->'steps')prepared(value) where i.workspace_id=ws and i.candidate_id=any(ecod_access_private.identity_family(ws,cid))and i.campaign_enrollment is null and i.status in('Queued','Retrying')and i.template_id=(prepared.value->>'template')::uuid and i.source_head=prepared.value->'source'->>'head'and abs(extract(epoch from i.available_at-(prepared.value->>'availableAt')::timestamptz))<86400)then raise exception 'Equivalent pending communication already exists';end if;
  if(select count(*)from ecod_comms_private.intents where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,cid)) and created_at>clock_timestamp()-interval'24 hours')+jsonb_array_length(s->'steps')>20 then raise exception 'Candidate daily preparation limit';end if;
  for step in select value from jsonb_array_elements(s->'steps')loop
   step_number:=step_number+1;intent:=gen_random_uuid();insert into ecod_comms_private.intents(id,workspace_id,candidate_id,template_id,context,source_head,preview,actor,available_at,expires_at,campaign_enrollment,campaign_step)values(intent,ws,cid,(step->>'template')::uuid,'{}',step->'source'->>'head',step->'source'->'preview',auth.uid(),greatest((step->>'availableAt')::timestamptz,clock_timestamp()),greatest((step->>'availableAt')::timestamptz,clock_timestamp())+interval'7 days',op,step_number);ids:=ids||jsonb_build_array(intent);
  end loop;
  r:=jsonb_build_object('enrollment',op,'definition',s->>'definition','name',s->>'name','version',s->'version','intents',ids,'status','Test campaign queued','transport','test-only');
 elsif a='campaign-stop'then
  if exists(select 1 from jsonb_object_keys(p)x where x not in('enrollment','reason'))or jsonb_typeof(p->'reason')is distinct from'string'or length(btrim(p->>'reason'))not between 10 and 1000 then raise exception 'Enrollment and stop evidence required';end if;
  select *into target from ecod_comms_private.receipts where workspace_id=ws and id=(p->>'enrollment')::uuid and request->>'action'='campaign-enroll'and ecod_journey_private.token(ws,to_jsonb(receipts))=h;
  if not found or ecod_journey_private.token(ws,to_jsonb(target))is distinct from h then raise exception 'Enrollment changed or unavailable';end if;cid:=target.candidate_id;
  update ecod_comms_private.intents set status='Cancelled',reason=p->>'reason',updated_at=clock_timestamp()where workspace_id=ws and target.result->'intents'@>jsonb_build_array(id)and status in('Queued','Retrying','Failed');
  r:=jsonb_build_object('status','Pending steps stopped','enrollment',target.id);
 end if;
 insert into ecod_comms_private.receipts(workspace_id,actor,id,candidate_id,request,result)values(ws,auth.uid(),op,cid,req,r);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when cid is null then'workspaces'else'candidates'end,coalesce(cid,ws),'completion_'||a,op::text,auth.uid()::text);
 return r||jsonb_build_object('replayed',false);
end $$;

-- Current access and an explicitly linked inbound Google message suppress pending steps.
-- SENT/DRAFT and DSN bounce messages cannot be treated as candidate replies.
create or replace function ecod_completion_private.campaign_allowed(ws uuid,intent uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select not exists(select 1 from ecod_comms_private.receipts e join ecod_completion_private.definitions d on d.workspace_id=e.workspace_id and d.id=(e.result->>'definition')::uuid where e.workspace_id=ws and e.request->>'action'='campaign-enroll'and e.result->'intents'@>jsonb_build_array(intent)and(d.body->'enabled'is distinct from'true'::jsonb or exists(select 1 from ecod_completion_private.definitions n where n.workspace_id=ws and n.kind='campaign'and n.name=d.name and n.version>d.version)or exists(select 1 from ecod_collaboration_private.messages m where m.workspace_id=ws and m.candidate_id=any(ecod_access_private.identity_family(ws,e.candidate_id))and not m.deleted and case when coalesce(m.body->>'receivedMs','')~'^[0-9]{1,16}$'then to_timestamp((m.body->>'receivedMs')::double precision/1000)>e.at and to_timestamp((m.body->>'receivedMs')::double precision/1000)<=clock_timestamp()else false end and not(m.body?'bounce')and jsonb_typeof(m.body->'labels')='array'and not(m.body->'labels'?|array['SENT','DRAFT','SPAM','TRASH'])and exists(select 1 from ecod_contacts_private.contacts ct where ct.workspace_id=ws and ct.candidate_id=any(ecod_access_private.identity_family(ws,e.candidate_id))and ct.kind='email'and ct.active and ct.verified_at between clock_timestamp()-interval'365 days'and clock_timestamp()and lower(ct.value)=m.body->>'senderEmail'))));
$$;
do $$ declare d text;begin
 d:=pg_get_functiondef('ecod_comms_private.run(integer)'::regprocedure);if strpos(d,'ecod_completion_private.campaign_allowed')=0 then
 d:=replace(d,'exit when n>=p_limit;n:=n+1;', 'exit when n>=p_limit;n:=n+1; if not ecod_completion_private.campaign_allowed(i.workspace_id,i.id)then update ecod_comms_private.intents other set status=''Suppressed'',reason=''Campaign changed or a linked candidate reply was received'',updated_at=clock_timestamp()where other.workspace_id=i.workspace_id and other.candidate_id=i.candidate_id and other.campaign_enrollment=i.campaign_enrollment and other.status in(''Queued'',''Retrying'',''Failed'');suppressed:=suppressed+1;continue;end if;');
 d:=replace(d,'if not exists(select 1 from public.memberships where workspace_id=i.workspace_id and user_id=i.actor and role in(''admin'',''recruiter''))then', 'if not ecod_enterprise_private.member_ok(i.workspace_id,i.actor)or not ecod_completion_private.campaign_allowed(i.workspace_id,i.id)or not exists(select 1 from public.memberships where workspace_id=i.workspace_id and user_id=i.actor and role in(''admin'',''recruiter''))then');execute d;end if;
end $$;
create or replace function public.api_completion_workflows(p_action text default'context',p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_completion_private.api(p_action,p_operation,p_head,p_payload,p_offset)$$;
revoke all on function ecod_completion_private.history(uuid,jsonb),ecod_completion_private.health(uuid),ecod_completion_private.campaign_preview(uuid,jsonb),ecod_completion_private.campaign_allowed(uuid,uuid),ecod_completion_private.api(text,uuid,text,jsonb,integer),public.api_completion_workflows(text,uuid,text,jsonb,integer)from public,anon,authenticated;
grant execute on function ecod_completion_private.api(text,uuid,text,jsonb,integer),public.api_completion_workflows(text,uuid,text,jsonb,integer)to authenticated;
do $$ declare d text; begin
 d:=pg_get_functiondef('ecod_private.subject_access_inventory(uuid,uuid)'::regprocedure);
 d:=replace(d,'''assessments'',''title,score,assessor,date,evidence,gap,skill,validUntil''','''assessments'',''title,score,assessor,date,evidence,gap,skill,validUntil,custom''');
 d:=replace(d,'''enrichment'',''title,description,due,owner,status,created,gapSkill''','''enrichment'',''title,description,due,owner,status,created,gapSkill,custom''');
 d:=replace(d,'''interviews'',''stage,scheduledAt,duration,mode,status,outcome,feedback,score''','''interviews'',''round,scheduledAt,durationMins,mode,status,recommendation,feedback,notes,completed,created,custom''');
 d:=replace(d,'''placements'',''status,startDate,endDate,engagementType,workMode,location,created''','''placements'',''status,startDate,endDate,engagementType,workMode,location,created,custom''');execute d;
end $$;
create index if not exists completion_lifecycle_date on public."lifecycleEvents"(workspace_id,occurred_at)where kind in('created','transition');
create index if not exists completion_readiness_date on public."readinessDecisions"(workspace_id,at);
create index if not exists completion_comms_attempt_date on ecod_comms_private.attempts(workspace_id,at);
create index if not exists completion_delivery_attempt_date on ecod_delivery_private.attempts(workspace_id,at);
create index if not exists completion_google_attempt_date on ecod_collaboration_private.attempts(workspace_id,at);
-- Offboarding and recovery stop future test steps immediately, including not-yet-due work.
do $$ declare d text;begin
 d:=pg_get_functiondef('ecod_enterprise_private.api(text,uuid,text,jsonb,integer)'::regprocedure);
 if strpos(d,'update ecod_comms_private.intents')=0 then d:=replace(d,'update ecod_external_private.work set status=''Suppressed'',reason=''Preparing actor offboarded''', 'update ecod_comms_private.intents set status=''Suppressed'',reason=''Preparing actor offboarded'',updated_at=clock_timestamp()where workspace_id=ws and actor=u and status in(''Queued'',''Retrying'');update ecod_external_private.work set status=''Suppressed'',reason=''Preparing actor offboarded''');execute d;end if;
 d:=pg_get_functiondef('ecod_processing_private.worker(text,jsonb)'::regprocedure);
 if strpos(d,'Recovery lockdown: prepare a new reviewed campaign')=0 then d:=replace(d,'update public.settings set custom=custom||','update ecod_comms_private.policy set enabled=false,updated_at=clock_timestamp();update ecod_comms_private.intents set status=''Suppressed'',reason=''Recovery lockdown: prepare a new reviewed campaign'',updated_at=clock_timestamp()where campaign_enrollment is not null and status in(''Queued'',''Retrying'',''Failed'');update public.settings set custom=custom||');execute d;end if;
end $$;
commit;
