begin;
create table if not exists ecod_private.freshness_policy (
 workspace_id uuid primary key references public.workspaces(id),enabled boolean not null default false,
 stale_days integer not null default 121 check(stale_days between 30 and 365),actor uuid,updated_at timestamptz not null default clock_timestamp()
);
create table if not exists ecod_private.freshness_receipts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),candidate_id uuid not null,
 anthro_id text not null,verified_on date not null,task_id uuid,
 status text not null check(status in('delivered','cancelled','retrying','failed')),attempts integer not null default 0,
 available_at timestamptz not null default now(),last_error text not null default '',created_at timestamptz not null default now(),cancelled_at timestamptz
);
create unique index if not exists freshness_active on ecod_private.freshness_receipts(workspace_id,candidate_id) where status<>'cancelled';
create index if not exists freshness_recent on ecod_private.freshness_receipts(workspace_id,created_at desc,id);
create index if not exists candidates_freshness_due on public.candidates(verified,id) where "mergedInto" is null and not "processingRestricted" and status<>'Unavailable';
create index if not exists contact_consent_recent on public.consents(workspace_id,"candidateId",date desc,id) where purpose='recruiting-contact';
create table if not exists ecod_private.freshness_worker_health(singleton boolean primary key default true check(singleton),last_run timestamptz not null);
alter table ecod_private.freshness_policy enable row level security;
alter table ecod_private.freshness_receipts enable row level security;
alter table ecod_private.freshness_worker_health enable row level security;
revoke all on ecod_private.freshness_policy,ecod_private.freshness_receipts,ecod_private.freshness_worker_health from public,anon,authenticated;

-- VOLATILE rechecks consent under the candidate lock using a fresh statement snapshot.
-- Equal-time revocations/expiry win over grants; future-dated grants fail closed.
create or replace function ecod_private.freshness_eligible(ws uuid,person uuid,days integer) returns boolean
language sql volatile security invoker set search_path='' as $$
 select exists(select 1 from public.candidates c where c.workspace_id=ws and c.id=person and c."mergedInto" is null
  and not c."processingRestricted" and c.status<>'Unavailable' and c.verified<=(clock_timestamp() at time zone 'UTC')::date-days
  and coalesce((select status='granted' and date<=clock_timestamp() from public.consents
   where workspace_id=ws and "candidateId"=person and purpose='recruiting-contact'
   order by date desc,(status<>'granted') desc,id desc limit 1),false));
$$;
revoke all on function ecod_private.freshness_eligible(uuid,uuid,integer) from public,anon,authenticated;
create or replace function ecod_private.cancel_freshness(ws uuid,person uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;begin
 for r in select * from ecod_private.freshness_receipts where workspace_id=ws and candidate_id=person and status<>'cancelled' for update loop
  update public.tasks set done=true where workspace_id=ws and id=r.task_id and not done;
  update ecod_private.freshness_receipts set status='cancelled',cancelled_at=clock_timestamp() where id=r.id;
 end loop;
end $$;
revoke all on function ecod_private.cancel_freshness(uuid,uuid) from public,anon,authenticated;

create or replace function ecod_private.invalidate_freshness_candidate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform ecod_private.cancel_freshness(old.workspace_id,old.id);return old;end if;
 if (new.workspace_id,new.id,new.verified,new."mergedInto",new."processingRestricted") is distinct from
    (old.workspace_id,old.id,old.verified,old."mergedInto",old."processingRestricted") or new.status='Unavailable' then
  perform ecod_private.cancel_freshness(old.workspace_id,old.id);
 end if;
 return new;
end $$;
revoke all on function ecod_private.invalidate_freshness_candidate() from public,anon,authenticated;
drop trigger if exists invalidate_freshness on public.candidates;
create trigger invalidate_freshness after update on public.candidates for each row execute function ecod_private.invalidate_freshness_candidate();
drop trigger if exists delete_freshness on public.candidates;
create trigger delete_freshness before delete on public.candidates for each row execute function ecod_private.invalidate_freshness_candidate();

create or replace function ecod_private.lock_freshness_consent() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_ws uuid;old_person uuid;new_ws uuid;new_person uuid;
begin
 if tg_op<>'INSERT' then old_ws:=old.workspace_id;old_person:=old."candidateId";end if;
 if tg_op<>'DELETE' then new_ws:=new.workspace_id;new_person:=new."candidateId";end if;
 perform 1 from public.candidates where (workspace_id=old_ws and id=old_person) or(workspace_id=new_ws and id=new_person) order by workspace_id,id for update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_private.lock_freshness_consent() from public,anon,authenticated;
create or replace function ecod_private.invalidate_freshness_consent() returns trigger
language plpgsql security definer set search_path='' as $$
declare ws uuid;person uuid;days integer;
begin
 if tg_op<>'INSERT' then
  ws:=old.workspace_id;person:=old."candidateId";
  select coalesce((select stale_days from ecod_private.freshness_policy where workspace_id=ws),121) into days;
  if not ecod_private.freshness_eligible(ws,person,days) then perform ecod_private.cancel_freshness(ws,person);end if;
 end if;
 if tg_op<>'DELETE' then
  ws:=new.workspace_id;person:=new."candidateId";
  select coalesce((select stale_days from ecod_private.freshness_policy where workspace_id=ws),121) into days;
  if not ecod_private.freshness_eligible(ws,person,days) then perform ecod_private.cancel_freshness(ws,person);end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_private.invalidate_freshness_consent() from public,anon,authenticated;
drop trigger if exists lock_freshness_consent on public.consents;
create trigger lock_freshness_consent before insert or update or delete on public.consents for each row execute function ecod_private.lock_freshness_consent();
drop trigger if exists invalidate_freshness_consent on public.consents;
create trigger invalidate_freshness_consent after insert or update or delete on public.consents for each row execute function ecod_private.invalidate_freshness_consent();

create or replace function public.worker_run_freshness_reviews(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record;days integer;task uuid;n integer:=0;failures integer:=0;cancelled integer:=0;at timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Batch size must be 1 to 50';end if;
 -- Candidate -> policy -> receipt is the issuance lock order. Pause never locks candidates.
 for c in select x.* from public.candidates x where exists(select 1 from ecod_private.freshness_receipts r where r.workspace_id=x.workspace_id and r.candidate_id=x.id and r.status<>'cancelled')
  and not ecod_private.freshness_eligible(x.workspace_id,x.id,coalesce((select stale_days from ecod_private.freshness_policy where workspace_id=x.workspace_id),121))
  order by x.id limit p_limit for update of x skip locked loop
  select coalesce((select stale_days from ecod_private.freshness_policy where workspace_id=c.workspace_id),121) into days;
  if not ecod_private.freshness_eligible(c.workspace_id,c.id,days) then perform ecod_private.cancel_freshness(c.workspace_id,c.id);cancelled:=cancelled+1;end if;
 end loop;
 for c in select x.* from public.candidates x join ecod_private.freshness_policy p on p.workspace_id=x.workspace_id and p.enabled
  where x."mergedInto" is null and not x."processingRestricted" and x.status<>'Unavailable'
   and x.verified<=(at at time zone 'UTC')::date-p.stale_days and ecod_private.freshness_eligible(x.workspace_id,x.id,p.stale_days)
   and not exists(select 1 from ecod_private.freshness_receipts r where r.workspace_id=x.workspace_id and r.candidate_id=x.id and (r.status in('delivered','failed') or(r.status='retrying' and r.available_at>at)))
  order by x.verified,x.id limit p_limit for update of x skip locked loop
  select stale_days into days from ecod_private.freshness_policy where workspace_id=c.workspace_id and enabled for share;
  if not found or not ecod_private.freshness_eligible(c.workspace_id,c.id,days) then continue;end if;
  if exists(select 1 from ecod_private.freshness_receipts where workspace_id=c.workspace_id and candidate_id=c.id and status in('delivered','failed')) then continue;end if;
  begin
   task:=gen_random_uuid();
   insert into public.tasks(id,workspace_id,title,due,"candidateId",owner,created)
    values(task,c.workspace_id,'Review stale profile '||c."anthroId",(at at time zone 'UTC')::date,c.id,'',at);
   insert into ecod_private.freshness_receipts(workspace_id,candidate_id,anthro_id,verified_on,task_id,status,attempts)
    values(c.workspace_id,c.id,c."anthroId",c.verified,task,'delivered',1)
    on conflict(workspace_id,candidate_id) where status<>'cancelled' do update set status='delivered',task_id=excluded.task_id,attempts=ecod_private.freshness_receipts.attempts+1,last_error='';
   n:=n+1;
  exception when others then
   insert into ecod_private.freshness_receipts(workspace_id,candidate_id,anthro_id,verified_on,status,attempts,available_at,last_error)
    values(c.workspace_id,c.id,c."anthroId",c.verified,'retrying',1,at+interval '1 minute','Task creation failed (SQLSTATE '||sqlstate||')')
    on conflict(workspace_id,candidate_id) where status<>'cancelled' do update set attempts=ecod_private.freshness_receipts.attempts+1,
     status=case when ecod_private.freshness_receipts.attempts+1>=5 then 'failed' else 'retrying' end,
     available_at=at+make_interval(secs=>least(900,60*(2^ecod_private.freshness_receipts.attempts)::integer)),last_error=excluded.last_error;
   failures:=failures+1;
  end;
 end loop;
 insert into ecod_private.freshness_worker_health values(true,clock_timestamp()) on conflict(singleton) do update set last_run=excluded.last_run;
 return jsonb_build_object('created',n,'retriedOrFailed',failures,'cancelled',cancelled);
end $$;
revoke all on function public.worker_run_freshness_reviews(integer) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_run_freshness_reviews(integer) to service_role;end if;end $$;

create or replace function public.api_freshness_reviews(p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();begin
 if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid page';end if;
 return jsonb_build_object('enabled',coalesce((select enabled from ecod_private.freshness_policy where workspace_id=ws),false),
  'staleDays',coalesce((select stale_days from ecod_private.freshness_policy where workspace_id=ws),121),
  'lastRun',(select last_run from ecod_private.freshness_worker_health where singleton),
  'total',(select count(*) from ecod_private.freshness_receipts where workspace_id=ws),
  'rows',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from(select id,candidate_id as "candidateId",anthro_id as "anthroId",verified_on as "verifiedOn",task_id as "taskId",status,attempts,last_error as "lastError",available_at as "availableAt",created_at as "createdAt" from ecod_private.freshness_receipts where workspace_id=ws order by created_at desc,id limit 50 offset p_offset)t));
end $$;
create or replace function public.api_set_freshness_reviews(p_enabled boolean,p_stale_days integer default 121) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();begin
 if p_enabled is null or p_stale_days is null or p_stale_days not between 30 and 365 then raise exception 'Choose enabled/paused and 30 to 365 stale days';end if;
 insert into ecod_private.freshness_policy(workspace_id,enabled,stale_days,actor) values(ws,p_enabled,p_stale_days,auth.uid())
  on conflict(workspace_id) do update set enabled=excluded.enabled,stale_days=excluded.stale_days,actor=excluded.actor,updated_at=clock_timestamp();
 return jsonb_build_object('enabled',p_enabled,'staleDays',p_stale_days);
end $$;
create or replace function public.api_retry_freshness_review(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();person uuid;r ecod_private.freshness_receipts;days integer;begin
 select candidate_id into person from ecod_private.freshness_receipts where workspace_id=ws and id=p_id;
 perform 1 from public.candidates where workspace_id=ws and id=person for update;
 if not found then raise exception 'Eligible candidate required';end if;
 select stale_days into days from ecod_private.freshness_policy where workspace_id=ws and enabled for share;
 if not found or not ecod_private.freshness_eligible(ws,person,days) then raise exception 'Enabled policy and eligible candidate required';end if;
 select * into r from ecod_private.freshness_receipts where workspace_id=ws and id=p_id for update;
 if r.status in('retrying','delivered') then return true;end if;
 if r.status<>'failed' then raise exception 'Only failed reviews can be retried';end if;
 update ecod_private.freshness_receipts set status='retrying',attempts=0,available_at=clock_timestamp(),last_error='' where id=r.id;
 return true;
end $$;
revoke all on function public.api_freshness_reviews(integer),public.api_set_freshness_reviews(boolean,integer),public.api_retry_freshness_review(uuid) from public,anon,authenticated;
grant execute on function public.api_freshness_reviews(integer),public.api_set_freshness_reviews(boolean,integer),public.api_retry_freshness_review(uuid) to authenticated;
commit;
