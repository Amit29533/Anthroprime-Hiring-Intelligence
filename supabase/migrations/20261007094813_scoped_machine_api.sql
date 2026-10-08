-- N4: hashed machine credentials, bounded versioned writes, incremental events and approved jobs.
begin;
create schema if not exists ecod_machine_private;
revoke all on schema ecod_machine_private from public,anon,authenticated;
create table if not exists ecod_machine_private.credentials (
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),creator uuid not null,name text not null,source text not null,
 issuance_days integer not null,scopes text[] not null,token_hash text not null unique,expires timestamptz not null,revoked boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),last_used timestamptz,minute_started timestamptz,minute_count integer not null default 0
);
create table if not exists ecod_machine_private.events (
 sequence bigint generated always as identity primary key,workspace_id uuid not null,candidate_id uuid,entity_type text not null,entity_id uuid not null,
 operation text not null,at timestamptz not null default clock_timestamp()
);
create index if not exists machine_events_page on ecod_machine_private.events(workspace_id,sequence);
create table if not exists ecod_machine_private.demand_mappings (
 workspace_id uuid not null,source text not null,external_id text not null,demand_id uuid not null,version integer not null default 1,
 primary key(workspace_id,source,external_id),foreign key(workspace_id,demand_id) references public.demands(workspace_id,id)
);
create table if not exists ecod_machine_private.receipts (
 credential_id uuid not null references ecod_machine_private.credentials(id),workspace_id uuid not null,operation_id uuid not null,candidate_id uuid,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(credential_id,operation_id)
);
do $$declare tbl text;begin foreach tbl in array array['credentials','events','demand_mappings','receipts'] loop
 execute format('alter table ecod_machine_private.%I enable row level security',tbl);execute format('revoke all on ecod_machine_private.%I from public,anon,authenticated',tbl);end loop;end $$;

create or replace function ecod_machine_private.key_admin(p_action text,p_id uuid,p_name text,p_source text,p_scopes text[],p_days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();token text;rows jsonb;result jsonb;
begin
 if auth.uid() is null or ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);
 if p_action='create' then
  if p_id is null or coalesce(length(btrim(p_name)),0) not between 1 and 100 or coalesce(length(btrim(p_source)),0) not between 1 and 80
   or p_days is null or p_days not between 1 and 90 or p_scopes is null or cardinality(p_scopes) not between 1 and 4
   or exists(select 1 from unnest(p_scopes)s where s is null or s<>all(array['candidate:write','demand:write','events:read','jobs:read'])) then raise exception 'Invalid machine credential settings';end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':machine-keys',0));
  if exists(select 1 from ecod_machine_private.credentials where id=p_id) then
   if not exists(select 1 from ecod_machine_private.credentials where id=p_id and workspace_id=ws and creator=auth.uid() and name=btrim(p_name) and source=btrim(p_source) and scopes=p_scopes and issuance_days=p_days) then raise exception 'Credential operation conflict';end if;
   return jsonb_build_object('id',p_id,'replayed',true,'token',null);
  end if;
  if (select count(*) from ecod_machine_private.credentials where workspace_id=ws and not revoked and expires>clock_timestamp())>=20 then raise exception 'Active credential limit reached';end if;
  token:='anthro_m_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into ecod_machine_private.credentials(id,workspace_id,creator,name,source,issuance_days,scopes,token_hash,expires)
  values(p_id,ws,auth.uid(),btrim(p_name),btrim(p_source),p_days,p_scopes,encode(sha256(convert_to(token,'UTF8')),'hex'),clock_timestamp()+make_interval(days=>p_days));
  result:=jsonb_build_object('id',p_id,'token',token,'replayed',false);
 elsif p_action='revoke' then
  update ecod_machine_private.credentials set revoked=true where id=p_id and workspace_id=ws;
  if not found then raise exception 'Credential not found';end if;
  result:=jsonb_build_object('id',p_id);
 elsif p_action<>'list' or p_action is null then raise exception 'Invalid credential action';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]') into rows from
  (select id,name,source,scopes,expires,revoked,created_at,last_used from ecod_machine_private.credentials where workspace_id=ws order by (not revoked and expires>clock_timestamp()) desc,created_at desc limit 100)x;
 return coalesce(result,'{}')||jsonb_build_object('credentials',rows);
end $$;

create or replace function ecod_machine_private.record_event() returns trigger language plpgsql security definer set search_path='' as $$
declare data jsonb;person uuid;ws uuid;

begin
 data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;ws:=(data->>'workspace_id')::uuid;
 person:=case when tg_table_name='candidates' then (data->>'id')::uuid else coalesce(nullif(data->>'candidateId',''),nullif(data->>'candidate_id',''))::uuid end;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':machine-events',0));
 insert into ecod_machine_private.events(workspace_id,candidate_id,entity_type,entity_id,operation) values(ws,person,tg_table_name,(data->>'id')::uuid,lower(tg_op));
 if tg_table_name='demands' and tg_op='UPDATE' and new is distinct from old then update ecod_machine_private.demand_mappings set version=version+1 where workspace_id=new.workspace_id and demand_id=new.id;end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_machine_private.record_event() from public,anon,authenticated;
do $$declare tbl text;begin foreach tbl in array array['candidates','demands','considerations','offers','placements'] loop
 execute format('drop trigger if exists machine_change on public.%I',tbl);
 execute format('create trigger machine_change after insert or update or delete on public.%I for each row execute function ecod_machine_private.record_event()',tbl);end loop;end $$;
drop trigger if exists machine_change on ecod_client_private.feedback;
create trigger machine_change after insert or update or delete on ecod_client_private.feedback for each row execute function ecod_machine_private.record_event();

create or replace function ecod_machine_private.demand_write(ws uuid,p_source text,p_external text,p_body jsonb,p_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare mapping ecod_machine_private.demand_mappings;d public.demands;client_name text;
begin
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>30000 or exists(select 1 from jsonb_object_keys(p_body)k where k<>all(array['title','clientId','skills','minExperience','maxNotice','budget','location','mode','positions','priority','target','description','status'])) then raise exception 'Invalid demand fields';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_source||':'||p_external||':demand',0));
 select * into mapping from ecod_machine_private.demand_mappings where workspace_id=ws and source=p_source and external_id=p_external;
 if found then
  select * into d from public.demands where workspace_id=ws and id=mapping.demand_id for update;
  select * into mapping from ecod_machine_private.demand_mappings where workspace_id=ws and source=p_source and external_id=p_external for update;
  if p_version is distinct from mapping.version then raise exception 'Demand version conflict' using errcode='40001';end if;
  d:=jsonb_populate_record(d,p_body);
 else
  if p_version is not null and p_version<>0 then raise exception 'Demand version conflict' using errcode='40001';end if;
  d:=jsonb_populate_record(null::public.demands,p_body);
 end if;
 select name into client_name from public.clients where workspace_id=ws and id=d."clientId";
 if client_name is null then raise exception 'Link the demand to a client in this workspace';end if;
 if length(coalesce(d.title,'')) not between 1 and 200 or cardinality(d.skills) not between 1 and 100 or d."minExperience"::text='NaN' or d.budget::text='NaN'
  or length(coalesce(d.description,''))>10000 or length(coalesce(d.location,''))>200 then raise exception 'Demand exceeds supported limits';end if;
 if mapping.demand_id is null then
  insert into public.demands(workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,description,weights)
  values(ws,d.title,client_name,d."clientId",d.skills,d."minExperience",d."maxNotice",d.budget,d.location,d.mode,d.positions,d.priority,coalesce(d.status,'Open'),d.target,coalesce(d.description,''),'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}') returning id into d.id;
  insert into ecod_machine_private.demand_mappings values(ws,p_source,p_external,d.id,1);
 else
  update public.demands set title=d.title,client=client_name,"clientId"=d."clientId",skills=d.skills,"minExperience"=d."minExperience","maxNotice"=d."maxNotice",budget=d.budget,location=d.location,mode=d.mode,positions=d.positions,priority=d.priority,status=d.status,target=d.target,description=d.description where workspace_id=ws and id=d.id;
 end if;
 select version into p_version from ecod_machine_private.demand_mappings where workspace_id=ws and source=p_source and external_id=p_external;
 return jsonb_build_object('demandId',d.id,'version',p_version,'replayed',false);
end $$;

-- Requisition approval historically excludes description/skills. Public publication must
-- bind all public job content, without changing that existing requisition policy.
alter table public.demands add column if not exists "jobFeedApprovedHash" text;
create or replace function ecod_machine_private.job_hash(d public.demands) returns text
language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(d.title,d.location,d.mode,d.positions,d.target,d.description,d.skills,d."minExperience")::text,'UTF8')),'hex')
$$;
create or replace function ecod_machine_private.guard_job_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare reviewed boolean:=false;
begin
 if tg_op='INSERT' then new."jobFeedApprovedHash":=null;reviewed:=true;
 else
  new."jobFeedApprovedHash":=old."jobFeedApprovedHash";
  if ecod_machine_private.job_hash(new) is distinct from ecod_machine_private.job_hash(old) or not new."careersVisible" or new."approvalStatus"<>'Approved' then new."jobFeedApprovedHash":=null;end if;
  reviewed:=(old."approvalStatus"<>'Approved' or not old."careersVisible");
 end if;
 if reviewed and new."careersVisible" and new."approvalStatus"='Approved' and exists(select 1 from public.memberships where user_id=auth.uid() and workspace_id=new.workspace_id and role='admin') then
  perform ecod_private.require_privileged_mfa(new.workspace_id);
  new."jobFeedApprovedHash":=ecod_machine_private.job_hash(new);
 end if;
 return new;
end $$;
revoke all on function ecod_machine_private.job_hash(public.demands),ecod_machine_private.guard_job_publication() from public,anon,authenticated;
drop trigger if exists zz_job_feed_publication on public.demands;
create trigger zz_job_feed_publication before insert or update on public.demands for each row execute function ecod_machine_private.guard_job_publication();

create or replace function ecod_machine_private.approved_jobs(p_workspace uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
 if p_workspace is null or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Workspace and valid page required';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into rows from
  (select id,left(title,200) title,left(location,200) location,mode,positions,target,left(description,5000) description,skills[1:60] skills,"minExperience"
   from public.demands d where workspace_id=p_workspace and status='Open' and "careersVisible" and "approvalStatus"='Approved' and "jobFeedApprovedHash"=ecod_machine_private.job_hash(d) order by id limit 51 offset p_offset)x;
 if octet_length(rows::text)>524288 then raise exception 'Job page exceeds its safe limit';end if;
 return jsonb_build_object('jobs',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'more',jsonb_array_length(rows)>50);
end $$;

create or replace function ecod_machine_private.dispatch(p_hash text,p_action text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare key ecod_machine_private.credentials;scope text;result jsonb;rows jsonb;after_seq bigint;page integer;req_hash text;receipt ecod_machine_private.receipts;op uuid;old_actor text;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' or jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>40000 then raise exception 'Invalid machine request' using errcode='42501';end if;
 select * into key from ecod_machine_private.credentials where token_hash=p_hash for update;
 if key.id is null or key.revoked or key.expires<=clock_timestamp() or not exists(select 1 from public.memberships where user_id=key.creator and workspace_id=key.workspace_id and role='admin') then raise exception 'Machine credential unavailable' using errcode='42501';end if;
 scope:=case p_action when 'candidate' then 'candidate:write' when 'demand' then 'demand:write' when 'events' then 'events:read' when 'mappings' then 'events:read' when 'jobs' then 'jobs:read' else null end;
 if scope is null or not scope=any(key.scopes) then raise exception 'Machine scope denied' using errcode='42501';end if;
 if key.minute_started is null or key.minute_started<clock_timestamp()-interval '1 minute' then key.minute_started:=clock_timestamp();key.minute_count:=0;end if;
 if key.minute_count>=60 then raise exception 'Machine rate limit exceeded';end if;
 update ecod_machine_private.credentials set minute_started=key.minute_started,minute_count=key.minute_count+1,last_used=clock_timestamp() where id=key.id;
 if p_action='events' then
  after_seq:=coalesce((p_request->>'after')::bigint,0);if after_seq<0 then raise exception 'Invalid event cursor';end if;
  select coalesce(jsonb_agg(to_jsonb(x)-'seq' order by seq),'[]') into rows from
   (select sequence seq,sequence::text cursor,entity_type,entity_id,operation,at from ecod_machine_private.events where workspace_id=key.workspace_id and sequence>after_seq order by sequence limit 101)x;
  return jsonb_build_object('events',case when jsonb_array_length(rows)>100 then rows-100 else rows end,'more',jsonb_array_length(rows)>100);
 elsif p_action='jobs' then return ecod_machine_private.approved_jobs(key.workspace_id,coalesce((p_request->>'offset')::integer,0));
 elsif p_action='mappings' then
  page:=coalesce((p_request->>'offset')::integer,0);if page not between 0 and 10000 then raise exception 'Invalid mapping page';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by entity_type,external_id),'[]') into rows from
   (select * from (select 'candidate'::text entity_type,m."externalId" external_id,m."candidateId" entity_id,m.version,c."mergedInto" merged_into from public."externalMappings" m join public.candidates c on c.workspace_id=m.workspace_id and c.id=m."candidateId" where m.workspace_id=key.workspace_id and m.source=key.source
    union all select 'demand',external_id,demand_id,version,null::uuid from ecod_machine_private.demand_mappings where workspace_id=key.workspace_id and source=key.source)y order by entity_type,external_id limit 101 offset page)x;
  return jsonb_build_object('mappings',case when jsonb_array_length(rows)>100 then rows-100 else rows end,'more',jsonb_array_length(rows)>100);
 end if;
 op:=(p_request->>'operationId')::uuid;
 if op is null or coalesce(length(p_request->>'externalId'),0) not between 1 and 200 then raise exception 'Operation ID and external ID required';end if;
 req_hash:=encode(sha256(convert_to(jsonb_build_array(p_action,p_request)::text,'UTF8')),'hex');
 select * into receipt from ecod_machine_private.receipts where credential_id=key.id and operation_id=op;
 if found then if receipt.request_hash<>req_hash then raise exception 'Machine operation conflict' using errcode='40001';end if;return receipt.result||jsonb_build_object('replayed',true);end if;
 old_actor:=current_setting('request.jwt.claim.sub',true);perform set_config('request.jwt.claim.sub',key.creator::text,true);
 if p_action='candidate' then result:=ecod_machine_private.candidate_write(key.workspace_id,key.source,p_request->>'externalId','machine:'||key.id::text||':'||op::text,p_request->'body',(p_request->>'version')::integer);
 else result:=ecod_machine_private.demand_write(key.workspace_id,key.source,p_request->>'externalId',p_request->'body',(p_request->>'version')::integer);end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_actor,''),true);
 insert into ecod_machine_private.receipts values(key.id,key.workspace_id,op,(result->>'candidateId')::uuid,req_hash,result,clock_timestamp());
 return result;
end $$;

create or replace function ecod_machine_private.reconcile(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();delivery public."webhookDeliveries";result jsonb;
begin
 if auth.uid() is null or ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);
 if coalesce(length(btrim(p_reason)),0) not between 10 and 1000 then raise exception 'Reconciliation evidence is required';end if;
 select * into delivery from public."webhookDeliveries" where workspace_id=ws and id=p_id and status='failed' for update;
 if not found then raise exception 'Failed delivery required';end if;
 -- An operator attests receiver reconciliation; this does not mark a remote delivery successful.
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot) values(ws,'webhookDeliveries',p_id,'Webhook reconciliation reviewed',auth.uid()::text,jsonb_build_object('reference',btrim(p_reason),'status','failed'));
 return jsonb_build_object('id',p_id,'reviewed',true);
end $$;

create or replace function ecod_machine_private.candidate_write(ws uuid,p_source text,p_external_id text,p_key text,p_candidate jsonb,p_version integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare req jsonb; cached jsonb; mapping record; cid uuid; col text; val jsonb; document public.candidates; result jsonb;
begin

 if p_source is null or length(p_source) not between 1 and 100 or p_external_id is null or length(p_external_id) not between 1 and 200 or p_key is null or length(p_key) not between 8 and 200 then raise exception 'Source, external ID and idempotency key are required'; end if;
 if jsonb_typeof(p_candidate) is distinct from 'object' or octet_length(p_candidate::text)>30000 then raise exception 'Invalid candidate payload'; end if;
 for col,val in select * from jsonb_each(p_candidate) loop
  if col not in ('name','email','phone','title','company','location','skills','status','mode','source','summary','linkedin','owner','experience','notice','engagement') then raise exception 'Unsupported candidate field: %',col; end if;
 end loop;
 req:=jsonb_build_object('source',p_source,'externalId',p_external_id,'candidate',p_candidate,'version',p_version);
 insert into public."integrationReceipts"(workspace_id,key,request) values(ws,p_key,req) on conflict do nothing;
 select request,response into cached,result from public."integrationReceipts" where workspace_id=ws and key=p_key for update;
 if cached is distinct from req then raise exception 'Idempotency key was used for a different request' using errcode='23505'; end if;
 if result is not null then return result||jsonb_build_object('replayed',true); end if;
 -- Serialize only this workspace/source/external ID; concurrent new keys cannot duplicate it.
 perform pg_advisory_xact_lock(hashtext(ws::text||p_source),hashtext(p_external_id));
 select * into mapping from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id;
 if found then
  cid:=mapping."candidateId";
  select * into document from public.candidates where workspace_id=ws and id=cid for update;
  -- Match the UI's candidate-before-mapping lock order and recheck after waiting.
  select * into mapping from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id for update;
  if p_version is null or p_version<>mapping.version or mapping."candidateId"<>cid then raise exception 'External record version conflict' using errcode='40001'; end if;
  if document."mergedInto" is not null then raise exception 'Candidate was merged; reconcile the external mapping' using errcode='40001'; end if;
  document:=jsonb_populate_record(document,p_candidate);
  perform public.validate_integration_candidate(document);
  update public.candidates set name=document.name,email=document.email,phone=document.phone,title=document.title,company=document.company,location=document.location,skills=document.skills,status=document.status,mode=document.mode,source=document.source,summary=document.summary,linkedin=document.linkedin,owner=document.owner,experience=document.experience,notice=document.notice,engagement=document.engagement where workspace_id=ws and id=cid;
  -- The candidate update trigger increments every mapping, including edits made in the UI.
  select version into p_version from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id;
 else
  if p_version is not null and p_version<>0 then raise exception 'External record does not exist' using errcode='40001'; end if;
  document:=jsonb_populate_record(null::public.candidates,p_candidate);
  perform public.validate_integration_candidate(document);
  insert into public.candidates(workspace_id,name,email,phone,title,company,location,skills,status,mode,source,summary,linkedin,owner,experience,notice,engagement)
  values(ws,document.name,coalesce(document.email,''),coalesce(document.phone,''),coalesce(document.title,''),coalesce(document.company,''),coalesce(document.location,''),coalesce(document.skills,'{}'),coalesce(document.status,'Assessing'),coalesce(document.mode,'Flexible'),coalesce(document.source,p_source),coalesce(document.summary,''),coalesce(document.linkedin,''),coalesce(document.owner,''),document.experience,document.notice,coalesce(document.engagement,'')) returning id into cid;
  insert into public."externalMappings"(workspace_id,source,"externalId","candidateId") values(ws,p_source,p_external_id,cid);
  p_version:=1;
 end if;
 result:=jsonb_build_object('candidateId',cid,'version',p_version,'replayed',false);
 update public."integrationReceipts" set response=result where workspace_id=ws and key=p_key;
 return result;
end $$;

alter table public."publicApplications" add column if not exists source text not null default 'Career page';
create or replace function ecod_machine_private.public_apply(ws uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_id uuid;
  role_id uuid;
  status_token uuid;
  attribution text:=coalesce(nullif(payload->>'source',''),'Career page');
begin
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>30000 or attribution !~ '^[A-Za-z0-9 ._-]{1,100}$' then raise exception 'Invalid application source or payload';end if;
  if payload is null
     or coalesce(trim(payload->>'name'), '') = ''
     or coalesce(trim(payload->>'email'), '') = '' then
    raise exception 'name and email are required';
  end if;
  if payload->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address';
  end if;
  if not coalesce((payload->>'consentContact')::boolean, false) then
    raise exception 'consent to contact is required';
  end if;

  if not exists (select 1 from public.workspaces w where w.id = ws) then
    raise exception 'unknown workspace';
  end if;

  begin
    role_id := nullif(payload->>'demandId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'select an open role';
  end;
  if role_id is null then
    raise exception 'select an open role';
  end if;
  if not exists (
    select 1
    from public.demands d
    where d.id = role_id
      and d.workspace_id = ws
      and d.status = 'Open'
      and d."careersVisible" is true
  ) then
    raise exception 'role is no longer accepting applications';
  end if;

  insert into public."publicApplications"(
    workspace_id, "demandId", name, email, phone, linkedin, message,
    "consentContact", "consentSharing", source
  )
  values (
    ws, role_id, trim(payload->>'name'), lower(trim(payload->>'email')),
    coalesce(trim(payload->>'phone'), ''), coalesce(trim(payload->>'linkedin'), ''),
    coalesce(payload->>'message', ''), true,
    coalesce((payload->>'consentSharing')::boolean, false), attribution
  )
  returning id, "statusToken" into app_id, status_token;

  return jsonb_build_object('applicationId', app_id, 'statusToken', status_token);
end;
$$;

create or replace function public.api_machine_credentials(p_action text,p_id uuid default null,p_name text default '',p_source text default '',p_scopes text[] default '{}',p_days integer default 30) returns jsonb
language sql security invoker set search_path='' as $$select ecod_machine_private.key_admin(p_action,p_id,p_name,p_source,p_scopes,p_days)$$;
create or replace function public.api_machine_dispatch(p_hash text,p_action text,p_request jsonb) returns jsonb
language sql security invoker set search_path='' as $$select ecod_machine_private.dispatch(p_hash,p_action,p_request)$$;
create or replace function public.api_approved_job_feed(p_workspace uuid,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$select ecod_machine_private.approved_jobs(p_workspace,p_offset)$$;
create or replace function public.api_reconcile_webhook(p_id uuid,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select ecod_machine_private.reconcile(p_id,p_reason)$$;
create or replace function public.api_public_apply(ws uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select ecod_machine_private.public_apply(ws,payload)$$;

drop trigger if exists integration_event on ecod_client_private.feedback;
create trigger integration_event after insert on ecod_client_private.feedback for each row execute function public.enqueue_integration_event();
drop trigger if exists machine_change on ecod_client_private.packs;
create trigger machine_change after insert or update on ecod_client_private.packs for each row execute function ecod_machine_private.record_event();

revoke all on all functions in schema ecod_machine_private from public,anon,authenticated;
revoke all on function public.api_machine_credentials(text,uuid,text,text,text[],integer),public.api_machine_dispatch(text,text,jsonb),public.api_approved_job_feed(uuid,integer),public.api_reconcile_webhook(uuid,text),public.api_public_apply(uuid,jsonb) from public,anon,authenticated;
grant usage on schema ecod_machine_private to anon,authenticated;
grant execute on function ecod_machine_private.key_admin(text,uuid,text,text,text[],integer),ecod_machine_private.reconcile(uuid,text),public.api_machine_credentials(text,uuid,text,text,text[],integer),public.api_reconcile_webhook(uuid,text) to authenticated;
grant execute on function ecod_machine_private.approved_jobs(uuid,integer),ecod_machine_private.public_apply(uuid,jsonb),public.api_approved_job_feed(uuid,integer),public.api_public_apply(uuid,jsonb) to anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant usage on schema ecod_machine_private to service_role;
 grant execute on function ecod_machine_private.dispatch(text,text,jsonb),public.api_machine_dispatch(text,text,jsonb) to service_role;
end if;end $$;
create or replace function ecod_machine_private.overview(p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();rows jsonb;cursor text;
begin
 if auth.uid() is null or ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid mappings page';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by source,external_id),'[]') into rows from(select source,external_id,demand_id,version from ecod_machine_private.demand_mappings where workspace_id=ws order by source,external_id limit 51 offset p_offset)x;
 select sequence::text into cursor from ecod_machine_private.events where workspace_id=ws order by sequence desc limit 1;
 return jsonb_build_object('mappings',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'more',jsonb_array_length(rows)>50,'cursor',coalesce(cursor,'0'));
end $$;
create or replace function public.api_machine_overview(p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select ecod_machine_private.overview(p_offset)$$;
revoke all on function ecod_machine_private.overview(integer),public.api_machine_overview(integer) from public,anon;
grant execute on function ecod_machine_private.overview(integer),public.api_machine_overview(integer) to authenticated;
commit;
