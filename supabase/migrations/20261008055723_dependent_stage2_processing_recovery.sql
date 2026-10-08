begin;
create schema if not exists ecod_processing_private;
revoke all on schema ecod_processing_private from public,anon,authenticated;
create table if not exists ecod_processing_private.lockdown(singleton boolean primary key default true check(singleton),paused boolean not null default false,changed_at timestamptz not null default clock_timestamp());
insert into ecod_processing_private.lockdown(singleton)values(true)on conflict do nothing;
create table if not exists ecod_processing_private.policies(workspace_id uuid references public.workspaces(id),kind text check(kind in('processing','recovery')),generation integer not null default 1,state text not null default 'configured',body jsonb not null,accepted_at timestamptz,primary key(workspace_id,kind));
create table if not exists ecod_processing_private.evidence(id uuid primary key,workspace_id uuid references public.workspaces(id),kind text not null,generation integer not null,component text not null check(component in('scan','ocr','backup','restore')),status text not null check(status in('passed','unavailable')),body jsonb not null,at timestamptz not null default clock_timestamp());
create index if not exists processing_evidence_page on ecod_processing_private.evidence(workspace_id,kind,at desc,id);
create table if not exists ecod_processing_private.receipts(workspace_id uuid,actor uuid,id uuid,request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
do $$declare t text;begin foreach t in array array['lockdown','policies','evidence','receipts']loop execute format('alter table ecod_processing_private.%I enable row level security',t);end loop;end$$;
revoke all on all tables in schema ecod_processing_private from public,anon,authenticated;
create or replace function ecod_processing_private.fresh(ws uuid,k text,c text,g integer,age interval)returns boolean language sql stable security invoker set search_path=''as $$
 select coalesce((select status='passed'from ecod_processing_private.evidence where workspace_id=ws and kind=k and component=c and generation=g and at>statement_timestamp()-age order by at desc,id limit 1),false)
$$;
create or replace function ecod_processing_private.ready(ws uuid)returns boolean language sql stable security definer set search_path=''as $$
 select not(select paused from ecod_processing_private.lockdown)and not coalesce((select custom->'stage2ProcessingSuspended'='true'::jsonb from public.settings where workspace_id=ws and id='workspace'),false)and coalesce((select state='enabled'and exists(select 1 from public.memberships m where m.workspace_id=ws and m.user_id=(p.body->>'owner')::uuid and m.role='admin')and ecod_processing_private.fresh(ws,'processing','scan',generation,interval'15 minutes')and(coalesce(body->'requireOcr','false')<>'true'::jsonb or ecod_processing_private.fresh(ws,'processing','ocr',generation,interval'15 minutes'))from ecod_processing_private.policies p where workspace_id=ws and kind='processing'),true)
$$;
-- Preserve legacy opt-in semantics until Stage 2 control is configured. Configuring adopts the stricter gate.
do $$declare name text;d text;begin
 foreach name in array array['worker_claim_cv_scan','worker_claim_cv','worker_claim_ocr_cv','worker_claim_attachment_scan','worker_claim_attachment_extract','worker_claim_ocr_attachment']loop
 d:=pg_get_functiondef(('public.'||name||'()')::regprocedure);
 if strpos(d,'ecod_processing_private.ready')=0 then
 d:=replace(d,'ecod_private.cv_staging_enabled(ib.workspace_id)','(ecod_private.cv_staging_enabled(ib.workspace_id)and ecod_processing_private.ready(ib.workspace_id))');
 d:=replace(d,'ecod_private.attachments_enabled(x.workspace_id)','(ecod_private.attachments_enabled(x.workspace_id)and ecod_processing_private.ready(x.workspace_id))');execute d;
 end if;end loop;
 d:=pg_get_functiondef('ecod_delivery_private.api(text,uuid,uuid,text,jsonb,integer)'::regprocedure);
 if strpos(d,'Use Stage 2 controls')=0 then d:=replace(d,' if a in(''configure'',''accept'',''enable'',''pause'',''degrade'',''revoke'',''rotate'',''diagnostic-token'')then',' if k in(''processing'',''recovery'')and a in(''configure'',''accept'',''enable'',''pause'',''degrade'',''revoke'',''rotate'')then raise exception ''Use Stage 2 controls for processing and recovery'';end if; if a in(''configure'',''accept'',''enable'',''pause'',''degrade'',''revoke'',''rotate'',''diagnostic-token'')then');execute d;end if;
end$$;
create or replace function ecod_processing_private.guard_lockdown()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if(select paused from ecod_processing_private.lockdown)and not(coalesce(current_setting('ecod.recovery_operator',true),'')='on'and coalesce(current_setting('role',true),'none')in('none','postgres','service_role'))then raise exception 'Recovery lockdown: application writes are paused'using errcode='55000';end if;
 if tg_op='TRUNCATE'then return null;end if;
 if tg_op<>'DELETE'and tg_table_schema='public'and tg_table_name in('importFiles','documentJobs')and not ecod_processing_private.ready((to_jsonb(new)->>'workspace_id')::uuid)then
  if (to_jsonb(new)->>'scan_status'='clean'and to_jsonb(old)->>'scan_status'is distinct from'clean')or(to_jsonb(new)->>'state'in('ready','manual')and to_jsonb(old)->>'state'is distinct from to_jsonb(new)->>'state')or(to_jsonb(new)->>'parse_state'in('parsed','manual')and to_jsonb(old)->>'parse_state'is distinct from to_jsonb(new)->>'parse_state')then raise exception 'Processing health gate closed; original remains quarantined'using errcode='55000';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
-- App tables/journals are frozen together. Managed Auth/storage tables remain managed by Supabase.
do $$declare r record;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'and(n.nspname='public'or n.nspname like 'ecod%private')and not(n.nspname='ecod_processing_private'and c.relname='lockdown')loop execute format('drop trigger if exists stage2_recovery_lockdown on %I.%I',r.nspname,r.relname);execute format('create trigger stage2_recovery_lockdown before insert or update or delete on %I.%I for each row execute function ecod_processing_private.guard_lockdown()',r.nspname,r.relname);execute format('drop trigger if exists stage2_recovery_truncate on %I.%I',r.nspname,r.relname);execute format('create trigger stage2_recovery_truncate before truncate on %I.%I for each statement execute function ecod_processing_private.guard_lockdown()',r.nspname,r.relname);end loop;end$$;
create or replace function ecod_processing_private.api(a text,op uuid,head text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);k text:=coalesce(p->>'kind','processing');cfg ecod_processing_private.policies;prior ecod_processing_private.receipts;r jsonb;rows jsonb;req jsonb;valid boolean;begin
 if not public.is_admin()then raise exception 'Administrator required'using errcode='42501';end if;perform ecod_private.require_privileged_mfa(ws);
 if a is null or a not in('context','history','configure','accept','enable','pause','revoke')or off is null or off not between 0 and 10000 or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 or k not in('processing','recovery')then raise exception 'Invalid processing/recovery request';end if;
 if a='context'then
  if p<>'{}'then raise exception 'Invalid context';end if;
  select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('head',ecod_journey_private.token(ws,to_jsonb(x)),'healthy',case when x.kind='processing'then ecod_processing_private.ready(ws)else x.state='enabled'and not(select paused from ecod_processing_private.lockdown)and exists(select 1 from public.memberships m where m.workspace_id=ws and m.user_id=(x.body->>'owner')::uuid and m.role='admin')and ecod_processing_private.fresh(ws,'recovery','backup',x.generation,make_interval(hours=>(x.body->>'rpoHours')::integer))and ecod_processing_private.fresh(ws,'recovery','restore',x.generation,interval'7 days')end)order by kind),'[]')into rows from ecod_processing_private.policies x where workspace_id=ws;
  return jsonb_build_object('policies',rows,'paused',(select paused from ecod_processing_private.lockdown),'defaultHead',ecod_journey_private.token(ws,'null'::jsonb),'queue',jsonb_build_object('imports',(select count(*)from public."importFiles"where workspace_id=ws and scan_status in('pending','scanning','error')),'attachments',(select count(*)from public."documentJobs"where workspace_id=ws and scan_status in('pending','scanning','error'))),'privacyCategories',jsonb_build_object('formal',68,'operations',65));
 elsif a='history'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>'kind')then raise exception 'Invalid history';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into rows from(select *from ecod_processing_private.evidence where workspace_id=ws and kind=k order by at desc,id limit 26 offset off)x;return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 if op is null then raise exception 'Operation UUID required';end if;perform pg_advisory_xact_lock(hashtextextended(ws::text,812));req:=jsonb_build_array(a,head,p);
 select *into prior from ecod_processing_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;if found then if prior.request<>req then raise exception 'Operation conflict'using errcode='40001';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select *into cfg from ecod_processing_private.policies where workspace_id=ws and kind=k for update;
 if ecod_journey_private.token(ws,case when cfg.workspace_id is null then'null'::jsonb else to_jsonb(cfg)end)is distinct from head then raise exception 'Configuration changed; refresh'using errcode='40001';end if;
 if a='configure'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','owner','account','purpose','costDecision','evidence','requireOcr','keyRef','destinationRef','rpoHours','rtoMinutes']))or exists(select 1 from jsonb_each(p)x where x.key not in('requireOcr','rpoHours','rtoMinutes')and jsonb_typeof(x.value)<>'string')or length(btrim(coalesce(p->>'account','')))not between 1 and 100 or length(btrim(coalesce(p->>'purpose','')))not between 10 and 1000 or length(btrim(coalesce(p->>'costDecision','')))not between 10 and 1000 or length(btrim(coalesce(p->>'evidence','')))not between 10 and 1000 or jsonb_typeof(p->'requireOcr')is distinct from'boolean'or coalesce(p->>'keyRef','')!~'^[A-Za-z0-9:_-]{1,100}$'or coalesce(p->>'destinationRef','')!~'^[A-Za-z0-9:_-]{1,100}$'or coalesce((p->>'rpoHours')::integer,0)not between 1 and 168 or coalesce((p->>'rtoMinutes')::integer,0)not between 1 and 1440 then raise exception 'Record bounded ownership, evidence, custody references and RPO/RTO';end if;
  perform 1 from public.memberships where workspace_id=ws and user_id=(p->>'owner')::uuid and role='admin'for share;if not found then raise exception 'Current administrator owner required';end if;
  insert into ecod_processing_private.policies values(ws,k,1,'configured',p,null)on conflict(workspace_id,kind)do update set generation=ecod_processing_private.policies.generation+1,state='configured',body=excluded.body,accepted_at=null;
 else
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','reason']))or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 or cfg.workspace_id is null then raise exception 'Configuration and explicit reason required';end if;
  valid:=case when k='processing'then ecod_processing_private.fresh(ws,k,'scan',cfg.generation,interval'15 minutes')and(cfg.body->'requireOcr'<>'true'::jsonb or ecod_processing_private.fresh(ws,k,'ocr',cfg.generation,interval'15 minutes'))else ecod_processing_private.fresh(ws,k,'backup',cfg.generation,make_interval(hours=>(cfg.body->>'rpoHours')::integer))and ecod_processing_private.fresh(ws,k,'restore',cfg.generation,interval'7 days')end;
  if a in('accept','enable')and not valid then raise exception 'Fresh passing server evidence required';end if;
  if a='enable'and(cfg.state<>'staging accepted'or cfg.accepted_at<clock_timestamp()-interval'7 days')then raise exception 'Accept current generation before enabling';end if;
  if a in('accept','enable')and not exists(select 1 from public.memberships where workspace_id=ws and user_id=(cfg.body->>'owner')::uuid and role='admin')then raise exception 'Owner access revoked';end if;
  update ecod_processing_private.policies set state=case a when'accept'then'staging accepted'when'enable'then'enabled'when'revoke'then'revoked'else'configured'end,generation=generation+case when a='revoke'then 1 else 0 end,accepted_at=case when a='accept'then clock_timestamp()when a='enable'then accepted_at else null end where workspace_id=ws and kind=k;
 end if;
 if a='enable'and k='processing'then update public.settings set custom=custom||'{"stage2ProcessingSuspended":false}'::jsonb where workspace_id=ws and id='workspace';end if;
 select *into cfg from ecod_processing_private.policies where workspace_id=ws and kind=k;
 insert into ecod_delivery_private.connections(workspace_id,kind,body,generation,state,accepted_at)values(ws,k,jsonb_build_object('owner',cfg.body->>'owner','account',cfg.body->>'account','purpose',cfg.body->>'purpose','costDecision',cfg.body->>'costDecision','evidence',cfg.body->>'evidence','scenario','success','secretRef','none'),cfg.generation,cfg.state,cfg.accepted_at)on conflict(workspace_id,kind)do update set body=excluded.body,generation=excluded.generation,state=excluded.state,accepted_at=excluded.accepted_at,updated_at=clock_timestamp();
 r:=jsonb_build_object('status','Recorded','kind',k);insert into ecod_processing_private.receipts values(ws,auth.uid(),op,req,r,clock_timestamp());insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'processing-recovery',op,'server_write','Stage 2 '||a,auth.uid()::text);return r;
end$$;
create or replace function ecod_processing_private.worker(a text,p jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare cfg ecod_processing_private.policies;old ecod_processing_private.evidence;ws uuid;component text;kind text;body jsonb;begin
 if jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 or a is null or a not in('configuration','evidence','lockdown','unlock')then raise exception 'Invalid operator request';end if;
 if a in('lockdown','unlock')then
  if exists(select 1 from jsonb_object_keys(p)x where x<>'reason')or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 then raise exception 'Operator reason required';end if;
  perform set_config('ecod.recovery_operator','on',true);
  update ecod_processing_private.lockdown set paused=(a='lockdown'),changed_at=clock_timestamp();
  if a='lockdown'then
   update public.settings set custom=custom||'{"stage2ProcessingSuspended":true}'::jsonb where id='workspace';
   update ecod_delivery_private.connections set state='configured',accepted_at=null where state in('enabled','staging accepted');
   update ecod_processing_private.policies set state='configured',accepted_at=null where state in('enabled','staging accepted');
  end if;return jsonb_build_object('paused',a='lockdown');
 end if;
 perform set_config('ecod.recovery_operator','on',true);
 ws:=(p->>'workspace')::uuid;kind:=coalesce(p->>'kind','processing');select *into cfg from ecod_processing_private.policies where workspace_id=ws and policies.kind=kind;
 if cfg.workspace_id is null then return jsonb_build_object('configured',false);end if;
 if a='configuration'then return jsonb_build_object('configured',true,'generation',cfg.generation,'requireOcr',cfg.body->'requireOcr','keyRef',cfg.body->'keyRef','destinationRef',cfg.body->'destinationRef');end if;
 if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['workspace','kind','generation','id','component','status','body']))or(cfg.generation is distinct from(p->>'generation')::integer)or cfg.state='revoked'or coalesce(p->>'status','')not in('passed','unavailable')then raise exception 'Current configured generation required';end if;
 component:=p->>'component';body:=p->'body';if jsonb_typeof(body)is distinct from'object'then raise exception 'Evidence object required';end if;
 if kind='processing'then
  if component not in('scan','ocr')or exists(select 1 from jsonb_object_keys(body)x where x<>all(array['engine','clean','blocked','fixture','code']))or length(coalesce(body->>'engine',''))>200 or length(coalesce(body->>'code',''))>100 then raise exception 'Invalid processing evidence';end if;
  if p->>'status'='passed'and(case when component='scan'then body->'clean'is distinct from'true'::jsonb or body->'blocked'is distinct from'true'::jsonb else body->'fixture'is distinct from'true'::jsonb end or length(coalesce(body->>'engine',''))=0)then raise exception 'Passing native smoke evidence required';end if;
 else
  if component not in('backup','restore')or exists(select 1 from jsonb_object_keys(body)x where x<>all(array['digest','keyRef','destinationRef','sourceRef','targetRef','backupDigest','encrypted','database','objects','privateJournals','sequences','rolesAuth','paused','durationSeconds','code']))or coalesce(body->>'sourceRef','')!~'^[A-Za-z0-9:_-]{1,100}$'or coalesce(body->>'digest','')!~'^[0-9a-f]{64}$'or body->>'keyRef'is distinct from cfg.body->>'keyRef'or body->>'destinationRef'is distinct from cfg.body->>'destinationRef'or coalesce((body->>'durationSeconds')::integer,-1)not between 0 and 86400 then raise exception 'Invalid recovery evidence';end if;
  if p->>'status'='passed'and(body->'encrypted'is distinct from'true'::jsonb or body->'database'is distinct from'true'::jsonb or body->'objects'is distinct from'true'::jsonb or body->'privateJournals'is distinct from'true'::jsonb or body->'sequences'is distinct from'true'::jsonb or body->'rolesAuth'is distinct from'true'::jsonb or body->'paused'is distinct from'true'::jsonb)then raise exception 'Complete recovery proof required';end if;
  if component='restore'and p->>'status'='passed'then if coalesce(body->>'targetRef','')!~'^[A-Za-z0-9:_-]{1,100}$'or body->>'targetRef'=body->>'sourceRef'or(body->>'durationSeconds')::integer>(cfg.body->>'rtoMinutes')::integer*60 or not exists(select 1 from ecod_processing_private.evidence e where e.workspace_id=ws and e.generation=cfg.generation and e.component='backup'and e.status='passed'and e.body->>'digest'=body->>'backupDigest'and e.body->>'sourceRef'=body->>'sourceRef')then raise exception 'Isolated matching backup and measured RTO required';end if;end if;
 end if;
 select *into old from ecod_processing_private.evidence where id=(p->>'id')::uuid;if found then if old.workspace_id<>ws or old.generation<>cfg.generation or old.component<>component or old.body<>body or old.status<>p->>'status'then raise exception 'Evidence conflict'using errcode='40001';end if;return jsonb_build_object('replayed',true);end if;
 insert into ecod_processing_private.evidence values((p->>'id')::uuid,ws,kind,cfg.generation,component,p->>'status',body,clock_timestamp());return jsonb_build_object('status','Evidence recorded');
end$$;
create or replace function public.api_processing_recovery(p_action text default'context',p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_processing_private.api(p_action,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.worker_processing_recovery(p_action text,p_payload jsonb default'{}')returns jsonb language sql security invoker set search_path=''as $$select ecod_processing_private.worker(p_action,p_payload)$$;
revoke all on all functions in schema ecod_processing_private from public,anon,authenticated;
revoke all on function public.api_processing_recovery(text,uuid,text,jsonb,integer),public.worker_processing_recovery(text,jsonb)from public,anon,authenticated;
grant usage on schema ecod_processing_private to authenticated;grant execute on function ecod_processing_private.api(text,uuid,text,jsonb,integer),public.api_processing_recovery(text,uuid,text,jsonb,integer)to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role')then grant usage on schema ecod_processing_private to service_role;grant execute on function ecod_processing_private.worker(text,jsonb),public.worker_processing_recovery(text,jsonb)to service_role;end if;end$$;
commit;
