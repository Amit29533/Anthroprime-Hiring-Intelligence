begin;
create schema if not exists ecod_enterprise_private;
revoke all on schema ecod_enterprise_private from public,anon,authenticated;
create table if not exists ecod_enterprise_private.policies(workspace_id uuid references public.workspaces(id),kind text check(kind in('sso','fulfillment')),generation integer not null default 1,state text not null default 'configured',body jsonb not null,accepted_at timestamptz,primary key(workspace_id,kind));
create unique index if not exists enterprise_provider_unique on ecod_enterprise_private.policies((body->>'provider'))where kind='sso';
create table if not exists ecod_enterprise_private.members(workspace_id uuid not null,user_id uuid not null,provider uuid,revoked boolean not null default false,reason text not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,user_id));
create table if not exists ecod_enterprise_private.plans(id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,case_id uuid not null,generation integer not null,actor uuid not null,source jsonb not null,status text not null default 'Prepared',approved_by uuid,approved_at timestamptz,at timestamptz not null default clock_timestamp(),foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id),foreign key(workspace_id,case_id)references ecod_private.subject_requests(workspace_id,id));
create table if not exists ecod_enterprise_private.decisions(id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,plan_id uuid references ecod_enterprise_private.plans(id),area text not null,outcome text not null,evidence text not null,actor uuid not null,at timestamptz not null default clock_timestamp());
create table if not exists ecod_enterprise_private.receipts(workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid,request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
create index if not exists enterprise_plans_page on ecod_enterprise_private.plans(workspace_id,at desc,id);
create index if not exists enterprise_decisions_plan on ecod_enterprise_private.decisions(workspace_id,plan_id,area,at desc,id);
create index if not exists enterprise_receipts_candidate on ecod_enterprise_private.receipts(workspace_id,candidate_id);
do $$declare n text;begin foreach n in array array['policies','members','plans','decisions','receipts']loop execute format('alter table ecod_enterprise_private.%I enable row level security',n);execute format('revoke all on ecod_enterprise_private.%I from public,anon,authenticated',n);execute format('drop trigger if exists stage2_recovery_lockdown on ecod_enterprise_private.%I',n);execute format('create trigger stage2_recovery_lockdown before insert or update or delete on ecod_enterprise_private.%I for each row execute function ecod_processing_private.guard_lockdown()',n);execute format('drop trigger if exists stage2_recovery_truncate on ecod_enterprise_private.%I',n);execute format('create trigger stage2_recovery_truncate before truncate on ecod_enterprise_private.%I for each statement execute function ecod_processing_private.guard_lockdown()',n);end loop;end$$;
-- Copy the pre-Stage-5 inventory: approval/reconciliation journals must not invalidate their own source.
do $$declare d text;begin if to_regprocedure('ecod_enterprise_private.base_inventory(uuid,uuid)')is null then d:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);d:=replace(d,'ecod_private.erasure_inventory','ecod_enterprise_private.base_inventory');execute d;end if;end$$;
create or replace function ecod_enterprise_private.ready(ws uuid,k text)returns boolean language sql stable security invoker set search_path=''as $$select coalesce((select p.state='enabled'and p.accepted_at>statement_timestamp()-interval'30 days'and exists(select 1 from public.memberships where workspace_id=ws and user_id=(p.body->>'owner')::uuid and role='admin')and not(select paused from ecod_processing_private.lockdown)from ecod_enterprise_private.policies p where workspace_id=ws and kind=k),false)$$;
create or replace function ecod_enterprise_private.member_ok(ws uuid,u uuid,check_session boolean default false)returns boolean language plpgsql stable security definer set search_path=''as $$declare m ecod_enterprise_private.members;matched_ok boolean;begin
 select *into m from ecod_enterprise_private.members where workspace_id=ws and user_id=u;
 if m.revoked then return false;end if;
 if m.provider is null then return true;end if;
 if not ecod_enterprise_private.ready(ws,'sso')or not exists(select 1 from ecod_enterprise_private.policies where workspace_id=ws and kind='sso'and body->>'provider'=m.provider::text)then return false;end if;
 if to_regclass('auth.identities')is null or to_regclass('auth.sso_providers')is null then return false;end if;execute 'select exists(select 1 from auth.identities i join auth.sso_providers sp on sp.id=$3 where i.user_id=$1 and i.provider=$2)'into matched_ok using u,'sso:'||m.provider::text,m.provider;if matched_ok is distinct from true then return false;end if;
 if check_session then return exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'))x where x->>'method'='sso/saml'and x->>'provider'=m.provider::text);end if;return true;
end$$;
-- Preserve workspace selection and limited-role semantics, adding current managed-SSO authority.
do $$declare d text;begin if to_regprocedure('ecod_enterprise_private.selected_workspace_core()')is null then d:=pg_get_functiondef('ecod_access_private.selected_workspace()'::regprocedure);execute replace(d,'ecod_access_private.selected_workspace','ecod_enterprise_private.selected_workspace_core');end if;end$$;
create or replace function ecod_access_private.selected_workspace()returns uuid language sql stable security definer set search_path=''as $$select ecod_enterprise_private.selected_workspace_core()where ecod_enterprise_private.member_ok(ecod_enterprise_private.selected_workspace_core(),auth.uid(),true)$$;
create or replace function public.can_edit_workspace(target uuid)returns boolean language sql stable security definer set search_path=''as $$select ecod_enterprise_private.member_ok(target,auth.uid(),true)and exists(select 1 from public.memberships where user_id=auth.uid()and workspace_id=target and role in('admin','recruiter'))$$;
create or replace function ecod_enterprise_private.membership_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from ecod_enterprise_private.members where workspace_id=new.workspace_id and user_id=new.user_id and revoked)then raise exception 'Offboarded membership requires explicit reviewed reactivation';end if;
 if coalesce((select(to_jsonb(u)->>'is_sso_user')::boolean from auth.users u where id=new.user_id),false)and current_setting('ecod.enterprise_grant',true)is distinct from'on'then raise exception 'SSO accounts require an explicit UUID workspace grant';end if;return new;end$$;
drop trigger if exists enterprise_membership_guard on public.memberships;
create trigger enterprise_membership_guard before insert or update on public.memberships for each row execute function ecod_enterprise_private.membership_guard();
-- SSO identities never inherit an email invitation. Auth owns SAML verification; user_metadata is unused.
do $$declare d text;begin d:=pg_get_functiondef('public.accept_workspace_invites_for(uuid,text)'::regprocedure);if strpos(d,'is_sso_user')=0 then d:=replace(d,'  if p_user is null','  if coalesce((select(to_jsonb(u)->>''is_sso_user'')::boolean from auth.users u where id=p_user),false)then return 0;end if; if p_user is null');execute d;end if;end$$;
create or replace function ecod_enterprise_private.policy_head(q ecod_enterprise_private.policies)returns text language sql stable security invoker set search_path=''as $$select ecod_journey_private.token(q.workspace_id,jsonb_build_array(q.generation,q.state,q.body,q.accepted_at))$$;
create or replace function ecod_enterprise_private.plan_head(q ecod_enterprise_private.plans)returns text language sql stable security invoker set search_path=''as $$select ecod_journey_private.token(q.workspace_id,to_jsonb(q)||(select coalesce(jsonb_agg(to_jsonb(d)order by at,id),'[]')from ecod_enterprise_private.decisions d where plan_id=q.id))$$;
create or replace function ecod_enterprise_private.scope(ws uuid,cid uuid)returns jsonb language plpgsql security invoker set search_path=''as $$declare r ecod_private.subject_requests;p ecod_enterprise_private.policies;inv jsonb;holds jsonb;family uuid[];s jsonb;begin
 select *into r from ecod_private.subject_requests where workspace_id=ws and id=cid for update;
 if r.id is null or r.kind not in('erasure','retention_review')or r.verified_at is null or r.status not in('verified','in_review','awaiting_action')then raise exception 'Current verified erasure or retention case required';end if;
 select *into p from ecod_enterprise_private.policies where workspace_id=ws and kind='fulfillment';
 if not ecod_enterprise_private.ready(ws,'fulfillment')then raise exception 'Current accepted fulfillment policy required';end if;
 inv:=ecod_enterprise_private.base_inventory(ws,r.candidate_id);family:=ecod_access_private.identity_family(ws,r.candidate_id);
 select coalesce(jsonb_agg(jsonb_build_object('document',d.id,'decision',x.decision)order by d.id),'[]')into holds from public.documents d join lateral(select decision from ecod_private.document_retention_reviews where workspace_id=ws and document_id=d.id order by reviewed_at desc,id desc limit 1)x on x.decision='hold'where d.workspace_id=ws and d."candidateId"=any(family);
 s:=jsonb_build_object('case',r.id,'caseVersion',r.version,'verifiedAt',r.verified_at,'candidate',r.candidate_id,'inventory',inv,'documentHolds',holds,'processingHold',exists(select 1 from public.candidates where workspace_id=ws and id=any(family)and "processingRestricted"),'policyGeneration',p.generation,'policy',p.body,'destructiveExecution',false,'manualAreas',jsonb_build_array('objects','external','backups','unlinked'));
 return s||jsonb_build_object('head',ecod_journey_private.token(ws,s));end$$;
create or replace function ecod_enterprise_private.api(a text,op uuid,h text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_ops_private.admin();q ecod_enterprise_private.policies;w ecod_enterprise_private.plans;prior ecod_enterprise_private.receipts;req jsonb;r jsonb;rows jsonb;s jsonb;k text:=p->>'kind';cid uuid;u uuid;family uuid[];provider_id uuid;matched_ok boolean;entry record;outcome text;area text;
begin
 if a is null or p is null or jsonb_typeof(p)<>'object'or octet_length(p::text)>12000 or off is null or off not between 0 and 10000 then raise exception 'Bounded enterprise request required';end if;
 if a='context'then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select kind,generation,state,body,accepted_at,ecod_enterprise_private.policy_head(t)head from ecod_enterprise_private.policies t where workspace_id=ws order by kind)x;
 return jsonb_build_object('actor',auth.uid(),'policies',rows,'defaultHead',ecod_journey_private.token(ws,'null'::jsonb),'paused',(select paused from ecod_processing_private.lockdown),'destructiveExecution',false);
 elsif a='members'then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select m.user_id,m.role,left(u.email,254)email,e.provider,coalesce(e.revoked,false)revoked from public.memberships m join auth.users u on u.id=m.user_id left join ecod_enterprise_private.members e on e.workspace_id=m.workspace_id and e.user_id=m.user_id where m.workspace_id=ws order by m.user_id limit 26 offset off)x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'offset',off);
 elsif a='access-history'then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select actor,id,request->>'action'action,request->'payload'body,result,at from ecod_enterprise_private.receipts where workspace_id=ws and request->>'action'in('grant','offboard','offboard-report')order by at desc,id limit 26 offset off)x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='cases'then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select id,candidate_id,kind,status,verified_at,version from ecod_private.subject_requests where workspace_id=ws and kind in('erasure','retention_review')and status not in('closed','declined')order by created_at desc,id limit 26 offset off)x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='preview'then return ecod_enterprise_private.scope(ws,(p->>'case')::uuid);
 elsif a='browse'then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select t.*,ecod_enterprise_private.plan_head(t)head from ecod_enterprise_private.plans t where workspace_id=ws order by at desc,id limit 26 offset off)x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='detail'then
 select *into w from ecod_enterprise_private.plans where workspace_id=ws and id=(p->>'id')::uuid;if w.id is null then raise exception 'Plan unavailable';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select *from ecod_enterprise_private.decisions where workspace_id=ws and plan_id=w.id order by at desc,id limit 26 offset off)x;
 return jsonb_build_object('plan',to_jsonb(w),'head',ecod_enterprise_private.plan_head(w),'rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='dashboard'then
 return jsonb_build_object('capturedAt',clock_timestamp(),'paused',(select paused from ecod_processing_private.lockdown),'plans',(select coalesce(jsonb_object_agg(status,n),'{}')from(select status,count(*)n from ecod_enterprise_private.plans where workspace_id=ws group by status)x),'delivery',(select coalesce(jsonb_object_agg(status,n),'{}')from(select status,count(*)n from ecod_delivery_private.intents where workspace_id=ws group by status)x),'google',(select coalesce(jsonb_object_agg(status,n),'{}')from(select status,count(*)n from ecod_collaboration_private.work where workspace_id=ws group by status)x),'controlled',(select coalesce(jsonb_object_agg(status,n),'{}')from(select status,count(*)n from ecod_external_private.work where workspace_id=ws group by status)x),'cases',(select count(*)from ecod_private.subject_requests where workspace_id=ws and status not in('closed','declined')),'restoreEvidence',(select max(at)from ecod_processing_private.evidence where workspace_id=ws and component='restore'and status='passed'),'notice','Recorded outcomes only; no provider reachability or complete fulfillment is inferred');
 end if;
 if op is null or h is null then raise exception 'Exact operation and review head required';end if;
 req:=jsonb_build_object('action',a,'head',h,'payload',p);perform pg_advisory_xact_lock(hashtextextended(ws::text||op::text,0));select *into prior from ecod_enterprise_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;if found then if prior.request<>req then raise exception 'Operation conflict';end if;return prior.result;end if;
 perform 1 from public.workspaces where id=ws for update;
 if a in('configure','accept','enable','pause','revoke')then
 if k not in('sso','fulfillment')or k is null then raise exception 'Known enterprise capability required';end if;
 select *into q from ecod_enterprise_private.policies where workspace_id=ws and policies.kind=k for update;
 if h is distinct from (case when q.workspace_id is null then ecod_journey_private.token(ws,'null'::jsonb)else ecod_enterprise_private.policy_head(q)end)then raise exception 'Policy changed; refresh'using errcode='40001';end if;
 if a='configure'then
 if not(p ?& array['kind','owner','purpose','rights','entitlement','recovery','basis'])or exists(select 1 from jsonb_each(p)x where jsonb_typeof(value)<>'string')or exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','owner','purpose','rights','entitlement','recovery','basis','provider','retentionDays']))or exists(select 1 from unnest(array['purpose','rights','entitlement','recovery','basis'])f where length(btrim(p->>f))not between 20 and 1000)or not exists(select 1 from public.memberships where workspace_id=ws and user_id=(p->>'owner')::uuid and role='admin')then raise exception 'Administrator owner and purpose, entitlement, rights, recovery and basis evidence required';end if;
 if k='sso'then provider_id:=(p->>'provider')::uuid;if provider_id is null then raise exception 'Registered provider UUID required';end if;elsif coalesce(p->>'retentionDays','')!~'^[0-9]{1,5}$'or(p->>'retentionDays')::int not between 1 and 36500 then raise exception 'Approved retention interval required';end if;
 insert into ecod_enterprise_private.policies values(ws,k,coalesce(q.generation,0)+1,'configured',p,null)on conflict(workspace_id,kind)do update set generation=excluded.generation,state=excluded.state,body=excluded.body,accepted_at=null;
 elsif a='accept'then
 if q.state not in('configured','paused')then raise exception 'Configure current policy';end if;
 if not exists(select 1 from ecod_processing_private.policies z where z.workspace_id=ws and z.kind='recovery'and ecod_processing_private.fresh(ws,'recovery','restore',z.generation,interval'30 days')and ecod_processing_private.fresh(ws,'recovery','backup',z.generation,interval'30 days'))then raise exception 'Current matching recovery drill evidence required';end if;
 if k='sso'then
 if to_regclass('auth.sso_providers')is null then raise exception 'Registered native SSO provider unavailable';end if;
 execute 'select exists(select 1 from auth.sso_providers where id=$1)'into matched_ok using(q.body->>'provider')::uuid;if matched_ok is distinct from true then raise exception 'Registered native SSO provider required';end if;
 if not exists(select 1 from public.memberships m join auth.users authu on authu.id=m.user_id where m.workspace_id=ws and m.role='admin'and not coalesce((to_jsonb(authu)->>'is_sso_user')::boolean,false)and not exists(select 1 from ecod_enterprise_private.members e where e.workspace_id=ws and e.user_id=m.user_id and e.provider is not null))then raise exception 'Independent non-SSO administrator required';end if;end if;
 update ecod_enterprise_private.policies set state='accepted',accepted_at=clock_timestamp()where workspace_id=ws and policies.kind=k;
 elsif a='enable'then if q.state<>'accepted'or q.accepted_at<clock_timestamp()-interval'30 days'then raise exception 'Current acceptance required';end if;update ecod_enterprise_private.policies set state='enabled'where workspace_id=ws and policies.kind=k;
 else update ecod_enterprise_private.policies set state=case when a='pause'then'paused'else'revoked'end,accepted_at=null,generation=generation+1 where workspace_id=ws and policies.kind=k;end if;r:=jsonb_build_object('status','Policy recorded');
 elsif a in('grant','offboard','offboard-report')then
 u:=(p->>'user')::uuid;if u is null or u=auth.uid()or length(btrim(coalesce(p->>'reason','')))not between 20 and 1000 or exists(select 1 from jsonb_object_keys(p)x where x<>all(array['user','role','reason','idp','sessions','downloads']))then raise exception 'Other exact user UUID and review reason required';end if;
 if h is distinct from ecod_journey_private.token(ws,jsonb_build_array((select role from public.memberships where workspace_id=ws and user_id=u),(select to_jsonb(m)from ecod_enterprise_private.members m where workspace_id=ws and user_id=u),(select ecod_enterprise_private.policy_head(z)from ecod_enterprise_private.policies z where workspace_id=ws and kind='sso')))then raise exception 'Membership changed; refresh';end if;
 if a='offboard-report'then
 if not exists(select 1 from ecod_enterprise_private.members where workspace_id=ws and user_id=u and revoked)or not(p ?& array['idp','sessions','downloads'])or exists(select 1 from unnest(array['idp','sessions','downloads'])f where coalesce(p->>f,'')not in('unresolved','reported_revoked','retained'))then raise exception 'Revoked workspace user and explicit external limitations required';end if;
 elsif a='grant'then
 if not ecod_enterprise_private.ready(ws,'sso')or coalesce(p->>'role','')not in('recruiter','viewer','assessor','sales')then raise exception 'Enabled mapping and nonadministrator role required';end if;select(body->>'provider')::uuid into provider_id from ecod_enterprise_private.policies where workspace_id=ws and kind='sso';
 if to_regclass('auth.identities')is null then raise exception 'Verified Auth identity unavailable';end if;
 execute 'select exists(select 1 from auth.identities where user_id=$1 and provider=$2)'into matched_ok using u,'sso:'||provider_id::text;if matched_ok is distinct from true then raise exception 'Exact verified SAML identity required';end if;
 insert into ecod_enterprise_private.members values(ws,u,provider_id,false,p->>'reason',clock_timestamp())on conflict(workspace_id,user_id)do update set provider=excluded.provider,revoked=false,reason=excluded.reason,at=excluded.at;
 perform set_config('ecod.enterprise_grant','on',true);insert into public.memberships(user_id,workspace_id,role)values(u,ws,p->>'role')on conflict(user_id,workspace_id)do update set role=excluded.role;
 else
 if not exists(select 1 from public.memberships where workspace_id=ws and user_id=u)then raise exception 'Current workspace member required';end if;
 if(select role from public.memberships where workspace_id=ws and user_id=u)='admin'and(select count(*)from public.memberships where workspace_id=ws and role='admin')<=1 then raise exception 'Preserve last administrator';end if;
 delete from public.memberships where workspace_id=ws and user_id=u;
 insert into ecod_enterprise_private.members values(ws,u,null,true,p->>'reason',clock_timestamp())on conflict(workspace_id,user_id)do update set revoked=true,reason=excluded.reason,at=excluded.at;
 update ecod_access_private.assignments set revoked_at=clock_timestamp(),version=version+1 where workspace_id=ws and member_id=u and revoked_at is null;
 update ecod_collaboration_private.connections set state='revoked',generation=generation+1,accepted_at=null,credentials=null where workspace_id=ws and body->>'owner'=u::text;
 update ecod_collaboration_private.oauth_states set used=true where workspace_id=ws and actor=u;
 update ecod_collaboration_private.work set status='Suppressed',reason='Preparing actor offboarded'where workspace_id=ws and actor=u and status in('Queued','Deferred');
 update ecod_delivery_private.intents set status='Suppressed',reason='Preparing actor offboarded'where workspace_id=ws and actor=u and status in('Queued','Deferred');
 update ecod_external_private.work set status='Suppressed',reason='Preparing actor offboarded'where workspace_id=ws and actor=u and status='Queued';
 end if;r:=jsonb_build_object('status',case when a='grant'then'Explicit UUID grant recorded'when a='offboard-report'then'Human offboarding report retained; external revocation not verified'else'Workspace access revoked; IdP/global sessions require separate reconciliation'end);
 elsif a='member-head'then raise exception 'Use read action';
 elsif a='prepare'then
 s:=ecod_enterprise_private.scope(ws,(p->>'case')::uuid);if h is distinct from s->>'head'then raise exception 'Scope changed; preview again';end if;cid:=(s->>'candidate')::uuid;
 if exists(select 1 from ecod_enterprise_private.plans where workspace_id=ws and case_id=(p->>'case')::uuid and source->>'head'=h and status in('Prepared','Approved'))then raise exception 'Current scope already prepared';end if;
 insert into ecod_enterprise_private.plans(id,workspace_id,candidate_id,case_id,generation,actor,source)values(op,ws,cid,(p->>'case')::uuid,(s->>'policyGeneration')::int,auth.uid(),s);r:=jsonb_build_object('status','Prepared; destructive execution disabled','id',op);
 else
 select *into w from ecod_enterprise_private.plans where workspace_id=ws and id=(p->>'id')::uuid for update;if w.id is null then raise exception 'Plan unavailable';end if;cid:=w.candidate_id;if h is distinct from ecod_enterprise_private.plan_head(w)then raise exception 'Plan changed; refresh';end if;
 if a='cancel'and w.status in('Prepared','Approved')then update ecod_enterprise_private.plans set status='Cancelled'where id=w.id;r:=jsonb_build_object('status','Cancelled; no deletion');
 else
 perform 1 from public.candidates where workspace_id=ws and id=any(ecod_access_private.identity_family(ws,cid))order by id for update;
 s:=ecod_enterprise_private.scope(ws,w.case_id);if s->>'head'is distinct from w.source->>'head'then raise exception 'Source scope changed; prepare a new reviewed plan';end if;
 if a='approve'and w.status='Prepared'then
 if w.actor=auth.uid()then raise exception 'Independent administrator approval required';end if;if length(btrim(coalesce(p->>'evidence','')))not between 20 and 1000 then raise exception 'Approval evidence required';end if;
 update ecod_enterprise_private.plans set status='Approved',approved_by=auth.uid(),approved_at=clock_timestamp()where id=w.id;r:=jsonb_build_object('status','Exact scope approved; execution disabled');
 elsif a='record'and w.status='Approved'then
 area:=p->>'area';outcome:=p->>'outcome';
 if area is null or not(exists(select 1 from jsonb_array_elements(s->'inventory'->'counts')x where x->>'category'=area and(x->>'count')::int>0)or area in('objects','external','backups','unlinked'))or coalesce(outcome,'')not in('retained','excluded','reported_removed','unknown','not_applicable')or length(btrim(coalesce(p->>'evidence','')))not between 20 and 1000 then raise exception 'Scoped area, outcome and evidence required';end if;
 if outcome='reported_removed'and(area not in('objects','external')or s->'processingHold'='true'::jsonb or jsonb_array_length(s->'documentHolds')>0)then raise exception 'Held/local/backup copies cannot be reported removed';end if;
 if outcome='not_applicable'and area not in('objects','external','backups','unlinked')then raise exception 'Existing local records cannot be not applicable';end if;
 insert into ecod_enterprise_private.decisions values(op,ws,cid,w.id,area,outcome,p->>'evidence',auth.uid(),clock_timestamp());r:=jsonb_build_object('status','Human reconciliation recorded; no deletion or provider proof');
 elsif a='complete'and w.status='Approved'then
 if exists(select 1 from(select x->>'category'area from jsonb_array_elements(s->'inventory'->'counts')x where(x->>'count')::int>0 union select unnest(array['objects','external','backups','unlinked']))z where not exists(select 1 from ecod_enterprise_private.decisions d where d.plan_id=w.id and d.area=z.area))then raise exception 'Reconcile every populated area and external/object/backup/unlinked limitations';end if;
 update ecod_enterprise_private.plans set status='Reconciled with limitations'where id=w.id;r:=jsonb_build_object('status','Reconciled with limitations; no erasure fulfillment assertion');
 else raise exception 'Available reviewed enterprise action required';end if;end if;
 end if;
 insert into ecod_enterprise_private.receipts(workspace_id,actor,id,candidate_id,request,result)values(ws,auth.uid(),op,cid,req,r);return r;
end$$;
create or replace function public.api_enterprise_operations(p_action text,p_operation uuid default null,p_head text default null,p_payload jsonb default '{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_enterprise_private.api(p_action,p_operation,p_head,p_payload,p_offset)$$;
create or replace function ecod_enterprise_private.member_head(u uuid)returns text language plpgsql security definer set search_path=''as $$declare ws uuid:=ecod_ops_private.admin();begin return ecod_journey_private.token(ws,jsonb_build_array((select role from public.memberships where workspace_id=ws and user_id=u),(select to_jsonb(m)from ecod_enterprise_private.members m where workspace_id=ws and user_id=u),(select ecod_enterprise_private.policy_head(z)from ecod_enterprise_private.policies z where workspace_id=ws and kind='sso')));end$$;
create or replace function public.api_enterprise_member_head(p_user uuid)returns text language sql security invoker set search_path=''as $$select ecod_enterprise_private.member_head(p_user)$$;
revoke all on all functions in schema ecod_enterprise_private from public,anon,authenticated;
grant usage on schema ecod_enterprise_private to authenticated;
grant execute on function ecod_enterprise_private.api(text,uuid,text,jsonb,integer),ecod_enterprise_private.member_head(uuid)to authenticated;
revoke all on function public.api_enterprise_operations(text,uuid,text,jsonb,integer),public.api_enterprise_member_head(uuid)from public,anon,authenticated;
grant execute on function public.api_enterprise_operations(text,uuid,text,jsonb,integer),public.api_enterprise_member_head(uuid)to authenticated;
-- Privacy inventory includes all candidate-linked Stage 5 journals; aggregate staff/policy records are separate.
do $$declare fn text;d text;begin foreach fn in array array['ecod_private.erasure_inventory','ecod_ops_private.source_inventory']loop d:=pg_get_functiondef((fn||'(uuid,uuid)')::regprocedure);
 if strpos(d,'enterprisePlans')=0 then d:=replace(d,'(''controlledReceipts'',''integrations'')','(''controlledReceipts'',''integrations''),(''enterprisePlans'',''history''),(''enterpriseDecisions'',''integrations''),(''enterpriseReceipts'',''integrations'')');d:=replace(d,'predicate:=case d.name','predicate:=case d.name when''enterprisePlans''then''t.candidate_id=any($1)''when''enterpriseDecisions''then''t.candidate_id=any($1)''when''enterpriseReceipts''then''t.candidate_id=any($1)''');d:=replace(d,'case when d.name','case when d.name in(''enterprisePlans'',''enterpriseDecisions'',''enterpriseReceipts'')then''ecod_enterprise_private''when d.name');d:=replace(d,'end,case d.name when','end,case d.name when''enterprisePlans''then''plans''when''enterpriseDecisions''then''decisions''when''enterpriseReceipts''then''receipts''when');execute d;end if;end loop;
 d:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);if strpos(d,'enterprise fulfillment')=0 then d:=replace(d,'controlled intelligence drafts','enterprise fulfillment plans and human reconciliation receipts (separately reviewed private journals), controlled intelligence drafts');execute d;end if;
 d:=pg_get_functiondef('ecod_processing_private.worker(text,jsonb)'::regprocedure);if strpos(d,'update ecod_enterprise_private.policies')=0 then d:=replace(d,'update ecod_external_private.policies','update ecod_enterprise_private.policies set state=''paused'',accepted_at=null;update ecod_external_private.policies');execute d;end if;
 d:=pg_get_functiondef('ecod_processing_private.api(text,uuid,text,jsonb,integer)'::regprocedure);execute replace(d,'''formal'',78,''operations'',75','''formal'',81,''operations'',78');
 d:=pg_get_functiondef('ecod_delivery_private.api(text,uuid,uuid,text,jsonb,integer)'::regprocedure);if strpos(d,'Use Stage 5 controls')=0 then d:=replace(d,' if k in(''processing'',''recovery'')',' if k in(''sso'',''fulfillment'')and a in(''configure'',''accept'',''enable'',''pause'',''degrade'',''revoke'',''rotate'')then raise exception ''Use Stage 5 controls for SSO and fulfillment'';end if; if k in(''processing'',''recovery'')');execute d;end if;
 foreach fn in array array['ecod_delivery_private.allowed(ecod_delivery_private.intents)','ecod_collaboration_private.allowed(ecod_collaboration_private.work)','ecod_external_private.allowed(ecod_external_private.work)']loop
 d:=pg_get_functiondef(fn::regprocedure);if strpos(d,'ecod_enterprise_private.member_ok')=0 then
 if fn like 'ecod_delivery%'then d:=replace(d,' if not exists(select 1 from public.memberships',' if not ecod_enterprise_private.member_ok(i.workspace_id,i.actor,false)or not exists(select 1 from public.memberships');
 else d:=replace(d,'if not exists(select 1 from public.memberships','if not ecod_enterprise_private.member_ok(w.workspace_id,w.actor,false)or not exists(select 1 from public.memberships');d:=replace(d,'if w.expires_at<=','if not ecod_enterprise_private.member_ok(w.workspace_id,w.actor,false)or w.expires_at<=');d:=replace(d,'if (w.status in','if not ecod_enterprise_private.member_ok(w.workspace_id,w.actor,false)or (w.status in');end if;execute d;end if;end loop;
end$$;
commit;
