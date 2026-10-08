begin;
create table if not exists ecod_private.subject_access_reviews (
 id uuid primary key, workspace_id uuid not null, case_id uuid not null, candidate_id uuid not null,
 verified_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 state text not null default 'draft' check(state in ('draft','prepared','superseded','expired')),
 source_hash text not null default '', total integer not null default 0,
 foreign key(workspace_id,case_id) references ecod_private.subject_requests(workspace_id,id),
 unique(workspace_id,id)
);
create index if not exists subject_access_case on ecod_private.subject_access_reviews(workspace_id,case_id,created_at desc);
create index if not exists subject_access_expiry on ecod_private.subject_access_reviews(expires_at,id) where state in ('draft','prepared');
create table if not exists ecod_private.subject_access_rows (
 review_id uuid not null references ecod_private.subject_access_reviews(id) on delete cascade,
 category text not null,record_id uuid not null,source_hash text not null,original jsonb not null,
 decision text not null default 'pending' check(decision in ('pending','include','redact','withhold')),
 approved jsonb,primary key(review_id,category,record_id)
);
create table if not exists ecod_private.subject_access_packages (
 id uuid primary key,workspace_id uuid not null,review_id uuid not null,actor uuid not null,
 prepared_at timestamptz not null,sha256 text not null,included integer not null,withheld integer not null,
 foreign key(workspace_id,review_id) references ecod_private.subject_access_reviews(workspace_id,id)
);
create index if not exists subject_access_package_actor on ecod_private.subject_access_packages(workspace_id,actor,prepared_at);
alter table ecod_private.subject_access_reviews enable row level security;
alter table ecod_private.subject_access_rows enable row level security;
alter table ecod_private.subject_access_packages enable row level security;
revoke all on ecod_private.subject_access_reviews,ecod_private.subject_access_rows,ecod_private.subject_access_packages from public,anon,authenticated;

-- Private, fixed projection registry. Storage locators, inline bytes, parsed CV text,
-- commercial tables, opaque custom fields and private provider/job tables are never projected.
create or replace function ecod_private.subject_access_inventory(ws uuid,person uuid)
returns table(category text,record_id uuid,projection jsonb,source_hash text)
language plpgsql stable security invoker set search_path='' as $$
declare definition record;predicate text;
begin
 for definition in select * from (values
  ('candidates','id,name,email,phone,linkedin,anthroId,title,company,location,timezone,experience,relevantExperience,skills,skillsDetail,current,expected,currency,notice,earliestStart,activeStatus,mode,engagement,status,source,created,verified'),
  ('employmentHistory','company,title,startDate,endDate,location,source,verified,created'),
  ('compensationHistory','kind,amount,currency,basis,source,verified'),
  ('availabilityHistory','notice,earliestStart,status,mode,captured'),
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

create or replace function ecod_private.subject_access_operation(op uuid,case_id uuid,expected integer,payload jsonb,note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;e ecod_private.subject_request_events;fp text;
begin
 if op is null or case_id is null or expected is null or expected<1 or note is null or length(btrim(note)) not between 10 and 2000 then raise exception 'Case version and review reference required';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||op::text,0));
 select * into r from ecod_private.subject_requests where id=case_id and workspace_id=ws for update;
 if not found or r.kind<>'access' or r.verified_at is null or r.status not in ('in_review','awaiting_action') then raise exception 'A verified access case under review is required' using errcode='42501';end if;
 perform 1 from public.candidates where id=r.candidate_id and workspace_id=ws and "mergedInto" is null;
 if not found then raise exception 'Candidate changed or merged; review the request scope' using errcode='42501';end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(case_id,expected,payload,note)::text,'UTF8')),'hex');
 select * into e from ecod_private.subject_request_events where workspace_id=ws and operation_id=op;
 if found then
  if e.actor<>auth.uid() or e.fingerprint<>fp then raise exception 'Request identifier conflict';end if;
  return jsonb_build_object('replay',true,'result',e.result,'case',to_jsonb(r));
 end if;
 if r.version<>expected then raise exception 'Case changed; refresh before updating' using errcode='40001';end if;
 return jsonb_build_object('replay',false,'case',to_jsonb(r),'fingerprint',fp,'operation',op);
end $$;
revoke all on function ecod_private.subject_access_operation(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;

create or replace function ecod_private.commit_subject_access(ctx jsonb,action_name text,note text,fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r ecod_private.subject_requests;result jsonb;at timestamptz:=clock_timestamp();
begin
 update ecod_private.subject_requests set version=version+1,updated_at=at
  where id=(ctx->'case'->>'id')::uuid and workspace_id=(ctx->'case'->>'workspace_id')::uuid returning * into r;
 result:=fields||jsonb_build_object('id',r.id,'version',r.version,'status',r.status);
 insert into ecod_private.subject_request_events(workspace_id,case_id,operation_id,actor,at,action,note,version,status,assignee,due_date,fingerprint,result)
  values(r.workspace_id,r.id,(ctx->>'operation')::uuid,auth.uid(),at,action_name,btrim(note),r.version,r.status,r.assignee,r.due_date,ctx->>'fingerprint',result);
 return result;
end $$;
revoke all on function ecod_private.commit_subject_access(jsonb,text,text,jsonb) from public,anon,authenticated;

create or replace function ecod_private.check_subject_access_review(ctx jsonb,review uuid)
returns ecod_private.subject_access_reviews language plpgsql security definer set search_path='' as $$
declare s ecod_private.subject_access_reviews;
begin
 select * into s from ecod_private.subject_access_reviews where id=review and case_id=(ctx->'case'->>'id')::uuid
  and workspace_id=(ctx->'case'->>'workspace_id')::uuid for update;
 if not found or s.state not in ('draft','prepared') or s.expires_at<=clock_timestamp()
  or s.verified_at is distinct from (ctx->'case'->>'verified_at')::timestamptz then raise exception 'Review expired or superseded; create a new snapshot';end if;
 return s;
end $$;
revoke all on function ecod_private.check_subject_access_review(jsonb,uuid) from public,anon,authenticated;

create or replace function public.api_start_subject_access_review(p_operation uuid,p_id uuid,p_version integer,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;r ecod_private.subject_requests;record_count integer;size_bytes bigint;fingerprint text;
begin
 ctx:=ecod_private.subject_access_operation(p_operation,p_id,p_version,jsonb_build_array('access_start'),p_note);
 if (ctx->>'replay')::boolean then return ctx->'result';end if;
 select * into r from jsonb_populate_record(null::ecod_private.subject_requests,ctx->'case');
 update ecod_private.subject_access_reviews set state='superseded' where workspace_id=r.workspace_id and case_id=r.id and state in ('draft','prepared');
 delete from ecod_private.subject_access_rows where review_id in(select id from ecod_private.subject_access_reviews where workspace_id=r.workspace_id and case_id=r.id);
 insert into ecod_private.subject_access_reviews(id,workspace_id,case_id,candidate_id,verified_at) values(p_operation,r.workspace_id,r.id,r.candidate_id,r.verified_at);
 with rows as materialized (select * from ecod_private.subject_access_inventory(r.workspace_id,r.candidate_id) limit 2001), inserted as (
  insert into ecod_private.subject_access_rows(review_id,category,record_id,source_hash,original)
   select p_operation,category,record_id,source_hash,projection from rows returning *
 ) select count(*)::int,sum(octet_length(original::text)),
  encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(category,record_id,source_hash) order by category,record_id),'[]')::text,'UTF8')),'hex')
  into record_count,size_bytes,fingerprint from inserted;
 if record_count>2000 or size_bytes>5242880 or exists(select 1 from ecod_private.subject_access_rows where review_id=p_operation and octet_length(original::text)>81920) then raise exception 'Access review exceeds its safe size limit; use an approved manual process';end if;
 update ecod_private.subject_access_reviews set source_hash=fingerprint,total=record_count where id=p_operation;
 return ecod_private.commit_subject_access(ctx,'access_review_started',p_note,jsonb_build_object('reviewId',p_operation,'records',record_count));
end $$;
revoke all on function public.api_start_subject_access_review(uuid,uuid,integer,text) from public,anon;
grant execute on function public.api_start_subject_access_review(uuid,uuid,integer,text) to authenticated;

create or replace function public.api_subject_access_page(p_id uuid,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();r ecod_private.subject_requests;s ecod_private.subject_access_reviews;readable boolean;result jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>2000 then raise exception 'Invalid access review page';end if;
 select * into r from ecod_private.subject_requests where id=p_id and workspace_id=ws and kind='access';
 if not found then raise exception 'Access case not found' using errcode='42501';end if;
 select * into s from ecod_private.subject_access_reviews where workspace_id=ws and case_id=p_id order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('review',null,'rows','[]'::jsonb,'total',0,'pending',0);end if;
 readable:=s.state in ('draft','prepared') and s.expires_at>clock_timestamp() and r.status in ('in_review','awaiting_action') and r.verified_at=s.verified_at
  and exists(select 1 from public.candidates where id=r.candidate_id and workspace_id=ws and "mergedInto" is null);
 select jsonb_build_object('review',jsonb_build_object('id',s.id,'state',case when not readable then 'unavailable' else s.state end,'expiresAt',s.expires_at,'createdAt',s.created_at),
  'total',s.total,'pending',(select count(*) from ecod_private.subject_access_rows where review_id=s.id and decision='pending'),
  'rows',case when readable then(select coalesce(jsonb_agg(jsonb_build_object('category',category,'id',record_id,'data',original,'decision',decision,'approved',approved) order by category,record_id),'[]')
   from(select * from ecod_private.subject_access_rows where review_id=s.id order by category,record_id limit 25 offset p_offset)t) else '[]'::jsonb end,
  'packages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'preparedAt',prepared_at,'sha256',sha256,'included',included,'withheld',withheld) order by prepared_at desc),'[]')
   from(select * from ecod_private.subject_access_packages where review_id=s.id order by prepared_at desc limit 5)p)
 ) into result;
 return result;
end $$;
revoke all on function public.api_subject_access_page(uuid,integer) from public,anon;
grant execute on function public.api_subject_access_page(uuid,integer) to authenticated;

create or replace function public.api_review_subject_access_rows(p_operation uuid,p_id uuid,p_version integer,p_review uuid,p_decisions jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;s ecod_private.subject_access_reviews;item jsonb;row ecod_private.subject_access_rows;approved_data jsonb;desired_decision text;
begin
 if jsonb_typeof(p_decisions) is distinct from 'array' then raise exception 'Choose reviewed records';end if;
 if jsonb_array_length(p_decisions) not between 1 and 25 then raise exception 'Review 1 to 25 records per action';end if;
 if (select count(distinct jsonb_build_array(value->>'category',value->>'id')) from jsonb_array_elements(p_decisions))<>jsonb_array_length(p_decisions) then raise exception 'Duplicate review row';end if;
 ctx:=ecod_private.subject_access_operation(p_operation,p_id,p_version,jsonb_build_array('access_decide',p_review,p_decisions),p_note);
 if (ctx->>'replay')::boolean then return ctx->'result';end if;
 s:=ecod_private.check_subject_access_review(ctx,p_review);
 if s.state<>'draft' then raise exception 'Prepared reviews cannot be changed; create a new snapshot';end if;
 for item in select * from jsonb_array_elements(p_decisions) loop
  desired_decision:=item->>'decision';
  if desired_decision is null or desired_decision not in ('include','redact','withhold') then raise exception 'Every record needs an explicit decision';end if;
  select * into row from ecod_private.subject_access_rows where review_id=s.id and category=item->>'category' and record_id=(item->>'id')::uuid for update;
  if not found then raise exception 'Review row not found';end if;
  approved_data:=case desired_decision when 'include' then row.original when 'withhold' then '{}'::jsonb else item->'data' end;
  if desired_decision='redact' then
   if jsonb_typeof(approved_data) is distinct from 'object' or approved_data='{}'::jsonb then raise exception 'Provide reviewed redacted fields or withhold this record';end if;
   if exists(select 1 from jsonb_each(approved_data) x where not row.original ? x.key
     or (x.value is distinct from row.original->x.key and not(jsonb_typeof(x.value)='string' and jsonb_typeof(row.original->x.key)='string' and length(x.value::text)<=81920))) then
    raise exception 'Redaction may remove fields or replace text; it cannot introduce fields or change non-text facts';
   end if;
  end if;
  if octet_length(approved_data::text)>81920 then raise exception 'Reviewed record exceeds its safe size limit';end if;
  update ecod_private.subject_access_rows set decision=desired_decision,approved=approved_data where review_id=s.id and category=row.category and record_id=row.record_id;
 end loop;
 return ecod_private.commit_subject_access(ctx,'access_records_reviewed',p_note,jsonb_build_object('reviewId',s.id,'records',jsonb_array_length(p_decisions)));
end $$;
revoke all on function public.api_review_subject_access_rows(uuid,uuid,integer,uuid,jsonb,text) from public,anon;
grant execute on function public.api_review_subject_access_rows(uuid,uuid,integer,uuid,jsonb,text) to authenticated;

create or replace function ecod_private.subject_access_content(package uuid)
returns text language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'caseId',s.case_id,'packageId',p.id,'preparedAt',p.prepared_at,
  'actor',p.actor,'workspaceId',p.workspace_id,'snapshotAt',s.created_at,
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;
revoke all on function ecod_private.subject_access_content(uuid) from public,anon,authenticated;

create or replace function public.api_prepare_subject_access_package(p_operation uuid,p_id uuid,p_version integer,p_review uuid,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;s ecod_private.subject_access_reviews;fp text;content text;result jsonb;included integer;withheld integer;ws uuid;
begin
 ctx:=ecod_private.subject_access_operation(p_operation,p_id,p_version,jsonb_build_array('access_prepare',p_review),p_note);
 s:=ecod_private.check_subject_access_review(ctx,p_review);ws:=s.workspace_id;
 select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(category,record_id,source_hash) order by category,record_id),'[]')::text,'UTF8')),'hex') into fp
  from ecod_private.subject_access_inventory(ws,s.candidate_id);
 if fp<>s.source_hash then raise exception 'Candidate data changed; create and review a new snapshot' using errcode='40001';end if;
 if (ctx->>'replay')::boolean then
  result:=ctx->'result';content:=ecod_private.subject_access_content((result->>'packageId')::uuid);
  return result||jsonb_build_object('content',content);
 end if;
 if exists(select 1 from ecod_private.subject_access_rows where review_id=s.id and decision='pending') then raise exception 'Review every record before preparing a package';end if;
 select count(*) filter(where decision in ('include','redact')),count(*) filter(where decision='withhold') into included,withheld from ecod_private.subject_access_rows where review_id=s.id;
 if included=0 then raise exception 'At least one record must be approved for disclosure';end if;
 perform pg_advisory_xact_lock(hashtextextended('subject-access-package:'||ws::text||auth.uid()::text,0));
 if (select count(*) from ecod_private.subject_access_packages where workspace_id=ws and actor=auth.uid() and prepared_at>clock_timestamp()-interval '24 hours')>=5 then raise exception 'Access package limit reached; try again tomorrow';end if;
 insert into ecod_private.subject_access_packages values(p_operation,ws,s.id,auth.uid(),clock_timestamp(),'',included,withheld);
 content:=ecod_private.subject_access_content(p_operation);
 if octet_length(content)>2097152 then raise exception 'Package exceeds the download size limit; withhold large records or use an approved manual process';end if;
 fp:=encode(sha256(convert_to(content,'UTF8')),'hex');
 update ecod_private.subject_access_packages set sha256=fp where id=p_operation;
 update ecod_private.subject_access_reviews set state='prepared' where id=s.id;
 result:=ecod_private.commit_subject_access(ctx,'access_package_prepared',p_note,jsonb_build_object('reviewId',s.id,'packageId',p_operation,'sha256',fp));
 return result||jsonb_build_object('content',content);
end $$;
revoke all on function public.api_prepare_subject_access_package(uuid,uuid,integer,uuid,text) from public,anon;
grant execute on function public.api_prepare_subject_access_package(uuid,uuid,integer,uuid,text) to authenticated;

create or replace function public.api_record_subject_access_delivery(p_operation uuid,p_id uuid,p_version integer,p_package uuid,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;review uuid;
begin
 ctx:=ecod_private.subject_access_operation(p_operation,p_id,p_version,jsonb_build_array('access_delivery',p_package),p_note);
 if (ctx->>'replay')::boolean then return ctx->'result';end if;
 select s.id into review from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id
  where p.id=p_package and p.workspace_id=(ctx->'case'->>'workspace_id')::uuid and s.case_id=p_id and s.verified_at=(ctx->'case'->>'verified_at')::timestamptz;
 if not found then raise exception 'Package receipt is not available for this verification';end if;
 return ecod_private.commit_subject_access(ctx,'access_delivery_recorded',p_note,jsonb_build_object('packageId',p_package,'reviewId',review));
end $$;
revoke all on function public.api_record_subject_access_delivery(uuid,uuid,integer,uuid,text) from public,anon;
grant execute on function public.api_record_subject_access_delivery(uuid,uuid,integer,uuid,text) to authenticated;

create or replace function public.worker_purge_subject_access_reviews(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record;n integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid cleanup batch';end if;
 for s in select id from ecod_private.subject_access_reviews where state in ('draft','prepared') and expires_at<=clock_timestamp()
  order by expires_at,id limit p_limit for update skip locked loop
  delete from ecod_private.subject_access_rows where review_id=s.id;
  update ecod_private.subject_access_reviews set state='expired' where id=s.id;n:=n+1;
 end loop;
 return jsonb_build_object('purged',n);
end $$;
revoke all on function public.worker_purge_subject_access_reviews(integer) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_purge_subject_access_reviews(integer) to service_role;end if;end $$;
commit;
