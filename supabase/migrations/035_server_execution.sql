-- Phase 3: durable database workflow jobs and server-side assignment.
-- Disabled per workspace until migration + new frontend + worker are deployed.
begin;
alter table public.settings add column if not exists "serverAutomation" boolean not null default false;

create table if not exists public."executionJobs" (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity,
  workspace_id uuid not null references public.workspaces(id),
  kind text not null default 'workflow' check(kind='workflow'),
  "entityType" text not null,
  "entityId" uuid not null,
  "ruleName" text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','completed','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  "availableAt" timestamptz not null default now(),
  "lastError" text not null default '',
  created timestamptz not null default now(),
  completed timestamptz
);
alter table public."executionJobs" add column if not exists sequence bigint generated always as identity;
create index if not exists execution_jobs_due on public."executionJobs"("availableAt",created) where status='pending';
create index if not exists execution_jobs_workspace on public."executionJobs"(workspace_id,created desc);
alter table public."executionJobs" enable row level security;
revoke all on public."executionJobs" from public,anon,authenticated;
grant select on public."executionJobs" to authenticated;
drop policy if exists execution_jobs_admin on public."executionJobs";
create policy execution_jobs_admin on public."executionJobs" for select to authenticated using(workspace_id=public.current_workspace() and public.is_admin());

create or replace function public.audit_execution_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.status is distinct from old.status or new.attempts is distinct from old.attempts then
    insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot)
    values(new.workspace_id,'executionJobs',new.id,'Workflow job '||new.status,coalesce(auth.uid()::text,'Background worker'),jsonb_build_object('entityType',new."entityType",'entityId',new."entityId",'ruleName',new."ruleName",'attempts',new.attempts));
  end if;
  return new;
end $$;
revoke all on function public.audit_execution_job() from public,anon,authenticated;
drop trigger if exists audit_execution_job on public."executionJobs";
create trigger audit_execution_job after insert or update on public."executionJobs" for each row execute function public.audit_execution_job();

create or replace function public.api_server_execution_status()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select s."serverAutomation" from public.settings s where s.workspace_id=public.current_workspace() and s.id='workspace'),false)
$$;
revoke all on function public.api_server_execution_status() from public,anon;
grant execute on function public.api_server_execution_status() to authenticated;

create or replace function public.api_set_server_execution(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();
begin
  if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Enabled is required'; end if;
  insert into public.settings(id,workspace_id,"serverAutomation") values('workspace',ws,p_enabled)
  on conflict(workspace_id,id) do update set "serverAutomation"=excluded."serverAutomation";
end $$;
revoke all on function public.api_set_server_execution(boolean) from public,anon;
grant execute on function public.api_set_server_execution(boolean) to authenticated;

create or replace function public.server_assign_new_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare r record; v jsonb; item text; wanted text; matched boolean;
begin
  if btrim(coalesce(new.owner,''))<>'' or not exists(select 1 from public.settings s where s.workspace_id=new.workspace_id and s.id='workspace' and s."serverAutomation") then return new; end if;
  for r in select * from public."assignmentRules" where workspace_id=new.workspace_id and entity=tg_table_name and enabled order by priority,created,name,id loop
    v:=to_jsonb(new)->r.field; wanted:=lower(btrim(r.value)); matched:=false;
    if wanted='' then continue; end if;
    for item in select case when jsonb_typeof(v)='array' then x#>>'{}' else v#>>'{}' end from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else jsonb_build_array(v) end) x loop
      item:=lower(btrim(coalesce(item,'')));
      if item='' then continue; end if;
      if r.op='contains' then matched:=strpos(item,wanted)>0;
      elsif r.op='any' then matched:=exists(select 1 from unnest(string_to_array(wanted,',')) w where btrim(w)=item);
      else matched:=item=wanted; end if;
      if matched then exit; end if;
    end loop;
    if matched then new.owner:=btrim(r."assignTo"); return new; end if;
  end loop;
  return new;
end $$;
revoke all on function public.server_assign_new_record() from public,anon,authenticated;
drop trigger if exists server_assignment on public.candidates;
create trigger server_assignment before insert on public.candidates for each row execute function public.server_assign_new_record();
drop trigger if exists server_assignment on public.demands;
create trigger server_assignment before insert on public.demands for each row execute function public.server_assign_new_record();

create or replace function public.enqueue_workflow_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare r record; before_value jsonb; after_value jsonb; new_row jsonb:=to_jsonb(new); old_row jsonb; candidate uuid; demand uuid;
begin
  if not exists(select 1 from public.settings s where s.workspace_id=new.workspace_id and s.id='workspace' and s."serverAutomation") then return new; end if;
  if tg_op='UPDATE' then old_row:=to_jsonb(old); end if;
  candidate:=case when tg_table_name='candidates' then new.id else (new_row->>'candidateId')::uuid end;
  demand:=case when tg_table_name='demands' then new.id else (new_row->>'demandId')::uuid end;
  for r in select * from public."workflowRules" where workspace_id=new.workspace_id and enabled and "triggerTable"=tg_table_name order by created,id loop
    before_value:=old_row->r."triggerField"; after_value:=new_row->r."triggerField";
    if coalesce(before_value,'null'::jsonb)=coalesce(after_value,'null'::jsonb) then continue; end if;
    if (r.op='eq' and after_value=to_jsonb(r.value)) or
       (r.op in ('changed','neq') and after_value is not null and after_value not in ('null'::jsonb,'""'::jsonb) and (r.op='changed' or after_value<>to_jsonb(r.value))) then
      insert into public."executionJobs"(workspace_id,"entityType","entityId","ruleName",payload)
      values(new.workspace_id,tg_table_name,new.id,r.name,jsonb_build_object('ruleId',r.id,'actions',r.actions,'candidateId',candidate,'demandId',demand,'date',current_date));
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.enqueue_workflow_change() from public,anon,authenticated;
do $$ declare tbl text; begin
  foreach tbl in array array['candidates','demands','considerations','offers','interviews'] loop
    execute format('drop trigger if exists enqueue_server_workflow on public.%I',tbl);
    execute format('create trigger enqueue_server_workflow after insert or update on public.%I for each row execute function public.enqueue_workflow_change()',tbl);
  end loop;
end $$;

-- Row locks are the claim: effects and completion commit together. If a worker is killed,
-- PostgreSQL rolls back the transaction and the job remains pending. SKIP LOCKED permits
-- multiple workers without processing the same job. No external I/O occurs in this RPC.
create or replace function public.worker_run_execution_jobs(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j record; a jsonb; candidate uuid; demand uuid; day date; processed integer:=0; failures integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Batch size must be 1 to 50'; end if;
  for j in select q.* from public."executionJobs" q join public.settings s on s.workspace_id=q.workspace_id and s.id='workspace' and s."serverAutomation"
    where q.status='pending' and q."availableAt"<=now() order by q.sequence limit p_limit for update of q skip locked loop
    begin
      candidate:=(j.payload->>'candidateId')::uuid; demand:=(j.payload->>'demandId')::uuid; day:=(j.payload->>'date')::date;
      -- Reject deleted/moved links before any effect, including tag-only actions.
      if candidate is not null and not exists(select 1 from public.candidates c where c.id=candidate and c.workspace_id=j.workspace_id) then raise exception 'Candidate unavailable'; end if;
      if demand is not null and not exists(select 1 from public.demands d where d.id=demand and d.workspace_id=j.workspace_id) then raise exception 'Demand unavailable'; end if;
      if jsonb_typeof(j.payload->'actions') is distinct from 'array' then raise exception 'Invalid actions'; end if;
      if jsonb_array_length(j.payload->'actions')>50 then raise exception 'Too many workflow actions'; end if;
      for a in select value from jsonb_array_elements(j.payload->'actions') loop
        if a->>'type'='task' then
          insert into public.tasks(workspace_id,title,due,"candidateId","demandId",created)
          values(j.workspace_id,coalesce(nullif(a->>'title',''),'Follow up: '||j."ruleName"),day+coalesce((a->>'dueDays')::integer,1),candidate,demand,day);
        elsif a->>'type'='note' and candidate is not null then
          insert into public.notes(workspace_id,"candidateId",text,date,author) values(j.workspace_id,candidate,btrim(j."ruleName"||' — '||coalesce(a->>'text','')),day,'Automation');
        elsif a->>'type'='tag' and candidate is not null and coalesce(a->>'tag','')<>'' then
          update public.candidates set tags=array_append(tags,a->>'tag') where id=candidate and workspace_id=j.workspace_id and not ((a->>'tag')=any(tags));
        elsif a->>'type'='nextAction' and candidate is not null and coalesce(a->>'text','')<>'' then
          update public.candidates set "nextAction"=a->>'text' where id=candidate and workspace_id=j.workspace_id;
        elsif a->>'type' not in ('note','tag','nextAction') or a->>'type' is null then
          raise exception 'Unsupported workflow action';
        end if;
      end loop;
      update public."executionJobs" set status='completed',attempts=attempts+1,completed=now(),"lastError"='' where id=j.id;
      processed:=processed+1;
    exception when others then
      -- The inner transaction rolls back ALL partial effects before recording failure.
      update public."executionJobs" set attempts=attempts+1,status=case when attempts+1>=5 then 'failed' else 'pending' end,
        "availableAt"=now()+make_interval(secs=>least(3600,60*(2^attempts)::integer)),"lastError"='Workflow could not complete (SQLSTATE '||sqlstate||'). Review rule actions and record links.' where id=j.id;
      failures:=failures+1;
    end;
  end loop;
  return jsonb_build_object('completed',processed,'retriedOrFailed',failures);
end $$;
revoke all on function public.worker_run_execution_jobs(integer) from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.worker_run_execution_jobs(integer) to service_role;
  end if;
end $$;

create or replace function public.api_execution_jobs(p_status text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
  if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_status not in ('','pending','completed','failed') or p_status is null or p_offset is null or p_offset<0 then raise exception 'Invalid jobs filter'; end if;
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (
    select id,kind,"entityType","entityId","ruleName",status,attempts,"availableAt","lastError",created,completed from public."executionJobs"
    where workspace_id=ws and (p_status='' or status=p_status) order by sequence desc limit 25 offset p_offset
  ) rows;
  return jsonb_build_object('enabled',public.api_server_execution_status(),'jobs',result,'total',(select count(*) from public."executionJobs" where workspace_id=ws and (p_status='' or status=p_status)));
end $$;
revoke all on function public.api_execution_jobs(text,integer) from public,anon;
grant execute on function public.api_execution_jobs(text,integer) to authenticated;

create or replace function public.api_retry_execution_job(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); rule_actions jsonb; rule_name text;
begin
  if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public."executionJobs" where id=p_id and workspace_id=ws and status='failed' for update;
  if not found then raise exception 'Failed job not found'; end if;
  select r.actions,r.name into rule_actions,rule_name from public."executionJobs" j join public."workflowRules" r on r.id=(j.payload->>'ruleId')::uuid and r.workspace_id=j.workspace_id and r.enabled where j.id=p_id and j.workspace_id=ws;
  if not found then raise exception 'Enable or restore the workflow rule before retrying'; end if;
  update public."executionJobs" set status='pending',attempts=0,"availableAt"=now(),"lastError"='',completed=null,payload=jsonb_set(payload,'{actions}',rule_actions),"ruleName"=rule_name where id=p_id and workspace_id=ws and status='failed';
  if not found then raise exception 'Failed job not found'; end if;
end $$;
revoke all on function public.api_retry_execution_job(uuid) from public,anon;
grant execute on function public.api_retry_execution_job(uuid) to authenticated;
commit;
