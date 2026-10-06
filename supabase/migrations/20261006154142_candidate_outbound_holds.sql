-- D4: reviewed outbound recruiting holds. Reads/corrections and historical records remain.
begin;
alter table public.candidates add column if not exists "processingRestricted" boolean not null default false;
create table if not exists ecod_private.candidate_outbound_holds (
 workspace_id uuid not null,candidate_id uuid not null,case_id uuid not null,active boolean not null,
 updated_at timestamptz not null,actor uuid not null,primary key(workspace_id,candidate_id),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id),
 foreign key(workspace_id,case_id) references ecod_private.subject_requests(workspace_id,id)
);
alter table ecod_private.candidate_outbound_holds enable row level security;
revoke all on ecod_private.candidate_outbound_holds from public,anon,authenticated;

create or replace function ecod_private.guard_candidate_hold_flag() returns trigger language plpgsql security definer set search_path='' as $$
declare active_hold boolean;
begin
 active_hold:=exists(select 1 from ecod_private.candidate_outbound_holds where workspace_id=new.workspace_id and candidate_id=new.id and active);
 if tg_op='INSERT' then
  -- BEFORE INSERT also runs for UPSERT: an omitted/default flag must retain a held original.
  if new."processingRestricted" and not active_hold then raise exception 'Outbound hold flag is server-owned' using errcode='42501';end if;
  new."processingRestricted":=active_hold;
 elsif new."processingRestricted"<>active_hold then raise exception 'Outbound hold flag is server-owned' using errcode='42501';end if;
 if tg_op='UPDATE' and new."mergedInto" is distinct from old."mergedInto" then perform 1 from public.candidates where id=new."mergedInto" and workspace_id=new.workspace_id for share;end if;
 if tg_op='UPDATE' and new."mergedInto" is distinct from old."mergedInto" and (old."processingRestricted" or exists(select 1 from public.candidates where id=new."mergedInto" and workspace_id=new.workspace_id and "processingRestricted")) then raise exception 'Release the outbound hold before merging' using errcode='42501';end if;
 return new;
end $$;
revoke all on function ecod_private.guard_candidate_hold_flag() from public,anon,authenticated;
drop trigger if exists zz_candidate_hold_flag_guard on public.candidates;
create trigger zz_candidate_hold_flag_guard before insert or update on public.candidates for each row execute function ecod_private.guard_candidate_hold_flag();

create or replace function ecod_private.guard_held_outbound_record() returns trigger language plpgsql security definer set search_path='' as $$
declare prior_id uuid;prior_ws uuid;terminal boolean:=false;
begin
 if tg_op='UPDATE' then prior_id:=old."candidateId";prior_ws:=old.workspace_id;end if;
 -- Serialize with hold activation/release; historical cancellation can still proceed.
 perform 1 from public.candidates where (workspace_id=new.workspace_id and id=new."candidateId") or (workspace_id=prior_ws and id=prior_id) order by workspace_id,id for share;
 if not exists(select 1 from public.candidates where ((workspace_id=new.workspace_id and id=new."candidateId") or (workspace_id=prior_ws and id=prior_id)) and "processingRestricted") then return new;end if;
 if tg_op='UPDATE' and new."candidateId"=old."candidateId" and new.workspace_id=old.workspace_id and new."demandId" is not distinct from old."demandId" then
  terminal:=case tg_table_name
   when 'considerations' then to_jsonb(new)->>'stage' in ('Rejected','Withdrawn')
   when 'interviews' then to_jsonb(new)->>'status'='Cancelled'
   when 'offers' then to_jsonb(new)->>'status' in ('Rejected','Withdrawn')
   when 'placements' then to_jsonb(new)->>'status' in ('Completed','Terminated','Cancelled')
   when 'submissions' then (to_jsonb(new)-array['notes','updated'])=(to_jsonb(old)-array['notes','updated'])
   else false end;
 end if;
 if terminal is not true then raise exception 'Candidate has an outbound recruiting hold' using errcode='42501';end if;
 return new;
end $$;
revoke all on function ecod_private.guard_held_outbound_record() from public,anon,authenticated;
do $$declare tbl text;begin foreach tbl in array array['considerations','submissions','interviews','offers','placements'] loop
 execute format('drop trigger if exists outbound_hold_guard on public.%I',tbl);
 execute format('create trigger outbound_hold_guard before insert or update on public.%I for each row execute function ecod_private.guard_held_outbound_record()',tbl);
end loop;end $$;

create or replace function ecod_private.guard_hold_export_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.id='workspace' and exists(select 1 from ecod_private.candidate_outbound_holds where workspace_id=old.workspace_id and active) then
  if tg_op='DELETE' then raise exception 'Release outbound holds before disabling audited CSV exports';end if;
  if new.workspace_id<>old.workspace_id or new.id<>old.id or new.custom->'auditedCandidateExports' is distinct from 'true'::jsonb then raise exception 'Release outbound holds before disabling audited CSV exports';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_private.guard_hold_export_settings() from public,anon,authenticated;
drop trigger if exists outbound_hold_export_settings on public.settings;
create trigger outbound_hold_export_settings before update or delete on public.settings for each row execute function ecod_private.guard_hold_export_settings();

create or replace function public.api_set_subject_outbound_hold(p_operation uuid,p_id uuid,p_version integer,p_enabled boolean,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;prior ecod_private.subject_request_events;h ecod_private.candidate_outbound_holds;c public.candidates;fp text;result jsonb;at timestamptz;action_name text;
begin
 if p_operation is null or p_id is null or p_version is null or p_enabled is null or p_note is null or length(btrim(p_note)) not between 10 and 2000 then raise exception 'Hold action and a review reference are required';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array('outbound_hold',p_id,p_version,p_enabled,p_note)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_operation::text,0));
 select * into prior from ecod_private.subject_request_events where workspace_id=ws and operation_id=p_operation;
 if found then if prior.actor<>auth.uid() or prior.fingerprint<>fp then raise exception 'Request identifier conflict';end if;return prior.result;end if;
 select * into r from ecod_private.subject_requests where id=p_id and workspace_id=ws;
 if not found then raise exception 'Request case not found' using errcode='42501';end if;
 select * into c from public.candidates where id=r.candidate_id and workspace_id=ws for update;
 select * into r from ecod_private.subject_requests where id=p_id and workspace_id=ws for update;
 if r.version<>p_version then raise exception 'Case changed; refresh before updating' using errcode='40001';end if;
 if r.kind<>'restriction' then raise exception 'A restriction request case is required';end if;
 select * into h from ecod_private.candidate_outbound_holds where workspace_id=ws and candidate_id=c.id;
 if p_enabled then
  if r.status not in ('in_review','awaiting_action') or r.verified_at is null or c."mergedInto" is not null then raise exception 'Verify and review the active restriction case first';end if;
  -- Lock configuration against concurrent downgrade while this hold is installed.
  perform 1 from public.settings where workspace_id=ws and id='workspace' and custom->'auditedCandidateExports'='true'::jsonb for update;
  if not found then raise exception 'Enable audited candidate CSV exports before applying a hold';end if;
  if h.active then raise exception 'Candidate already has an active outbound hold';end if;
 else
  if not coalesce(h.active,false) or h.case_id<>r.id then raise exception 'This case does not own an active outbound hold';end if;
 end if;
 at:=clock_timestamp();action_name:=case when p_enabled then 'hold_applied' else 'hold_released' end;
 insert into ecod_private.candidate_outbound_holds values(ws,c.id,r.id,p_enabled,at,auth.uid()) on conflict(workspace_id,candidate_id) do update set case_id=excluded.case_id,active=excluded.active,updated_at=excluded.updated_at,actor=excluded.actor;
 update public.candidates set "processingRestricted"=p_enabled where id=c.id and workspace_id=ws;
 update ecod_private.subject_requests set version=version+1,updated_at=at where id=r.id returning * into r;
 result:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'outboundHold',p_enabled);
 insert into ecod_private.subject_request_events(workspace_id,case_id,operation_id,actor,at,action,note,version,status,assignee,due_date,fingerprint,result) values(ws,r.id,p_operation,auth.uid(),at,action_name,btrim(p_note),r.version,r.status,r.assignee,r.due_date,fp,result);
 return result;
end $$;
revoke all on function public.api_set_subject_outbound_hold(uuid,uuid,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.api_set_subject_outbound_hold(uuid,uuid,integer,boolean,text) to authenticated;

-- Wrap detail without duplicating the D3 case projection/history implementation.
do $$begin if to_regprocedure('ecod_private.subject_request_detail_base(uuid,integer)') is null then alter function public.api_subject_request_detail(uuid,integer) rename to subject_request_detail_base;alter function public.subject_request_detail_base(uuid,integer) set schema ecod_private;end if;end $$;
revoke all on function ecod_private.subject_request_detail_base(uuid,integer) from public,anon,authenticated;
create or replace function public.api_subject_request_detail(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();result jsonb;h ecod_private.candidate_outbound_holds;
begin
 result:=ecod_private.subject_request_detail_base(p_id,p_offset);
 select * into h from ecod_private.candidate_outbound_holds where workspace_id=ws and candidate_id=(result->'case'->>'candidateId')::uuid;
 return result||jsonb_build_object('outboundHold',jsonb_build_object('active',coalesce(h.active,false),'owned',h.case_id=p_id));
end $$;
revoke all on function public.api_subject_request_detail(uuid,integer) from public,anon,authenticated;
grant execute on function public.api_subject_request_detail(uuid,integer) to authenticated;

do $$begin if to_regprocedure('ecod_private.prepare_candidate_export_base(uuid[])') is null then alter function public.api_prepare_candidate_export(uuid[]) rename to prepare_candidate_export_base;alter function public.prepare_candidate_export_base(uuid[]) set schema ecod_private;end if;end $$;
revoke all on function ecod_private.prepare_candidate_export_base(uuid[]) from public,anon,authenticated;
create or replace function public.api_prepare_candidate_export(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Export permission required' using errcode='42501';end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 500 then raise exception 'Select 1 to 500 distinct candidates';end if;
 perform 1 from public.candidates where workspace_id=ws and id=any(p_ids) order by id for share;
 if exists(select 1 from public.candidates where workspace_id=ws and id=any(p_ids) and "processingRestricted") then raise exception 'Candidate has an outbound recruiting hold' using errcode='42501';end if;
 return ecod_private.prepare_candidate_export_base(p_ids);
end $$;
revoke all on function public.api_prepare_candidate_export(uuid[]) from public,anon,authenticated;
grant execute on function public.api_prepare_candidate_export(uuid[]) to authenticated;
commit;
