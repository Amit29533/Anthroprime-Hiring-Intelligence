-- After 037. Optional 038_pgvector_index.sql may be applied before or after this file.
-- Private, automatic local-vector maintenance; no external AI calls.
begin;
create table if not exists public."indexJobs" (
 workspace_id uuid not null,candidate_id uuid not null,sequence bigint generated always as identity,
 fingerprint text not null,status text not null default 'pending' check(status in ('pending','processing','failed')),
 attempts integer not null default 0 check(attempts between 0 and 5),available_at timestamptz not null default now(),
 lease uuid,leased_until timestamptz,primary key(workspace_id,candidate_id),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id) on delete cascade
);
alter table public."indexJobs" enable row level security;
revoke all on public."indexJobs" from public,anon,authenticated;
create index if not exists index_jobs_due on public."indexJobs"(sequence) where status in ('pending','processing');
create or replace function public.enqueue_candidate_index()
returns trigger language plpgsql security definer set search_path='' as $$
declare fp text:=md5(public.professional_text(new));
begin
 if new."mergedInto" is not null then
  delete from public."indexJobs" where workspace_id=new.workspace_id and candidate_id=new.id;
  delete from public."candidateVectors" where workspace_id=new.workspace_id and candidate_id=new.id;
 elsif tg_op='INSERT' or old."mergedInto" is distinct from new."mergedInto" or fp is distinct from md5(public.professional_text(old)) then
  insert into public."indexJobs"(workspace_id,candidate_id,fingerprint) values(new.workspace_id,new.id,fp)
  on conflict(workspace_id,candidate_id) do update set fingerprint=excluded.fingerprint,status='pending',attempts=0,available_at=now(),lease=null,leased_until=null;
 end if;
 return new;
end $$;
revoke all on function public.enqueue_candidate_index() from public,anon,authenticated;
drop trigger if exists candidate_index_queue on public.candidates;
create trigger candidate_index_queue after insert or update on public.candidates for each row execute function public.enqueue_candidate_index();
insert into public."indexJobs"(workspace_id,candidate_id,fingerprint)
 select c.workspace_id,c.id,md5(public.professional_text(c)) from public.candidates c
 where c."mergedInto" is null and not exists(select 1 from public."candidateVectors" v where v.workspace_id=c.workspace_id and v.candidate_id=c.id and v.namespace='local-v1' and v.fingerprint=md5(public.professional_text(c)))
 on conflict(workspace_id,candidate_id) do update set fingerprint=excluded.fingerprint,status='pending',attempts=0,available_at=now(),lease=null,leased_until=null where "indexJobs".fingerprint is distinct from excluded.fingerprint;

create or replace function public.worker_claim_index(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid index batch size'; end if;
 -- A crashed function cannot leave AI drafts pending forever; reserved quota stays counted.
 update public."intelligenceRequests" set status='failed' where status='pending' and created<now()-interval '10 minutes';
 update public."indexJobs" set status='failed',lease=null,leased_until=null where status='processing' and leased_until<now() and attempts>=5;
 with ready as (select workspace_id,candidate_id from public."indexJobs" where attempts<5 and ((status='pending' and available_at<=now()) or (status='processing' and leased_until<now())) order by sequence limit p_limit for update skip locked),
 claimed as (update public."indexJobs" j set status='processing',attempts=attempts+1,lease=gen_random_uuid(),leased_until=now()+interval '2 minutes' from ready r where j.workspace_id=r.workspace_id and j.candidate_id=r.candidate_id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('workspaceId',j.workspace_id,'candidateId',j.candidate_id,'fingerprint',j.fingerprint,'lease',j.lease,'text',public.professional_text(c)) order by j.sequence),'[]') into result from claimed j join public.candidates c on c.workspace_id=j.workspace_id and c.id=j.candidate_id;
 return result;
end $$;
create or replace function public.worker_finish_index(p_workspace uuid,p_candidate uuid,p_lease uuid,p_vector real[] default null,p_failed boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare job record;
begin
 -- Candidate-before-queue locking matches the update trigger and avoids inverse locks.
 perform 1 from public.candidates where workspace_id=p_workspace and id=p_candidate for update;
 if not found then return false; end if;
 select * into job from public."indexJobs" where workspace_id=p_workspace and candidate_id=p_candidate and lease=p_lease and status='processing' for update;
 if not found then return false; end if;
 if p_failed then
  update public."indexJobs" set status=case when attempts>=5 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>60*(2^(attempts-1))::integer),lease=null,leased_until=null where workspace_id=p_workspace and candidate_id=p_candidate;
 else
  perform public.put_candidate_vector(p_workspace,p_candidate,job.fingerprint,p_vector,'local-v1');
  delete from public."indexJobs" where workspace_id=p_workspace and candidate_id=p_candidate;
 end if;
 return true;
end $$;
revoke all on function public.worker_claim_index(integer),public.worker_finish_index(uuid,uuid,uuid,real[],boolean) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_claim_index(integer),public.worker_finish_index(uuid,uuid,uuid,real[],boolean) to service_role; end if; end $$;

create or replace function public.api_index_health(p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_retry_failed then
  update public."indexJobs" set status='pending',attempts=0,available_at=now() where workspace_id=ws and status='failed';
  insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot) values(ws,'indexJobs',ws,'Failed index jobs retried',auth.uid()::text,'{}');
 end if;
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed')) into result from public."indexJobs" where workspace_id=ws;
 return result||jsonb_build_object('indexed',(select count(*) from public."candidateVectors" v join public.candidates c on c.workspace_id=v.workspace_id and c.id=v.candidate_id where v.workspace_id=ws and v.namespace='local-v1' and c."mergedInto" is null and v.fingerprint=md5(public.professional_text(c))),
 'failedJobs',(select coalesce(jsonb_agg(to_jsonb(rows)),'[]') from (select j.candidate_id,c.name,j.attempts from public."indexJobs" j join public.candidates c on c.workspace_id=j.workspace_id and c.id=j.candidate_id where j.workspace_id=ws and j.status='failed' order by j.sequence limit 25) rows));
end $$;
revoke all on function public.api_index_health(boolean) from public,anon;
grant execute on function public.api_index_health(boolean) to authenticated;

-- Rotations require pausing and draining active claims, preventing mixed signing keys.
create or replace function public.api_rotate_webhook(p_id uuid,p_secret text)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); sub record;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into sub from public."webhookSubscriptions" where workspace_id=ws and id=p_id for update;
 if not found then raise exception 'Subscription not found'; end if;
 if sub.enabled or exists(select 1 from public."webhookDeliveries" where workspace_id=ws and subscription_id=p_id and status='sending' and leased_until>now()) then raise exception 'Pause the subscription and wait for active deliveries before rotating'; end if;
 update public."webhookSubscriptions" set secret=p_secret where workspace_id=ws and id=p_id;
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot) values(ws,'webhookSubscriptions',p_id,'Webhook signing key rotated',auth.uid()::text,'{}');
end $$;
revoke all on function public.api_rotate_webhook(uuid,text) from public,anon;
grant execute on function public.api_rotate_webhook(uuid,text) to authenticated;

create or replace function public.api_mapping_page(p_source text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); rows jsonb; total bigint;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset'; end if;
 select count(*) into total from public."externalMappings" where workspace_id=ws and (p_source='' or source=p_source);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select m.source,m."externalId",m."candidateId",m.version,m.updated,c.name,c."mergedInto" from public."externalMappings" m join public.candidates c on c.workspace_id=m.workspace_id and c.id=m."candidateId" where m.workspace_id=ws and (p_source='' or m.source=p_source) order by m.source,m."externalId" limit 25 offset p_offset) r;
 return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function public.api_mapping_page(text,integer) from public,anon;
grant execute on function public.api_mapping_page(text,integer) to authenticated;

create or replace function public.api_reconcile_mapping(p_source text,p_external_id text,p_version integer,p_candidate uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); mapping record;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 perform 1 from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Active candidate in this workspace required'; end if;
 select * into mapping from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id for update;
 if not found then raise exception 'External mapping not found'; end if;
 if p_version is null or mapping.version<>p_version then raise exception 'External record version conflict' using errcode='40001'; end if;
 if mapping."candidateId"=p_candidate then return; end if;
 update public."externalMappings" set "candidateId"=p_candidate,version=version+1,updated=now() where workspace_id=ws and source=p_source and "externalId"=p_external_id;
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot) values(ws,'externalMappings',p_candidate,'External mapping reconciled',auth.uid()::text,jsonb_build_object('source',p_source,'externalId',p_external_id,'previousCandidateId',mapping."candidateId",'version',mapping.version+1));
end $$;
revoke all on function public.api_reconcile_mapping(text,text,integer,uuid) from public,anon;
grant execute on function public.api_reconcile_mapping(text,text,integer,uuid) to authenticated;

-- Claims lock subscriptions as well as deliveries, serializing pause/rotation with claims.
create or replace function public.worker_claim_webhooks(p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'Invalid batch limit'; end if;
 update public."webhookDeliveries" set status='failed',last_error='Delivery attempts exhausted' where status='sending' and leased_until<now() and attempts>=5;
 with ready as (select d.id from public."webhookDeliveries" d join public."webhookSubscriptions" s on s.id=d.subscription_id and s.workspace_id=d.workspace_id and s.enabled where d.attempts<5 and ((d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.leased_until<now())) order by d.created,d.id limit p_limit for update of d,s skip locked),
 claimed as (update public."webhookDeliveries" d set status='sending',attempts=attempts+1,lease=gen_random_uuid(),leased_until=now()+interval '2 minutes' from ready where d.id=ready.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'event',d.event,'lease',d.lease,'url',s.url,'secret',s.secret)),'[]') into result from claimed d join public."webhookSubscriptions" s on s.id=d.subscription_id and s.workspace_id=d.workspace_id;
 return result;
end $$;
revoke all on function public.worker_claim_webhooks(integer) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_claim_webhooks(integer) to service_role; end if; end $$;
commit;
