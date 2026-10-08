begin;
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
  ('history','history'),('auditEvents','history'),('contactRecords','records'),('contactEvents','history'),('contactReceipts','integrations'),('readinessDecisions','records'),('clientPacks','records'),('clientFeedback','records'),('clientReceipts','integrations'),('clientReads','history'),('machineEvents','history'),('machineReceipts','integrations')
 ) as definitions(name,area) loop
  predicate:=case d.name
   when 'clientReads' then 'exists(select 1 from ecod_client_private.packs p where p.workspace_id=$2 and p.candidate_id=any($1) and p.id=any(t.pack_ids))'
   when 'clientPacks' then 't.candidate_id=any($1)'
   when 'clientFeedback' then 't.candidate_id=any($1)'
   when 'clientReceipts' then 't.candidate_id=any($1)'
   when 'machineEvents' then 't.candidate_id=any($1)'
   when 'machineReceipts' then 't.candidate_id=any($1)'
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
   from(select to_jsonb(t)j,encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')h from %I.%I t where t.workspace_id=$2 and %s limit 2001)q',case when d.name in ('clientPacks','clientFeedback','clientReceipts','clientReads') then 'ecod_client_private' when d.name in ('machineEvents','machineReceipts') then 'ecod_machine_private' when d.name in ('contactRecords','contactEvents','contactReceipts') then 'ecod_contacts_private' else 'public' end,case d.name when 'clientPacks' then 'packs' when 'clientFeedback' then 'feedback' when 'clientReceipts' then 'receipts' when 'clientReads' then 'read_events' when 'machineEvents' then 'events' when 'machineReceipts' then 'receipts' when 'contactRecords' then 'contacts' when 'contactEvents' then 'contact_events' when 'contactReceipts' then 'contact_receipts' else d.name end,predicate)
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
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, alternate-contact records and private contact verification/operation history, readiness decision history, rubric scorecard snapshots and recording provenance, client submission versions/feedback/read history and private machine-operation metadata, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;

revoke all on function ecod_private.erasure_inventory(uuid,uuid),ecod_private.subject_access_content(uuid) from public,anon,authenticated;
commit;
