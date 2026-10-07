begin;
alter table public."availabilityHistory"
 add column if not exists source text not null default '',
 add column if not exists observed date,
 add column if not exists "recordedBy" uuid,
 add column if not exists "recordedAt" timestamptz,
 add column if not exists "operationApplied" boolean not null default false;
-- Legacy writers may append observations, but cannot manufacture a receipt for an applied RPC.
revoke insert on public."availabilityHistory" from authenticated;
grant insert(id,workspace_id,"candidateId",notice,"earliestStart",status,mode,captured,source,observed,"recordedBy","recordedAt")
on public."availabilityHistory" to authenticated;

-- Legacy observations keep unknown observation provenance. New inserts cannot forge recording metadata.
create or replace function public.stamp_availability_record() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new."recordedBy":=auth.uid();new."recordedAt":=clock_timestamp();
 return new;
end $$;
drop trigger if exists stamp_availability_record on public."availabilityHistory";
create trigger stamp_availability_record before insert on public."availabilityHistory"
for each row execute function public.stamp_availability_record();
revoke all on function public.stamp_availability_record() from public,anon,authenticated;

create or replace function public.api_candidate_availability(p_candidate uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); person uuid; family uuid[]; context jsonb; rows jsonb;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid availability page';end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;
 if person is null then raise exception 'Candidate not found in your workspace';end if;
 with recursive relatives as (
  select id from public.candidates where workspace_id=ws and id=person
  union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws
 ) select array_agg(id) into family from(select id from relatives limit 101)t;
 if cardinality(family)>100 then raise exception 'Identity scope exceeds its safe limit';end if;
 select jsonb_build_object('notice',notice,'earliestStart',"earliestStart",'activeStatus',"activeStatus",'mode',mode,
 'token',md5(to_jsonb(c)::text)) into context from public.candidates c where workspace_id=ws and id=person;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'candidateId',"candidateId",'notice',notice,'earliestStart',"earliestStart",
 'activeStatus',status,'mode',mode,'source',source,'observed',observed,'captured',captured,'recordedBy',"recordedBy",'recordedAt',"recordedAt")
 order by "recordedAt" desc nulls last,captured desc,id desc),'[]') into rows
 from(select * from public."availabilityHistory" where workspace_id=ws and "candidateId"=any(family)
 order by "recordedAt" desc nulls last,captured desc,id desc limit 26 offset p_offset)t;
 return jsonb_build_object('candidateId',person,'current',context,'rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
 'offset',p_offset,'more',jsonb_array_length(rows)>25);
end $$;

-- Narrow private privileged write owns the protected applied marker. Every lookup binds actor/workspace.
create or replace function ecod_repository_private.record_candidate_availability(p_candidate uuid,p_operation uuid,p_token text,p_observation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();actor uuid:=auth.uid();person public.candidates;prior public."availabilityHistory";family uuid[];
 notice_days integer;start_day date;observed_day date;source_text text;today_utc date:=(statement_timestamp() at time zone 'UTC')::date;
begin
 if ws is null or actor is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501';end if;
 perform 1 from public.memberships where workspace_id=ws and user_id=actor and role in ('admin','recruiter') for share;
 if not found or not public.can_edit_workspace(ws) then raise exception 'Editor membership required' using errcode='42501';end if;
 if p_operation is null or p_token is null or p_token!~'^[a-f0-9]{32}$' or jsonb_typeof(p_observation) is distinct from 'object'
 or octet_length(p_observation::text)>6000 then raise exception 'Invalid availability observation';end if;
 if not p_observation ?& array['notice','earliestStart','activeStatus','mode','source','observed']
 or (select count(*) from jsonb_object_keys(p_observation))<>6 then raise exception 'Invalid observation fields';end if;
 if p_observation->'notice'<>'null'::jsonb then
  if jsonb_typeof(p_observation->'notice')<>'number' then raise exception 'Notice must be whole days or unknown';end if;
  if (p_observation->>'notice')::numeric<0 or (p_observation->>'notice')::numeric>3650
  or (p_observation->>'notice')::numeric<>trunc((p_observation->>'notice')::numeric) then raise exception 'Notice must be whole days from 0 to 3650';end if;
  notice_days:=(p_observation->>'notice')::integer;
 end if;
 if jsonb_typeof(p_observation->'source')<>'string' or length(btrim(p_observation->>'source')) not between 1 and 1000
 or jsonb_typeof(p_observation->'observed')<>'string' or p_observation->>'observed'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(p_observation->'activeStatus')<>'string' or p_observation->>'activeStatus' not in ('Active','Passive')
 or jsonb_typeof(p_observation->'mode')<>'string' or p_observation->>'mode' not in ('','Flexible','Remote','Hybrid','Onsite') then raise exception 'Invalid source, observation date or availability choice';end if;
 source_text:=btrim(p_observation->>'source');observed_day:=(p_observation->>'observed')::date;
 if observed_day<date '1900-01-01' or observed_day>today_utc then raise exception 'Observation date must not be in the future';end if;
 if p_observation->'earliestStart'<>'null'::jsonb then
  if jsonb_typeof(p_observation->'earliestStart')<>'string' or p_observation->>'earliestStart'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid earliest start date';end if;
  start_day:=(p_observation->>'earliestStart')::date;
  if start_day<date '1900-01-01' or start_day>date '2100-12-31' then raise exception 'Invalid earliest start date';end if;
 end if;
 select * into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace';end if;
 select * into prior from public."availabilityHistory" where workspace_id=ws and id=p_operation;
 if found then
  if not prior."operationApplied" or prior."candidateId"<>p_candidate or prior."recordedBy" is distinct from actor
  or (prior.notice,prior."earliestStart",prior.status,prior.mode,prior.source,prior.observed)
  is distinct from (notice_days,start_day,p_observation->>'activeStatus',p_observation->>'mode',source_text,observed_day)
  then raise exception 'Availability operation conflict' using errcode='40001';end if;
  return public.api_candidate_availability(p_candidate)||jsonb_build_object('recordedId',p_operation,'replayed',true);
 end if;
 if md5(to_jsonb(person)::text)<>p_token then raise exception 'Candidate changed. Reload availability before saving.' using errcode='40001';end if;
 with recursive relatives as (
  select id from public.candidates where workspace_id=ws and id=p_candidate
  union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws
 ) select array_agg(id) into family from(select id from relatives limit 101)t;
 if cardinality(family)>100 then raise exception 'Identity scope exceeds its safe limit';end if;
 if exists(select 1 from public."availabilityHistory" where workspace_id=ws and "candidateId"=any(family) and observed>observed_day)
 then raise exception 'A newer observation exists; reload availability';end if;
 insert into public."availabilityHistory"(id,workspace_id,"candidateId",notice,"earliestStart",status,mode,source,observed,captured,"operationApplied")
 values(p_operation,ws,p_candidate,notice_days,start_day,p_observation->>'activeStatus',p_observation->>'mode',source_text,observed_day,today_utc,true);
 if (person.notice,person."earliestStart",person."activeStatus",person.mode)
 is distinct from (notice_days,start_day,p_observation->>'activeStatus',p_observation->>'mode') then
  update public.candidates set notice=notice_days,"earliestStart"=start_day,"activeStatus"=p_observation->>'activeStatus',mode=p_observation->>'mode'
  where workspace_id=ws and id=p_candidate;
 end if;
 return public.api_candidate_availability(p_candidate)||jsonb_build_object('recordedId',p_operation,'replayed',false);
end $$;
create or replace function public.api_record_candidate_availability(p_candidate uuid,p_operation uuid,p_token text,p_observation jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select ecod_repository_private.record_candidate_availability(p_candidate,p_operation,p_token,p_observation)
$$;
revoke all on function ecod_repository_private.record_candidate_availability(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function ecod_repository_private.record_candidate_availability(uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.api_candidate_availability(uuid,integer),public.api_record_candidate_availability(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.api_candidate_availability(uuid,integer),public.api_record_candidate_availability(uuid,uuid,text,jsonb) to authenticated;


-- Include sourced observation facts in the existing reviewed disclosure category. Internal actor IDs stay excluded.
create or replace function ecod_private.subject_access_inventory(ws uuid,person uuid)
returns table(category text,record_id uuid,projection jsonb,source_hash text)
language plpgsql stable security invoker set search_path='' as $$
declare definition record;predicate text;
begin
 for definition in select * from (values
  ('candidates','id,name,email,phone,linkedin,anthroId,title,company,location,timezone,experience,relevantExperience,skills,skillsDetail,current,expected,currency,notice,earliestStart,activeStatus,mode,engagement,status,source,created,verified'),
  ('employmentHistory','company,title,startDate,endDate,location,source,verified,created'),
  ('compensationHistory','kind,amount,currency,basis,source,verified'),
  ('availabilityHistory','notice,earliestStart,status,mode,captured,source,observed,recordedAt'),
  ('personSkills','skillId,proficiency,years,lastUsed,confidence,validated,evidenceCount,lastEvidence'),
  ('skillEvidence','personSkillId,evidenceType,proficiency,years,lastUsed,evidenceRef,assessor,note,date'),
  ('assessments','title,score,assessor,date,evidence,gap,skill,validUntil'),
  ('enrichment','title,description,due,owner,status,created,gapSkill'),
  ('notes','text,date,followUp,completed'),
  ('consents','purpose,status,noticeVersion,source,note,date'),
  ('considerations','stage,created,updated,reason'),
  ('submissions','submittedOn,clientStatus,clientFeedback,packText'),
  ('interviews','stage,scheduledAt,duration,mode,status,outcome,feedback,score'),
  ('offers','role,status,offeredCtc,currency,joiningDate,created,sentOn,acceptedOn'),
  ('placements','status,startDate,endDate,engagementType,workMode,location,created'),
  ('documents','kind,name,mime,size,version,parserStatus,removed,uploaded'),
  ('tasks','title,description,due,done,created'),
  ('history','entityType,action,date')
 ) as definitions(name,fields) loop
  predicate:=case definition.name when 'candidates' then 't.id=$1'
   when 'history' then 't."entityId"=$1 and t."entityType"=''candidates'''
   when 'skillEvidence' then 't."personSkillId" in (select id from public."personSkills" where workspace_id=$2 and "candidateId"=$1)'
   else 't."candidateId"=$1' end;
  return query execute format('select %L,t.id,
   coalesce((select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(t)) where key=any($3)),''{}''::jsonb),
   encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')
   from public.%I t where t.workspace_id=$2 and %s order by t.id limit 2001',definition.name,definition.name,predicate)
   using person,ws,string_to_array(definition.fields,',');
 end loop;
end $$;
revoke all on function ecod_private.subject_access_inventory(uuid,uuid) from public,anon,authenticated;


commit;
