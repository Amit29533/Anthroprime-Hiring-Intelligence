begin;
create schema if not exists ecod_delivery_private;
revoke all on schema ecod_delivery_private from public,anon,authenticated;
create table if not exists ecod_delivery_private.connections(workspace_id uuid references public.workspaces(id),kind text not null,body jsonb not null,generation integer not null default 1,state text not null default 'configured',diagnostic jsonb,accepted_at timestamptz,updated_at timestamptz not null default clock_timestamp(),primary key(workspace_id,kind));
create table if not exists ecod_delivery_private.intents(id uuid primary key,workspace_id uuid not null references public.workspaces(id),candidate_id uuid not null references public.candidates(id),template_id uuid not null,context jsonb not null,source_head text not null,generation integer not null,actor uuid not null,status text not null default 'Queued',reason text not null default '',attempts integer not null default 0,available_at timestamptz not null,expires_at timestamptz not null,lease uuid,lease_until timestamptz,started boolean not null default false,reconcile_due boolean not null default false,created_at timestamptz not null default clock_timestamp());
create index if not exists delivery_due on ecod_delivery_private.intents(status,available_at,id);
create index if not exists delivery_person on ecod_delivery_private.intents(workspace_id,candidate_id,created_at desc,id);
create unique index if not exists delivery_equivalent on ecod_delivery_private.intents(workspace_id,candidate_id,source_head)where status in('Queued','Deferred','Leased','Provider accepted','Delivered','Bounced','Ambiguous');
create table if not exists ecod_delivery_private.attempts(id uuid primary key,workspace_id uuid not null,candidate_id uuid not null references public.candidates(id),intent_id uuid not null references ecod_delivery_private.intents(id),number integer not null,gate_at timestamptz,outcome text,at timestamptz not null default clock_timestamp(),unique(intent_id,number));
create index if not exists delivery_attempt_person on ecod_delivery_private.attempts(workspace_id,candidate_id);
create table if not exists ecod_delivery_private.provider_receipts(intent_id uuid primary key references ecod_delivery_private.intents(id),workspace_id uuid not null,candidate_id uuid not null references public.candidates(id),generation integer not null,message_id text not null,state text not null default 'Provider accepted',event_at timestamptz not null default clock_timestamp());
create index if not exists delivery_provider_person on ecod_delivery_private.provider_receipts(workspace_id,candidate_id);
create table if not exists ecod_delivery_private.events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,candidate_id uuid not null references public.candidates(id),intent_id uuid not null references ecod_delivery_private.intents(id),generation integer not null,event_id text not null,body jsonb not null,at timestamptz not null default clock_timestamp(),unique(workspace_id,generation,event_id));
create index if not exists delivery_event_person on ecod_delivery_private.events(workspace_id,candidate_id);
create index if not exists delivery_event_intent on ecod_delivery_private.events(workspace_id,intent_id,at desc,id);
create table if not exists ecod_delivery_private.receipts(workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid references public.candidates(id),request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
create index if not exists delivery_receipt_person on ecod_delivery_private.receipts(workspace_id,candidate_id);
do $$declare n text;begin foreach n in array array['connections','intents','attempts','provider_receipts','events','receipts']loop execute format('alter table ecod_delivery_private.%I enable row level security',n);end loop;end$$;
revoke all on all tables in schema ecod_delivery_private from public,anon,authenticated;

create or replace function ecod_delivery_private.source(ws uuid,c uuid,t uuid,ctx jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s jsonb;conn ecod_delivery_private.connections;begin
 select *into conn from ecod_delivery_private.connections where workspace_id=ws and kind='delivery';
 s:=ecod_comms_private.source(ws,c,t,ctx);
 return jsonb_build_object('head',ecod_journey_private.token(ws,jsonb_build_array(s->'head',conn.generation)),'eligible',s->'eligible'='true'::jsonb and conn.state='enabled'and exists(select 1 from public.memberships where workspace_id=ws and user_id=(conn.body->>'owner')::uuid and role='admin'),'reason',case when conn.state is distinct from 'enabled'then'Sandbox connection is not enabled'when not exists(select 1 from public.memberships where workspace_id=ws and user_id=(conn.body->>'owner')::uuid and role='admin')then'Connection owner access revoked'else s->>'reason'end,'preference',s->'preference','generation',conn.generation,'preview',jsonb_build_object('transport','fictional sandbox','recipient','fixture@example.invalid','subject','Fictional delivery exercise','text','No candidate message or contact is transmitted.','templateKey',s->'preview'->'templateKey','purpose',s->'preview'->'purpose'));
end$$;
create or replace function ecod_delivery_private.allowed(i ecod_delivery_private.intents)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s jsonb;begin
 if not exists(select 1 from public.memberships where workspace_id=i.workspace_id and user_id=i.actor and role in('admin','recruiter'))then return jsonb_build_object('eligible',false,'reason','Preparing editor access revoked');end if;
 if i.expires_at<=clock_timestamp()then return jsonb_build_object('eligible',false,'reason','Intent expired');end if;
 s:=ecod_delivery_private.source(i.workspace_id,i.candidate_id,i.template_id,i.context);
 if s->>'head'is distinct from i.source_head then return jsonb_build_object('eligible',false,'reason','Reviewed source or connection generation changed');end if;
 return s;
exception when others then return jsonb_build_object('eligible',false,'reason','Source unavailable');end$$;

create or replace function ecod_delivery_private.api(a text,c uuid,op uuid,head text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(a not in('context','preview','history','diagnostic-token'));req jsonb;prior ecod_delivery_private.receipts;conn ecod_delivery_private.connections;i ecod_delivery_private.intents;s jsonb;result jsonb;rows jsonb;k text:=coalesce(p->>'kind','delivery');at timestamptz;begin
 if a is null or a not in('context','preview','history','diagnostic-token','configure','accept','enable','pause','degrade','revoke','rotate','prepare','cancel','retry','request-reconcile')or off is null or off not between 0 and 10000 or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 then raise exception 'Invalid delivery sandbox request';end if;
 if a in('configure','accept','enable','pause','degrade','revoke','rotate','diagnostic-token')then if not public.is_admin()then raise exception 'Administrator required'using errcode='42501';end if;perform ecod_private.require_privileged_mfa(ws);end if;
 if a not in('context','preview','history','diagnostic-token')then
  if op is null then raise exception 'Operation UUID required';end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text,714));req:=jsonb_build_array(a,c,head,p);
  select *into prior from ecod_delivery_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;
  if found then if prior.request<>req then raise exception 'Delivery operation conflict'using errcode='40001';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 end if;
 if c is not null then perform 1 from public.candidates where workspace_id=ws and id=c;if not found then raise exception 'Candidate unavailable';end if;end if;
 select *into conn from ecod_delivery_private.connections where workspace_id=ws and kind=k;
 if a='diagnostic-token'then if p<>'{}'or conn.workspace_id is null or conn.state='revoked'then raise exception 'Configure an active delivery sandbox first';end if;return jsonb_build_object('workspace',ws,'generation',conn.generation);
 elsif a='context'then
  if p<>'{}'then raise exception 'Invalid context request';end if;
  select coalesce(jsonb_agg(case when public.is_admin()then to_jsonb(x)||jsonb_build_object('head',ecod_journey_private.token(ws,to_jsonb(x)))else jsonb_build_object('kind',x.kind,'state',x.state,'generation',x.generation,'diagnostic',x.diagnostic)end order by kind),'[]')into rows from ecod_delivery_private.connections x where workspace_id=ws;
  result:=jsonb_build_object('transport','fictional sandbox only','catalogVersion',1,'templates',(select coalesce(jsonb_agg(to_jsonb(t)order by key,version desc),'[]')from(select tt.id,tt.key,tt.version from ecod_comms_private.templates tt where tt.workspace_id=ws order by tt.at desc,tt.id limit 100)t),'connections',rows,'canAdmin',public.is_admin(),'defaultHead',ecod_journey_private.token(ws,'null'::jsonb));
  select coalesce(jsonb_agg(to_jsonb(x)order by created_at desc,id),'[]')into rows from(select id,candidate_id,status,reason,attempts,generation,available_at,expires_at,created_at,ecod_journey_private.token(ws,to_jsonb(z))head from ecod_delivery_private.intents z where workspace_id=ws and(c is null or candidate_id=any(ecod_access_private.identity_family(ws,c)))order by created_at desc,id limit 26 offset off)x;
  return result||jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a in('preview','prepare')then
  if c is null or exists(select 1 from jsonb_object_keys(p)x where x<>all(array['template','context','availableAt']))then raise exception 'Choose candidate and template context';end if;
  s:=ecod_delivery_private.source(ws,c,(p->>'template')::uuid,coalesce(p->'context','{}'));
  if a='preview'then return s;end if;
  if s->'eligible'is distinct from'true'::jsonb then raise exception 'Source is not eligible: %',s->>'reason';end if;
  if s->>'head'is distinct from head then raise exception 'Reviewed delivery source changed'using errcode='40001';end if;
  at:=coalesce((p->>'availableAt')::timestamptz,clock_timestamp());if at>clock_timestamp()+interval'30 days'or at<clock_timestamp()-interval'5 minutes'then raise exception 'Schedule within the next 30 days';end if;
  if(select count(*)from ecod_delivery_private.intents where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,c))and created_at>clock_timestamp()-interval'24 hours')>=20 then raise exception 'Candidate sandbox intent quota reached';end if;
  if(select count(*)from ecod_delivery_private.intents where workspace_id=ws and status in('Queued','Deferred','Leased','Ambiguous'))>=500 then raise exception 'Workspace sandbox queue limit reached';end if;
  insert into ecod_delivery_private.intents(id,workspace_id,candidate_id,template_id,context,source_head,generation,actor,available_at,expires_at)values(op,ws,c,(p->>'template')::uuid,coalesce(p->'context','{}'),head,(s->>'generation')::integer,auth.uid(),greatest(at,clock_timestamp()),greatest(at,clock_timestamp())+interval'7 days');result:=jsonb_build_object('id',op,'status','Queued','transport','fictional sandbox');
 elsif a in('configure','accept','enable','pause','degrade','revoke','rotate')then
  if k not in('delivery','mailbox','calendar','processing','recovery','intelligence','enrichment','signing','sso','fulfillment')then raise exception 'Unknown dependency capability';end if;
  if ecod_journey_private.token(ws,case when conn.workspace_id is null then'null'::jsonb else to_jsonb(conn)end)is distinct from head then raise exception 'Connection changed; refresh readiness'using errcode='40001';end if;
  if a='configure'then
   if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','owner','account','purpose','costDecision','evidence','scenario','secretRef']))or exists(select 1 from jsonb_each(p)x where jsonb_typeof(x.value)<>'string')or length(btrim(coalesce(p->>'account','')))not between 1 and 100 or length(btrim(coalesce(p->>'purpose','')))not between 10 and 1000 or length(btrim(coalesce(p->>'costDecision','')))not between 10 and 1000 or length(btrim(coalesce(p->>'evidence','')))not between 10 and 1000 or coalesce(p->>'scenario','success')not in('success','transient','permanent','accepted-timeout','unknown','duplicate','reordered')or coalesce(p->>'secretRef','none')not in('none','env:DELIVERY_SANDBOX_CALLBACK_SECRET')then raise exception 'Record bounded ownership, purpose, cost and evidence; secret reference only';end if;
   perform 1 from public.memberships where workspace_id=ws and user_id=(p->>'owner')::uuid and role='admin'for share;if not found then raise exception 'Owner must be a current workspace administrator';end if;
   insert into ecod_delivery_private.connections(workspace_id,kind,body)values(ws,k,p)on conflict(workspace_id,kind)do update set body=excluded.body,generation=ecod_delivery_private.connections.generation+1,state='configured',diagnostic=null,accepted_at=null,updated_at=clock_timestamp();
  else
   if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','reason']))or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 then raise exception 'Record an administrative reason';end if;
   if conn.workspace_id is null then raise exception 'Configure the dependency first';end if;
   if a in('accept','enable')and(k<>'delivery'or conn.diagnostic->>'code'is distinct from'sandbox-healthy'or(conn.diagnostic->>'generation')::integer is distinct from conn.generation or(conn.diagnostic->>'at')::timestamptz<clock_timestamp()-interval'10 minutes')then raise exception 'Fresh successful sandbox diagnostic required';end if;
   if a='enable'and(conn.state<>'staging accepted'or conn.accepted_at<clock_timestamp()-interval'7 days')then raise exception 'Accept this generation before enabling';end if;
   update ecod_delivery_private.connections set state=case a when'accept'then'staging accepted'when'enable'then'enabled'when'pause'then'configured'when'degrade'then'degraded'when'revoke'then'revoked'else'configured'end,generation=generation+case when a in('revoke','rotate')then 1 else 0 end,accepted_at=case when a='accept'then clock_timestamp()when a='enable'then accepted_at else null end,body=jsonb_set(body,'{lastReason}',to_jsonb(btrim(p->>'reason'))),updated_at=clock_timestamp()where workspace_id=ws and kind=k;
  end if;
  if k='delivery'and a in('configure','revoke','rotate')then update ecod_delivery_private.intents set status='Suppressed',reason='Connection generation invalidated'where workspace_id=ws and status in('Queued','Deferred');end if;
  result:=jsonb_build_object('status','Readiness recorded','kind',k);
 elsif a='history'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>'intent')then raise exception 'Invalid history request';end if;
  select *into i from ecod_delivery_private.intents where workspace_id=ws and id=(p->>'intent')::uuid;if not found then raise exception 'Intent unavailable';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into rows from(select *from ecod_delivery_private.events where workspace_id=ws and intent_id=i.id order by at desc,id limit 26 offset off)x;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'attempts',(select coalesce(jsonb_agg(to_jsonb(x)order by number),'[]')from ecod_delivery_private.attempts x where intent_id=i.id),'head',ecod_journey_private.token(ws,to_jsonb(i)),'status',i.status);
 else
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['intent','reason']))or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 then raise exception 'Record a recovery reason';end if;
  select *into i from ecod_delivery_private.intents where workspace_id=ws and id=(p->>'intent')::uuid for update;if not found then raise exception 'Intent unavailable';end if;c:=i.candidate_id;
  if ecod_journey_private.token(ws,to_jsonb(i))is distinct from head then raise exception 'Intent changed; refresh recovery'using errcode='40001';end if;
  if a='cancel'then if i.status not in('Queued','Deferred','Failed')then raise exception 'Cannot cancel a possibly dispatched intent';end if;update ecod_delivery_private.intents set status='Cancelled',reason=btrim(p->>'reason')where id=i.id;
  elsif a='retry'then s:=ecod_delivery_private.allowed(i);if i.status<>'Failed'or i.attempts>=3 or s->'eligible'is distinct from'true'::jsonb then raise exception 'Only eligible failed intents below three attempts may retry';end if;update ecod_delivery_private.intents set status='Deferred',available_at=clock_timestamp(),reason=btrim(p->>'reason')where id=i.id;
  else if i.status not in('Ambiguous','Provider accepted')then raise exception 'Only ambiguous or accepted outcomes need reconciliation';end if;update ecod_delivery_private.intents set reconcile_due=true,reason=btrim(p->>'reason')where id=i.id;end if;
  result:=jsonb_build_object('id',i.id,'status','Recovery recorded');
 end if;
 insert into ecod_delivery_private.receipts values(ws,auth.uid(),op,c,req,result,clock_timestamp());
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'delivery-sandbox',coalesce(c,op),'server_write','Sandbox '||a,auth.uid()::text);
 return result;
end$$;

create or replace function ecod_delivery_private.worker(a text,p jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare i ecod_delivery_private.intents;conn ecod_delivery_private.connections;s jsonb;r ecod_delivery_private.provider_receipts;lease_id uuid;rows jsonb:='[]';n integer;prior ecod_delivery_private.events;outcome text;begin
 if a is null or a not in('claim','gate','sink','finish','reconcile','event','diagnose','reconcile-list')or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 then raise exception 'Invalid sandbox worker request';end if;
 if a='diagnose'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['workspace','generation','callbackConfigured','actor']))or jsonb_typeof(p->'callbackConfigured')is distinct from'boolean'then raise exception 'Invalid diagnostic';end if;
  if not exists(select 1 from public.memberships where workspace_id=(p->>'workspace')::uuid and user_id=(p->>'actor')::uuid and role='admin')then raise exception 'Diagnostic administrator access revoked';end if;
  update ecod_delivery_private.connections set diagnostic=jsonb_build_object('code','sandbox-healthy','generation',generation,'at',clock_timestamp(),'callbackConfigured',p->'callbackConfigured','liveTransport',false),updated_at=clock_timestamp()where workspace_id=(p->>'workspace')::uuid and kind='delivery'and generation=(p->>'generation')::integer and state<>'revoked';
  if not found then raise exception 'Connection generation unavailable';end if;return jsonb_build_object('status','Diagnostic recorded');
 elsif a='claim'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>'limit')then raise exception 'Invalid claim';end if;n:=coalesce((p->>'limit')::integer,3);if n not between 1 and 3 then raise exception 'Claim 1-3 intents';end if;
  for i in select *from ecod_delivery_private.intents where status='Leased'and lease_until<=clock_timestamp()order by lease_until,id limit n for update skip locked loop
   update ecod_delivery_private.intents set status=case when started then'Ambiguous'else'Deferred'end,reconcile_due=started,available_at=clock_timestamp(),reason=case when started then'Expired dispatch acknowledgement'else'Expired before dispatch'end where id=i.id;
   update ecod_delivery_private.attempts set outcome=case when i.started then'Ambiguous'else'Lease expired before dispatch'end where id=i.lease;
  end loop;
  for i in select z.*from ecod_delivery_private.intents z where z.status in('Queued','Deferred')and available_at<=clock_timestamp()and exists(select 1 from ecod_delivery_private.connections c where c.workspace_id=z.workspace_id and c.kind='delivery'and c.state='enabled')order by available_at,id limit n for update skip locked loop
   s:=ecod_delivery_private.allowed(i);
   if s->'eligible'is distinct from'true'::jsonb then update ecod_delivery_private.intents set status='Suppressed',reason=s->>'reason'where id=i.id;continue;end if;
   if i.attempts>=3 then update ecod_delivery_private.intents set status='Failed',reason='Three-attempt bound reached'where id=i.id;continue;end if;
   if extract(hour from clock_timestamp()at time zone'UTC')<(s->'preference'->>'startHour')::integer or extract(hour from clock_timestamp()at time zone'UTC')>=(s->'preference'->>'endHour')::integer then update ecod_delivery_private.intents set available_at=clock_timestamp()+interval'1 hour',reason='Waiting for permitted UTC contact window'where id=i.id;continue;end if;
   if(select count(distinct intent_id)from ecod_delivery_private.attempts where workspace_id=i.workspace_id and candidate_id=any(ecod_access_private.identity_family(i.workspace_id,i.candidate_id))and gate_at>clock_timestamp()-interval'24 hours'and intent_id<>i.id)>=3 then update ecod_delivery_private.intents set available_at=clock_timestamp()+interval'1 hour',reason='Candidate sandbox frequency bound'where id=i.id;continue;end if;
   lease_id:=gen_random_uuid();update ecod_delivery_private.intents set status='Leased',attempts=attempts+1,lease=lease_id,lease_until=clock_timestamp()+interval'70 seconds',started=false,reason=''where id=i.id;
   insert into ecod_delivery_private.attempts(id,workspace_id,candidate_id,intent_id,number)values(lease_id,i.workspace_id,i.candidate_id,i.id,i.attempts+1);
   rows:=rows||jsonb_build_array(jsonb_build_object('id',i.id,'lease',lease_id));
  end loop;return jsonb_build_object('rows',rows);
 elsif a='reconcile-list'then
  if p<>'{}'then raise exception 'Invalid reconciliation list';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]')into rows from(select id from ecod_delivery_private.intents where reconcile_due and status in('Ambiguous','Provider accepted','Delivered','Bounced')order by created_at,id limit 3)x;return jsonb_build_object('rows',rows);
 elsif a='event'then
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['workspace','intent','generation','eventId','messageId','type','at']))or length(coalesce(p->>'eventId',''))not between 1 and 100 or coalesce(p->>'type','')not in('Provider accepted','Delivered','Bounced')or nullif(p->>'at','')is null or(p->>'at')::timestamptz>clock_timestamp()+interval'5 minutes'or(p->>'at')::timestamptz<clock_timestamp()-interval'30 days'then raise exception 'Invalid normalized callback';end if;
  select *into i from ecod_delivery_private.intents where id=(p->>'intent')::uuid and workspace_id=(p->>'workspace')::uuid for update;select *into r from ecod_delivery_private.provider_receipts where intent_id=i.id;
  if i.id is null or r.intent_id is null or r.generation is distinct from(p->>'generation')::integer or r.message_id is distinct from p->>'messageId'or not exists(select 1 from ecod_delivery_private.connections where workspace_id=i.workspace_id and kind='delivery'and generation=i.generation and state<>'revoked')then raise exception 'Callback connection or provider receipt unavailable';end if;
  select *into prior from ecod_delivery_private.events where workspace_id=i.workspace_id and generation=i.generation and event_id=p->>'eventId';
  if found then if prior.body<>p then raise exception 'Callback event conflict'using errcode='40001';end if;return jsonb_build_object('replayed',true);end if;
  insert into ecod_delivery_private.events(workspace_id,candidate_id,intent_id,generation,event_id,body)values(i.workspace_id,i.candidate_id,i.id,i.generation,p->>'eventId',p);
  if(p->>'at')::timestamptz>=r.event_at and(p->>'type'='Bounced'or(r.state<>'Bounced'and(p->>'type'='Delivered'or r.state='Provider accepted')))then update ecod_delivery_private.provider_receipts set state=p->>'type',event_at=(p->>'at')::timestamptz where intent_id=i.id;update ecod_delivery_private.intents set reconcile_due=true where id=i.id;end if;return jsonb_build_object('status','Callback recorded');
 end if;
 if exists(select 1 from jsonb_object_keys(p)x where x<>all(case when a='finish'then array['id','lease','outcome']when a='reconcile'then array['id']else array['id','lease']end))then raise exception 'Invalid worker payload';end if;
 select *into i from ecod_delivery_private.intents where id=(p->>'id')::uuid for update;if not found then raise exception 'Intent unavailable';end if;select *into conn from ecod_delivery_private.connections where workspace_id=i.workspace_id and kind='delivery';
 if a='reconcile'then
  if i.status not in('Ambiguous','Provider accepted','Delivered','Bounced')then return jsonb_build_object('status',i.status);end if;select *into r from ecod_delivery_private.provider_receipts where intent_id=i.id;
  if r.intent_id is null then update ecod_delivery_private.intents set reconcile_due=false,reason='Provider acceptance remains unknown; no automatic resend'where id=i.id;return jsonb_build_object('status','Ambiguous');end if;
  update ecod_delivery_private.intents set status=r.state,reconcile_due=false,reason='Reconciled fictional provider receipt'where id=i.id;return jsonb_build_object('status',r.state);
 end if;
 if i.status<>'Leased'or i.lease is distinct from(p->>'lease')::uuid or i.lease_until<=clock_timestamp()then raise exception 'Stale dispatch lease'using errcode='40001';end if;
 if a='gate'then
  perform 1 from public.candidates where workspace_id=i.workspace_id and id=i.candidate_id for update;
  s:=ecod_delivery_private.allowed(i);if s->'eligible'is distinct from'true'::jsonb then update ecod_delivery_private.intents set status='Suppressed',reason=s->>'reason'where id=i.id;return jsonb_build_object('allowed',false);end if;
  if extract(hour from clock_timestamp()at time zone'UTC')<(s->'preference'->>'startHour')::integer or extract(hour from clock_timestamp()at time zone'UTC')>=(s->'preference'->>'endHour')::integer then update ecod_delivery_private.intents set status='Deferred',available_at=clock_timestamp()+interval'1 hour',reason='Contact window closed before dispatch'where id=i.id;update ecod_delivery_private.attempts set outcome='Deferred before dispatch'where id=i.lease;return jsonb_build_object('allowed',false);end if;
  if i.started then raise exception 'Lease already passed the dispatch gate';end if;
  if(select count(distinct intent_id)from ecod_delivery_private.attempts where workspace_id=i.workspace_id and candidate_id=any(ecod_access_private.identity_family(i.workspace_id,i.candidate_id))and gate_at>clock_timestamp()-interval'24 hours'and intent_id<>i.id)>=3 then update ecod_delivery_private.intents set status='Deferred',available_at=clock_timestamp()+interval'1 hour',reason='Candidate sandbox frequency bound at dispatch'where id=i.id;update ecod_delivery_private.attempts set outcome='Deferred before dispatch'where id=i.lease;return jsonb_build_object('allowed',false);end if;
update ecod_delivery_private.intents set started=true where id=i.id;update ecod_delivery_private.attempts set gate_at=clock_timestamp()where id=i.lease;
  return jsonb_build_object('allowed',true,'adapter','fictional','scenario',conn.body->>'scenario','idempotencyKey',i.id,'workspace',i.workspace_id,'generation',i.generation);
 elsif a='sink'then
  if not i.started then raise exception 'Final dispatch gate required';end if;s:=ecod_delivery_private.allowed(i);if s->'eligible'is distinct from'true'::jsonb then return jsonb_build_object('outcome','permanent');end if;
  if extract(hour from clock_timestamp()at time zone'UTC')<(s->'preference'->>'startHour')::integer or extract(hour from clock_timestamp()at time zone'UTC')>=(s->'preference'->>'endHour')::integer then return jsonb_build_object('outcome','transient');end if;
  if conn.body->>'scenario'in('transient','permanent','unknown')then return jsonb_build_object('outcome',conn.body->>'scenario');end if;
  insert into ecod_delivery_private.provider_receipts(intent_id,workspace_id,candidate_id,generation,message_id)values(i.id,i.workspace_id,i.candidate_id,i.generation,'sandbox:'||i.id)on conflict(intent_id)do nothing;return jsonb_build_object('outcome','accepted','messageId','sandbox:'||i.id);
 else
  outcome:=p->>'outcome';if outcome is null or outcome not in('accepted','transient','permanent','ambiguous')or not i.started then raise exception 'Valid gated outcome required';end if;
  if outcome='accepted'and not exists(select 1 from ecod_delivery_private.provider_receipts where intent_id=i.id)then raise exception 'Provider acceptance proof required';end if;
  update ecod_delivery_private.attempts set outcome=outcome where id=i.lease;
  update ecod_delivery_private.intents set status=case outcome when'accepted'then'Provider accepted'when'ambiguous'then'Ambiguous'when'transient'then case when attempts<3 then'Deferred'else'Failed'end else'Failed'end,reconcile_due=outcome='ambiguous'or(outcome='accepted'and exists(select 1 from ecod_delivery_private.provider_receipts where intent_id=i.id and state<>'Provider accepted')),available_at=clock_timestamp()+interval'1 minute',reason=case when outcome='ambiguous'then'Unknown acknowledgement; reconcile before any resend'else'Fictional dispatch '||outcome end where id=i.id;return jsonb_build_object('status','Outcome recorded');
 end if;
end$$;
create or replace function public.api_delivery_sandbox(p_action text default'context',p_candidate uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_delivery_private.api(p_action,p_candidate,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.worker_delivery_sandbox(p_action text,p_payload jsonb default'{}')returns jsonb language sql security invoker set search_path=''as $$select ecod_delivery_private.worker(p_action,p_payload)$$;
revoke all on all functions in schema ecod_delivery_private from public,anon,authenticated;
revoke all on function public.api_delivery_sandbox(text,uuid,uuid,text,jsonb,integer),public.worker_delivery_sandbox(text,jsonb)from public,anon,authenticated;
grant usage on schema ecod_delivery_private to authenticated;
grant execute on function ecod_delivery_private.api(text,uuid,uuid,text,jsonb,integer),public.api_delivery_sandbox(text,uuid,uuid,text,jsonb,integer)to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role')then grant usage on schema ecod_delivery_private to service_role;grant execute on function ecod_delivery_private.worker(text,jsonb),public.worker_delivery_sandbox(text,jsonb)to service_role;end if;end$$;
do $$declare fn text;d text;begin
 foreach fn in array array['ecod_private.erasure_inventory','ecod_ops_private.source_inventory']loop
  d:=pg_get_functiondef((fn||'(uuid,uuid)')::regprocedure);
  if strpos(d,'deliveryIntents')=0 then
   d:=replace(d,'(''foundationReceipts'',''integrations'')','(''foundationReceipts'',''integrations''),(''deliveryIntents'',''records''),(''deliveryAttempts'',''history''),(''deliveryEvents'',''history''),(''deliveryProvider'',''integrations''),(''deliveryReceipts'',''integrations'')');
   d:=replace(d,'predicate:=case d.name','predicate:=case d.name when''deliveryIntents''then''t.candidate_id=any($1)''when''deliveryAttempts''then''t.candidate_id=any($1)''when''deliveryEvents''then''t.candidate_id=any($1)''when''deliveryProvider''then''t.candidate_id=any($1)''when''deliveryReceipts''then''t.candidate_id=any($1)''');
   d:=replace(d,'case when d.name','case when d.name in(''deliveryIntents'',''deliveryAttempts'',''deliveryEvents'',''deliveryProvider'',''deliveryReceipts'')then''ecod_delivery_private''when d.name');
   d:=replace(d,'end,case d.name when','end,case d.name when''deliveryIntents''then''intents''when''deliveryAttempts''then''attempts''when''deliveryEvents''then''events''when''deliveryProvider''then''provider_receipts''when''deliveryReceipts''then''receipts''when');execute d;
  end if;
 end loop;
 d:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);if strpos(d,'leased delivery sandbox')=0 then d:=replace(d,'foundation quality decisions','leased delivery sandbox intents, attempts, callbacks, fictional provider receipts and recovery receipts, foundation quality decisions');execute d;end if;
end$$;
commit;
