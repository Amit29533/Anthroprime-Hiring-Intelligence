-- N4: client-scoped memberships, immutable approved packs and client review ledger.
begin;
create schema if not exists ecod_client_private;
revoke all on schema ecod_client_private from public,anon,authenticated;
create table if not exists ecod_client_private.members (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,client_id uuid not null,user_id uuid not null references auth.users(id),
 expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),demand_id uuid,active boolean not null default true,created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 foreign key(workspace_id,client_id) references public.clients(workspace_id,id),foreign key(workspace_id,demand_id) references public.demands(workspace_id,id)
);
create unique index if not exists client_members_scope on ecod_client_private.members(workspace_id,client_id,user_id,coalesce(demand_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists ecod_client_private.packs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,client_id uuid not null,candidate_id uuid not null,demand_id uuid not null,submission_id uuid not null,
 version integer not null,content jsonb not null,source_hash text not null,created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 approved_at timestamptz,approved_by uuid,approval_reason text,revoked boolean not null default false,respond_by timestamptz,
 unique(workspace_id,id),unique(workspace_id,submission_id,version),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id),foreign key(workspace_id,demand_id) references public.demands(workspace_id,id),
 foreign key(workspace_id,submission_id) references public.submissions(workspace_id,id)
);
create index if not exists client_packs_page on ecod_client_private.packs(workspace_id,client_id,created_at desc,id);
create table if not exists ecod_client_private.feedback (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,candidate_id uuid not null,pack_id uuid not null,actor uuid not null,
 kind text not null,decision text,rating integer,comment text not null,proposed_at timestamptz,at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,pack_id) references ecod_client_private.packs(workspace_id,id)
);
create index if not exists client_feedback_pack on ecod_client_private.feedback(workspace_id,pack_id,at desc);
create table if not exists ecod_client_private.receipts (
 workspace_id uuid not null,actor uuid not null,operation_id uuid not null,candidate_id uuid,request_hash text not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,operation_id)
);
do $$declare tbl text;begin foreach tbl in array array['members','packs','feedback','receipts'] loop
 execute format('alter table ecod_client_private.%I enable row level security',tbl);
 execute format('revoke all on ecod_client_private.%I from public,anon,authenticated',tbl);end loop;end $$;

create table if not exists ecod_client_private.read_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,client_id uuid not null,actor uuid not null,pack_ids uuid[] not null,at timestamptz not null default clock_timestamp());
create index if not exists client_read_events_client on ecod_client_private.read_events(workspace_id,client_id,at desc);
alter table ecod_client_private.read_events enable row level security;
revoke all on ecod_client_private.read_events from public,anon,authenticated;

create or replace function ecod_client_private.source(ws uuid,submission uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.submissions;c public.candidates;d public.demands;consent public.consents;offers jsonb;fingerprint text;
begin
 select * into s from public.submissions where workspace_id=ws and id=submission;
 select * into c from public.candidates where workspace_id=ws and id=s."candidateId" and "mergedInto" is null;
 select * into d from public.demands where workspace_id=ws and id=s."demandId";
 if s.id is null or c.id is null or d.id is null or d."clientId" is null then raise exception 'Submission needs a current candidate and linked client demand';end if;
 select * into consent from public.consents where workspace_id=ws and "candidateId"=c.id and purpose='profile-sharing' order by date desc,(status<>'granted') desc,id desc limit 1;
 if consent.status is distinct from 'granted' or consent.date>clock_timestamp() or c."processingRestricted" then raise exception 'Current profile-sharing consent and an unrestricted candidate are required';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into offers from(select * from public.offers where workspace_id=ws and "candidateId"=c.id and "demandId"=d.id order by id limit 201)x;
 if jsonb_array_length(offers)>200 or octet_length(jsonb_build_array(to_jsonb(c),to_jsonb(d),offers)::text)>1048576 then raise exception 'Submission source exceeds its safe review limit';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(to_jsonb(c),to_jsonb(d),to_jsonb(consent),offers,
  jsonb_build_array(s."candidateId",s."demandId",s.notes,s.method,s."clientContact",s."submittedOn"))::text,'UTF8')),'hex');
 return jsonb_build_object('hash',fingerprint,'clientId',d."clientId",'candidateId',c.id,'demandId',d.id,'content',
  jsonb_build_object('anthroId',c."anthroId",'name',left(c.name,200),'title',left(c.title,200),'location',left(c.location,200),
   'relevantExperience',c."relevantExperience",'skills',to_jsonb(c.skills[1:60]),'profileStatus',c.status,'profileVerified',c.verified,
   'demandTitle',left(d.title,200),'demandMode',d.mode));
end $$;
create or replace function ecod_client_private.is_current(p ecod_client_private.packs) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 if p.revoked or p.approved_at is null then return false;end if;
 return p.source_hash=(ecod_client_private.source(p.workspace_id,p.submission_id)->>'hash');
exception when raise_exception then return false;
end $$;

create or replace function ecod_client_private.admin_read(p_client uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();packs jsonb;feedback jsonb;members jsonb;submissions jsonb;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid client review page';end if;
 if not exists(select 1 from public.clients where workspace_id=ws and id=p_client) then raise exception 'Client not found';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id),'[]') into packs from
  (select p.id,p.submission_id,p.version,p.content,p.created_at,p.approved_at,p.respond_by,p.revoked,
   case when p.revoked then 'Revoked' when p.approved_at is null then 'Draft' when ecod_client_private.is_current(p) then 'Approved' else 'Needs approval' end as state,
   case when p.approved_at is not null and not exists(select 1 from ecod_client_private.feedback f where f.pack_id=p.id) then greatest(0,extract(day from(clock_timestamp()-p.approved_at)))::integer end as "feedbackAgeDays"
   from ecod_client_private.packs p where workspace_id=ws and client_id=p_client order by created_at desc,id limit 21 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by at desc),'[]') into feedback from
  (select f.id,f.pack_id,p.version,p.content->>'name' as "candidateName",p.content->>'demandTitle' as "demandTitle",f.kind,f.decision,f.rating,f.comment,f.proposed_at,f.at from ecod_client_private.feedback f join ecod_client_private.packs p on p.id=f.pack_id and p.workspace_id=f.workspace_id where p.workspace_id=ws and p.client_id=p_client order by at desc limit 50)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into submissions from
  (select s.id,c.name,d.title from public.submissions s join public.demands d on d.workspace_id=s.workspace_id and d.id=s."demandId" join public.candidates c on c.workspace_id=s.workspace_id and c.id=s."candidateId" where d.workspace_id=ws and d."clientId"=p_client and c."mergedInto" is null order by s.created desc,s.id limit 50)x;
 members:='[]';
 if public.is_admin() then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into members from(select id,user_id,demand_id,active,expires_at from ecod_client_private.members where workspace_id=ws and client_id=p_client order by created_at desc limit 50)x;end if;
 if octet_length(jsonb_build_array(packs,feedback,submissions,members)::text)>1048576 then raise exception 'Client review page exceeds its safe limit';end if;
 return jsonb_build_object('packs',case when jsonb_array_length(packs)>20 then packs-20 else packs end,'more',jsonb_array_length(packs)>20,'feedback',feedback,'members',members,'submissions',submissions);
end $$;

create or replace function ecod_client_private.admin_change(p_client uuid,p_operation uuid,p_action text,p_id uuid,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();actor_id uuid:=auth.uid();req text;receipt ecod_client_private.receipts;pack ecod_client_private.packs;sub public.submissions;ctx jsonb;result jsonb;person uuid;target uuid;demand uuid;member uuid;
begin
 if actor_id is null or ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501';end if;
 if p_operation is null or p_action is null or p_action not in ('prepare','approve','revoke','grant','remove') or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>4000 then raise exception 'Invalid client review action';end if;
 if exists(select 1 from jsonb_each(p_details) where key<>all(array['reason','userId','demandId'])) then raise exception 'Unknown client review detail';end if;
 if p_action in ('approve','grant','remove') then if not public.is_admin() then raise exception 'Administrator approval required';end if;perform ecod_private.require_privileged_mfa(ws);end if;
 perform 1 from public.clients where workspace_id=ws and id=p_client for update;
 if not found then raise exception 'Client not found';end if;
 req:=encode(sha256(convert_to(jsonb_build_array(p_client,p_action,p_id,p_details)::text,'UTF8')),'hex');
 select * into receipt from ecod_client_private.receipts where workspace_id=ws and actor=actor_id and operation_id=p_operation;
 if found then if receipt.request_hash<>req then raise exception 'Client operation conflict' using errcode='40001';end if;return receipt.result||jsonb_build_object('replayed',true);end if;
 if p_action='grant' then
  target:=(p_details->>'userId')::uuid;demand:=nullif(p_details->>'demandId','')::uuid;
  perform 1 from auth.users where id=target for update;
  if target is null or not exists(select 1 from auth.users where id=target) or exists(select 1 from public.memberships where user_id=target) then raise exception 'Use a provisioned external client account without workspace membership';end if;
  if demand is not null and not exists(select 1 from public.demands where id=demand and workspace_id=ws and "clientId"=p_client) then raise exception 'Demand does not belong to this client';end if;
  update ecod_client_private.members set active=true,expires_at=clock_timestamp()+interval '30 days' where workspace_id=ws and client_id=p_client and user_id=target and demand_id is not distinct from demand returning id into member;
  if not found then
   if (select count(*) from ecod_client_private.members where workspace_id=ws and client_id=p_client)>=50 then raise exception 'Client membership limit reached; renew an existing scope';end if;
   insert into ecod_client_private.members(workspace_id,client_id,user_id,demand_id,created_by) values(ws,p_client,target,demand,actor_id) returning id into member;end if;
  result:=jsonb_build_object('id',member);
 elsif p_action='remove' then
  update ecod_client_private.members set active=false where workspace_id=ws and client_id=p_client and id=p_id returning id into member;
  if not found then raise exception 'Client membership not found';end if;result:=jsonb_build_object('id',member);
 else
  if p_action='prepare' then select * into sub from public.submissions where workspace_id=ws and id=p_id;
  else select * into pack from ecod_client_private.packs where workspace_id=ws and client_id=p_client and id=p_id;
   select * into sub from public.submissions where workspace_id=ws and id=pack.submission_id;
  end if;
  if sub.id is null then raise exception 'Submission not found';end if;
  person:=sub."candidateId";
  perform 1 from public.candidates where workspace_id=ws and id=person for update;
  perform 1 from public.submissions where workspace_id=ws and id=sub.id for update;
  select * into sub from public.submissions where workspace_id=ws and id=sub.id;
  if sub.id is null or sub."candidateId" is distinct from person then raise exception 'Submission identity changed; refresh and review again' using errcode='40001';end if;
  perform 1 from public.demands where workspace_id=ws and id=sub."demandId" for share;
  if p_action='revoke' then update ecod_client_private.packs set revoked=true where id=pack.id;result:=jsonb_build_object('id',pack.id);
  else
   ctx:=ecod_client_private.source(ws,sub.id);
   if (ctx->>'clientId')::uuid<>p_client then raise exception 'Submission belongs to another client';end if;
   if p_action='prepare' then
    if (select count(*) from ecod_client_private.packs where workspace_id=ws and submission_id=sub.id)>=100 then raise exception 'Submission version limit reached';end if;
    insert into ecod_client_private.packs(workspace_id,client_id,candidate_id,demand_id,submission_id,version,content,source_hash,created_by)
     select ws,p_client,person,sub."demandId",sub.id,coalesce(max(version),0)+1,ctx->'content',ctx->>'hash',actor_id from ecod_client_private.packs where workspace_id=ws and submission_id=sub.id returning * into pack;
   else
    if pack.revoked or pack.approved_at is not null or pack.source_hash<>ctx->>'hash' then raise exception 'Draft changed or unavailable. Prepare and review a new version.' using errcode='40001';end if;
    if coalesce(length(btrim(p_details->>'reason')),0) not between 10 and 2000 then raise exception 'Approval needs 10–2000 characters of review evidence';end if;
    update ecod_client_private.packs set revoked=true where workspace_id=ws and submission_id=sub.id and approved_at is not null and not revoked;
    update ecod_client_private.packs set approved_at=clock_timestamp(),approved_by=actor_id,approval_reason=btrim(p_details->>'reason'),respond_by=clock_timestamp()+interval '7 days' where id=pack.id;
   end if;
   result:=jsonb_build_object('id',pack.id,'version',pack.version);
  end if;
 end if;
 insert into ecod_client_private.receipts(workspace_id,actor,operation_id,candidate_id,request_hash,result) values(ws,actor_id,p_operation,person,req,result);
 return result||jsonb_build_object('replayed',false);
end $$;

create or replace function ecod_client_private.portal_clients() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Client sign-in required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select distinct c.id,left(c.name,200) name from ecod_client_private.members m join public.clients c on c.id=m.client_id and c.workspace_id=m.workspace_id where m.user_id=auth.uid() and m.active and m.expires_at>clock_timestamp() order by c.id limit 50)x);
end $$;
create or replace function ecod_client_private.portal_read(p_client uuid,p_offset integer,p_demands_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid;packs jsonb;demands jsonb;
begin
 if auth.uid() is null then raise exception 'Client sign-in required' using errcode='42501';end if;
 select workspace_id into ws from ecod_client_private.members where client_id=p_client and user_id=auth.uid() and active and expires_at>clock_timestamp() limit 1;
 if ws is null then raise exception 'Client access unavailable' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 or p_demands_offset is null or p_demands_offset not between 0 and 10000 then raise exception 'Invalid client page';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by approved_at desc,id),'[]') into packs from
  (select p.id,p.version,p.content,p.approved_at,p.respond_by from ecod_client_private.packs p
   where p.workspace_id=ws and p.client_id=p_client and ecod_client_private.is_current(p)
    and exists(select 1 from ecod_client_private.members m where m.workspace_id=ws and m.client_id=p_client and m.user_id=auth.uid() and m.active and m.expires_at>clock_timestamp() and (m.demand_id is null or m.demand_id=p.demand_id))
   order by approved_at desc,id limit 21 offset p_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into demands from
  (select d.id,left(d.title,200) title,d.status,d.positions,d.target,
   (select count(*) from public.placements pl where pl.workspace_id=ws and pl."demandId"=d.id and pl.status='Active') as "activePlacements"
   from public.demands d where workspace_id=ws and "clientId"=p_client and "approvalStatus"='Approved' and exists(select 1 from ecod_client_private.members m where m.workspace_id=ws and m.client_id=p_client and m.user_id=auth.uid() and m.active and m.expires_at>clock_timestamp() and (m.demand_id is null or m.demand_id=d.id)) order by id limit 21 offset p_demands_offset)x;
 if octet_length(jsonb_build_array(packs,demands)::text)>1048576 then raise exception 'Client page exceeds its safe limit';end if;
 insert into ecod_client_private.read_events(workspace_id,client_id,actor,pack_ids) values(ws,p_client,auth.uid(),array(select (x->>'id')::uuid from jsonb_array_elements(case when jsonb_array_length(packs)>20 then packs-20 else packs end)x));
 return jsonb_build_object('packs',case when jsonb_array_length(packs)>20 then packs-20 else packs end,'more',jsonb_array_length(packs)>20,'demands',case when jsonb_array_length(demands)>20 then demands-20 else demands end,'demandsMore',jsonb_array_length(demands)>20);
end $$;

create or replace function ecod_client_private.respond(p_pack uuid,p_operation uuid,p_kind text,p_decision text,p_rating integer,p_comment text,p_proposed timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pack ecod_client_private.packs;req text;receipt ecod_client_private.receipts;result jsonb;fid uuid;
begin
 if auth.uid() is null then raise exception 'Client sign-in required' using errcode='42501';end if;
 select * into pack from ecod_client_private.packs where id=p_pack;
 if pack.id is null or not exists(select 1 from ecod_client_private.members m where m.workspace_id=pack.workspace_id and m.client_id=pack.client_id and m.user_id=auth.uid() and m.active and m.expires_at>clock_timestamp() and (m.demand_id is null or m.demand_id=pack.demand_id)) then raise exception 'Client share unavailable' using errcode='42501';end if;
 perform 1 from ecod_client_private.members m where m.workspace_id=pack.workspace_id and m.client_id=pack.client_id and m.user_id=auth.uid() and m.active and m.expires_at>clock_timestamp() and (m.demand_id is null or m.demand_id=pack.demand_id) for share;
 if not found then raise exception 'Client share unavailable' using errcode='42501';end if;
 perform 1 from public.candidates where workspace_id=pack.workspace_id and id=pack.candidate_id for share;
 perform 1 from public.submissions where workspace_id=pack.workspace_id and id=pack.submission_id for share;
 perform 1 from public.demands where workspace_id=pack.workspace_id and id=pack.demand_id for share;
 perform 1 from ecod_client_private.packs where id=pack.id for update;
 select * into pack from ecod_client_private.packs where id=p_pack;
 if not ecod_client_private.is_current(pack) then raise exception 'Share changed or revoked; refresh the shortlist';end if;
 if p_operation is null or p_kind is null or p_kind not in ('comment','decision','interview') or coalesce(length(btrim(p_comment)),0) not between 10 and 2000 or octet_length(p_comment)>8000
  or (p_rating is not null and p_rating not between 1 and 5) or (p_kind='decision' and (p_decision is null or p_decision not in ('Shortlisted','Rejected','Hold')))
  or (p_kind<>'decision' and p_decision is not null) or (p_kind='interview' and (p_proposed is null or p_proposed>clock_timestamp()+interval '90 days'))
  or (p_kind<>'interview' and p_proposed is not null) then raise exception 'Invalid feedback or interview request';end if;
 req:=encode(sha256(convert_to(jsonb_build_array(p_pack,p_kind,p_decision,p_rating,btrim(p_comment),p_proposed)::text,'UTF8')),'hex');
 select * into receipt from ecod_client_private.receipts where workspace_id=pack.workspace_id and actor=auth.uid() and operation_id=p_operation;
 if found then if receipt.request_hash<>req then raise exception 'Client operation conflict' using errcode='40001';end if;return receipt.result||jsonb_build_object('replayed',true);end if;
 if p_kind='interview' and p_proposed<clock_timestamp() then raise exception 'Proposed interview time has passed';end if;
 if (select count(*) from ecod_client_private.feedback where pack_id=pack.id)>=200 then raise exception 'Feedback limit reached; use approved manual review';end if;
 insert into ecod_client_private.feedback(workspace_id,candidate_id,pack_id,actor,kind,decision,rating,comment,proposed_at)
 values(pack.workspace_id,pack.candidate_id,pack.id,auth.uid(),p_kind,p_decision,p_rating,btrim(p_comment),p_proposed) returning id into fid;
 result:=jsonb_build_object('id',fid);
 insert into ecod_client_private.receipts values(pack.workspace_id,auth.uid(),p_operation,pack.candidate_id,req,result,clock_timestamp());
 return result||jsonb_build_object('replayed',false);
end $$;

create or replace function public.api_client_review(p_client uuid,p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$select ecod_client_private.admin_read(p_client,p_offset)$$;
create or replace function public.api_change_client_review(p_client uuid,p_operation uuid,p_action text,p_id uuid,p_details jsonb) returns jsonb language sql security invoker set search_path='' as $$select ecod_client_private.admin_change(p_client,p_operation,p_action,p_id,p_details)$$;
create or replace function public.api_client_portal_clients() returns jsonb language sql security invoker set search_path='' as $$select ecod_client_private.portal_clients()$$;
create or replace function public.api_client_portal(p_client uuid,p_offset integer default 0,p_demands_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$select ecod_client_private.portal_read(p_client,p_offset,p_demands_offset)$$;
create or replace function public.api_client_respond(p_pack uuid,p_operation uuid,p_kind text,p_decision text,p_rating integer,p_comment text,p_proposed timestamptz) returns jsonb language sql security invoker set search_path='' as $$select ecod_client_private.respond(p_pack,p_operation,p_kind,p_decision,p_rating,p_comment,p_proposed)$$;
revoke all on all functions in schema ecod_client_private from public,anon,authenticated;
revoke all on function public.api_client_review(uuid,integer),public.api_change_client_review(uuid,uuid,text,uuid,jsonb),public.api_client_portal_clients(),public.api_client_portal(uuid,integer,integer),public.api_client_respond(uuid,uuid,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant usage on schema ecod_client_private to authenticated;
grant execute on function ecod_client_private.admin_read(uuid,integer),ecod_client_private.admin_change(uuid,uuid,text,uuid,jsonb),ecod_client_private.portal_clients(),ecod_client_private.portal_read(uuid,integer,integer),ecod_client_private.respond(uuid,uuid,text,text,integer,text,timestamptz),public.api_client_review(uuid,integer),public.api_change_client_review(uuid,uuid,text,uuid,jsonb),public.api_client_portal_clients(),public.api_client_portal(uuid,integer,integer),public.api_client_respond(uuid,uuid,text,text,integer,text,timestamptz) to authenticated;
-- Serialize sharing consent and offer changes against client approval/response source checks.
create or replace function ecod_client_private.source_write_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb;after_row jsonb;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new);end if;
 perform 1 from public.candidates c where
  (c.workspace_id=(before_row->>'workspace_id')::uuid and c.id=(before_row->>'candidateId')::uuid)
  or (c.workspace_id=(after_row->>'workspace_id')::uuid and c.id=(after_row->>'candidateId')::uuid)
  order by c.workspace_id,c.id for no key update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_client_private.source_write_guard() from public,anon,authenticated;
drop trigger if exists client_share_source_guard on public.consents;
create trigger client_share_source_guard before insert or update or delete on public.consents for each row execute function ecod_client_private.source_write_guard();
drop trigger if exists client_share_source_guard on public.offers;
create trigger client_share_source_guard before insert or update or delete on public.offers for each row execute function ecod_client_private.source_write_guard();
create or replace function ecod_client_private.guard_internal_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=new.user_id for update;
 if exists(select 1 from ecod_client_private.members where user_id=new.user_id and active and expires_at>clock_timestamp()) then
  raise exception 'Revoke active client access before granting internal workspace membership' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function ecod_client_private.guard_internal_membership() from public,anon,authenticated;
drop trigger if exists client_account_boundary on public.memberships;
create trigger client_account_boundary before insert or update on public.memberships for each row execute function ecod_client_private.guard_internal_membership();
commit;
