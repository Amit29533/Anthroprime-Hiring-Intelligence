-- N3.1: general assessment-backed readiness review; never overwrites profile status.
begin;
create schema if not exists ecod_readiness_private;
revoke all on schema ecod_readiness_private from public,anon,authenticated;
create table if not exists public."readinessDecisions" (
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity,workspace_id uuid not null,"candidateId" uuid not null,
 actor uuid not null,at timestamptz not null default clock_timestamp(),decision text not null check(decision in ('Ready','Near-ready','Not-ready','Revoked')),
 reason text not null check(length(btrim(reason)) between 10 and 2000),expires date not null,
 assessment_id uuid,source_fingerprint text not null,previous_id uuid,operation_id uuid not null,request_hash text not null,
 unique(workspace_id,actor,operation_id),foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists readiness_decisions_candidate on public."readinessDecisions"(workspace_id,"candidateId",sequence desc);
alter table public."readinessDecisions" enable row level security;
revoke all on public."readinessDecisions" from public,anon,authenticated;
grant select on public."readinessDecisions" to authenticated;
drop policy if exists readiness_read on public."readinessDecisions";
create policy readiness_read on public."readinessDecisions" for select to authenticated using(workspace_id=public.current_workspace());

create or replace function ecod_readiness_private.context(ws uuid,person uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.candidates;a public.assessments;assessments jsonb;plans jsonb;blockers jsonb:='[]';fingerprint text;expiry date;
begin
 select * into c from public.candidates where workspace_id=ws and id=person and "mergedInto" is null;
 if not found then raise exception 'Candidate not found in your workspace';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into assessments from
  (select * from public.assessments where workspace_id=ws and "candidateId"=person order by id limit 201)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into plans from
  (select * from public.enrichment where workspace_id=ws and "candidateId"=person order by id limit 201)x;
 if jsonb_array_length(assessments)>200 or jsonb_array_length(plans)>200 or octet_length(assessments::text)+octet_length(plans::text)>2097152 then raise exception 'Readiness source limit exceeded; use approved manual review';end if;
 select * into a from public.assessments where workspace_id=ws and "candidateId"=person and "demandId" is null and skill is null order by date desc,id desc limit 1;
 expiry:=least(a.date+180,coalesce(a."validUntil",a.date+180),c.verified+120);
 if a.id is null then blockers:=blockers||jsonb_build_array('No general assessment; demand/skill assessments require their own evaluation');
 else
  if (select count(*) from public.assessments where workspace_id=ws and "candidateId"=person and "demandId" is null and skill is null and date=a.date)>1 then
   blockers:=blockers||jsonb_build_array('Multiple general assessments share the latest date; resolve chronology before Ready');end if;
  if a.date>current_date then blockers:=blockers||jsonb_build_array('Assessment date is in the future');end if;
  if expiry<current_date then blockers:=blockers||jsonb_build_array('Assessment or profile verification has expired');end if;
  if a.score<80 then blockers:=blockers||jsonb_build_array('Latest general assessment is below the 80/100 review threshold');end if;
  if length(btrim(a.evidence))<10 then blockers:=blockers||jsonb_build_array('General assessment needs at least 10 characters of evidence');end if;
 end if;
 if c.verified>current_date then blockers:=blockers||jsonb_build_array('Profile verification date is in the future');end if;
 if c.verified<current_date-120 then blockers:=blockers||jsonb_build_array('Profile verification is older than 120 days');end if;
 if c."processingRestricted" then blockers:=blockers||jsonb_build_array('Outbound recruiting hold');end if;
 if c.status='Unavailable' then blockers:=blockers||jsonb_build_array('Candidate is unavailable');end if;
 if exists(select 1 from public.enrichment where workspace_id=ws and "candidateId"=person and status<>'Validated') then
  blockers:=blockers||jsonb_build_array('Enrichment plans still need completion and validation');end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(to_jsonb(c),assessments,plans)::text,'UTF8')),'hex');
 return jsonb_build_object('fingerprint',fingerprint,'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,
  'assessment',case when a.id is null then null else jsonb_build_object('id',a.id,'title',left(a.title,300),'date',a.date,'score',a.score,'evidence',left(a.evidence,5000),'evidenceTruncated',length(a.evidence)>5000,'validUntil',expiry) end,
  'profileStatus',c.status,'profileVerified',c.verified,'expiryLimit',expiry);
end $$;

create or replace function ecod_readiness_private.read_review(p_candidate uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();person uuid;ctx jsonb;family uuid[];rows jsonb;head public."readinessDecisions";state text;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid readiness page';end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;
 ctx:=ecod_readiness_private.context(ws,person);
 with recursive relatives(id) as(select person union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws)
 select array_agg(id) into family from(select id from relatives limit 101)x;
 if cardinality(family)>100 then raise exception 'Readiness identity limit exceeded; use approved manual review';end if;
 select * into head from public."readinessDecisions" where workspace_id=ws and "candidateId"=person order by sequence desc limit 1;
 state:=case when head.id is null then 'Not reviewed' when head.decision='Revoked' then 'Revoked'
  when head.source_fingerprint<>ctx->>'fingerprint' then 'Needs review' when head.expires<current_date then 'Expired'
  when head.decision='Ready' and not (ctx->>'eligible')::boolean then 'Needs review' else head.decision end;
 select coalesce(jsonb_agg(to_jsonb(x) order by sequence desc),'[]') into rows from
  (select id,sequence,"candidateId",actor,at,decision,reason,expires,assessment_id,previous_id from public."readinessDecisions" where workspace_id=ws and "candidateId"=any(family) order by sequence desc limit 51 offset p_offset)x;
 return ctx||jsonb_build_object('candidateId',person,'state',state,'headId',head.id,'rows',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'more',jsonb_array_length(rows)>50);
end $$;

create or replace function ecod_readiness_private.decide(p_candidate uuid,p_operation uuid,p_head uuid,p_fingerprint text,p_decision text,p_days integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();acting_user uuid:=auth.uid();ctx jsonb;head public."readinessDecisions";receipt public."readinessDecisions";request_hash text;expiry date;
begin
 if acting_user is null or ws is null or not exists(select 1 from public.memberships where user_id=acting_user and workspace_id=ws and role='admin') then raise exception 'Administrator validation required' using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);
 if p_candidate is null or p_operation is null or p_fingerprint is null or p_fingerprint!~'^[0-9a-f]{64}$' or p_decision is null or p_decision not in ('Ready','Near-ready','Not-ready','Revoked')
  or p_days is null or p_days not between 1 and 180 or coalesce(length(btrim(p_reason)),0) not between 10 and 2000 or octet_length(p_reason)>8000 then raise exception 'Invalid readiness decision or evidence';end if;
 perform 1 from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_candidate,p_head,p_fingerprint,p_decision,p_days,btrim(p_reason))::text,'UTF8')),'hex');
 select * into receipt from public."readinessDecisions" where workspace_id=ws and actor=acting_user and operation_id=p_operation;
 if found then
  if receipt.request_hash<>request_hash then raise exception 'Readiness operation conflict' using errcode='40001';end if;
  return jsonb_build_object('id',receipt.id,'replayed',true);
 end if;
 -- Lock existing source rows; the candidate lock also serializes FK-bound inserts.
 perform 1 from public.assessments where workspace_id=ws and "candidateId"=p_candidate order by id limit 201 for share;
 perform 1 from public.enrichment where workspace_id=ws and "candidateId"=p_candidate order by id limit 201 for share;
 ctx:=ecod_readiness_private.context(ws,p_candidate);
 select * into head from public."readinessDecisions" where workspace_id=ws and "candidateId"=p_candidate order by sequence desc limit 1;
 if head.id is distinct from p_head or ctx->>'fingerprint'<>p_fingerprint then raise exception 'Readiness evidence changed. Refresh before reviewing.' using errcode='40001';end if;
 if p_decision='Ready' and not (ctx->>'eligible')::boolean then raise exception 'Resolve readiness blockers before validating Ready';end if;
 expiry:=current_date+p_days;
 if p_decision='Ready' then expiry:=least(expiry,(ctx->>'expiryLimit')::date);end if;
 insert into public."readinessDecisions"(workspace_id,"candidateId",actor,decision,reason,expires,assessment_id,source_fingerprint,previous_id,operation_id,request_hash)
 values(ws,p_candidate,acting_user,p_decision,btrim(p_reason),expiry,(ctx->'assessment'->>'id')::uuid,p_fingerprint,head.id,p_operation,request_hash) returning * into receipt;
 return jsonb_build_object('id',receipt.id,'replayed',false);
end $$;

create or replace function public.api_candidate_readiness(p_candidate uuid,p_offset integer default 0) returns jsonb
language sql security invoker set search_path='' as $$select ecod_readiness_private.read_review(p_candidate,p_offset)$$;
create or replace function public.api_decide_candidate_readiness(p_candidate uuid,p_operation uuid,p_head uuid,p_fingerprint text,p_decision text,p_days integer,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select ecod_readiness_private.decide(p_candidate,p_operation,p_head,p_fingerprint,p_decision,p_days,p_reason)$$;
revoke all on function ecod_readiness_private.context(uuid,uuid),ecod_readiness_private.read_review(uuid,integer),ecod_readiness_private.decide(uuid,uuid,uuid,text,text,integer,text),public.api_candidate_readiness(uuid,integer),public.api_decide_candidate_readiness(uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant usage on schema ecod_readiness_private to authenticated;
grant execute on function ecod_readiness_private.read_review(uuid,integer),ecod_readiness_private.decide(uuid,uuid,uuid,text,text,integer,text),public.api_candidate_readiness(uuid,integer),public.api_decide_candidate_readiness(uuid,uuid,uuid,text,text,integer,text) to authenticated;

-- Keep privacy source inventory and disclosure exclusions explicit.
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
  ('history','history'),('auditEvents','history'),('contactRecords','records'),('contactEvents','history'),('contactReceipts','integrations'),('readinessDecisions','records')
 ) as definitions(name,area) loop
  predicate:=case d.name
   when 'contactRecords' then 't.candidate_id=any($1)'
   when 'contactEvents' then '(t.candidate_id=any($1) or t.contact_id in(select id from ecod_contacts_private.contacts where workspace_id=$2 and candidate_id=any($1)))'
   when 'contactReceipts' then 't.request->>''candidate''=any(select x::text from unnest($1)x)'
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
   from(select to_jsonb(t)j,encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')h from %I.%I t where t.workspace_id=$2 and %s limit 2001)q',case when d.name in ('contactRecords','contactEvents','contactReceipts') then 'ecod_contacts_private' else 'public' end,case d.name when 'contactRecords' then 'contacts' when 'contactEvents' then 'contact_events' when 'contactReceipts' then 'contact_receipts' else d.name end,predicate)
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
create or replace function ecod_private.subject_access_content(package uuid)
returns text language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'caseId',s.case_id,'packageId',p.id,'preparedAt',p.prepared_at,
  'actor',p.actor,'workspaceId',p.workspace_id,'snapshotAt',s.created_at,
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, alternate-contact records and private contact verification/operation history, readiness decision history, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;
revoke all on function ecod_private.erasure_inventory(uuid,uuid),ecod_private.subject_access_content(uuid) from public,anon,authenticated;
commit;
