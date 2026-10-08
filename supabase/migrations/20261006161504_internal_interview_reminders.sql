-- E1: atomic internal preparation tasks, no email or external delivery.
begin;
create table if not exists ecod_private.interview_reminder_policy (
 workspace_id uuid primary key references public.workspaces(id),enabled boolean not null default false,
 updated_at timestamptz not null default now(),actor uuid
);
create table if not exists ecod_private.interview_reminder_worker_health (
 singleton boolean primary key default true check(singleton),last_run timestamptz not null
);
alter table ecod_private.interview_reminder_worker_health enable row level security;
revoke all on ecod_private.interview_reminder_worker_health from public,anon,authenticated;
create table if not exists ecod_private.interview_reminders (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 interview_id uuid not null,scheduled_at timestamptz not null,task_id uuid,
 status text not null check(status in ('delivered','cancelled','retrying','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),last_error text not null default '',
 created_at timestamptz not null default now(),cancelled_at timestamptz
);
create unique index if not exists interview_reminder_active on ecod_private.interview_reminders(workspace_id,interview_id) where status<>'cancelled';
create index if not exists interview_reminder_recent on ecod_private.interview_reminders(workspace_id,created_at desc,id);
create index if not exists interviews_reminder_due on public.interviews("scheduledAt",id) where status='Scheduled';
alter table ecod_private.interview_reminder_policy enable row level security;
alter table ecod_private.interview_reminders enable row level security;
revoke all on ecod_private.interview_reminder_policy,ecod_private.interview_reminders from public,anon,authenticated;

create or replace function ecod_private.cancel_interview_reminder(ws uuid,interview uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;begin
 for r in select * from ecod_private.interview_reminders where workspace_id=ws and interview_id=interview and status<>'cancelled' for update loop
  update public.tasks set done=true where workspace_id=ws and id=r.task_id and not done;
  update ecod_private.interview_reminders set status='cancelled',cancelled_at=clock_timestamp() where id=r.id;
 end loop;
end $$;
revoke all on function ecod_private.cancel_interview_reminder(uuid,uuid) from public,anon,authenticated;
create or replace function ecod_private.invalidate_interview_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform ecod_private.cancel_interview_reminder(old.workspace_id,old.id);return old;end if;
 if (new.workspace_id,new.id,new."candidateId",new."demandId",new."scheduledAt",new.status,new.round,new.mode,new.interviewers) is distinct from
    (old.workspace_id,old.id,old."candidateId",old."demandId",old."scheduledAt",old.status,old.round,old.mode,old.interviewers) then
  perform ecod_private.cancel_interview_reminder(old.workspace_id,old.id);
 end if;
 return new;
end $$;
revoke all on function ecod_private.invalidate_interview_reminder() from public,anon,authenticated;
drop trigger if exists invalidate_internal_reminder on public.interviews;
create trigger invalidate_internal_reminder after update or delete on public.interviews for each row execute function ecod_private.invalidate_interview_reminder();

create or replace function public.worker_run_interview_reminders(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i record;task uuid;processed integer:=0;failures integer:=0;at timestamptz:=clock_timestamp();begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Batch size must be 1 to 50';end if;
 -- The persisted interview is the schedule. Lock it before creating both the task
 -- and its receipt, so retries and overlapping workers cannot duplicate effects.
 for i in select iv.* from public.interviews iv
  join ecod_private.interview_reminder_policy p on p.workspace_id=iv.workspace_id and p.enabled
  where iv.status='Scheduled' and iv."scheduledAt">at and iv."scheduledAt"<=at+interval '60 minutes'
   and not exists(select 1 from ecod_private.interview_reminders r where r.workspace_id=iv.workspace_id and r.interview_id=iv.id and (r.status in ('delivered','failed') or (r.status='retrying' and r.available_at>at)))
  order by iv."scheduledAt",iv.id limit p_limit for update of iv skip locked loop
  -- Serialize task issuance against pause without reversing the interview lock order.
  perform 1 from ecod_private.interview_reminder_policy where workspace_id=i.workspace_id and enabled for share;
  if not found then continue;end if;
  if exists(select 1 from ecod_private.interview_reminders where workspace_id=i.workspace_id and interview_id=i.id and status in ('delivered','failed')) then continue;end if;
  begin
  task:=gen_random_uuid();
  insert into public.tasks(id,workspace_id,title,due,"candidateId","demandId",created,owner)
   values(task,i.workspace_id,'Prepare interview: '||i.round||' — '||to_char(i."scheduledAt" at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC',
     (i."scheduledAt" at time zone 'UTC')::date,i."candidateId",i."demandId",at,'');
  insert into ecod_private.interview_reminders(workspace_id,interview_id,scheduled_at,task_id,status,attempts) values(i.workspace_id,i.id,i."scheduledAt",task,'delivered',1)
   on conflict(workspace_id,interview_id) where status<>'cancelled' do update set status='delivered',task_id=excluded.task_id,attempts=ecod_private.interview_reminders.attempts+1,last_error='';
  processed:=processed+1;
  exception when others then
   -- No partial task survives the failed inner transaction. Persist only a
   -- generic error code, never candidate text or database exception details.
   insert into ecod_private.interview_reminders(workspace_id,interview_id,scheduled_at,status,attempts,available_at,last_error)
    values(i.workspace_id,i.id,i."scheduledAt",'retrying',1,at+interval '1 minute','Task creation failed (SQLSTATE '||sqlstate||')')
    on conflict(workspace_id,interview_id) where status<>'cancelled' do update set
     attempts=ecod_private.interview_reminders.attempts+1,
     status=case when ecod_private.interview_reminders.attempts+1>=5 then 'failed' else 'retrying' end,
     available_at=at+make_interval(secs=>least(900,60*(2^ecod_private.interview_reminders.attempts)::integer)),last_error=excluded.last_error;
   failures:=failures+1;
  end;
 end loop;
 -- A separate heartbeat avoids upgrading shared policy locks across workers.
 insert into ecod_private.interview_reminder_worker_health values(true,clock_timestamp()) on conflict(singleton) do update set last_run=excluded.last_run;
 return jsonb_build_object('created',processed,'retriedOrFailed',failures);
end $$;
revoke all on function public.worker_run_interview_reminders(integer) from public,anon,authenticated;
do $$begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.worker_run_interview_reminders(integer) to service_role;
 end if;
end $$;

create or replace function public.api_interview_reminders(p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();begin
 if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid page';end if;
 return jsonb_build_object('enabled',coalesce((select enabled from ecod_private.interview_reminder_policy where workspace_id=ws),false),
  'lastRun',(select last_run from ecod_private.interview_reminder_worker_health where singleton),
  'total',(select count(*) from ecod_private.interview_reminders where workspace_id=ws),
  'rows',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,interview_id as "interviewId",scheduled_at as "scheduledAt",task_id as "taskId",status,attempts,last_error as "lastError",available_at as "availableAt",created_at as "createdAt",cancelled_at as "cancelledAt" from ecod_private.interview_reminders where workspace_id=ws order by created_at desc,id limit 50 offset p_offset)t));
end $$;
create or replace function public.api_set_interview_reminders(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();begin
 if p_enabled is null then raise exception 'Choose enabled or paused';end if;
 insert into ecod_private.interview_reminder_policy(workspace_id,enabled,actor) values(ws,p_enabled,auth.uid()) on conflict(workspace_id) do update set enabled=excluded.enabled,actor=excluded.actor,updated_at=clock_timestamp();
 return jsonb_build_object('enabled',p_enabled);
end $$;
revoke all on function public.api_interview_reminders(integer),public.api_set_interview_reminders(boolean) from public,anon,authenticated;
grant execute on function public.api_interview_reminders(integer),public.api_set_interview_reminders(boolean) to authenticated;
create or replace function public.api_retry_interview_reminder(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();iv uuid;r ecod_private.interview_reminders;begin
 select interview_id into iv from ecod_private.interview_reminders where workspace_id=ws and id=p_id;
 perform 1 from public.interviews where workspace_id=ws and id=iv and status='Scheduled' and "scheduledAt">clock_timestamp() for update;
 if not found then raise exception 'Future scheduled interview required';end if;
 select * into r from ecod_private.interview_reminders where workspace_id=ws and id=p_id for update;
 if r.status<>'failed' then raise exception 'Only failed reminders can be retried';end if;
 update ecod_private.interview_reminders set status='retrying',attempts=0,available_at=clock_timestamp(),last_error='' where id=r.id;
 return true;
end $$;
revoke all on function public.api_retry_interview_reminder(uuid) from public,anon,authenticated;
grant execute on function public.api_retry_interview_reminder(uuid) to authenticated;
commit;
