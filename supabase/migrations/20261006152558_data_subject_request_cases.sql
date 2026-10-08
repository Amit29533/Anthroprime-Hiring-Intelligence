-- D3: administrator-owned review cases. No erasure or processing restriction is executed.
begin;
create table if not exists ecod_private.subject_requests (
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,anthro_id text not null,
 kind text not null check(kind in ('access','correction','restriction','erasure','retention_review')),
 status text not null check(status in ('opened','verified','in_review','awaiting_action','closed','declined')),
 summary text not null,channel text not null check(channel in ('email','phone','portal','other')),
 assignee uuid,due_date date,version integer not null default 1,created_at timestamptz not null,updated_at timestamptz not null,
 verified_at timestamptz,closed_at timestamptz,unique(workspace_id,id),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id)
);
create table if not exists ecod_private.subject_request_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,case_id uuid not null,operation_id uuid not null,
 actor uuid not null,at timestamptz not null,action text not null,note text not null,version integer not null,status text not null,
 assignee uuid,due_date date,fingerprint text not null,result jsonb not null,
 unique(workspace_id,operation_id),foreign key(workspace_id,case_id) references ecod_private.subject_requests(workspace_id,id)
);
alter table ecod_private.subject_requests enable row level security;
alter table ecod_private.subject_request_events enable row level security;
revoke all on ecod_private.subject_requests,ecod_private.subject_request_events from public,anon,authenticated;
create index if not exists subject_request_queue on ecod_private.subject_requests(workspace_id,status,due_date,created_at desc);
create index if not exists subject_request_candidate on ecod_private.subject_requests(workspace_id,candidate_id,created_at desc);
create index if not exists subject_request_history on ecod_private.subject_request_events(workspace_id,case_id,version desc);

create or replace function ecod_private.subject_request_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 perform 1 from public.memberships where workspace_id=ws and user_id=auth.uid() and role='admin' for share;
 if ws is null or not found then raise exception 'Administrator access required' using errcode='42501';end if;
 return ws;
end $$;
revoke all on function ecod_private.subject_request_admin() from public,anon,authenticated;

create or replace function public.api_create_subject_request(p_id uuid,p_candidate uuid,p_kind text,p_summary text,p_channel text,p_due date default null,p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();c public.candidates;prior ecod_private.subject_request_events;fp text;result jsonb;at timestamptz:=clock_timestamp();
begin
 if p_id is null or p_candidate is null or p_kind is null or p_kind not in ('access','correction','restriction','erasure','retention_review') or p_channel is null or p_channel not in ('email','phone','portal','other') or p_summary is null or length(btrim(p_summary)) not between 10 and 2000 then raise exception 'Invalid request case';end if;
 if p_due is not null and p_due not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid review date';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(p_candidate,p_kind,p_summary,p_channel,p_due,p_assignee)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_id::text,0));
 select * into prior from ecod_private.subject_request_events where workspace_id=ws and operation_id=p_id;
 if found then
  if prior.actor<>auth.uid() or prior.fingerprint<>fp or prior.action<>'created' then raise exception 'Request identifier conflict';end if;
  return prior.result;
 end if;
 select * into c from public.candidates where id=p_candidate and workspace_id=ws and "mergedInto" is null;
 if not found then raise exception 'Candidate not available' using errcode='42501';end if;
 if exists(select 1 from ecod_private.subject_requests where id=p_id) then raise exception 'Request identifier conflict';end if;
 if p_assignee is not null and not exists(select 1 from public.memberships where workspace_id=ws and user_id=p_assignee and role='admin') then raise exception 'Assignee must be a workspace administrator';end if;
 at:=clock_timestamp();
 insert into ecod_private.subject_requests values(p_id,ws,c.id,c."anthroId",p_kind,'opened',btrim(p_summary),p_channel,p_assignee,p_due,1,at,at,null,null);
 result:=jsonb_build_object('id',p_id,'version',1,'status','opened');
 insert into ecod_private.subject_request_events(workspace_id,case_id,operation_id,actor,at,action,note,version,status,assignee,due_date,fingerprint,result)
 values(ws,p_id,p_id,auth.uid(),at,'created',btrim(p_summary),1,'opened',p_assignee,p_due,fp,result);
 return result;
end $$;

create or replace function public.api_update_subject_request(p_operation uuid,p_id uuid,p_version integer,p_action text,p_note text,p_due date default null,p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;prior ecod_private.subject_request_events;fp text;result jsonb;next_status text;at timestamptz:=clock_timestamp();
begin
 if p_operation is null or p_id is null or p_version is null or p_version<1 or p_action is null or p_action not in ('verify','start','wait','close','decline','reopen','plan') or p_note is null or length(btrim(p_note)) not between 10 and 2000 then raise exception 'Action and a review reference are required';end if;
 if p_due is not null and p_due not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid review date';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_action,p_note,p_due,p_assignee)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_operation::text,0));
 select * into prior from ecod_private.subject_request_events where workspace_id=ws and operation_id=p_operation;
 if found then
  if prior.actor<>auth.uid() or prior.fingerprint<>fp then raise exception 'Request identifier conflict';end if;
  return prior.result;
 end if;
 select * into r from ecod_private.subject_requests where id=p_id and workspace_id=ws for update;
 if not found then raise exception 'Request case not found' using errcode='42501';end if;
 if r.version<>p_version then raise exception 'Case changed; refresh before updating' using errcode='40001';end if;
 next_status:=case
  when p_action='verify' and r.status='opened' then 'verified'
  when p_action='start' and r.status in ('verified','awaiting_action') then 'in_review'
  when p_action='wait' and r.status='in_review' then 'awaiting_action'
  when p_action='close' and r.status in ('in_review','awaiting_action') and r.verified_at is not null then 'closed'
  when p_action='decline' and r.status not in ('closed','declined') then 'declined'
  when p_action='reopen' and r.status in ('closed','declined') then 'opened'
  when p_action='plan' and r.status not in ('closed','declined') then r.status
  else null end;
 if next_status is null then raise exception 'Action is not available in this case state';end if;
 if p_action='plan' and p_assignee is not null and not exists(select 1 from public.memberships where workspace_id=ws and user_id=p_assignee and role='admin') then raise exception 'Assignee must be a workspace administrator';end if;
 at:=clock_timestamp();
 update ecod_private.subject_requests set status=next_status,version=version+1,updated_at=at,
  verified_at=case when p_action='verify' then at when p_action='reopen' then null else verified_at end,
  closed_at=case when p_action in ('close','decline') then at when p_action='reopen' then null else closed_at end,
  assignee=case when p_action='plan' then p_assignee else assignee end,due_date=case when p_action='plan' then p_due else due_date end
 where id=r.id returning * into r;
 result:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status);
 insert into ecod_private.subject_request_events(workspace_id,case_id,operation_id,actor,at,action,note,version,status,assignee,due_date,fingerprint,result)
 values(ws,r.id,p_operation,auth.uid(),at,p_action,btrim(p_note),r.version,r.status,r.assignee,r.due_date,fp,result);
 return result;
end $$;

create or replace function public.api_subject_request_page(p_candidate uuid default null,p_filter text default 'active',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();rows jsonb;total integer;overdue integer;admins jsonb;
begin
 if p_filter is null or p_filter not in ('active','all','overdue') or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid request page';end if;
 select count(*),count(*) filter(where due_date<current_date and status not in ('closed','declined')) into total,overdue from ecod_private.subject_requests
 where workspace_id=ws and (p_candidate is null or candidate_id=p_candidate)
 and (p_filter='all' or status not in ('closed','declined')) and (p_filter<>'overdue' or due_date<current_date);
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (
  select r.id,r.candidate_id as "candidateId",r.anthro_id as "anthroId",left(c.name,300) as "candidateName",c."mergedInto",r.kind,r.status,left(r.summary,180) summary,r.assignee,r.due_date as "dueDate",r.version,r.created_at as "createdAt"
  from ecod_private.subject_requests r join public.candidates c on c.id=r.candidate_id and c.workspace_id=r.workspace_id
  where r.workspace_id=ws and (p_candidate is null or r.candidate_id=p_candidate) and (p_filter='all' or r.status not in ('closed','declined')) and (p_filter<>'overdue' or r.due_date<current_date)
  order by r.due_date nulls last,r.created_at desc,r.id limit 50 offset p_offset
 )q;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into admins from (select m.user_id id,coalesce(nullif(u.email,''),'Workspace administrator') label from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=ws and m.role='admin' order by u.email,m.user_id limit 100)q;
 return jsonb_build_object('rows',rows,'total',total,'overdue',overdue,'admins',admins);
end $$;
create or replace function public.api_subject_request_detail(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;events jsonb;total integer;
begin
 if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid history page';end if;
 select * into r from ecod_private.subject_requests where workspace_id=ws and id=p_id;
 if not found then raise exception 'Request case not found' using errcode='42501';end if;
 select count(*) into total from ecod_private.subject_request_events where workspace_id=ws and case_id=p_id;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into events from (select id,actor,at,action,note,version,status,assignee,due_date as "dueDate" from ecod_private.subject_request_events where workspace_id=ws and case_id=p_id order by version desc,id desc limit 50 offset p_offset)q;
 return jsonb_build_object('case',jsonb_build_object('id',r.id,'candidateId',r.candidate_id,'anthroId',r.anthro_id,'kind',r.kind,'status',r.status,'summary',r.summary,'channel',r.channel,'assignee',r.assignee,'dueDate',r.due_date,'version',r.version,'verifiedAt',r.verified_at,'closedAt',r.closed_at),'events',events,'total',total);
end $$;
revoke all on function public.api_create_subject_request(uuid,uuid,text,text,text,date,uuid),public.api_update_subject_request(uuid,uuid,integer,text,text,date,uuid),public.api_subject_request_page(uuid,text,integer),public.api_subject_request_detail(uuid,integer) from public,anon,authenticated;
grant execute on function public.api_create_subject_request(uuid,uuid,text,text,text,date,uuid),public.api_update_subject_request(uuid,uuid,integer,text,text,date,uuid),public.api_subject_request_page(uuid,text,integer),public.api_subject_request_detail(uuid,integer) to authenticated;
commit;
