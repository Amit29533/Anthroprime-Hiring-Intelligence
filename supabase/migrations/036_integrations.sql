-- Phase 4: transactional, idempotent integration writes and webhook outbox.
begin;
create table if not exists public."externalMappings" (
 workspace_id uuid not null references public.workspaces(id),source text not null,"externalId" text not null,
 "candidateId" uuid not null,version integer not null default 1,
 updated timestamptz not null default now(),primary key(workspace_id,source,"externalId"),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create table if not exists public."integrationReceipts" (
 workspace_id uuid not null references public.workspaces(id),key text not null,request jsonb not null,
 response jsonb,created timestamptz not null default now(),primary key(workspace_id,key)
);
create table if not exists public."webhookSubscriptions" (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 name text not null check(length(btrim(name)) between 1 and 120),url text not null check(url ~ '^https://'),
 secret text not null check(length(secret) between 32 and 256), enabled boolean not null default false,
 created timestamptz not null default now(),unique(workspace_id,id)
);
create table if not exists public."webhookDeliveries" (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 subscription_id uuid not null,event jsonb not null,status text not null default 'pending' check(status in ('pending','sending','delivered','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease uuid,leased_until timestamptz,
 last_error text not null default '',created timestamptz not null default now(),
 foreign key(workspace_id,subscription_id) references public."webhookSubscriptions"(workspace_id,id)
);
create index if not exists webhook_deliveries_due on public."webhookDeliveries"(available_at) where status in ('pending','sending');
create or replace function public.audit_webhook_metadata()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot)
 values(new.workspace_id,tg_table_name,new.id,'Webhook '||lower(tg_op),coalesce(auth.uid()::text,'Background worker'),
  case when tg_table_name='webhookSubscriptions' then jsonb_build_object('name',to_jsonb(new)->'name','enabled',to_jsonb(new)->'enabled')
  else jsonb_build_object('status',to_jsonb(new)->'status','attempts',to_jsonb(new)->'attempts') end);
 return new;
end $$;
revoke all on function public.audit_webhook_metadata() from public,anon,authenticated;
drop trigger if exists webhook_audit on public."webhookSubscriptions";
create trigger webhook_audit after insert or update on public."webhookSubscriptions" for each row execute function public.audit_webhook_metadata();
drop trigger if exists webhook_audit on public."webhookDeliveries";
create trigger webhook_audit after insert or update on public."webhookDeliveries" for each row execute function public.audit_webhook_metadata();
do $$ declare tbl text; begin
 foreach tbl in array array['externalMappings','integrationReceipts','webhookSubscriptions','webhookDeliveries'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
 end loop;
end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['externalMappings','integrationReceipts'] loop
  execute format('drop policy if exists integration_members on public.%I',tbl);
  execute format('create policy integration_members on public.%I to authenticated using (workspace_id=public.current_workspace() and public.can_edit_workspace(workspace_id)) with check (workspace_id=public.current_workspace() and public.can_edit_workspace(workspace_id))',tbl);
 end loop;
end $$;

create or replace function public.validate_integration_candidate(c public.candidates)
returns void language plpgsql set search_path='' as $$
begin
 if coalesce(btrim(c.name),'')='' then raise exception 'Candidate name is required'; end if;
 if coalesce(c.email,'')<>'' and c.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email address'; end if;
 if coalesce(c.phone,'')<>'' and (c.phone !~ '^\+?[0-9[:space:]().-]+$' or length(ltrim(regexp_replace(c.phone,'[^0-9]','','g'),'0')) not between 7 and 15) then raise exception 'Invalid phone number'; end if;
 if c.experience::text='NaN' or c.experience<0 or c.experience>60 or c.notice<0 or c.notice>365 then raise exception 'Experience or notice exceeds supported limits'; end if;
 if cardinality(c.skills)>200 or exists(select 1 from unnest(c.skills) s where s is null or length(s)>200) then raise exception 'Invalid skills'; end if;
end $$;
revoke all on function public.validate_integration_candidate(public.candidates) from public,anon,authenticated;

create or replace function public.api_integrate_candidate(p_source text,p_external_id text,p_key text,p_candidate jsonb,p_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); req jsonb; cached jsonb; mapping record; cid uuid; col text; val jsonb; document public.candidates; result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
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
revoke all on function public.api_integrate_candidate(text,text,text,jsonb,integer) from public,anon;
grant execute on function public.api_integrate_candidate(text,text,text,jsonb,integer) to authenticated;

create or replace function public.api_external_mappings(p_source text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (select source,"externalId","candidateId",version,updated from public."externalMappings" where workspace_id=ws and (p_source='' or source=p_source) order by updated desc limit 100) rows;
 return result;
end $$;
revoke all on function public.api_external_mappings(text) from public,anon;
grant execute on function public.api_external_mappings(text) to authenticated;

create or replace function public.bump_external_candidate_version()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new is distinct from old then
  update public."externalMappings" set version=version+1,updated=now() where workspace_id=new.workspace_id and "candidateId"=new.id;
 end if;
 return new;
end $$;
revoke all on function public.bump_external_candidate_version() from public,anon,authenticated;
drop trigger if exists external_mapping_version on public.candidates;
create trigger external_mapping_version after update on public.candidates for each row execute function public.bump_external_candidate_version();

create or replace function public.api_webhook_admin(p_operation text,p_id uuid default null,p_name text default '',p_url text default '',p_secret text default '',p_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_operation='create' then
  if (select count(*) from public."webhookSubscriptions" where workspace_id=ws)>=100 then raise exception 'Subscription limit reached'; end if;
  insert into public."webhookSubscriptions"(workspace_id,name,url,secret,enabled) values(ws,p_name,p_url,p_secret,p_enabled);
 elsif p_operation='toggle' then
  update public."webhookSubscriptions" set enabled=p_enabled where id=p_id and workspace_id=ws;
  if not found then raise exception 'Subscription not found'; end if;
 elsif p_operation='retry' then
  update public."webhookDeliveries" d set status='pending',attempts=0,available_at=now(),last_error='',lease=null,leased_until=null
   where d.id=p_id and d.workspace_id=ws and d.status='failed' and exists(select 1 from public."webhookSubscriptions" s where s.workspace_id=ws and s.id=d.subscription_id and s.enabled);
  if not found then raise exception 'Failed delivery with an enabled subscription required'; end if;
 elsif p_operation<>'list' then raise exception 'Invalid operation'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (select id,name,url,enabled,created from public."webhookSubscriptions" where workspace_id=ws order by created desc limit 100) rows;
 return jsonb_build_object('subscriptions',result,'deliveries',(select coalesce(jsonb_agg(to_jsonb(rows)),'[]') from (select id,subscription_id,status,attempts,last_error,created from public."webhookDeliveries" where workspace_id=ws order by created desc limit 50) rows));
end $$;
revoke all on function public.api_webhook_admin(text,uuid,text,text,text,boolean) from public,anon;
grant execute on function public.api_webhook_admin(text,uuid,text,text,text,boolean) to authenticated;

create or replace function public.enqueue_integration_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare envelope jsonb;
begin
 envelope:=jsonb_build_object('id',gen_random_uuid(),'type',tg_table_name||'.'||lower(tg_op),'workspaceId',new.workspace_id,'occurredAt',now(),'data',jsonb_build_object('id',new.id));
 insert into public."webhookDeliveries"(workspace_id,subscription_id,event) select new.workspace_id,s.id,envelope from public."webhookSubscriptions" s where s.workspace_id=new.workspace_id and s.enabled;
 return new;
end $$;
revoke all on function public.enqueue_integration_event() from public,anon,authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['candidates','demands','considerations','interviews','offers'] loop
  execute format('drop trigger if exists integration_event on public.%I',tbl);
  execute format('create trigger integration_event after insert or update on public.%I for each row execute function public.enqueue_integration_event()',tbl);
 end loop;
end $$;

create or replace function public.worker_claim_webhooks(p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'Invalid batch limit'; end if;
 -- An exhausted lease may have been delivered externally. Receiver deduplication is required.
 update public."webhookDeliveries" set status='failed',last_error='Delivery attempts exhausted' where status='sending' and leased_until<now() and attempts>=5;
 with ready as (select d.id from public."webhookDeliveries" d join public."webhookSubscriptions" s on s.id=d.subscription_id and s.workspace_id=d.workspace_id and s.enabled where d.attempts<5 and ((d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.leased_until<now())) order by d.created,d.id limit p_limit for update of d skip locked),claimed as (update public."webhookDeliveries" d set status='sending',attempts=attempts+1,lease=gen_random_uuid(),leased_until=now()+interval '2 minutes' from ready where d.id=ready.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'event',d.event,'lease',d.lease,'url',s.url,'secret',s.secret)),'[]') into result from claimed d join public."webhookSubscriptions" s on s.id=d.subscription_id and s.workspace_id=d.workspace_id;
 return result;
end $$;
create or replace function public.worker_finish_webhook(p_id uuid,p_lease uuid,p_ok boolean,p_error text default '')
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public."webhookDeliveries" set status=case when p_ok then 'delivered' when attempts>=5 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>60*(2^(attempts-1))::integer),leased_until=null,lease=null,last_error=case when p_ok then '' else left(p_error,200) end where id=p_id and lease=p_lease and status='sending';
 return found;
end $$;
revoke all on function public.worker_claim_webhooks(integer),public.worker_finish_webhook(uuid,uuid,boolean,text) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_claim_webhooks(integer),public.worker_finish_webhook(uuid,uuid,boolean,text) to service_role; end if; end $$;
commit;
