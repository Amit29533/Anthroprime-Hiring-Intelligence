-- Stage 5: explicit, bounded operator jobs; no destructive or external transport.
begin;
create schema if not exists ecod_ops_private;
revoke all on schema ecod_ops_private from public,anon,authenticated;
create table if not exists ecod_ops_private.policy(
 workspace_id uuid primary key references public.workspaces(id),version integer not null default 1,
 body jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp());
create table if not exists ecod_ops_private.preferences(
 workspace_id uuid not null references public.workspaces(id),actor uuid not null,
 body jsonb not null,primary key(workspace_id,actor));
create table if not exists ecod_ops_private.jobs(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor uuid not null,
 kind text not null check(kind in('report','retention','erasure','bulk')),
 status text not null check(status in('Pending','Review','Applying','Completed','Cancelled')),
 version integer not null default 1,body jsonb not null,policy_version integer not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id));
create table if not exists ecod_ops_private.items(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,job_id uuid not null,
 candidate_id uuid not null,ordinal integer not null,
 state text not null default 'Pending' check(state in('Pending','Prepared','Completed','Failed','Stale','Skipped')),
 source_head text,result jsonb,code text not null default '',attempts integer not null default 0,
 unique(job_id,candidate_id),unique(job_id,ordinal),
 foreign key(workspace_id,job_id)references ecod_ops_private.jobs(workspace_id,id),
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create table if not exists ecod_ops_private.receipts(
 workspace_id uuid not null,actor uuid not null,id uuid not null,job_id uuid,
 request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,actor,id),foreign key(workspace_id,job_id)references ecod_ops_private.jobs(workspace_id,id));
create index if not exists ops_jobs_page on ecod_ops_private.jobs(workspace_id,created_at desc,id);
create index if not exists ops_items_batch on ecod_ops_private.items(workspace_id,job_id,state,ordinal);
create index if not exists ops_items_candidate on ecod_ops_private.items(workspace_id,candidate_id,job_id);
create index if not exists ops_receipts_job on ecod_ops_private.receipts(workspace_id,job_id);
do $$declare n text;begin foreach n in array array['policy','preferences','jobs','items','receipts']loop
 execute format('alter table ecod_ops_private.%I enable row level security',n);
 execute format('revoke all on ecod_ops_private.%I from public,anon,authenticated',n);
end loop;end$$;
create or replace function ecod_ops_private.policy_body(ws uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select coalesce((select body from ecod_ops_private.policy where workspace_id=ws),
 '{"enabled":false,"subjectDays":30,"feedbackHours":48,"taskGraceHours":24,"retentionMonths":24,"retentionReference":"Unapproved — review only"}'::jsonb)
$$;
create or replace function ecod_ops_private.admin()returns uuid language plpgsql security invoker set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);begin
 perform 1 from public.memberships where workspace_id=ws and user_id=auth.uid()and role='admin'for share;
 if not found then raise exception 'Administrator access required'using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);return ws;end$$;
create or replace function ecod_ops_private.profile_head(ws uuid,c uuid)returns text language plpgsql stable security invoker set search_path=''as $$
declare family uuid[]:=ecod_access_private.identity_family(ws,c);cases jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_array(x.id,x.version,x.status,x.verified_at,x.due_date)order by x.id),'[]')into cases from(select id,version,status,verified_at,due_date from ecod_private.subject_requests where workspace_id=ws and candidate_id=any(family)order by id limit 2001)x;
 if jsonb_array_length(cases)>2000 then raise exception 'Subject coverage exceeds its safe limit; use a reviewed manual inventory';end if;
 return ecod_journey_private.token(ws,jsonb_build_array(ecod_access_private.candidate_token(c),family,cases,(statement_timestamp()at time zone'UTC')::date));
end$$;
-- Preserve the source inventory before registering this job's own review metadata.
-- This avoids a dry run invalidating itself as its result/receipt is recorded.
do $$declare definition text;begin
 if to_regprocedure('ecod_ops_private.source_inventory(uuid,uuid)')is null then
  definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
  definition:=replace(definition,'ecod_private.erasure_inventory','ecod_ops_private.source_inventory');execute definition;
 end if;
end$$;
create or replace function ecod_ops_private.health(ws uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('generatedAt',clock_timestamp(),'scope','Current workspace counts; worker heartbeats are global',
 'queues',jsonb_build_array(
 jsonb_build_object('kind','workflow','pending',(select count(*)from public."executionJobs"where workspace_id=ws and status='pending'),'failed',(select count(*)from public."executionJobs"where workspace_id=ws and status='failed'),'oldest',(select min(created)from public."executionJobs"where workspace_id=ws and status='pending')),
 jsonb_build_object('kind','index','pending',(select count(*)from public."indexJobs"where workspace_id=ws and status in('pending','processing')),'failed',(select count(*)from public."indexJobs"where workspace_id=ws and status='failed'),'oldest',(select min(available_at)from public."indexJobs"where workspace_id=ws and status in('pending','processing'))),
 jsonb_build_object('kind','interview','pending',(select count(*)from ecod_private.interview_reminders where workspace_id=ws and status='retrying'),'failed',(select count(*)from ecod_private.interview_reminders where workspace_id=ws and status='failed'),'lastRun',(select last_run from ecod_private.interview_reminder_worker_health where singleton)),
 jsonb_build_object('kind','freshness','pending',(select count(*)from ecod_private.freshness_receipts where workspace_id=ws and status='retrying'),'failed',(select count(*)from ecod_private.freshness_receipts where workspace_id=ws and status='failed'),'lastRun',(select last_run from ecod_private.freshness_worker_health where singleton)),
 jsonb_build_object('kind','communication-test','pending',(select count(*)from ecod_comms_private.intents where workspace_id=ws and status in('Queued','Retrying')),'failed',(select count(*)from ecod_comms_private.intents where workspace_id=ws and status='Failed'),'lastRun',(select at from ecod_comms_private.health where singleton)),
 jsonb_build_object('kind','operations','pending',(select count(*)from ecod_ops_private.jobs where workspace_id=ws and status in('Pending','Review','Applying')),'failed',(select count(*)from ecod_ops_private.items where workspace_id=ws and state in('Failed','Stale')))),
 'destructiveExecution',false,'externalDelivery',false)
$$;
create or replace function ecod_ops_private.sla(p_save boolean,p_preferences jsonb,p_offset integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);prefs jsonb;policy jsonb:=ecod_ops_private.policy_body(ws);rows jsonb;counts jsonb;isadmin boolean;hour integer:=extract(hour from clock_timestamp()at time zone'UTC');quiet boolean;
begin
 if p_save is null or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid SLA request';end if;
 if p_save then
  if jsonb_typeof(p_preferences)is distinct from'object'or(select count(*)from jsonb_object_keys(p_preferences))<>3
   or jsonb_typeof(p_preferences->'enabled')is distinct from'boolean'
   or jsonb_typeof(p_preferences->'quietStart')is distinct from'number'or jsonb_typeof(p_preferences->'quietEnd')is distinct from'number'
   or(p_preferences->>'quietStart')!~'^[0-9]{1,2}$'or(p_preferences->>'quietEnd')!~'^[0-9]{1,2}$'
   or(p_preferences->>'quietStart')::int not between 0 and 23 or(p_preferences->>'quietEnd')::int not between 0 and 23
   or exists(select 1 from jsonb_object_keys(p_preferences)k where k<>all(array['enabled','quietStart','quietEnd']))then raise exception 'Invalid internal notification preferences';end if;
  insert into ecod_ops_private.preferences values(ws,auth.uid(),p_preferences)on conflict(workspace_id,actor)do update set body=excluded.body;
 end if;
 select body into prefs from ecod_ops_private.preferences where workspace_id=ws and actor=auth.uid();
 prefs:=coalesce(prefs,'{"enabled":false,"quietStart":0,"quietEnd":0}'::jsonb);
 isadmin:=exists(select 1 from public.memberships where workspace_id=ws and user_id=auth.uid()and role='admin');
 if isadmin then perform ecod_private.require_privileged_mfa(ws);end if;
 quiet:=case when prefs->>'quietStart'=prefs->>'quietEnd'then false when(prefs->>'quietStart')::int<(prefs->>'quietEnd')::int then hour>=(prefs->>'quietStart')::int and hour<(prefs->>'quietEnd')::int else hour>=(prefs->>'quietStart')::int or hour<(prefs->>'quietEnd')::int end;
 with work as materialized(
 select 'task'kind,t.id,t."candidateId"candidate_id,(t.due::timestamp at time zone'UTC')+interval'1 day'+make_interval(hours=>(policy->>'taskGraceHours')::int)deadline from public.tasks t where t.workspace_id=ws and not t.done and t.due is not null
 union all select 'subject',r.id,r.candidate_id,coalesce((r.due_date::timestamp at time zone'UTC')+interval'1 day',r.created_at+make_interval(days=>(policy->>'subjectDays')::int))from ecod_private.subject_requests r where r.workspace_id=ws and r.status not in('closed','declined')and isadmin
 union all select 'proposal',p.id,p.candidate_id,p.at+make_interval(hours=>(policy->>'feedbackHours')::int)from ecod_feedback_private.proposals p where p.workspace_id=ws and p.status='Pending'
 union all select 'response',r.id,r.candidate_id,r.at+make_interval(hours=>(policy->>'feedbackHours')::int)from ecod_feedback_private.responses r where r.workspace_id=ws and r.disposition='Pending'),
 page as(select *from work where deadline<=clock_timestamp()order by deadline,id limit 26 offset p_offset)
 select coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'candidateId',candidate_id,'deadline',deadline)order by deadline,id)from page),'[]'),
 coalesce((select jsonb_object_agg(kind,n)from(select kind,count(*)n from work where deadline<=clock_timestamp()group by kind)x),'{}')into rows,counts;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'counts',counts,'preferences',prefs,'policyEnabled',policy->'enabled','noticeEnabled',policy->'enabled'='true'::jsonb and prefs->'enabled'='true'::jsonb and not quiet,'quiet',quiet,'timezone','UTC');
end$$;
create or replace function ecod_ops_private.console(p_action text,p_operation uuid,p_job uuid,p_version integer,p_payload jsonb,p_offset integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_ops_private.admin();j ecod_ops_private.jobs;prior ecod_ops_private.receipts;item ecod_ops_private.items;
 req jsonb:=jsonb_build_array(p_action,p_job,p_version,p_payload);result jsonb;rows jsonb;policy jsonb;pv integer;person public.candidates;scope jsonb;head text;entry jsonb;selection uuid[];n integer;at timestamptz:=clock_timestamp();failure_code text;run_status text;run_kind text;
begin
 if p_action is null or p_action<>all(array['context','detail','search','policy','start','step','confirm','cancel','retry','export','health-export'])or p_offset is null or p_offset not between 0 and 10000 or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>40000 then raise exception 'Invalid operations request';end if;
 -- Serialize all operator mutations with the workspace, before candidate/job locks.
 if p_action not in('context','detail','search')then perform pg_advisory_xact_lock(hashtextextended('operations:'||ws::text,0));end if;
 select coalesce(p.version,0),coalesce(p.body,ecod_ops_private.policy_body(ws))into pv,policy from(values(ws))w(id)left join ecod_ops_private.policy p on p.workspace_id=w.id;
 if p_action='context'then
  select coalesce(jsonb_agg(to_jsonb(x)order by created_at desc,id),'[]')into rows from(select id,kind,status,version,created_at,updated_at,(select count(*)from ecod_ops_private.items i where i.job_id=q.id)total,(select count(*)from ecod_ops_private.items i where i.job_id=q.id and i.state not in('Pending','Prepared'))processed from ecod_ops_private.jobs q where workspace_id=ws order by created_at desc,id limit 26 offset p_offset)x;
  return jsonb_build_object('workspaceId',ws,'policy',policy,'policyVersion',pv,'health',ecod_ops_private.health(ws),'jobs',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 if p_action='search'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['query','filter']))or length(coalesce(p_payload->>'query',''))>100 or coalesce(p_payload->>'filter','all')<>all(array['all','retention','held'])then raise exception 'Invalid candidate search';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by "anthroId"),'[]')into rows from(select id,"anthroId",left(name,150)name from public.candidates where workspace_id=ws and "mergedInto"is null and(coalesce(p_payload->>'filter','all')='all'or p_payload->>'filter'='held'and "processingRestricted"or p_payload->>'filter'='retention'and(verified is null or verified<(at at time zone'UTC')::date-make_interval(months=>(policy->>'retentionMonths')::int)))and (coalesce(p_payload->>'query','')=''or strpos(lower(name),lower(p_payload->>'query'))>0 or strpos(lower("anthroId"),lower(p_payload->>'query'))>0)order by "anthroId"limit 26 offset p_offset)x;
  perform ecod_access_private.audit_candidate_reads(ws,rows,'Operations candidate selection');
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 if p_action='detail'then
  select *into j from ecod_ops_private.jobs where workspace_id=ws and id=p_job;if not found then raise exception 'Job unavailable'using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by ordinal),'[]')into rows from(select i.id,i.candidate_id,i.ordinal,i.state,i.result,i.code,i.attempts from ecod_ops_private.items i where i.workspace_id=ws and i.job_id=j.id order by i.ordinal limit 26 offset p_offset)x;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'kind',j.kind,'status',j.status,'version',j.version,'body',j.body,'createdAt',j.created_at,'policyVersion',j.policy_version),'rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'counts',(select coalesce(jsonb_object_agg(x.state,x.n),'{}')from(select state,count(*)n from ecod_ops_private.items where job_id=j.id group by state)x));
 end if;
 if p_operation is null then raise exception 'Operation UUID required';end if;
 select *into prior from ecod_ops_private.receipts where workspace_id=ws and actor=auth.uid()and id=p_operation;
 if found then if prior.request<>req then raise exception 'Operation conflict'using errcode='40001';end if;return prior.result;end if;
 if p_action='policy'then
  if p_version is distinct from pv then raise exception 'Policy changed; refresh'using errcode='40001';end if;
  if(select count(*)from jsonb_object_keys(p_payload))<>6 or exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['enabled','subjectDays','feedbackHours','taskGraceHours','retentionMonths','retentionReference']))or jsonb_typeof(p_payload->'enabled')is distinct from'boolean'
   or(p_payload->>'subjectDays')!~'^[0-9]{1,3}$'or(p_payload->>'subjectDays')::int not between 1 and 365
   or(p_payload->>'feedbackHours')!~'^[0-9]{1,3}$'or(p_payload->>'feedbackHours')::int not between 1 and 720
   or(p_payload->>'taskGraceHours')!~'^[0-9]{1,3}$'or(p_payload->>'taskGraceHours')::int not between 0 and 168
   or(p_payload->>'retentionMonths')!~'^[0-9]{1,3}$'or(p_payload->>'retentionMonths')::int not between 1 and 120
   or jsonb_typeof(p_payload->'retentionReference')is distinct from'string'or length(btrim(p_payload->>'retentionReference'))not between 10 and 500
   or not(p_payload?&array['enabled','subjectDays','feedbackHours','taskGraceHours','retentionMonths','retentionReference'])then raise exception 'Invalid SLA/retention policy';end if;
  insert into ecod_ops_private.policy values(ws,pv+1,p_payload,auth.uid(),at)on conflict(workspace_id)do update set version=excluded.version,body=excluded.body,actor=excluded.actor,at=excluded.at;
  result:=jsonb_build_object('policyVersion',pv+1);
 elsif p_action='health-export'then
  if p_payload<>'{}'::jsonb then raise exception 'Health evidence accepts no contents';end if;
  if(select count(*)from ecod_ops_private.receipts r where r.workspace_id=ws and r.actor=auth.uid()and r.request->>0='health-export'and r.at>clock_timestamp()-interval'1 minute')>=6 then raise exception 'Health export quota reached';end if;
  result:=ecod_ops_private.health(ws);
 elsif p_action='start'then
  if p_job is null or jsonb_typeof(p_payload->'kind')is distinct from'string'or p_payload->>'kind'<>all(array['report','retention','erasure','bulk'])or not(p_payload?&array['kind','anthroIds','reason'])or exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['kind','anthroIds','reason','owner','nextAction']))or jsonb_typeof(p_payload->'anthroIds')is distinct from'array'or jsonb_array_length(p_payload->'anthroIds')not between 1 and 250 or jsonb_typeof(p_payload->'reason')is distinct from'string'or length(btrim(p_payload->>'reason'))not between 10 and 1000 then raise exception 'Choose 1–250 unique Anthro-IDs and a review reason';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'anthroIds')x where jsonb_typeof(x)<>'string'or x#>>'{}'!~'^ANTHRO-[0-9]{5}$')or(select count(distinct x)from jsonb_array_elements_text(p_payload->'anthroIds')x)<>jsonb_array_length(p_payload->'anthroIds')then raise exception 'Invalid or duplicate Anthro-ID';end if;
  if p_payload->>'kind'='bulk'and(not(p_payload?&array['owner','nextAction'])or jsonb_typeof(p_payload->'owner')is distinct from'string'or jsonb_typeof(p_payload->'nextAction')is distinct from'string'or length(p_payload->>'owner')>120 or length(p_payload->>'nextAction')>1000)then raise exception 'Bulk owner/action limits exceeded';end if;
  if p_payload->>'kind'<>'bulk'and(p_payload?'owner'or p_payload?'nextAction')then raise exception 'Only bulk jobs accept owner/action fields';end if;
  if(select count(*)from ecod_ops_private.jobs where workspace_id=ws and status in('Pending','Review','Applying'))>=10 or(select count(*)from ecod_ops_private.jobs where workspace_id=ws and created_at>at-interval'1 day')>=50 then raise exception 'Operations quota reached';end if;
  select array_agg(c.id order by c.id)into selection from public.candidates c where c.workspace_id=ws and c."mergedInto"is null and c."anthroId"in(select jsonb_array_elements_text(p_payload->'anthroIds'));
  if cardinality(selection)is distinct from jsonb_array_length(p_payload->'anthroIds')then raise exception 'One or more identities unavailable'using errcode='42501';end if;
  perform 1 from public.candidates where workspace_id=ws and id=any(selection)order by id for share;
  if exists(select 1 from public.candidates where workspace_id=ws and id=any(selection)and "mergedInto"is not null)then raise exception 'Identity changed during selection; refresh'using errcode='40001';end if;
  insert into ecod_ops_private.jobs(id,workspace_id,actor,kind,status,body,policy_version)values(p_job,ws,auth.uid(),p_payload->>'kind','Pending',p_payload-'anthroIds'||jsonb_build_object('retentionMonths',policy->'retentionMonths','retentionReference',policy->'retentionReference'),pv);
  insert into ecod_ops_private.items(workspace_id,job_id,candidate_id,ordinal)select ws,p_job,candidate,ordinal from unnest(selection)with ordinality as s(candidate,ordinal);
  perform ecod_access_private.audit_candidate_reads(ws,(select jsonb_agg(jsonb_build_object('id',x))from unnest(selection)x),'Operations job selection');
  result:=jsonb_build_object('id',p_job,'version',1,'status','Pending','total',cardinality(selection));
 else
  -- Same lock order as candidate/profile mutation: workspace, candidates, journal.
  select status,kind into run_status,run_kind from ecod_ops_private.jobs where workspace_id=ws and id=p_job;
  perform 1 from public.candidates where workspace_id=ws and id in(select candidate_id from ecod_ops_private.items where workspace_id=ws and job_id=p_job and(p_action<>'step'or state=case when run_status='Applying'then'Prepared'else'Pending'end)order by ordinal limit case when p_action='step'then case when run_kind='erasure'then 1 else 10 end else 250 end)order by id for update;
  select *into j from ecod_ops_private.jobs where workspace_id=ws and id=p_job for update;if not found then raise exception 'Job unavailable'using errcode='42501';end if;
  if p_version is distinct from j.version then raise exception 'Job changed; refresh before acting'using errcode='40001';end if;
  if p_payload<>'{}'::jsonb then raise exception 'This job action accepts no changed contents';end if;
  if p_action='cancel'then
   if j.status in('Completed','Cancelled')then raise exception 'Job already ended';end if;j.status:='Cancelled';
  elsif p_action='retry'then
   if j.status='Cancelled'or not exists(select 1 from ecod_ops_private.items where job_id=j.id and state in('Failed','Stale'))then raise exception 'No recoverable items';end if;
   if j.kind='bulk'and exists(select 1 from ecod_ops_private.items where job_id=j.id and state='Completed')then raise exception 'Applied bulk job cannot be re-prepared; start a new selection';end if;
   if exists(select 1 from ecod_ops_private.items where job_id=j.id and state in('Failed','Stale')and attempts>=5)then raise exception 'Five attempts exhausted; review the cause before starting a fresh job';end if;
   update ecod_ops_private.items set state='Pending',result=null,source_head=null,code=''where job_id=j.id and state in('Failed','Stale');j.status:='Pending';
  elsif p_action='confirm'then
   if j.kind<>'bulk'or j.status<>'Review'or exists(select 1 from ecod_ops_private.items where job_id=j.id and state<>'Prepared')then raise exception 'All bulk items must have a successful preview';end if;
   if j.created_at<at-interval'1 day'or j.policy_version<>pv then raise exception 'Preview or policy expired; prepare a new job';end if;
   for item in select *from ecod_ops_private.items where job_id=j.id order by ordinal loop
    select *into person from public.candidates where workspace_id=ws and id=item.candidate_id;
    if person."mergedInto"is not null or person."processingRestricted"or ecod_access_private.candidate_token(person.id)<>item.source_head then raise exception 'Bulk source changed; prepare a new job'using errcode='40001';end if;
   end loop;j.status:='Applying';
  elsif p_action='step'then
   if j.status not in('Pending','Applying')then raise exception 'Job is not runnable';end if;
   if j.created_at<at-interval'7 days'then raise exception 'Job expired; cancel and create a fresh job';end if;
   for item in select *from ecod_ops_private.items where job_id=j.id and state=case when j.status='Applying'then'Prepared'else'Pending'end order by ordinal limit case when j.kind='erasure'then 1 else 10 end for update loop
    begin
     select *into person from public.candidates where workspace_id=ws and id=item.candidate_id;
     if not found or person."mergedInto"is not null then raise exception 'Current identity required'using errcode='40001';end if;
     if j.status='Applying'then
      if person."processingRestricted"or ecod_access_private.candidate_token(person.id)<>item.source_head then raise exception 'Source changed'using errcode='40001';end if;
      perform public.api_candidate_quick_edit(person.id,item.source_head,j.body->>'owner',j.body->>'nextAction');
      entry:=item.result||jsonb_build_object('appliedAt',at);head:=item.source_head;
     elsif j.kind='erasure'then
      scope:=ecod_ops_private.source_inventory(ws,person.id);head:=scope->>'fingerprint';
      entry:=jsonb_build_object('anthroId',person."anthroId",'inventory',scope-'fingerprint','coverage','57 source categories plus operations metadata in reviewed erasure inventory','manualAreas',jsonb_build_array('Private unlinked records and arbitrary text','External copies and downloads','Original object existence','Backups and restore handling'),'destructiveExecution',false);
     else
      head:=case when j.kind='bulk'then ecod_access_private.candidate_token(person.id)else ecod_ops_private.profile_head(ws,person.id)end;
      entry:=jsonb_build_object('anthroId',person."anthroId",'preparedAt',at,'verified',person.verified,'status',person.status,'held',person."processingRestricted",'owner',left(person.owner,120),'nextAction',left(person."nextAction",1000),'retentionDue',person.verified is null or person.verified<(at at time zone'UTC')::date-make_interval(months=>(j.body->>'retentionMonths')::int),'futureProfileDate',person.verified>(at at time zone'UTC')::date,'activeSubjectRequests',(select count(*)from ecod_private.subject_requests where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,person.id))and status not in('closed','declined')));
      if j.kind='bulk'then
       if person."processingRestricted"then raise exception 'Processing hold'using errcode='40001';end if;
       entry:=entry||jsonb_build_object('proposedOwner',j.body->>'owner','proposedNextAction',j.body->>'nextAction');
      end if;
     end if;
     update ecod_ops_private.items set state=case when j.kind='bulk'and j.status<>'Applying'then'Prepared'else'Completed'end,source_head=head,result=entry,code='',attempts=attempts+1 where id=item.id;
    exception when others then
     get stacked diagnostics failure_code=returned_sqlstate;
     update ecod_ops_private.items set state=case when failure_code='40001'then'Stale'else'Failed'end,code=case when failure_code='40001'then'SOURCE_CHANGED'else'INVENTORY_OR_WRITE_FAILED:'||failure_code end,attempts=attempts+1 where id=item.id;
    end;
   end loop;
   if not exists(select 1 from ecod_ops_private.items where job_id=j.id and state=case when j.status='Applying'then'Prepared'else'Pending'end)then j.status:=case when j.kind='bulk'and j.status='Pending'then'Review'else'Completed'end;end if;
  elsif p_action='export'then
   if j.status<>'Completed'or exists(select 1 from ecod_ops_private.items where job_id=j.id and state<>'Completed')then raise exception 'Only fully successful completed jobs can be exported';end if;
   if j.created_at<at-interval'7 days'then raise exception 'Export snapshot expired';end if;
   for item in select *from ecod_ops_private.items where job_id=j.id order by ordinal loop
    select *into person from public.candidates where workspace_id=ws and id=item.candidate_id;
    if person."mergedInto"is not null then raise exception 'Identity changed; run a fresh job'using errcode='40001';end if;
    if j.kind='erasure'then head:=ecod_ops_private.source_inventory(ws,person.id)->>'fingerprint';elsif j.kind='bulk'then head:=item.source_head;else head:=ecod_ops_private.profile_head(ws,person.id);end if;
    if j.kind<>'bulk'and head<>item.source_head then raise exception 'Snapshot changed; run a fresh job'using errcode='40001';end if;
   end loop;
   if(select count(*)from ecod_ops_private.receipts r where r.workspace_id=ws and r.actor=auth.uid()and r.request->>0='export'and r.at>clock_timestamp()-interval'1 minute')>=6 then raise exception 'Export quota reached';end if;
   result:=jsonb_build_object('id',j.id,'kind',j.kind,'snapshotAt',j.created_at,'policyVersion',j.policy_version,'coverage','Explicit selected identities; not the entire repository','rows',(select jsonb_agg(i.result order by i.ordinal)from ecod_ops_private.items i where i.job_id=j.id),'destructiveExecution',false);
   if octet_length(result::text)>2097152 then raise exception 'Export exceeds its 2 MiB budget; use smaller selections';end if;
  end if;
  if p_action<>'export'then
   update ecod_ops_private.jobs set status=j.status,version=version+1,updated_at=at where id=j.id returning version into n;
   result:=jsonb_build_object('id',j.id,'version',n,'status',j.status);
  end if;
 end if;
 insert into ecod_ops_private.receipts(workspace_id,actor,id,job_id,request,result)values(ws,auth.uid(),p_operation,case when p_action in('policy','health-export')then null else p_job end,req,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'operations',coalesce(p_job,ws),'Operations '||p_action,'Bounded operator action; no source content',auth.uid()::text);
 return result;
end$$;
create or replace function public.api_operations(p_action text default'context',p_operation uuid default null,p_job uuid default null,p_version integer default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_ops_private.console(p_action,p_operation,p_job,p_version,p_payload,p_offset)$$;
create or replace function public.api_sla_worklist(p_save boolean default false,p_preferences jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_ops_private.sla(p_save,p_preferences,p_offset)$$;
revoke all on all functions in schema ecod_ops_private from public,anon,authenticated;
revoke all on function public.api_operations(text,uuid,uuid,integer,jsonb,integer),public.api_sla_worklist(boolean,jsonb,integer)from public,anon,authenticated;
grant usage on schema ecod_ops_private to authenticated;
grant execute on function ecod_ops_private.console(text,uuid,uuid,integer,jsonb,integer),ecod_ops_private.sla(boolean,jsonb,integer),public.api_operations(text,uuid,uuid,integer,jsonb,integer),public.api_sla_worklist(boolean,jsonb,integer)to authenticated;
-- Include job metadata in the reviewed D7 inventory. Job dry runs use the source
-- inventory above, and report this exclusion explicitly rather than claiming deletion.
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
 if strpos(definition,'operationsJobs')=0 then
  definition:=replace(definition,'(''feedbackReceipts'',''integrations'')','(''feedbackReceipts'',''integrations''),(''operationsJobs'',''integrations''),(''operationsItems'',''integrations''),(''operationsReceipts'',''integrations'')');
  definition:=replace(definition,'predicate:=case d.name','predicate:=case d.name when ''operationsItems''then''t.candidate_id=any($1)''when ''operationsJobs''then''t.id in(select job_id from ecod_ops_private.items where workspace_id=$2 and candidate_id=any($1))''when ''operationsReceipts''then''t.job_id in(select job_id from ecod_ops_private.items where workspace_id=$2 and candidate_id=any($1))''');
  definition:=replace(definition,'case when d.name in(''feedbackGrants''','case when d.name in(''operationsJobs'',''operationsItems'',''operationsReceipts'')then''ecod_ops_private''when d.name in(''feedbackGrants''');
  definition:=replace(definition,'case d.name when''feedbackGrants''','case d.name when''operationsJobs''then''jobs''when''operationsItems''then''items''when''operationsReceipts''then''receipts''when''feedbackGrants''');execute definition;
 end if;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 if strpos(definition,'operations job metadata')=0 then definition:=replace(definition,'survey responses and their operation receipts','survey responses and their operation receipts, operations job metadata, dry-run results and recovery/export receipts');execute definition;end if;
end$$;
commit;
