begin;
create index if not exists candidates_merged_family on public.candidates(workspace_id,"mergedInto") where "mergedInto" is not null;
create index if not exists audit_events_entity_review on public."auditEvents"(workspace_id,"entityType","entityId");
create index if not exists execution_jobs_entity_review on public."executionJobs"(workspace_id,"entityType","entityId");
create table if not exists ecod_private.erasure_reviews (
 id uuid primary key,workspace_id uuid not null,case_id uuid not null,verified_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),inventory jsonb not null,
 foreign key(workspace_id,case_id) references ecod_private.subject_requests(workspace_id,id),unique(workspace_id,id)
);
create index if not exists erasure_review_case on ecod_private.erasure_reviews(workspace_id,case_id,created_at desc);
create table if not exists ecod_private.erasure_decisions (
 review_id uuid not null references ecod_private.erasure_reviews(id),area text not null,
 decision text not null default 'pending' check(decision in ('pending','completed','retained','not_applicable')),
 reference text not null default '',actor uuid,reviewed_at timestamptz,primary key(review_id,area)
);
alter table ecod_private.erasure_reviews enable row level security;
alter table ecod_private.erasure_decisions enable row level security;
revoke all on ecod_private.erasure_reviews,ecod_private.erasure_decisions from public,anon,authenticated;

-- Point-in-time inventory: hashes and counts only, no copied content or storage URLs.
create or replace function ecod_private.erasure_inventory(ws uuid,person uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare family uuid[];d record;n integer;total integer:=0;keys text[]:='{}';found_keys text[];digest text;
 counts jsonb:='[]';stamps jsonb:='[]';predicate text;
begin
 if not exists(select 1 from public.candidates where workspace_id=ws and id=person and "mergedInto" is null) then raise exception 'Candidate merged or unavailable; review the current identity';end if;
 with recursive relatives(id) as (
  select id from public.candidates where workspace_id=ws and id=person
  union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws
 ) select array_agg(id) into family from(select id from relatives limit 101)t;
 if cardinality(family)>100 then raise exception 'Identity scope exceeds its safe limit; use an approved manual inventory';end if;
 for d in select * from (values
  ('candidates','records'),('employmentHistory','records'),('compensationHistory','records'),('availabilityHistory','records'),
  ('personSkills','records'),('skillEvidence','records'),('assessments','records'),('enrichment','records'),('notes','records'),('consents','records'),
  ('considerations','records'),('submissions','records'),('interviews','records'),('offers','records'),('placements','records'),('placementCommercials','records'),
  ('tasks','records'),('referrals','records'),('poolMembers','records'),('documents','originals'),
  ('externalMappings','integrations'),('candidateVectors','integrations'),('intelligenceRequests','integrations'),('executionJobs','integrations'),('integrationReceipts','integrations'),
  ('history','history'),('auditEvents','history')
 ) as definitions(name,area) loop
  predicate:=case d.name
   when 'candidates' then 't.id=any($1)'
   when 'skillEvidence' then 't."personSkillId" in(select id from public."personSkills" where workspace_id=$2 and "candidateId"=any($1))'
   when 'placementCommercials' then 't."placementId" in(select id from public.placements where workspace_id=$2 and "candidateId"=any($1))'
   when 'candidateVectors' then 't.candidate_id=any($1)' when 'intelligenceRequests' then 't.candidate_id=any($1)'
   when 'executionJobs' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   when 'integrationReceipts' then 't.response->>''candidateId''=any(select x::text from unnest($1)x)'
   when 'history' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   when 'auditEvents' then '(t."entityType",t."entityId") in(select split_part(k,'':'',1),split_part(k,'':'',2)::uuid from unnest($4)k)'
   else 't."candidateId"=any($1)' end;
  execute format('select count(*)::int,
   coalesce(array_agg($3||'':''||(j->>''id'')) filter(where j->>''id'' is not null),''{}''::text[]),
   encode(sha256(convert_to(coalesce(jsonb_agg(h order by h),''[]'')::text,''UTF8'')),''hex'')
   from(select to_jsonb(t)j,encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')h from public.%I t where t.workspace_id=$2 and %s limit 2001)q',d.name,predicate)
   into n,found_keys,digest using family,ws,d.name,keys;
  total:=total+n;
  if n>2000 or total>10000 then raise exception 'Record scope exceeds its safe limit; use an approved manual inventory';end if;
  keys:=keys||found_keys;
  counts:=counts||jsonb_build_array(jsonb_build_object('category',d.name,'area',d.area,'count',n));
  stamps:=stamps||jsonb_build_array(jsonb_build_array(d.name,n,digest));
 end loop;
 return jsonb_build_object('identities',cardinality(family),'total',total,'counts',counts,
  'fingerprint',encode(sha256(convert_to(stamps::text,'UTF8')),'hex'));
end $$;
revoke all on function ecod_private.erasure_inventory(uuid,uuid) from public,anon,authenticated;

create or replace function ecod_private.erasure_operation(op uuid,case_id uuid,expected integer,payload jsonb,note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;e ecod_private.subject_request_events;fp text;
begin
 if op is null or case_id is null or expected is null or expected<1 or note is null or length(btrim(note)) not between 10 and 2000 then raise exception 'Case version and review reference required';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||op::text,0));
 select * into r from ecod_private.subject_requests where id=case_id and workspace_id=ws for update;
 if not found or r.kind<>'erasure' or r.verified_at is null or r.status not in ('in_review','awaiting_action') then raise exception 'A verified erasure case under review is required' using errcode='42501';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(case_id,expected,payload,note)::text,'UTF8')),'hex');
 select * into e from ecod_private.subject_request_events where workspace_id=ws and operation_id=op;
 if found then
  if e.actor<>auth.uid() or e.fingerprint<>fp then raise exception 'Request identifier conflict';end if;
  return jsonb_build_object('replay',true,'result',e.result,'case',to_jsonb(r));
 end if;
 if r.version<>expected then raise exception 'Case changed; refresh before updating' using errcode='40001';end if;
 return jsonb_build_object('replay',false,'case',to_jsonb(r),'fingerprint',fp,'operation',op);
end $$;
revoke all on function ecod_private.erasure_operation(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;

create or replace function public.api_capture_erasure_scope(p_operation uuid,p_id uuid,p_version integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r ecod_private.subject_requests;scope jsonb;
begin
 ctx:=ecod_private.erasure_operation(p_operation,p_id,p_version,jsonb_build_array('erasure_scope'),p_note);
 if(ctx->>'replay')::boolean then return ctx->'result';end if;
 select * into r from jsonb_populate_record(null::ecod_private.subject_requests,ctx->'case');
 scope:=ecod_private.erasure_inventory(r.workspace_id,r.candidate_id);
 insert into ecod_private.erasure_reviews(id,workspace_id,case_id,verified_at,inventory) values(p_operation,r.workspace_id,r.id,r.verified_at,scope);
 insert into ecod_private.erasure_decisions(review_id,area) select p_operation,unnest(array['records','originals','history','integrations','platform_records','external_copies','backups']);
 return ecod_private.commit_subject_access(ctx,'erasure_scope_captured',p_note,jsonb_build_object('reviewId',p_operation,'records',scope->'total','identities',scope->'identities'));
end $$;
revoke all on function public.api_capture_erasure_scope(uuid,uuid,integer,text) from public,anon;
grant execute on function public.api_capture_erasure_scope(uuid,uuid,integer,text) to authenticated;

create or replace function public.api_erasure_review(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;s ecod_private.erasure_reviews;
begin
 select * into r from ecod_private.subject_requests where workspace_id=ws and id=p_id and kind='erasure';
 if not found then raise exception 'Erasure case not found' using errcode='42501';end if;
 select * into s from ecod_private.erasure_reviews where workspace_id=ws and case_id=p_id order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('review',null,'rows','[]'::jsonb);end if;
 return jsonb_build_object('review',jsonb_build_object('id',s.id,'createdAt',s.created_at,'inventory',s.inventory-'fingerprint',
  'currentVerification',r.verified_at=s.verified_at and r.status in('in_review','awaiting_action')),
  'rows',(select coalesce(jsonb_agg(jsonb_build_object('area',area,'decision',decision,'reference',reference,'actor',actor,'reviewedAt',reviewed_at) order by area),'[]') from ecod_private.erasure_decisions where review_id=s.id));
end $$;
revoke all on function public.api_erasure_review(uuid) from public,anon;
grant execute on function public.api_erasure_review(uuid) to authenticated;

create or replace function public.api_review_erasure_area(p_operation uuid,p_id uuid,p_version integer,p_review uuid,p_area text,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r ecod_private.subject_requests;s ecod_private.erasure_reviews;scope jsonb;
begin
 if p_area is null or p_decision is null or p_decision not in('completed','retained','not_applicable') then raise exception 'Choose a reviewed outcome';end if;
 ctx:=ecod_private.erasure_operation(p_operation,p_id,p_version,jsonb_build_array('erasure_decision',p_review,p_area,p_decision),p_note);
 if(ctx->>'replay')::boolean then return ctx->'result';end if;
 select * into r from jsonb_populate_record(null::ecod_private.subject_requests,ctx->'case');
 select * into s from ecod_private.erasure_reviews where workspace_id=r.workspace_id and case_id=r.id order by created_at desc,id desc limit 1 for update;
 if not found or s.id<>p_review or s.verified_at is distinct from r.verified_at then raise exception 'Scope superseded; capture the current scope';end if;
 scope:=ecod_private.erasure_inventory(r.workspace_id,r.candidate_id);
 if scope->>'fingerprint'<>s.inventory->>'fingerprint' then raise exception 'Data changed; capture and reconcile a fresh scope' using errcode='40001';end if;
 update ecod_private.erasure_decisions set decision=p_decision,reference=btrim(p_note),actor=auth.uid(),reviewed_at=clock_timestamp() where review_id=s.id and area=p_area;
 if not found then raise exception 'Review area not found';end if;
 return ecod_private.commit_subject_access(ctx,'erasure_area_reviewed',p_note,jsonb_build_object('reviewId',s.id,'area',p_area,'decision',p_decision));
end $$;
revoke all on function public.api_review_erasure_area(uuid,uuid,integer,uuid,text,text,text) from public,anon;
grant execute on function public.api_review_erasure_area(uuid,uuid,integer,uuid,text,text,text) to authenticated;

create or replace function ecod_private.guard_erasure_closure() returns trigger
language plpgsql security definer set search_path='' as $$
declare s ecod_private.erasure_reviews;scope jsonb;
begin
 if new.kind='erasure' and new.status='closed' and old.status<>'closed' then
  select * into s from ecod_private.erasure_reviews where workspace_id=new.workspace_id and case_id=new.id order by created_at desc,id desc limit 1;
  if found then
   if s.verified_at is distinct from new.verified_at then raise exception 'Capture scope for the current identity verification';end if;
   if (select count(*) from ecod_private.erasure_decisions where review_id=s.id and decision<>'pending')<>7 then raise exception 'Review all seven erasure areas before closure';end if;
   scope:=ecod_private.erasure_inventory(new.workspace_id,new.candidate_id);
   if scope->>'fingerprint'<>s.inventory->>'fingerprint' then raise exception 'Data changed; capture and reconcile a fresh scope before closure' using errcode='40001';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function ecod_private.guard_erasure_closure() from public,anon,authenticated;
drop trigger if exists erasure_closure_review on ecod_private.subject_requests;
create trigger erasure_closure_review before update on ecod_private.subject_requests for each row execute function ecod_private.guard_erasure_closure();
commit;
