-- Google Workspace activation and bounded collaboration contracts. No credential is exposed by an application RPC.
begin;
create schema if not exists ecod_collaboration_private;
revoke all on schema ecod_collaboration_private from public,anon,authenticated;
create table if not exists ecod_collaboration_private.connections(
 workspace_id uuid references public.workspaces(id),kind text check(kind in('mailbox','calendar')),generation integer not null default 1,
 body jsonb not null,state text not null default 'configured',credentials jsonb,authorized_at timestamptz,diagnostic_at timestamptz,accepted_at timestamptz,
 cursor text,page text,baseline text,full_sync boolean not null default true,cycle uuid,lease uuid,lease_until timestamptz,
 due_at timestamptz not null default clock_timestamp(),channel jsonb,dirty boolean not null default false,error text not null default '',
 primary key(workspace_id,kind));
create table if not exists ecod_collaboration_private.oauth_states(id uuid primary key,workspace_id uuid not null,kind text not null,generation integer not null,actor uuid not null,expires_at timestamptz not null,used boolean not null default false);
create table if not exists ecod_collaboration_private.work(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),candidate_id uuid not null references public.candidates(id),kind text not null check(kind in('send','book','reschedule','cancel','attachment')),
 generation integer not null,actor uuid not null,source_head text not null,body jsonb not null,status text not null default 'Queued',reason text not null default '',attempts integer not null default 0,
 lease uuid,lease_until timestamptz,started boolean not null default false,reconciling boolean not null default false,available_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval'7 days',
 provider_id text,created_at timestamptz not null default clock_timestamp());
create index if not exists collaboration_work_due on ecod_collaboration_private.work(status,available_at,id);
create index if not exists collaboration_work_candidate on ecod_collaboration_private.work(workspace_id,candidate_id);
create unique index if not exists collaboration_send_equivalent on ecod_collaboration_private.work(workspace_id,candidate_id,kind,source_head)where kind='send'and status in('Queued','Deferred','Leased','Ambiguous','Manual review','Provider accepted','Bounced','Bounce reported');
create table if not exists ecod_collaboration_private.attempts(id uuid primary key,workspace_id uuid not null,candidate_id uuid not null references public.candidates(id),work_id uuid not null references ecod_collaboration_private.work(id),number integer not null,body jsonb not null default '{}',at timestamptz not null default clock_timestamp(),unique(work_id,number));
create index if not exists collaboration_attempt_candidate on ecod_collaboration_private.attempts(workspace_id,candidate_id);
create table if not exists ecod_collaboration_private.messages(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,generation integer not null,provider_id text not null,thread_id text not null,candidate_id uuid references public.candidates(id),
 body jsonb not null,deleted boolean not null default false,seen_cycle uuid,at timestamptz not null default clock_timestamp(),unique(workspace_id,generation,provider_id));
create index if not exists collaboration_message_candidate on ecod_collaboration_private.messages(workspace_id,candidate_id);
create index if not exists collaboration_message_thread on ecod_collaboration_private.messages(workspace_id,generation,thread_id,at desc,id);
create table if not exists ecod_collaboration_private.attachments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,candidate_id uuid references public.candidates(id),message_id uuid not null references ecod_collaboration_private.messages(id),
 part_id text not null,body jsonb not null,document_id uuid references public."documentJobs"(id),unique(message_id,part_id));
create index if not exists collaboration_attachment_candidate on ecod_collaboration_private.attachments(workspace_id,candidate_id);
create table if not exists ecod_collaboration_private.bookings(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null references public.candidates(id),interview_id uuid not null references public.interviews(id),generation integer not null,account text not null,calendar_id text not null,
 starts_at timestamptz not null,ends_at timestamptz not null,old_start timestamptz,old_end timestamptz,zone text not null,state text not null default 'Reserved',
 provider_id text not null,etag text,rsvp text not null default 'needsAction',provider_updated timestamptz,operation_id uuid not null);
create unique index if not exists collaboration_active_interview on ecod_collaboration_private.bookings(workspace_id,interview_id)where state<>'Cancelled';
create index if not exists collaboration_booking_candidate on ecod_collaboration_private.bookings(workspace_id,candidate_id);
create table if not exists ecod_collaboration_private.receipts(workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid references public.candidates(id),request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
create index if not exists collaboration_receipt_candidate on ecod_collaboration_private.receipts(workspace_id,candidate_id);
create table if not exists ecod_collaboration_private.busy(workspace_id uuid not null,generation integer not null,starts_at timestamptz not null,ends_at timestamptz not null,checked_at timestamptz not null,check(ends_at>starts_at));
create table if not exists ecod_collaboration_private.availability(workspace_id uuid primary key,generation integer not null,starts_at timestamptz not null,ends_at timestamptz not null,checked_at timestamptz not null);

create or replace function ecod_collaboration_private.person_ok(ws uuid,c uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select exists(select 1 from public.candidates where workspace_id=ws and id=c and "mergedInto"is null and not "processingRestricted"and status<>'Unavailable')
$$;
create or replace function ecod_collaboration_private.owner_ok(cfg ecod_collaboration_private.connections)returns boolean language sql stable security invoker set search_path=''as $$
 select cfg.state<>'revoked'and not(select paused from ecod_processing_private.lockdown)and exists(select 1 from public.memberships where workspace_id=cfg.workspace_id and user_id=(cfg.body->>'owner')::uuid and role='admin')
$$;
create or replace function ecod_collaboration_private.quarantine_ready(ws uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select ecod_private.attachments_enabled(ws)and ecod_processing_private.ready(ws)
 and exists(select 1 from ecod_processing_private.policies where workspace_id=ws and kind='processing'and state='enabled')
 and exists(select 1 from ecod_processing_private.policies q where workspace_id=ws and kind='recovery'and state='enabled'and exists(select 1 from public.memberships where workspace_id=ws and user_id=(q.body->>'owner')::uuid and role='admin')and ecod_processing_private.fresh(ws,'recovery','backup',q.generation,make_interval(hours=>(q.body->>'rpoHours')::integer))and ecod_processing_private.fresh(ws,'recovery','restore',q.generation,interval'7 days'))
$$;
create or replace function ecod_collaboration_private.head(cfg ecod_collaboration_private.connections)returns text language sql stable security invoker set search_path=''as $$
 select ecod_journey_private.token(cfg.workspace_id,jsonb_build_array(cfg.body,cfg.generation,cfg.state,cfg.authorized_at,cfg.accepted_at))
$$;
create or replace function ecod_collaboration_private.source(ws uuid,c uuid,k text,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare cfg ecod_collaboration_private.connections;s jsonb;i public.interviews;b ecod_collaboration_private.bookings;m ecod_collaboration_private.messages;tpl ecod_comms_private.templates;vars jsonb;render_subject text;render_body text;var_name text;begin
 select *into cfg from ecod_collaboration_private.connections where workspace_id=ws and kind=case when k in('send','attachment')then'mailbox'else'calendar'end;
 if k='attachment'then
  select x.*into m from ecod_collaboration_private.messages x join ecod_collaboration_private.attachments a on a.message_id=x.id where a.id=(p->>'attachment')::uuid and a.workspace_id=ws and a.candidate_id=c and not x.deleted;
  s:=jsonb_build_object('eligible',m.id is not null and ecod_collaboration_private.person_ok(ws,c)and ecod_collaboration_private.quarantine_ready(ws),'reason','Reviewed attachment and accepted Stage 2 processing/recovery required','head',ecod_journey_private.token(ws,jsonb_build_array(m.id,m.generation,m.candidate_id,m.deleted,p)));
 else
  s:=ecod_comms_private.source(ws,c,(p->>'template')::uuid,coalesce(p->'context','{}'));
  if k='send'and nullif(p->>'reply','')is not null then
   select *into m from ecod_collaboration_private.messages where workspace_id=ws and id=(p->>'reply')::uuid and generation=cfg.generation and candidate_id=any(ecod_access_private.identity_family(ws,c))and not deleted;
   if m.id is null or coalesce(m.body->>'messageId','')!~'^<[^<>[:space:]]+@[^<>[:space:]]+>$'or s->'preview'->>'subject'is distinct from m.body->>'subject'then return jsonb_build_object('eligible',false,'reason','Review a current linked thread and matching reply subject');end if;
   s:=s||jsonb_build_object('head',ecod_journey_private.token(ws,jsonb_build_array(s->'head',m.id,m.body,m.deleted)),'preview',s->'preview'||jsonb_build_object('threadId',m.thread_id,'inReplyTo',m.body->>'messageId'));
  end if;
  if k<>'send'then
   select *into i from public.interviews where workspace_id=ws and id=(p->>'interview')::uuid and "candidateId"=c;
   if i.id is null or(i.status<>'Scheduled'and k<>'cancel')or p->'context'->>'interview'is distinct from i.id::text or not exists(select 1 from ecod_comms_private.templates where id=(p->>'template')::uuid and body->>'kind'='interview-invite')then return jsonb_build_object('eligible',false,'reason','Current interview and invite template required');end if;
   select *into b from ecod_collaboration_private.bookings where workspace_id=ws and interview_id=i.id and state<>'Cancelled';
   s:=s||jsonb_build_object('head',ecod_journey_private.token(ws,jsonb_build_array(s->'head',i.id,i."scheduledAt",i."durationMins",i.status)),'interview',jsonb_build_object('id',i.id,'start',i."scheduledAt",'duration',i."durationMins"),'booking',b.id);
   if k='reschedule'then
    select *into tpl from ecod_comms_private.templates where workspace_id=ws and id=(p->>'template')::uuid;
    vars:=jsonb_build_object('candidateName',s->'preview'->>'candidate','anthroId',s->'preview'->>'anthroId','demandTitle',coalesce((select title from public.demands where workspace_id=ws and id=i."demandId"),''),'scheduledAt',p->>'start');
    render_subject:=tpl.body->>'subject';render_body:=tpl.body->>'text';foreach var_name in array array['candidateName','anthroId','demandTitle','scheduledAt']loop render_subject:=replace(render_subject,'{{'||var_name||'}}',coalesce(vars->>var_name,''));render_body:=replace(render_body,'{{'||var_name||'}}',coalesce(vars->>var_name,''));end loop;
    s:=s||jsonb_build_object('preview',s->'preview'||jsonb_build_object('subject',render_subject,'text',render_body));
   end if;
  end if;
 end if;
 return s||jsonb_build_object('head',ecod_journey_private.token(ws,jsonb_build_array(s->'head',k,p,cfg.generation)),'generation',cfg.generation,'eligible',coalesce(s->'eligible'='true'::jsonb,false)and cfg.state='enabled'and cfg.credentials is not null and ecod_collaboration_private.owner_ok(cfg),'reason',case when cfg.state is distinct from'enabled'then'Google connection is not enabled'when not ecod_collaboration_private.owner_ok(cfg)then'Connection owner or recovery gate unavailable'else s->>'reason'end);
end$$;
-- Service-only OAuth, sync checkpoints and lease transitions. No application role can forge provider evidence.
create or replace function ecod_collaboration_private.worker(a text,p jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare cfg ecod_collaboration_private.connections;w ecod_collaboration_private.work;b ecod_collaboration_private.bookings;m ecod_collaboration_private.messages;att ecod_collaboration_private.attachments;ticket ecod_collaboration_private.oauth_states;
 ws uuid;kind text;v jsonb;item jsonb;s jsonb;lease_id uuid;cid uuid;key text;ext text;mt text;outcome text;begin
 if a is null or a not in('oauth-claim','oauth-save','oauth-gate','diagnostic','claim','gate','sync-finish','sync-reset','sync-error','channel','hint','finish','attachment-reserve','attachment-uploaded')or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>262144 then raise exception 'Invalid Google worker request';end if;
 if a in('oauth-claim','oauth-save','oauth-gate')then
  select *into ticket from ecod_collaboration_private.oauth_states where id=(p->>'ticket')::uuid for update;
  if ticket.id is null or ticket.expires_at<=clock_timestamp()or(a='oauth-claim'and ticket.used)or(a in('oauth-save','oauth-gate')and not ticket.used)then raise exception 'OAuth state expired or consumed';end if;
  select *into cfg from ecod_collaboration_private.connections where workspace_id=ticket.workspace_id and connections.kind=ticket.kind for update;
  if cfg.generation<>ticket.generation or not ecod_collaboration_private.owner_ok(cfg)or ticket.actor is distinct from(cfg.body->>'owner')::uuid then raise exception 'OAuth generation or owner changed';end if;
  if a='oauth-claim'then update ecod_collaboration_private.oauth_states set used=true where id=ticket.id;return jsonb_build_object('workspace',ticket.workspace_id,'kind',ticket.kind,'generation',ticket.generation,'account',cfg.body->>'account','calendarId',cfg.body->>'calendarId');end if;
  if a='oauth-gate'then return jsonb_build_object('allowed',true);end if;
  if cfg.credentials is not null or p->>'account'is distinct from cfg.body->>'account'or jsonb_typeof(p->'credentials')is distinct from'object'or length(p->'credentials'->>'cipher')not between 1 and 20000 then raise exception 'Exact authorized account and encrypted credential required';end if;
  update ecod_collaboration_private.connections set credentials=p->'credentials',authorized_at=clock_timestamp(),state='configured',diagnostic_at=null,accepted_at=null,error=''where workspace_id=cfg.workspace_id and connections.kind=cfg.kind;
  delete from ecod_collaboration_private.oauth_states where id=ticket.id;return jsonb_build_object('status','Authorized');
 end if;
 if a='hint'then
  select *into cfg from ecod_collaboration_private.connections where connections.kind='calendar'and channel->>'id'=p->>'channel'for update;
  if cfg.workspace_id is null or cfg.state<>'enabled'or not ecod_collaboration_private.owner_ok(cfg)or cfg.channel->>'token'is distinct from p->>'token'or cfg.channel->>'resourceId'is distinct from p->>'resourceId'or(cfg.channel->>'expiration')::timestamptz<=clock_timestamp()then raise exception 'Current calendar channel required';end if;
  if coalesce(p->>'number','')!~'^[0-9]{1,20}$'then raise exception 'Invalid notification sequence';end if;
  if(p->>'number')::numeric<=coalesce((cfg.channel->>'number')::numeric,0)then return jsonb_build_object('duplicate',true);end if;
  update ecod_collaboration_private.connections set dirty=true,due_at=clock_timestamp(),channel=jsonb_set(channel,'{number}',to_jsonb(p->>'number'))where workspace_id=cfg.workspace_id and connections.kind=cfg.kind;return jsonb_build_object('status','Hint recorded');
 end if;
 if a='claim'then
  update ecod_collaboration_private.work set status=case when started or reconciling then'Ambiguous'else'Deferred'end,reason='Lease expired - reconcile before resend',available_at=clock_timestamp()+interval'1 minute'where status='Leased'and lease_until<clock_timestamp();
  update ecod_collaboration_private.work set status=case when status in('Ambiguous','Provider accepted')then'Manual review'else'Suppressed'end,reason='Operation expired; retained reservations require review'where status in('Queued','Deferred','Ambiguous','Provider accepted')and expires_at<=clock_timestamp();
  select x.*into w from ecod_collaboration_private.work x join ecod_collaboration_private.connections c on c.workspace_id=x.workspace_id and c.kind=case when x.kind in('send','attachment')then'mailbox'else'calendar'end
   where x.status in('Queued','Deferred','Ambiguous','Provider accepted')and x.available_at<=clock_timestamp()and x.expires_at>clock_timestamp()and c.due_at>clock_timestamp()-interval'10 minutes'and c.state='enabled'and c.credentials is not null and(c.lease_until is null or c.lease_until<clock_timestamp())and ecod_collaboration_private.owner_ok(c)
   order by x.available_at,x.id limit 1 for update of x,c skip locked;
  if w.id is not null then
   if w.kind='send'and w.status in('Queued','Deferred')and(select count(*)from ecod_collaboration_private.attempts where workspace_id=w.workspace_id and candidate_id=w.candidate_id and at>clock_timestamp()-interval'24 hours'and work_id in(select id from ecod_collaboration_private.work where kind='send'))>=3 then update ecod_collaboration_private.work set status='Deferred',reason='Three delivery attempts per candidate per 24 hours',available_at=clock_timestamp()+interval'1 hour'where id=w.id;return jsonb_build_object('mode','suppressed');end if;
   s:=ecod_collaboration_private.allowed(w);if s->'eligible'is distinct from'true'::jsonb then update ecod_collaboration_private.work set status=case when w.status in('Ambiguous','Provider accepted')then'Manual review'else'Suppressed'end,reason=s->>'reason'where id=w.id;return jsonb_build_object('mode','suppressed');end if;
   kind:=case when w.kind in('send','attachment')then'mailbox'else'calendar'end;
   lease_id:=gen_random_uuid();update ecod_collaboration_private.connections set lease=lease_id,lease_until=clock_timestamp()+interval'70 seconds'where workspace_id=w.workspace_id and connections.kind=kind;
   update ecod_collaboration_private.work set lease=lease_id,lease_until=clock_timestamp()+interval'70 seconds',started=false,reconciling=w.status in('Ambiguous','Provider accepted'),status='Leased',attempts=attempts+case when w.status in('Ambiguous','Provider accepted')then 0 else 1 end where id=w.id;
   if w.status not in('Ambiguous','Provider accepted')then insert into ecod_collaboration_private.attempts values(lease_id,w.workspace_id,w.candidate_id,w.id,w.attempts+1,'{}',clock_timestamp());end if;
   return jsonb_build_object('mode',case when w.status in('Ambiguous','Provider accepted')then'reconcile'else'work'end,'id',w.id,'workspace',w.workspace_id,'kind',kind,'lease',lease_id);
  end if;
  select *into cfg from ecod_collaboration_private.connections where state='enabled'and credentials is not null and(due_at<=clock_timestamp()or dirty)and(lease_until is null or lease_until<clock_timestamp())and ecod_collaboration_private.owner_ok(connections)order by due_at,workspace_id,connections.kind limit 1 for update skip locked;
  if cfg.workspace_id is null then return jsonb_build_object('mode','idle');end if;
  lease_id:=gen_random_uuid();update ecod_collaboration_private.connections set lease=lease_id,lease_until=clock_timestamp()+interval'70 seconds',cycle=coalesce(cycle,gen_random_uuid()),dirty=false where workspace_id=cfg.workspace_id and connections.kind=cfg.kind;
  return jsonb_build_object('mode','sync','workspace',cfg.workspace_id,'kind',cfg.kind,'lease',lease_id);
 end if;
 ws:=(p->>'workspace')::uuid;kind:=p->>'kind';select *into cfg from ecod_collaboration_private.connections where workspace_id=ws and connections.kind=kind for update;
 if cfg.workspace_id is null or not ecod_collaboration_private.owner_ok(cfg)then raise exception 'Current Google connection required';end if;
 if a='diagnostic'then
  if cfg.generation is distinct from(p->>'generation')::integer or cfg.credentials is null or not exists(select 1 from public.memberships where workspace_id=ws and user_id=(p->>'actor')::uuid and role='admin')then raise exception 'Current diagnostic actor required';end if;
  if coalesce(p->>'status','')='passed'then update ecod_collaboration_private.connections set diagnostic_at=clock_timestamp(),error=''where workspace_id=ws and connections.kind=kind;
  else update ecod_collaboration_private.connections set diagnostic_at=null,error='Google diagnostic unavailable'where workspace_id=ws and connections.kind=kind;end if;
  return jsonb_build_object('status','Recorded');
 end if;
 if a='gate'and p->>'mode'='diagnostic'then
  if cfg.generation is distinct from(p->>'generation')::integer or cfg.credentials is null then raise exception 'Current authorization required';end if;
  return jsonb_build_object('credentials',cfg.credentials,'account',cfg.body->>'account','calendarId',cfg.body->>'calendarId','generation',cfg.generation,'workspace',ws,'kind',kind);
 end if;
 if cfg.state<>'enabled'or cfg.lease is distinct from(p->>'lease')::uuid or cfg.lease_until<=clock_timestamp()then raise exception 'Current active Google lease required';end if;
 if nullif(p->>'id','')is not null then
  select *into w from ecod_collaboration_private.work where id=(p->>'id')::uuid and workspace_id=ws for update;
  if w.id is null or w.status<>'Leased'or w.lease is distinct from cfg.lease or w.lease_until<=clock_timestamp()or w.generation<>cfg.generation then raise exception 'Current work lease required';end if;
  s:=ecod_collaboration_private.allowed(w);if s->'eligible'is distinct from'true'::jsonb then raise exception 'Current outbound or processing source changed';end if;
 end if;
 if a='gate'then
  if w.id is not null then update ecod_collaboration_private.work set started=true where id=w.id;end if;
  select *into b from ecod_collaboration_private.bookings where operation_id=w.id;
  if w.kind='attachment'then select *into att from ecod_collaboration_private.attachments where id=(w.body->>'attachment')::uuid;select *into m from ecod_collaboration_private.messages where id=att.message_id;end if;
  return jsonb_build_object('credentials',cfg.credentials,'account',cfg.body->>'account','calendarId',cfg.body->>'calendarId','generation',cfg.generation,'workspace',ws,'kind',kind,'cursor',cfg.cursor,'page',cfg.page,'baseline',cfg.baseline,'fullSync',cfg.full_sync,'cycle',cfg.cycle,'channel',cfg.channel,'operation',w.kind,'preview',s->'preview','body',w.body,'booking',to_jsonb(b),'attachment',case when att.id is not null then att.body||jsonb_build_object('id',att.id,'messageProviderId',m.provider_id)else null end);
 end if;
 if a='channel'then
  if kind<>'calendar'or jsonb_typeof(p->'channel')is distinct from'object'or(p->'channel'->>'expiration')::timestamptz<=clock_timestamp()or(p->'channel'->>'expiration')::timestamptz>clock_timestamp()+interval'8 days'then raise exception 'Valid expiring calendar channel required';end if;
  update ecod_collaboration_private.connections set channel=p->'channel'where workspace_id=ws and connections.kind=kind;return jsonb_build_object('status','Recorded');
 end if;
 if a in('sync-error','sync-reset')then
  if a='sync-reset'then update ecod_collaboration_private.connections set full_sync=true,page=null,cursor=null,baseline=null,cycle=gen_random_uuid(),due_at=clock_timestamp(),lease=null,lease_until=null,error='Cursor expired; bounded full reconciliation required'where workspace_id=ws and connections.kind=kind;
  else update ecod_collaboration_private.connections set due_at=clock_timestamp()+interval'5 minutes',lease=null,lease_until=null,error=case when p->>'code'='reauthorize'then'Google authorization expired or revoked; reconnect'else'Google temporarily unavailable; polling will retry'end,state=case when p->>'code'='reauthorize'then'paused'else state end where workspace_id=ws and connections.kind=kind;end if;
  return jsonb_build_object('status','Recorded');
 end if;
 if a='sync-finish'then
  if jsonb_typeof(p->'items')is distinct from'array'or jsonb_array_length(p->'items')>10 or length(coalesce(p->>'cursor',''))>2048 or length(coalesce(p->>'page',''))>2048 then raise exception 'Bounded sync page required';end if;
  for item in select value from jsonb_array_elements(p->'items')loop
   if kind='mailbox'then
    if coalesce(item->>'id','')!~'^[a-zA-Z0-9_-]{1,200}$'or length(coalesce(item->>'thread',''))not between 1 and 200 or octet_length((item->'body')::text)>40000 or jsonb_typeof(item->'attachments')is distinct from'array'or jsonb_array_length(item->'attachments')>10 then raise exception 'Invalid mailbox item';end if;
    select candidate_id into cid from ecod_collaboration_private.messages where workspace_id=ws and generation=cfg.generation and thread_id=item->>'thread'and candidate_id is not null limit 1;
    insert into ecod_collaboration_private.messages(workspace_id,generation,provider_id,thread_id,candidate_id,body,deleted,seen_cycle)values(ws,cfg.generation,item->>'id',item->>'thread',cid,item->'body',coalesce((item->>'deleted')::boolean,false),cfg.cycle)on conflict(workspace_id,generation,provider_id)do update set body=excluded.body,deleted=excluded.deleted,seen_cycle=excluded.seen_cycle returning *into m;
    if item->'body'?'bounce'then
     for w in select *from ecod_collaboration_private.work where workspace_id=ws and generation=cfg.generation and work.kind='send'and status in('Provider accepted','Ambiguous')and item->'body'->'bounce'->>'originalMessageId'='<anthro-'||id::text||'@'||split_part(cfg.body->>'account','@',2)||'>'loop
      begin s:=ecod_comms_private.source(ws,w.candidate_id,(w.body->>'template')::uuid,coalesce(w.body->'context','{}'));
       if item->'body'->'bounce'->>'recipient'=s->'preview'->>'recipient'and item->'body'->'bounce'->>'action'='failed'and item->'body'->'bounce'->>'status'~'^5\.[0-9]{1,3}\.[0-9]{1,3}$'then
        update ecod_collaboration_private.work set status='Bounce reported',reason='Received delivery-status report; inspect Gmail evidence before further contact'where id=w.id;
        update ecod_collaboration_private.messages set candidate_id=w.candidate_id where id=m.id and candidate_id is null;
       end if;
      exception when others then null;end;
     end loop;
    end if;
    for v in select value from jsonb_array_elements(item->'attachments')loop
     if coalesce(v->>'part','')!~'^[A-Za-z0-9._-]{1,100}$'or octet_length(v::text)>2000 then raise exception 'Invalid bounded attachment metadata';end if;
     insert into ecod_collaboration_private.attachments(workspace_id,candidate_id,message_id,part_id,body)values(ws,m.candidate_id,m.id,v->>'part',v)on conflict(message_id,part_id)do nothing;
    end loop;
   else
    select *into b from ecod_collaboration_private.bookings where workspace_id=ws and generation=cfg.generation and provider_id=item->>'id'for update;
    if b.id is not null and(item->>'updated')::timestamptz>coalesce(b.provider_updated,'epoch'::timestamptz)then
     update ecod_collaboration_private.bookings set etag=coalesce(item->>'etag',etag),rsvp=case when item->>'rsvp'in('accepted','declined','tentative','needsAction')then item->>'rsvp'else rsvp end,provider_updated=(item->>'updated')::timestamptz,state=case when item->>'status'='cancelled'then'Cancelled'when item->>'start'is distinct from to_char(starts_at at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')and state='Confirmed'then'Manual review'else state end where id=b.id;
    end if;
   end if;
  end loop;
  if kind='calendar'and p?'busy'then
   if jsonb_typeof(p->'busy')is distinct from'array'or jsonb_array_length(p->'busy')>500 then raise exception 'Bounded free/busy required';end if;
   delete from ecod_collaboration_private.busy where workspace_id=ws;
   insert into ecod_collaboration_private.busy select ws,cfg.generation,(x->>'start')::timestamptz,(x->>'end')::timestamptz,clock_timestamp()from jsonb_array_elements(p->'busy')x;
   insert into ecod_collaboration_private.availability values(ws,cfg.generation,(p->>'windowStart')::timestamptz,(p->>'windowEnd')::timestamptz,clock_timestamp())on conflict(workspace_id)do update set generation=excluded.generation,starts_at=excluded.starts_at,ends_at=excluded.ends_at,checked_at=excluded.checked_at;
  end if;
  if cfg.full_sync and nullif(p->>'page','')is null and kind='mailbox'then update ecod_collaboration_private.messages set deleted=true where workspace_id=ws and generation=cfg.generation and seen_cycle is distinct from cfg.cycle;end if;
  update ecod_collaboration_private.connections set cursor=case when nullif(p->>'page','')is null then p->>'cursor'else cursor end,page=nullif(p->>'page',''),baseline=coalesce(p->>'baseline',baseline),full_sync=case when nullif(p->>'page','')is null then false else full_sync end,cycle=case when nullif(p->>'page','')is null then null else cycle end,lease=null,lease_until=null,due_at=case when nullif(p->>'page','')is null then clock_timestamp()+interval'5 minutes'else clock_timestamp()end,error=''where workspace_id=ws and connections.kind=kind;
  return jsonb_build_object('status','Checkpoint committed');
 end if;
 if a='attachment-reserve'then
  if w.kind<>'attachment'or not ecod_collaboration_private.quarantine_ready(ws)then raise exception 'Accepted healthy Stage 2 quarantine and recovery required';end if;
  select *into att from ecod_collaboration_private.attachments where id=(w.body->>'attachment')::uuid for update;
  ext:=lower(att.body->>'name');ext:=regexp_replace(ext,'^.*\.','');mt:=case ext when'pdf'then'application/pdf'when'docx'then'application/vnd.openxmlformats-officedocument.wordprocessingml.document'when'txt'then'text/plain'when'md'then'text/plain'when'csv'then'text/csv'end;
  if mt is null or coalesce((p->>'size')::integer,0)not between 1 and 5242880 or(p->>'size')::integer is distinct from(att.body->>'size')::integer or coalesce(p->>'hash','')!~'^[0-9a-f]{64}$'then raise exception 'Verified supported immutable attachment required';end if;
  key:=ws::text||'/candidates/'||w.candidate_id::text||'/'||w.id::text||'/original.'||ext;
  if exists(select 1 from public."documentJobs"where id=w.id and(hash<>p->>'hash'or size<>(p->>'size')::integer or candidate_id<>w.candidate_id))then raise exception 'Immutable attachment manifest conflict';end if;
  insert into public."documentJobs"(id,workspace_id,candidate_id,name,ext,mime,kind,size,hash,storage_path)values(w.id,ws,w.candidate_id,left(att.body->>'name',160),ext,mt,'Email attachment',(p->>'size')::integer,p->>'hash',key)on conflict(id)do nothing;
  insert into public.documents(id,workspace_id,"candidateId",kind,name,mime,size,hash,"storagePath","storageProvider",stored,"parserStatus",extracted,"dataUrl","uploadedBy")values(w.id,ws,w.candidate_id,'Email attachment',left(att.body->>'name',160),mt,(p->>'size')::integer,p->>'hash',key,'r2',false,'quarantined','','','Google mailbox')on conflict(id)do nothing;
  update ecod_collaboration_private.attachments set document_id=w.id where id=att.id;
  return jsonb_build_object('id',w.id,'path',key,'mime',mt,'hash',p->>'hash');
 end if;
 if a='attachment-uploaded'then
  if w.kind<>'attachment'or length(coalesce(p->>'etag',''))not between 1 and 200 then raise exception 'Immutable upload receipt required';end if;
  update public."documentJobs"set uploaded=true where id=w.id and candidate_id=w.candidate_id;update public.documents set stored=true where id=w.id;
  return jsonb_build_object('status','Quarantined');
 end if;
 if a='finish'then
  if w.id is null or not w.started or p->>'outcome'not in('accepted','transient','permanent','ambiguous','not-found')then raise exception 'Gated work outcome required';end if;
  outcome:=p->>'outcome';
  if outcome='accepted'and length(coalesce(p->>'providerId',''))not between 1 and 200 then raise exception 'Provider identity required';end if;
  update ecod_collaboration_private.attempts set body=jsonb_build_object('outcome',outcome,'providerId',p->>'providerId')where id=w.lease;
  update ecod_collaboration_private.work set status=case outcome when'accepted'then case when w.kind='send'then'Provider accepted'else'Confirmed'end when'ambiguous'then'Ambiguous'when'not-found'then'Manual review'when'transient'then case when attempts<3 then'Deferred'else'Failed'end else'Failed'end,reason=case when outcome in('ambiguous','not-found')then'Unknown provider outcome; no automatic resend'else'Google '||outcome end,provider_id=coalesce(p->>'providerId',provider_id),available_at=clock_timestamp()+interval'1 hour',lease=null,lease_until=null where id=w.id;
  if w.kind in('book','reschedule','cancel')then
   select *into b from ecod_collaboration_private.bookings where operation_id=w.id for update;
   if outcome='accepted'then
    update ecod_collaboration_private.bookings set state=case when w.kind='cancel'then'Cancelled'else'Confirmed'end,etag=p->>'etag',old_start=null,old_end=null where id=b.id;
    if w.kind='reschedule'then update public.interviews set "scheduledAt"=b.starts_at where workspace_id=ws and id=b.interview_id;elsif w.kind='cancel'then update public.interviews set status='Cancelled'where workspace_id=ws and id=b.interview_id;end if;
   elsif outcome in('permanent','not-found')then update ecod_collaboration_private.bookings set state='Manual review'where id=b.id;end if;
  end if;
  update ecod_collaboration_private.connections set lease=null,lease_until=null where workspace_id=ws and connections.kind=kind;return jsonb_build_object('status','Outcome recorded');
 end if;
 raise exception 'Unsupported worker transition';
end$$;
create or replace function ecod_collaboration_private.allowed(w ecod_collaboration_private.work)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s jsonb;begin
 if w.expires_at<=clock_timestamp()or not exists(select 1 from public.memberships where workspace_id=w.workspace_id and user_id=w.actor and role in('admin','recruiter'))then return jsonb_build_object('eligible',false,'reason','Preparing actor revoked or operation expired');end if;
 s:=ecod_collaboration_private.source(w.workspace_id,w.candidate_id,w.kind,w.body);
 if s->>'head'is distinct from w.source_head then return jsonb_build_object('eligible',false,'reason','Reviewed source changed; prepare a new operation');end if;
 if w.kind='send'and not(extract(hour from clock_timestamp()at time zone'UTC')>=(s->'preference'->>'startHour')::integer and extract(hour from clock_timestamp()at time zone'UTC')<(s->'preference'->>'endHour')::integer)then return jsonb_build_object('eligible',false,'reason','Outside candidate contact window');end if;
 return s;
exception when others then return jsonb_build_object('eligible',false,'reason','Current source unavailable');end$$;

create or replace function ecod_collaboration_private.api(a text,c uuid,op uuid,h text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare ws uuid:=ecod_access_private.member_workspace(true);cfg ecod_collaboration_private.connections;k text:=coalesce(p->>'kind','mailbox');req jsonb;prior ecod_collaboration_private.receipts;r jsonb;rows jsonb;s jsonb;w ecod_collaboration_private.work;b ecod_collaboration_private.bookings;m ecod_collaboration_private.messages;start_at timestamptz;end_at timestamptz;zone text;uid uuid;begin
 if a is null or a not in('context','inbox','history','bookings','preview','configure','accept','enable','pause','revoke','oauth-start','diagnostic-token','prepare','cancel-work','retry','reconcile','resolve-booking','link','quarantine','availability')or off is null or off not between 0 and 10000 or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 then raise exception 'Invalid collaboration request';end if;
 if c is not null and not exists(select 1 from public.candidates where workspace_id=ws and id=c)then raise exception 'Candidate unavailable';end if;
 if a='context'then
  select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'body',x.body,'generation',x.generation,'state',x.state,'authorized',x.credentials is not null,'diagnosticAt',x.diagnostic_at,'error',x.error,'head',ecod_collaboration_private.head(x),'syncDue',x.due_at,'fullSync',x.full_sync,'subscriptionExpires',x.channel->>'expiration')order by kind),'[]')into rows from ecod_collaboration_private.connections x where workspace_id=ws;
  return jsonb_build_object('connections',rows,'defaultHead',ecod_journey_private.token(ws,'null'::jsonb),'availability',(select jsonb_build_object('start',starts_at,'end',ends_at,'checkedAt',checked_at)from ecod_collaboration_private.availability where workspace_id=ws),'paused',(select paused from ecod_processing_private.lockdown));
 end if;
 if a in('history','inbox','bookings')then
  if a='history'then select coalesce(jsonb_agg(to_jsonb(x)order by created_at desc,id),'[]')into rows from(select id,candidate_id,kind,status,reason,provider_id,created_at,ecod_journey_private.token(ws,jsonb_build_array(id,status,attempts,source_head))head from ecod_collaboration_private.work where workspace_id=ws and(c is null or candidate_id=any(ecod_access_private.identity_family(ws,c)))order by created_at desc,id limit 26 offset off)x;
  elsif a='bookings'then select coalesce(jsonb_agg(to_jsonb(x)order by starts_at desc,id),'[]')into rows from(select cb.*,ecod_journey_private.token(ws,to_jsonb(cb))head from ecod_collaboration_private.bookings cb where workspace_id=ws and(c is null or candidate_id=any(ecod_access_private.identity_family(ws,c)))order by starts_at desc,id limit 26 offset off)x;
  else select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into rows from(select id,candidate_id,thread_id,body,deleted,at,ecod_journey_private.token(ws,to_jsonb(msg))head,(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'body',a.body,'documentId',a.document_id)),'[]')from ecod_collaboration_private.attachments a where a.message_id=msg.id)attachments from ecod_collaboration_private.messages msg where workspace_id=ws and(c is null or candidate_id=any(ecod_access_private.identity_family(ws,c)))order by at desc,id limit 26 offset off)x;end if;
  insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'google-collaboration',coalesce(c,ws),'server_read','Bounded Stage 3 '||a||' page',auth.uid()::text);return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 if a='preview'then if c is null then raise exception 'Candidate required';end if;return ecod_collaboration_private.source(ws,c,p->>'operation',p);end if;
 if a in('configure','accept','enable','pause','revoke','oauth-start','diagnostic-token')then
  if not public.is_admin()then raise exception 'Administrator required'using errcode='42501';end if;perform ecod_private.require_privileged_mfa(ws);
  if k not in('mailbox','calendar')then raise exception 'Mailbox or calendar required';end if;
  select *into cfg from ecod_collaboration_private.connections where workspace_id=ws and kind=k for update;
  if a='diagnostic-token'then if cfg.credentials is null or not ecod_collaboration_private.owner_ok(cfg)then raise exception 'Authorized current connection required';end if;return jsonb_build_object('workspace',ws,'kind',k,'generation',cfg.generation);end if;
 end if;
 if op is null then raise exception 'Operation UUID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||auth.uid()::text||op::text,81));req:=jsonb_build_array(a,c,h,p);
 select *into prior from ecod_collaboration_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;
 if found then if prior.request<>req then raise exception 'Operation conflict'using errcode='40001';end if;return prior.result||'{"replayed":true}'::jsonb;end if;
 if a in('configure','accept','enable','pause','revoke','oauth-start')then
  if h is distinct from (case when cfg.workspace_id is null then ecod_journey_private.token(ws,'null'::jsonb)else ecod_collaboration_private.head(cfg)end)then raise exception 'Connection changed; refresh'using errcode='40001';end if;
  if a='configure'then
   if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','owner','account','calendarId','purpose','costDecision','evidence']))or length(btrim(coalesce(p->>'purpose','')))not between 10 and 1000 or length(btrim(coalesce(p->>'costDecision','')))not between 10 and 1000 or length(btrim(coalesce(p->>'evidence','')))not between 10 and 1000 or coalesce(p->>'account','')!~'^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'or length(p->>'account')>254 or not exists(select 1 from public.memberships where workspace_id=ws and user_id=(p->>'owner')::uuid and role='admin')or(k='calendar'and coalesce(p->>'calendarId','')!~'^[A-Za-z0-9@._-]{1,254}$')then raise exception 'Current admin owner, account and purpose/budget evidence required';end if;
   insert into ecod_collaboration_private.connections(workspace_id,kind,body)values(ws,k,p)on conflict(workspace_id,kind)do update set body=p,generation=connections.generation+1,state='configured',credentials=null,authorized_at=null,diagnostic_at=null,accepted_at=null,cursor=null,page=null,baseline=null,full_sync=true,cycle=null,channel=null,lease=null,lease_until=null,due_at=clock_timestamp(),error='';
  else
   if cfg.workspace_id is null or not ecod_collaboration_private.owner_ok(cfg)then raise exception 'Current configured owner required';end if;
   if a='oauth-start'then
    if auth.uid()is distinct from(cfg.body->>'owner')::uuid then raise exception 'Configured owner must authorize their Google account';end if;
    uid:=gen_random_uuid();insert into ecod_collaboration_private.oauth_states values(uid,ws,k,cfg.generation,auth.uid(),clock_timestamp()+interval'10 minutes',false);
    r:=jsonb_build_object('ticket',uid,'workspace',ws,'kind',k,'generation',cfg.generation,'account',cfg.body->>'account');
   elsif a in('accept','enable')then
    if cfg.credentials is null or cfg.diagnostic_at is null or cfg.diagnostic_at<clock_timestamp()-interval'10 minutes'then raise exception 'Fresh authenticated Google diagnostic required';end if;
    if a='enable'and(cfg.state<>'staging accepted'or cfg.accepted_at<clock_timestamp()-interval'7 days')then raise exception 'Current staging acceptance required';end if;
    update ecod_collaboration_private.connections set state=case a when'accept'then'staging accepted'else'enabled'end,accepted_at=case when a='accept'then clock_timestamp()else accepted_at end,due_at=clock_timestamp()where workspace_id=ws and kind=k;
   else
    update ecod_collaboration_private.connections set state=case when a='revoke'then'revoked'else'paused'end,generation=generation+1,credentials=null,authorized_at=null,diagnostic_at=null,accepted_at=null,cursor=null,page=null,baseline=null,full_sync=true,cycle=null,channel=null,lease=null,lease_until=null where workspace_id=ws and kind=k;
   end if;
  end if;
  if a in('configure','pause','revoke')then update ecod_collaboration_private.work set status='Suppressed',reason='Connection generation changed'where workspace_id=ws and kind=any(case when k='mailbox'then array['send','attachment']else array['book','reschedule','cancel']end)and status in('Queued','Deferred');end if;
 elsif a in('prepare','quarantine')then
  k:=case when a='quarantine'then'attachment'else p->>'operation'end;
  if k is null or k not in('send','book','reschedule','cancel','attachment')or c is null then raise exception 'Supported candidate operation required';end if;
  if exists(select 1 from jsonb_object_keys(p)x where x<>all(array['operation','template','context','interview','zone','local','start','attachment','reply','availableAt']))then raise exception 'Unsupported operation field';end if;
  s:=ecod_collaboration_private.source(ws,c,k,p);if s->>'head'is distinct from h then raise exception 'Source changed; review again'using errcode='40001';end if;if s->'eligible'is distinct from'true'::jsonb then raise exception 'Current eligible source required: %',s->>'reason';end if;
  if(select count(*)from ecod_collaboration_private.work where workspace_id=ws and candidate_id=c and created_at>clock_timestamp()-interval'24 hours')>=20 or(select count(*)from ecod_collaboration_private.work where workspace_id=ws and status in('Queued','Deferred','Leased'))>=500 then raise exception 'Collaboration queue limit reached';end if;
  if k='send'and p?'availableAt'and((p->>'availableAt')::timestamptz<=clock_timestamp()or(p->>'availableAt')::timestamptz>clock_timestamp()+interval'30 days')then raise exception 'Schedule delivery within the next 30 days';end if;
  if k in('book','reschedule','cancel')then
   select *into cfg from ecod_collaboration_private.connections where workspace_id=ws and kind='calendar';perform pg_advisory_xact_lock(hashtextextended(lower(case when cfg.body->>'calendarId'='primary'then cfg.body->>'account'else cfg.body->>'calendarId'end),82));
   select *into b from ecod_collaboration_private.bookings where workspace_id=ws and interview_id=(p->>'interview')::uuid and state<>'Cancelled'for update;
   if(k='book'and b.id is not null)or(k<>'book'and(b.id is null or b.state<>'Confirmed'or b.generation<>cfg.generation))then raise exception 'Current confirmed booking required for changes';end if;
   if k<>'cancel'then
    zone:=p->>'zone';if not exists(select 1 from pg_timezone_names where name=zone)or p->>'start'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$'or p->>'local'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'then raise exception 'Explicit UTC minute and IANA timezone required';end if;
    start_at:=(p->>'start')::timestamptz;if to_char(start_at at time zone zone,'YYYY-MM-DD"T"HH24:MI')is distinct from p->>'local'then raise exception 'Nonexistent or mismatched local time';end if;
    end_at:=start_at+make_interval(mins=>(s->'interview'->>'duration')::integer);
    if start_at<=clock_timestamp()+interval'5 minutes'or start_at>clock_timestamp()+interval'30 days'or(k='book'and start_at is distinct from(s->'interview'->>'start')::timestamptz)then raise exception 'Future current interview time required';end if;
    if not exists(select 1 from ecod_collaboration_private.availability where workspace_id=ws and generation=cfg.generation and checked_at>clock_timestamp()-interval'5 minutes'and starts_at<=start_at and ends_at>=end_at)then raise exception 'Refresh Google free/busy before reserving';end if;
    if exists(select 1 from ecod_collaboration_private.busy where workspace_id=ws and generation=cfg.generation and starts_at<end_at and ends_at>start_at and not(k='reschedule'and starts_at=b.starts_at and ends_at=b.ends_at))or exists(select 1 from ecod_collaboration_private.bookings x where calendar_id=lower(case when cfg.body->>'calendarId'='primary'then cfg.body->>'account'else cfg.body->>'calendarId'end)and x.id is distinct from b.id and x.state<>'Cancelled'and((x.starts_at<end_at and x.ends_at>start_at)or(x.old_start<end_at and x.old_end>start_at)))then raise exception 'Calendar time is already reserved';end if;
   end if;
   if k='book'then uid:=gen_random_uuid();insert into ecod_collaboration_private.bookings(id,workspace_id,candidate_id,interview_id,generation,account,calendar_id,starts_at,ends_at,zone,provider_id,operation_id)values(uid,ws,c,(p->>'interview')::uuid,cfg.generation,cfg.body->>'account',lower(case when cfg.body->>'calendarId'='primary'then cfg.body->>'account'else cfg.body->>'calendarId'end),start_at,end_at,zone,replace(uid::text,'-',''),op);
   else update ecod_collaboration_private.bookings set old_start=starts_at,old_end=ends_at,starts_at=coalesce(start_at,starts_at),ends_at=coalesce(end_at,ends_at),zone=coalesce(zone,bookings.zone),state='Reserved',operation_id=op where id=b.id;end if;
  end if;
  insert into ecod_collaboration_private.work(id,workspace_id,candidate_id,kind,generation,actor,source_head,body,available_at,expires_at)values(op,ws,c,k,(s->>'generation')::integer,auth.uid(),h,p,case when k='send'then coalesce((p->>'availableAt')::timestamptz,clock_timestamp())else clock_timestamp()end,case when k='send'then coalesce((p->>'availableAt')::timestamptz,clock_timestamp())else clock_timestamp()end+interval'7 days');
  r:=jsonb_build_object('status','Queued','id',op);
 elsif a in('cancel-work','retry','reconcile')then
  select *into w from ecod_collaboration_private.work where id=(p->>'id')::uuid and workspace_id=ws for update;if w.id is null then raise exception 'Operation unavailable';end if;
  if h is distinct from ecod_journey_private.token(ws,jsonb_build_array(w.id,w.status,w.attempts,w.source_head))then raise exception 'Operation changed; refresh'using errcode='40001';end if;
  if a='cancel-work'and w.status in('Queued','Deferred')then update ecod_collaboration_private.work set status='Cancelled',reason='Cancelled before dispatch'where id=w.id;
   update ecod_collaboration_private.bookings set state=case when w.kind='book'then'Cancelled'else'Confirmed'end,starts_at=coalesce(old_start,starts_at),ends_at=coalesce(old_end,ends_at),old_start=null,old_end=null where operation_id=w.id;
  elsif a='retry'and w.status='Failed'and w.attempts<3 and ecod_collaboration_private.allowed(w)->'eligible'='true'::jsonb then update ecod_collaboration_private.work set status='Queued',available_at=clock_timestamp()where id=w.id;
  elsif a='reconcile'and w.status in('Ambiguous','Provider accepted')then update ecod_collaboration_private.work set available_at=clock_timestamp()where id=w.id;
  else raise exception 'Operation cannot take that transition';end if;
  c:=w.candidate_id;r:=jsonb_build_object('status','Recorded');
 elsif a='resolve-booking'then
  if not public.is_admin()then raise exception 'Administrator required';end if;perform ecod_private.require_privileged_mfa(ws);
  select *into b from ecod_collaboration_private.bookings where workspace_id=ws and id=(p->>'booking')::uuid for update;
  if b.id is null or h is distinct from ecod_journey_private.token(ws,to_jsonb(b))or b.state not in('Reserved','Manual review')or p->>'resolution'is distinct from'cancelled-at-provider'or length(btrim(coalesce(p->>'evidence','')))not between 20 and 1000 then raise exception 'Review current retained reservation and independently verified provider cancellation';end if;
  select *into w from ecod_collaboration_private.work where id=b.operation_id for update;if w.status='Leased'and w.lease_until>clock_timestamp()then raise exception 'Wait for current provider lease to drain';end if;
  update ecod_collaboration_private.bookings set state='Cancelled',old_start=null,old_end=null where id=b.id;
  update ecod_collaboration_private.work set status='Closed by review',reason='Administrator verified provider cancellation; retained reservation released'where id=w.id;
  c:=b.candidate_id;r:=jsonb_build_object('status','Reservation released by reviewed decision');
 elsif a='link'then
  select *into m from ecod_collaboration_private.messages where id=(p->>'message')::uuid and workspace_id=ws for update;
  if m.id is null or m.deleted or c is null or not ecod_collaboration_private.person_ok(ws,c)or m.candidate_id is not null or h is distinct from ecod_journey_private.token(ws,to_jsonb(m))or length(btrim(coalesce(p->>'evidence','')))not between 10 and 1000 then raise exception 'Review current unlinked message and canonical candidate';end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||m.generation||m.thread_id,83));
  if exists(select 1 from ecod_collaboration_private.messages where workspace_id=ws and generation=m.generation and thread_id=m.thread_id and candidate_id is not null and candidate_id<>c)then raise exception 'Thread already belongs to another candidate';end if;
  update ecod_collaboration_private.messages set candidate_id=c where workspace_id=ws and generation=m.generation and thread_id=m.thread_id and candidate_id is null;
  update ecod_collaboration_private.attachments set candidate_id=c where message_id in(select id from ecod_collaboration_private.messages where workspace_id=ws and generation=m.generation and thread_id=m.thread_id);
  r:=jsonb_build_object('status','Linked','message',m.id);
 elsif a='availability'then
  update ecod_collaboration_private.connections set due_at=clock_timestamp(),dirty=true where workspace_id=ws and kind='calendar'and state='enabled';r:=jsonb_build_object('status','Refresh requested');
 else raise exception 'Unsupported operation';end if;
 r:=coalesce(r,jsonb_build_object('status','Recorded'));insert into ecod_collaboration_private.receipts values(ws,auth.uid(),op,c,req,r,clock_timestamp());
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'google-collaboration',op,'server_write','Stage 3 '||a,auth.uid()::text);return r;
end$$;

create or replace function public.api_google_collaboration(p_action text default 'context',p_candidate uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default '{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_collaboration_private.api(p_action,p_candidate,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.worker_google_collaboration(p_action text,p_payload jsonb default '{}')returns jsonb language sql security invoker set search_path=''as $$select ecod_collaboration_private.worker(p_action,p_payload)$$;
do $$declare n text;begin foreach n in array array['connections','oauth_states','work','attempts','messages','attachments','bookings','receipts','busy','availability']loop
 execute format('alter table ecod_collaboration_private.%I enable row level security',n);
 execute format('drop trigger if exists stage2_recovery_lockdown on ecod_collaboration_private.%I',n);execute format('drop trigger if exists stage2_recovery_truncate on ecod_collaboration_private.%I',n);execute format('create trigger stage2_recovery_lockdown before insert or update or delete on ecod_collaboration_private.%I for each row execute function ecod_processing_private.guard_lockdown()',n);
 execute format('create trigger stage2_recovery_truncate before truncate on ecod_collaboration_private.%I for each statement execute function ecod_processing_private.guard_lockdown()',n);
end loop;end$$;
revoke all on all tables in schema ecod_collaboration_private from public,anon,authenticated;
revoke all on all functions in schema ecod_collaboration_private from public,anon,authenticated;
revoke all on function public.api_google_collaboration(text,uuid,uuid,text,jsonb,integer),public.worker_google_collaboration(text,jsonb)from public,anon,authenticated;
grant usage on schema ecod_collaboration_private to authenticated;
grant execute on function ecod_collaboration_private.api(text,uuid,uuid,text,jsonb,integer),public.api_google_collaboration(text,uuid,uuid,text,jsonb,integer)to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role')then grant usage on schema ecod_collaboration_private to service_role;grant execute on function ecod_collaboration_private.worker(text,jsonb),public.worker_google_collaboration(text,jsonb)to service_role;end if;end$$;
do $$declare fn text;d text;begin foreach fn in array array['ecod_private.erasure_inventory','ecod_ops_private.source_inventory']loop d:=pg_get_functiondef((fn||'(uuid,uuid)')::regprocedure);
if strpos(d,'collaborationWork')=0 then d:=replace(d,'(''foundationReceipts'',''integrations'')','(''foundationReceipts'',''integrations''),(''collaborationWork'',''records''),(''collaborationAttempts'',''history''),(''mailboxMessages'',''integrations''),(''mailboxAttachments'',''integrations''),(''calendarBookings'',''integrations''),(''collaborationReceipts'',''integrations'')');
d:=replace(d,'predicate:=case d.name','predicate:=case d.name when''collaborationWork''then''t.candidate_id=any($1)'' when''collaborationAttempts''then''t.candidate_id=any($1)'' when''mailboxMessages''then''t.candidate_id=any($1)'' when''mailboxAttachments''then''t.candidate_id=any($1)'' when''calendarBookings''then''t.candidate_id=any($1)'' when''collaborationReceipts''then''t.candidate_id=any($1)''');
d:=replace(d,'case when d.name','case when d.name in(''collaborationWork'',''collaborationAttempts'',''mailboxMessages'',''mailboxAttachments'',''calendarBookings'',''collaborationReceipts'')then''ecod_collaboration_private''when d.name');
d:=replace(d,'end,case d.name when','end,case d.name when''collaborationWork''then''work'' when''collaborationAttempts''then''attempts'' when''mailboxMessages''then''messages'' when''mailboxAttachments''then''attachments'' when''calendarBookings''then''bookings'' when''collaborationReceipts''then''receipts'' when');execute d;end if;end loop;
d:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);if strpos(d,'Google collaboration work')=0 then d:=replace(d,'leased delivery sandbox','Google collaboration work, attempts, mailbox messages and attachments, calendar bookings and operation receipts (separately reviewed private journals), leased delivery sandbox');execute d;end if;end$$;
do $$declare d text;begin d:=pg_get_functiondef('ecod_delivery_private.api(text,uuid,uuid,text,jsonb,integer)'::regprocedure);d:=replace(d,'if k in(''processing'',''recovery'')','if k in(''mailbox'',''calendar'',''processing'',''recovery'')');execute d;
d:=pg_get_functiondef('ecod_processing_private.worker(text,jsonb)'::regprocedure);if strpos(d,'update ecod_collaboration_private.connections')=0 then d:=replace(d,'update public.settings set custom=custom||','update ecod_collaboration_private.connections set state=''paused'',accepted_at=null,diagnostic_at=null,lease=null,lease_until=null;update public.settings set custom=custom||');execute d;end if;
d:=pg_get_functiondef('ecod_processing_private.api(text,uuid,text,jsonb,integer)'::regprocedure);d:=replace(d,'''formal'',68,''operations'',65','''formal'',74,''operations'',71');execute d;end$$;
commit;
