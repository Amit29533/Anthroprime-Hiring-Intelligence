-- N3.2: bounded, sealed rubric scorecards with server provenance and chronology.
begin;
alter table public.assessments add column if not exists "recordedAt" timestamptz;
alter table public.assessments add column if not exists "recordedBy" uuid;
alter table public.assessments add column if not exists "recordedSequence" bigint;
alter table public.assessments add column if not exists "scorecardRequestHash" text;
create index if not exists assessments_sealed_page on public.assessments(workspace_id,"candidateId","recordedSequence" desc,id desc) where "scorecardRequestHash" is not null;
create index if not exists assessments_general_chronology on public.assessments(workspace_id,"candidateId",date desc,"recordedSequence" desc nulls last,id desc) where "demandId" is null and skill is null;
create sequence if not exists ecod_readiness_private.assessment_recording_sequence;
revoke all on sequence ecod_readiness_private.assessment_recording_sequence from public,anon,authenticated;

create or replace function ecod_readiness_private.stamp_assessment() returns trigger
language plpgsql security definer set search_path='' as $$
declare existing public.assessments;
begin
 if tg_op='INSERT' then
  select * into existing from public.assessments where id=new.id and workspace_id=new.workspace_id;
  if found then
   -- An UPSERT must preserve the original provenance, including unknown legacy values.
   new."recordedAt":=existing."recordedAt";new."recordedBy":=existing."recordedBy";
   new."recordedSequence":=existing."recordedSequence";new."scorecardRequestHash":=existing."scorecardRequestHash";
   return new;
  end if;
  new."recordedAt":=clock_timestamp();new."recordedBy":=auth.uid();
  new."recordedSequence":=nextval('ecod_readiness_private.assessment_recording_sequence'::regclass);
  if new."scorecardRequestHash" is not null then
   if new."templateId" is null or new."templateSnapshot" is null then raise exception 'Sealed scorecards require a rubric';end if;
   new."scorecardRequestHash":=encode(sha256(convert_to(jsonb_build_array(new."candidateId",new."templateId",(new."templateSnapshot"->>'version')::integer,new."rubricScores",new.date,btrim(new.evidence))::text,'UTF8')),'hex');
  end if;
 elsif (new."recordedAt",new."recordedBy",new."recordedSequence",new."scorecardRequestHash") is distinct from
  (old."recordedAt",old."recordedBy",old."recordedSequence",old."scorecardRequestHash") then
  raise exception 'Assessment recording provenance cannot be changed';
 elsif old."scorecardRequestHash" is not null and to_jsonb(new)-'candidateId' is distinct from to_jsonb(old)-'candidateId' then
  raise exception 'Scorecard evidence is sealed; record a reassessment';
 end if;
 return new;
end $$;
create or replace function public.snapshot_assessment_rubric()
returns trigger language plpgsql set search_path='' as $$
declare existing public.assessments; template public."assessmentTemplates"%rowtype; criterion jsonb; score_value numeric; total numeric:=0;
begin
  if tg_op='INSERT' then
    select * into existing from public.assessments where id=new.id and workspace_id=new.workspace_id;
    if found and existing."scorecardRequestHash" is not null then
      if to_jsonb(new)-array['candidateId','recordedAt','recordedBy','recordedSequence','scorecardRequestHash']
        is distinct from to_jsonb(existing)-array['candidateId','recordedAt','recordedBy','recordedSequence','scorecardRequestHash'] then
        raise exception 'Scorecard evidence is sealed; record a reassessment';
      end if;
      return new;
    end if;
  end if;
  if tg_op='UPDATE' and old."templateId" is not null then
    if (new."templateId",new."templateSnapshot",new."rubricScores",new.score,new.date,new."validUntil",new.evidence,new.assessor,new."demandId")
      is distinct from (old."templateId",old."templateSnapshot",old."rubricScores",old.score,old.date,old."validUntil",old.evidence,old.assessor,old."demandId") then
      raise exception 'Recorded rubric evidence is immutable; record a reassessment';
    end if;
    return new;
  end if;
  if new."templateId" is null then
    if new."templateSnapshot" is not null or new."rubricScores" is not null then raise exception 'Select a template for rubric evidence'; end if;
    return new;
  end if;
  select * into template from public."assessmentTemplates" where id=new."templateId" and workspace_id=new.workspace_id;
  if not found or template.archived then raise exception 'Assessment template is unavailable'; end if;
  if new.date>current_date then raise exception 'Assessment date cannot be in the future'; end if;
  if jsonb_typeof(new."rubricScores") is distinct from 'object' then raise exception 'Score every rubric criterion'; end if;
  for criterion in select * from jsonb_array_elements(template.rubric) loop
    if jsonb_typeof(new."rubricScores"->(criterion->>'id')) is distinct from 'number' then raise exception 'Score every rubric criterion'; end if;
    score_value := (new."rubricScores"->>(criterion->>'id'))::numeric;
    if score_value<0 or score_value>(criterion->>'maxScore')::numeric then raise exception 'Rubric score is out of range'; end if;
    total := total + score_value/(criterion->>'maxScore')::numeric*(criterion->>'weight')::numeric;
  end loop;
  if (select count(*) from jsonb_object_keys(new."rubricScores")) <> jsonb_array_length(template.rubric) then raise exception 'Unknown rubric criterion'; end if;
  new.score := round(total,2);
  new."validUntil" := new.date+template."validityDays";
  new."templateSnapshot" := jsonb_build_object('name',template.name,'description',template.description,'version',template.version,'validityDays',template."validityDays",'rubric',template.rubric);
  return new;
end $$;

revoke all on function public.snapshot_assessment_rubric() from public,anon,authenticated;
-- Run after the existing rubric snapshot/validation trigger.
drop trigger if exists zz_assessment_recording on public.assessments;
create trigger zz_assessment_recording before insert or update on public.assessments for each row execute function ecod_readiness_private.stamp_assessment();
revoke all on function ecod_readiness_private.stamp_assessment() from public,anon,authenticated;

create or replace function ecod_readiness_private.scorecards_read(p_candidate uuid,p_offset integer,p_templates_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();person uuid;rows jsonb;templates jsonb;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 or p_templates_offset is null or p_templates_offset not between 0 and 10000 then raise exception 'Invalid scorecard page';end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;
 if person is null then raise exception 'Candidate not found in your workspace';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by name,id),'[]') into templates from
  (select id,name,description,version,"validityDays",rubric from public."assessmentTemplates" where workspace_id=ws and not archived order by name,id limit 51 offset p_templates_offset)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by "recordedSequence" desc,id desc),'[]') into rows from
  (select id,title,score,date,evidence,"templateSnapshot","rubricScores","validUntil","recordedAt","recordedBy","recordedSequence" from public.assessments
   where workspace_id=ws and "candidateId"=person and "scorecardRequestHash" is not null order by "recordedSequence" desc,id desc limit 51 offset p_offset)x;
 if octet_length(templates::text)+octet_length(rows::text)>524288 then raise exception 'Scorecard page exceeds its safe size; use approved manual review';end if;
 return jsonb_build_object('candidateId',person,'rows',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'more',jsonb_array_length(rows)>50,
  'templates',case when jsonb_array_length(templates)>50 then templates-50 else templates end,'templatesMore',jsonb_array_length(templates)>50);
end $$;

create or replace function ecod_readiness_private.record_scorecard(p_candidate uuid,p_operation uuid,p_template uuid,p_template_version integer,p_scores jsonb,p_date date,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();acting_user uuid:=auth.uid();template public."assessmentTemplates";receipt public.assessments;request_hash text;
begin
 if acting_user is null or ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501';end if;
 if p_date>current_date then raise exception 'Assessment date must be on or before %',current_date;end if;
 if p_candidate is null or p_operation is null or p_template is null or p_template_version is null or p_template_version<1 or p_date is null or p_date>current_date or p_date<current_date-730
  or jsonb_typeof(p_scores) is distinct from 'object' or octet_length(p_scores::text)>8000 or coalesce(length(btrim(p_evidence)),0) not between 10 and 5000 or octet_length(p_evidence)>20000 then raise exception 'Invalid scorecard, date or evidence';end if;
 perform 1 from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_candidate,p_template,p_template_version,p_scores,p_date,btrim(p_evidence))::text,'UTF8')),'hex');
 select * into receipt from public.assessments where id=p_operation;
 if found then
  if receipt.workspace_id<>ws or receipt."recordedBy" is distinct from acting_user or receipt."scorecardRequestHash" is distinct from request_hash then raise exception 'Scorecard operation conflict' using errcode='40001';end if;
  return jsonb_build_object('id',receipt.id,'score',receipt.score,'replayed',true);
 end if;
 if (select count(*) from(select 1 from public.assessments where workspace_id=ws and "candidateId"=p_candidate limit 200)x)>=200 then raise exception 'Assessment limit reached; use approved manual review';end if;
 select * into template from public."assessmentTemplates" where workspace_id=ws and id=p_template and not archived for share;
 if not found then raise exception 'Assessment rubric unavailable';end if;
 if template.version<>p_template_version then raise exception 'Rubric changed. Refresh and review the current version.' using errcode='40001';end if;
 if octet_length(to_jsonb(template)::text)>80000 then raise exception 'Rubric exceeds its safe size';end if;
 insert into public.assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence,"templateId","rubricScores","scorecardRequestHash")
 values(p_operation,ws,p_candidate,template.name,0,acting_user::text,p_date,btrim(p_evidence),template.id,p_scores,'seal') returning * into receipt;
 return jsonb_build_object('id',receipt.id,'score',receipt.score,'replayed',false);
end $$;
create or replace function public.api_candidate_scorecards(p_candidate uuid,p_offset integer default 0,p_templates_offset integer default 0) returns jsonb
language sql security invoker set search_path='' as $$select ecod_readiness_private.scorecards_read(p_candidate,p_offset,p_templates_offset)$$;
create or replace function public.api_record_candidate_scorecard(p_candidate uuid,p_operation uuid,p_template uuid,p_template_version integer,p_scores jsonb,p_date date,p_evidence text) returns jsonb
language sql security invoker set search_path='' as $$select ecod_readiness_private.record_scorecard(p_candidate,p_operation,p_template,p_template_version,p_scores,p_date,p_evidence)$$;
revoke all on function ecod_readiness_private.scorecards_read(uuid,integer,integer),ecod_readiness_private.record_scorecard(uuid,uuid,uuid,integer,jsonb,date,text),public.api_candidate_scorecards(uuid,integer,integer),public.api_record_candidate_scorecard(uuid,uuid,uuid,integer,jsonb,date,text) from public,anon,authenticated;
grant execute on function ecod_readiness_private.scorecards_read(uuid,integer,integer),ecod_readiness_private.record_scorecard(uuid,uuid,uuid,integer,jsonb,date,text),public.api_candidate_scorecards(uuid,integer,integer),public.api_record_candidate_scorecard(uuid,uuid,uuid,integer,jsonb,date,text) to authenticated;

-- Use reliable chronology for new assessments without inventing legacy provenance.
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
 select * into a from public.assessments where workspace_id=ws and "candidateId"=person and "demandId" is null and skill is null order by date desc,"recordedSequence" desc nulls last,id desc limit 1;
 expiry:=least(a.date+180,coalesce(a."validUntil",a.date+180),c.verified+120);
 if a.id is null then blockers:=blockers||jsonb_build_array('No general assessment; demand/skill assessments require their own evaluation');
 else
  if a."recordedSequence" is null and (select count(*) from public.assessments where workspace_id=ws and "candidateId"=person and "demandId" is null and skill is null and date=a.date)>1 then
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
  'assessment',case when a.id is null then null else jsonb_build_object('id',a.id,'title',left(a.title,300),'date',a.date,'score',a.score,'evidence',left(a.evidence,5000),'evidenceTruncated',length(a.evidence)>5000,'validUntil',expiry,'recordedAt',a."recordedAt",'recordedBy',a."recordedBy") end,
  'profileStatus',c.status,'profileVerified',c.verified,'expiryLimit',expiry);
end $$;

revoke all on function ecod_readiness_private.context(uuid,uuid) from public,anon,authenticated;
create or replace function ecod_private.subject_access_content(package uuid)
returns text language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'caseId',s.case_id,'packageId',p.id,'preparedAt',p.prepared_at,
  'actor',p.actor,'workspaceId',p.workspace_id,'snapshotAt',s.created_at,
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, alternate-contact records and private contact verification/operation history, readiness decision history, rubric scorecard snapshots and recording provenance, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;
revoke all on function ecod_private.subject_access_content(uuid) from public,anon,authenticated;
commit;
