begin;
create schema if not exists ecod_worklist_private;
revoke all on schema ecod_worklist_private from public,anon,authenticated;
create table if not exists ecod_worklist_private.preferences(workspace_id uuid not null references public.workspaces(id),actor uuid not null,horizon integer not null default 7 check(horizon between 1 and 30),bucket text not null default 'tasks' check(bucket in ('tasks','followups','interviews','client-feedback')),primary key(workspace_id,actor));
create table if not exists ecod_worklist_private.receipts(workspace_id uuid not null,actor uuid not null,operation_id uuid not null,candidate_id uuid,kind text not null,entity_id uuid not null,request_hash text not null,state boolean not null,result jsonb not null,sequence bigint generated always as identity,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,operation_id));
create index if not exists worklist_receipt_entity on ecod_worklist_private.receipts(workspace_id,kind,entity_id,sequence desc);
alter table ecod_worklist_private.preferences enable row level security;
alter table ecod_worklist_private.receipts enable row level security;
revoke all on all tables in schema ecod_worklist_private from public,anon,authenticated;
create or replace function ecod_worklist_private.feedback_state(ws uuid,entity uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select state from ecod_worklist_private.receipts where workspace_id=ws and kind='client-feedback' and entity_id=entity order by sequence desc limit 1),false)
$$;
create or replace function ecod_worklist_private.rows(ws uuid,days integer) returns table(kind text,id uuid,candidate_id uuid,demand_id uuid,title text,due date,state boolean,version text)
language sql stable security invoker set search_path='' as $$
 select 'tasks',t.id,t."candidateId",t."demandId",left(t.title,200),t.due,t.done,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') from public.tasks t where t.workspace_id=ws and (t.due is null or t.due<=(clock_timestamp() at time zone 'UTC')::date+days)
 union all select 'followups',n.id,n."candidateId",null::uuid,left(n.text,200),n."followUp",n.completed,null::text from public.notes n where n.workspace_id=ws and n."followUp" is not null and n."followUp"<=(clock_timestamp() at time zone 'UTC')::date+days
 union all select 'interviews',i.id,i."candidateId",i."demandId",left(i.round,200),(i."scheduledAt" at time zone 'UTC')::date,false,null::text from public.interviews i where i.workspace_id=ws and i.status='Scheduled' and (i."scheduledAt" at time zone 'UTC')::date<=(clock_timestamp() at time zone 'UTC')::date+days
 union all select 'client-feedback',f.id,f.candidate_id,p.demand_id,left('Client '||f.kind||': '||coalesce(p.content->>'name','Candidate'),200),(f.at at time zone 'UTC')::date,ecod_worklist_private.feedback_state(ws,f.id),encode(sha256(convert_to(jsonb_build_array(to_jsonb(f),ecod_worklist_private.feedback_state(ws,f.id))::text,'UTF8')),'hex') from ecod_client_private.feedback f join ecod_client_private.packs p on p.workspace_id=f.workspace_id and p.id=f.pack_id where f.workspace_id=ws
$$;
create or replace function ecod_worklist_private.read(p_kind text,p_offset integer,p_days integer,p_completed boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();rows jsonb;counts jsonb;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('tasks','followups','interviews','client-feedback') or p_offset is null or p_offset not between 0 and 10000 or p_days is null or p_days not between 1 and 30 or p_completed is null then raise exception 'Invalid worklist filters';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by due nulls last,id),'[]') into rows from(select r.*,r.due<(clock_timestamp() at time zone 'UTC')::date and not r.state as overdue from ecod_worklist_private.rows(ws,p_days)r where r.kind=p_kind and r.state=p_completed order by due nulls last,id limit 26 offset p_offset)x;
 select coalesce(jsonb_object_agg(kind,jsonb_build_object('pending',pending,'overdue',overdue,'completed',completed)),'{}') into counts from(select kind,count(*) filter(where not state) pending,count(*) filter(where not state and due<(clock_timestamp() at time zone 'UTC')::date) overdue,count(*) filter(where state) completed from ecod_worklist_private.rows(ws,p_days) group by kind)c;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'counts',counts,'timezone','UTC');
end $$;
create or replace function ecod_worklist_private.prefs(p_save boolean,p_kind text,p_days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();result jsonb;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_save is null then raise exception 'Choose read or save';end if;
 if p_save then
  if p_kind is null or p_kind not in ('tasks','followups','interviews','client-feedback') or p_days is null or p_days not between 1 and 30 then raise exception 'Invalid display preferences';end if;
  insert into ecod_worklist_private.preferences values(ws,auth.uid(),p_days,p_kind) on conflict(workspace_id,actor) do update set horizon=excluded.horizon,bucket=excluded.bucket;
 end if;
 select jsonb_build_object('horizon',horizon,'bucket',bucket) into result from ecod_worklist_private.preferences where workspace_id=ws and actor=auth.uid();
 return coalesce(result,'{"horizon":7,"bucket":"tasks"}'::jsonb);
end $$;
create or replace function ecod_worklist_private.act(p_operation uuid,p_kind text,p_id uuid,p_version text,p_state boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();actor_id uuid:=auth.uid();req text;receipt ecod_worklist_private.receipts;t public.tasks;f ecod_client_private.feedback;person uuid;version text;result jsonb;
begin
 if actor_id is null or ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501';end if;
 if p_operation is null or p_id is null or p_state is null or p_kind is null or p_kind not in ('tasks','client-feedback') or p_version is null or p_version!~'^[a-f0-9]{64}$' then raise exception 'Invalid worklist action';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||actor_id::text||':'||p_operation::text,0));
 req:=encode(sha256(convert_to(jsonb_build_array(p_kind,p_id,p_version,p_state)::text,'UTF8')),'hex');
 select * into receipt from ecod_worklist_private.receipts where workspace_id=ws and actor=actor_id and operation_id=p_operation;
 if found then if receipt.request_hash<>req then raise exception 'Worklist operation conflict' using errcode='40001';end if;return receipt.result||jsonb_build_object('replayed',true);end if;
 if p_kind='tasks' then
  select "candidateId" into person from public.tasks where workspace_id=ws and id=p_id;
  perform 1 from public.candidates where workspace_id=ws and id=person for share;
  select * into t from public.tasks where workspace_id=ws and id=p_id for update;
  if t.id is null then raise exception 'Task unavailable';end if;
  if t."candidateId" is distinct from person then raise exception 'Task identity changed; refresh' using errcode='40001';end if;
  version:=encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex');
 else
  select * into f from ecod_client_private.feedback where workspace_id=ws and id=p_id for update;
  if f.id is null then raise exception 'Feedback unavailable';end if;person:=f.candidate_id;
  version:=encode(sha256(convert_to(jsonb_build_array(to_jsonb(f),ecod_worklist_private.feedback_state(ws,f.id))::text,'UTF8')),'hex');
 end if;
 if version<>p_version then raise exception 'Work changed; refresh before deciding' using errcode='40001';end if;
 if p_kind='tasks' then update public.tasks set done=p_state where workspace_id=ws and id=p_id;end if;
 result:=jsonb_build_object('id',p_id,'kind',p_kind,'state',p_state);
 insert into ecod_worklist_private.receipts(workspace_id,actor,operation_id,candidate_id,kind,entity_id,request_hash,state,result)values(ws,actor_id,p_operation,person,p_kind,p_id,req,p_state,result);
 return result||jsonb_build_object('replayed',false);
end $$;
create or replace function public.api_recruiter_worklist(p_kind text default 'tasks',p_offset integer default 0,p_days integer default 7,p_completed boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$select ecod_worklist_private.read(p_kind,p_offset,p_days,p_completed)$$;
create or replace function public.api_worklist_preferences(p_save boolean default false,p_kind text default 'tasks',p_days integer default 7) returns jsonb language sql security invoker set search_path='' as $$select ecod_worklist_private.prefs(p_save,p_kind,p_days)$$;
create or replace function public.api_worklist_action(p_operation uuid,p_kind text,p_id uuid,p_version text,p_state boolean)returns jsonb language sql security invoker set search_path='' as $$select ecod_worklist_private.act(p_operation,p_kind,p_id,p_version,p_state)$$;
revoke all on all functions in schema ecod_worklist_private from public,anon,authenticated;
revoke all on function public.api_recruiter_worklist(text,integer,integer,boolean),public.api_worklist_preferences(boolean,text,integer),public.api_worklist_action(uuid,text,uuid,text,boolean) from public,anon,authenticated;
grant usage on schema ecod_worklist_private to authenticated;
grant execute on function ecod_worklist_private.read(text,integer,integer,boolean),ecod_worklist_private.prefs(boolean,text,integer),ecod_worklist_private.act(uuid,text,uuid,text,boolean),public.api_recruiter_worklist(text,integer,integer,boolean),public.api_worklist_preferences(boolean,text,integer),public.api_worklist_action(uuid,text,uuid,text,boolean) to authenticated;

create or replace function ecod_private.erasure_inventory(ws uuid,person uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare family uuid[];d record;n integer;total integer:=0;keys text[]:='{}';found_keys text[];digest text;
 counts jsonb:='[]';stamps jsonb:='[]';predicate text;
begin
 if not exists(select 1 from public.candidates where workspace_id=ws and id=person and "mergedInto" is null) then raise exception 'Candidate merged or unavailable; review the current identity';end if;
 with recursive relatives(id) as (
  select id from public.candidates where workspace_id=ws and id=person
  union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws
 ) select array_agg(id) into family from(select id from relatives limit 101)t;
 if cardinality(family)>100 then raise exception 'Identity scope exceeds its safe limit; use an approved manual inventory';end if;
 for d in select * from (values
  ('candidates','records'),('employmentHistory','records'),('compensationHistory','records'),('availabilityHistory','records'),
  ('personSkills','records'),('skillEvidence','records'),('assessments','records'),('enrichment','records'),('notes','records'),('consents','records'),
  ('considerations','records'),('submissions','records'),('interviews','records'),('offers','records'),('placements','records'),('placementCommercials','records'),
  ('tasks','records'),('referrals','records'),('poolMembers','records'),('documents','originals'),
  ('externalMappings','integrations'),('candidateVectors','integrations'),('intelligenceRequests','integrations'),('executionJobs','integrations'),('integrationReceipts','integrations'),
  ('history','history'),('auditEvents','history'),('contactRecords','records'),('contactEvents','history'),('contactReceipts','integrations'),('readinessDecisions','records'),('clientPacks','records'),('clientFeedback','records'),('clientReceipts','integrations'),('clientReads','history'),('machineEvents','history'),('machineReceipts','integrations'),('worklistReceipts','integrations')
 ) as definitions(name,area) loop
  predicate:=case d.name
   when 'worklistReceipts' then 't.candidate_id=any($1)'
   when 'clientReads' then 'exists(select 1 from ecod_client_private.packs p where p.workspace_id=$2 and p.candidate_id=any($1) and p.id=any(t.pack_ids))'
   when 'clientPacks' then 't.candidate_id=any($1)'
   when 'clientFeedback' then 't.candidate_id=any($1)'
   when 'clientReceipts' then 't.candidate_id=any($1)'
   when 'machineEvents' then 't.candidate_id=any($1)'
   when 'machineReceipts' then 't.candidate_id=any($1)'
   when 'contactRecords' then 't.candidate_id=any($1)'
   when 'contactEvents' then '(t.candidate_id=any($1) or t.contact_id in(select id from ecod_contacts_private.contacts where workspace_id=$2 and candidate_id=any($1)))'
   when 'contactReceipts' then 't.request->>''candidate''=any(select x::text from unnest($1)x)'
   when 'candidates' then 't.id=any($1)'
   when 'skillEvidence' then 't."personSkillId" in(select id from public."personSkills" where workspace_id=$2 and "candidateId"=any($1))'
   when 'placementCommercials' then 't."placementId" in(select id from public.placements where workspace_id=$2 and "candidateId"=any($1))'
   when 'candidateVectors' then 't.candidate_id=any($1)' when 'intelligenceRequests' then 't.candidate_id=any($1)'
   when 'executionJobs' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   when 'integrationReceipts' then 't.response->>''candidateId''=any(select x::text from unnest($1)x)'
   when 'history' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   when 'auditEvents' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   else 't."candidateId"=any($1)' end;
  execute format('select count(*)::int,
   coalesce(array_agg($3||'':''||(j->>''id'')) filter(where j->>''id'' is not null),''{}''::text[]),
   encode(sha256(convert_to(coalesce(jsonb_agg(h order by h),''[]'')::text,''UTF8'')),''hex'')
   from(select to_jsonb(t)j,encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')h from %I.%I t where t.workspace_id=$2 and %s limit 2001)q',case when d.name='worklistReceipts' then 'ecod_worklist_private' when d.name in ('clientPacks','clientFeedback','clientReceipts','clientReads') then 'ecod_client_private' when d.name in ('machineEvents','machineReceipts') then 'ecod_machine_private' when d.name in ('contactRecords','contactEvents','contactReceipts') then 'ecod_contacts_private' else 'public' end,case d.name when 'worklistReceipts' then 'receipts' when 'clientPacks' then 'packs' when 'clientFeedback' then 'feedback' when 'clientReceipts' then 'receipts' when 'clientReads' then 'read_events' when 'machineEvents' then 'events' when 'machineReceipts' then 'receipts' when 'contactRecords' then 'contacts' when 'contactEvents' then 'contact_events' when 'contactReceipts' then 'contact_receipts' else d.name end,predicate)
   into n,found_keys,digest using family,ws,d.name,keys;
  total:=total+n;
  if n>2000 or total>10000 then raise exception 'Record scope exceeds its safe limit; use an approved manual inventory';end if;
  keys:=keys||found_keys;
  counts:=counts||jsonb_build_array(jsonb_build_object('category',d.name,'area',d.area,'count',n));
  stamps:=stamps||jsonb_build_array(jsonb_build_array(d.name,n,digest));
 end loop;
 return jsonb_build_object('identities',cardinality(family),'total',total,'counts',counts,
  'fingerprint',encode(sha256(convert_to(stamps::text,'UTF8')),'hex'));
end $$;
create or replace function ecod_private.subject_access_content(package uuid)
returns text language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'caseId',s.case_id,'packageId',p.id,'preparedAt',p.prepared_at,
  'actor',p.actor,'workspaceId',p.workspace_id,'snapshotAt',s.created_at,
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, alternate-contact records and private contact verification/operation history, readiness decision history, rubric scorecard snapshots and recording provenance, client submission versions/feedback/read history and private machine-operation metadata and worklist decision receipts, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;

revoke all on function ecod_private.erasure_inventory(uuid,uuid),ecod_private.subject_access_content(uuid) from public,anon,authenticated;

commit;
