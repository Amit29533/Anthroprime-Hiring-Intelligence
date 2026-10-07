-- N2.1: sourced alternate contacts, explicit confirmation and immutable evidence events.
begin;
create schema if not exists ecod_contacts_private;
revoke all on schema ecod_contacts_private from public,anon,authenticated;
create table if not exists ecod_contacts_private.contacts (
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,
 kind text not null check(kind in ('email','phone')),value text not null,normalized text not null,
 label text not null default '',source text not null,
 active boolean not null default true,preferred boolean not null default false,
 verified_at timestamptz,verified_by uuid,verification_note text not null default '',
 version integer not null default 1 check(version>0),created_at timestamptz not null default clock_timestamp(),created_by uuid,
 unique(workspace_id,id),foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id),
 check(not preferred or (active and verified_at is not null)),check(length(value)<=254 and length(label)<=60 and length(source) between 3 and 80)
);
create unique index if not exists contacts_unique_active on ecod_contacts_private.contacts(workspace_id,kind,normalized) where active;
create unique index if not exists contacts_preferred on ecod_contacts_private.contacts(workspace_id,candidate_id,kind) where active and preferred;
create index if not exists contacts_person on ecod_contacts_private.contacts(workspace_id,candidate_id,id);
create table if not exists ecod_contacts_private.contact_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,contact_id uuid not null,candidate_id uuid not null,
 action text not null,actor uuid,at timestamptz not null default clock_timestamp(),reason text not null,snapshot jsonb not null,
 foreign key(workspace_id,contact_id) references ecod_contacts_private.contacts(workspace_id,id)
);
create index if not exists contact_events_person on ecod_contacts_private.contact_events(workspace_id,contact_id,at desc,id);
create table if not exists ecod_contacts_private.contact_receipts (
 workspace_id uuid not null,actor uuid not null,operation_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,operation_id)
);
alter table ecod_contacts_private.contacts enable row level security;
alter table ecod_contacts_private.contact_events enable row level security;
alter table ecod_contacts_private.contact_receipts enable row level security;
revoke all on ecod_contacts_private.contacts,ecod_contacts_private.contact_events,ecod_contacts_private.contact_receipts from public,anon,authenticated;

create or replace function ecod_contacts_private.normalize_contact(p_kind text,p_value text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare value text:=btrim(p_value);normalized text;
begin
 if value is null or length(value)>254 then raise exception 'Invalid contact value';end if;
 if p_kind='email' then
  if value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email address';end if;
  return lower(value);
 elsif p_kind='phone' then
  normalized:=ltrim(regexp_replace(value,'[^0-9]','','g'),'0');
  if value!~'^\+?[0-9[:space:]().-]+$' or length(normalized) not between 7 and 15 then raise exception 'Invalid phone number';end if;
  return normalized;
 end if;
 raise exception 'Invalid contact kind';
end $$;

-- Primary profile writes and alternate-contact writes take the same value lock.
-- This keeps all existing import/API/UI entry points inside duplicate protection.
create or replace function ecod_contacts_private.guard_primary_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;normal text;
begin
 for item in select * from (values('email',new.email),('phone',new.phone)) v(kind,value) order by kind loop
  if coalesce(btrim(item.value),'')='' then continue;end if;
  -- Preserve legacy validation behavior; normalization here only compares existing identifiers.
  normal:=case item.kind when 'email' then lower(btrim(item.value)) else ltrim(regexp_replace(item.value,'[^0-9]','','g'),'0') end;
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':'||item.kind||':'||normal,0));
  if exists(select 1 from ecod_contacts_private.contacts c where c.workspace_id=new.workspace_id and c.kind=item.kind and c.normalized=normal and c.active and c.candidate_id<>new.id) then
   raise exception 'Contact is already linked to another candidate; review duplicates' using errcode='23505';
  end if;
 end loop;
 return new;
end $$;
drop trigger if exists alternate_contact_guard on public.candidates;
create trigger alternate_contact_guard before insert or update of email,phone on public.candidates for each row execute function ecod_contacts_private.guard_primary_contact();

create or replace function ecod_contacts_private.contacts_read(p_candidate uuid,p_offset integer,p_events_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();person uuid;items jsonb;events jsonb;primary_email text;primary_phone text;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 10000 or p_events_offset is null or p_events_offset not between 0 and 100000 then raise exception 'Invalid contact page';end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;
 if person is null then raise exception 'Candidate not found in your workspace';end if;
 select email,phone into primary_email,primary_phone from public.candidates where workspace_id=ws and id=person;
 select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') into items from
  (select id,kind,value,label,source,active,preferred,verified_at,verified_by,verification_note,version,created_at from ecod_contacts_private.contacts
   where workspace_id=ws and candidate_id=person order by id limit 51 offset p_offset) c;
 select coalesce(jsonb_agg(to_jsonb(e) order by at desc,id desc),'[]') into events from
  (select e.id,e.contact_id,e.action,e.actor,e.at,e.reason,e.snapshot from ecod_contacts_private.contact_events e
   join ecod_contacts_private.contacts c on c.workspace_id=e.workspace_id and c.id=e.contact_id
   where c.workspace_id=ws and c.candidate_id=person order by e.at desc,e.id desc limit 51 offset p_events_offset) e;
 return jsonb_build_object('candidateId',person,'primaryEmail',primary_email,'primaryPhone',primary_phone,
  'rows',case when jsonb_array_length(items)>50 then items-50 else items end,'more',jsonb_array_length(items)>50,
  'events',case when jsonb_array_length(events)>50 then events-50 else events end,'eventsMore',jsonb_array_length(events)>50);
end $$;

create or replace function ecod_contacts_private.contacts_change(p_candidate uuid,p_operation uuid,p_action text,p_contact uuid,p_version integer,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();acting_user uuid:=auth.uid();person public.candidates;c ecod_contacts_private.contacts;
 request jsonb;receipt ecod_contacts_private.contact_receipts;result jsonb;normal text;reason text;prior record;
begin
 if acting_user is null or ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501';end if;
 if p_candidate is null or p_operation is null or p_contact is null or p_action is null or p_action not in ('add','verify','prefer','retire')
  or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>2500 then raise exception 'Invalid contact request';end if;
 if exists(select 1 from jsonb_each(p_details) x where x.key<>all(array['kind','value','label','source','reason']) or jsonb_typeof(x.value)<>'string') then raise exception 'Invalid contact detail';end if;
 request:=jsonb_build_object('candidate',p_candidate,'action',p_action,'contact',p_contact,'version',p_version,'details',p_details);
 select * into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace';end if;
 select * into receipt from ecod_contacts_private.contact_receipts r where r.workspace_id=ws and r.actor=acting_user and r.operation_id=p_operation;
 if found then
  if receipt.request<>request then raise exception 'Contact operation conflict' using errcode='40001';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 reason:=btrim(coalesce(p_details->>'reason',''));
 if p_action='add' then
  if p_version is distinct from 0 or coalesce(length(btrim(p_details->>'source')),0) not between 3 and 80
   or length(coalesce(p_details->>'label',''))>60 then raise exception 'Provide contact source and supported details';end if;
  normal:=ecod_contacts_private.normalize_contact(p_details->>'kind',p_details->>'value');
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||(p_details->>'kind')||':'||normal,0));
  if (select count(*) from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=p_candidate and active)>=30
   or (select count(*) from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=p_candidate)>=200 then raise exception 'Contact limit reached; review existing contacts';end if;
  if exists(select 1 from public.candidates x where x.workspace_id=ws and x.id<>p_candidate and x."mergedInto" is null and
   (case when p_details->>'kind'='email' then lower(btrim(x.email)) else ltrim(regexp_replace(x.phone,'[^0-9]','','g'),'0') end)=normal)
   or exists(select 1 from ecod_contacts_private.contacts x where x.workspace_id=ws and x.active and x.kind=p_details->>'kind' and x.normalized=normal) then
   raise exception 'Contact is already linked; review duplicates' using errcode='23505';end if;
  insert into ecod_contacts_private.contacts(id,workspace_id,candidate_id,kind,value,normalized,label,source,created_by)
   values(p_contact,ws,p_candidate,p_details->>'kind',btrim(p_details->>'value'),normal,btrim(coalesce(p_details->>'label','')),btrim(p_details->>'source'),acting_user) returning * into c;
  reason:='Recorded as declared; no ownership verification performed';
 else
  if p_version is null or p_version<1 or length(reason) not between 10 and 1000 then raise exception 'Provide 10–1000 characters of verification/change evidence';end if;
  select * into c from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=p_candidate and id=p_contact for update;
  if not found then raise exception 'Contact not found in this candidate';end if;
  if c.version<>p_version then raise exception 'Contact changed. Refresh before retrying.' using errcode='40001';end if;
  if not c.active then raise exception 'Retired contacts cannot be changed';end if;
  if p_action='prefer' then
   if c.verified_at is null then raise exception 'Confirm the contact before marking it preferred';end if;
   for prior in select * from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=p_candidate and kind=c.kind and preferred and id<>c.id for update loop
    update ecod_contacts_private.contacts set preferred=false,version=version+1 where id=prior.id;
    insert into ecod_contacts_private.contact_events(workspace_id,contact_id,candidate_id,action,actor,reason,snapshot)
     select ws,id,candidate_id,'preference_replaced',acting_user,reason,to_jsonb(x) from ecod_contacts_private.contacts x where id=prior.id;
   end loop;
  end if;
  update ecod_contacts_private.contacts set version=version+1,
   verified_at=case when p_action='verify' then clock_timestamp() else verified_at end,
   verified_by=case when p_action='verify' then acting_user else verified_by end,
   verification_note=case when p_action='verify' then reason else verification_note end,
   preferred=case when p_action='prefer' then true when p_action='retire' then false else preferred end,
   active=case when p_action='retire' then false else active end where id=c.id returning * into c;
 end if;
 insert into ecod_contacts_private.contact_events(workspace_id,contact_id,candidate_id,action,actor,reason,snapshot)
 values(ws,c.id,p_candidate,p_action,acting_user,reason,to_jsonb(c));
 result:=jsonb_build_object('contactId',c.id,'version',c.version,'replayed',false);
 insert into ecod_contacts_private.contact_receipts(workspace_id,actor,operation_id,request,result) values(ws,acting_user,p_operation,request,result);
 return result;
end $$;

-- Preserve contact evidence through existing merges; primary profile behavior stays unchanged.
create or replace function ecod_contacts_private.merge_contacts() returns trigger
language plpgsql security definer set search_path='' as $$
declare c record;
begin
 if new."mergedInto" is distinct from old."mergedInto" and new."mergedInto" is not null then
  for c in select * from ecod_contacts_private.contacts where workspace_id=new.workspace_id and candidate_id=new.id for update loop
   update ecod_contacts_private.contacts set candidate_id=new."mergedInto",preferred=false,version=version+1 where id=c.id;
   insert into ecod_contacts_private.contact_events(workspace_id,contact_id,candidate_id,action,actor,reason,snapshot)
    select x.workspace_id,x.id,x.candidate_id,'merged',auth.uid(),'Preserved from retired candidate; preferred choice requires review',to_jsonb(x) from ecod_contacts_private.contacts x where id=c.id;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists merge_candidate_contacts on public.candidates;
create trigger merge_candidate_contacts after update of "mergedInto" on public.candidates for each row execute function ecod_contacts_private.merge_contacts();

create or replace function public.api_candidate_contacts(p_candidate uuid,p_offset integer default 0,p_events_offset integer default 0)
returns jsonb language sql security invoker set search_path='' as $$select ecod_contacts_private.contacts_read(p_candidate,p_offset,p_events_offset)$$;
create or replace function public.api_change_candidate_contact(p_candidate uuid,p_operation uuid,p_action text,p_contact uuid,p_version integer,p_details jsonb)
returns jsonb language sql security invoker set search_path='' as $$select ecod_contacts_private.contacts_change(p_candidate,p_operation,p_action,p_contact,p_version,p_details)$$;
revoke all on function ecod_contacts_private.normalize_contact(text,text),ecod_contacts_private.guard_primary_contact(),ecod_contacts_private.merge_contacts(),
 ecod_contacts_private.contacts_read(uuid,integer,integer),ecod_contacts_private.contacts_change(uuid,uuid,text,uuid,integer,jsonb),
 public.api_candidate_contacts(uuid,integer,integer),public.api_change_candidate_contact(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant usage on schema ecod_contacts_private to authenticated;
grant execute on function ecod_contacts_private.contacts_read(uuid,integer,integer),ecod_contacts_private.contacts_change(uuid,uuid,text,uuid,integer,jsonb),
 public.api_candidate_contacts(uuid,integer,integer),public.api_change_candidate_contact(uuid,uuid,text,uuid,integer,jsonb) to authenticated;

-- Extend erasure source-change detection; access packages explicitly disclose the remaining exclusion.
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
  ('history','history'),('auditEvents','history'),('contactRecords','records'),('contactEvents','history'),('contactReceipts','integrations')
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
  'scopeNotice','Reviewed direct candidate records only. Original file bytes, raw CV extraction, opaque custom fields, alternate-contact records and private contact verification/operation history, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records are not included. Preparation does not prove delivery or complete legal fulfillment.',
  'withheldRecords',p.withheld,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('category',category,'recordId',record_id,'data',approved) order by category,record_id),'[]')
   from ecod_private.subject_access_rows where review_id=s.id and decision in ('include','redact'))
 )::text from ecod_private.subject_access_packages p join ecod_private.subject_access_reviews s on s.id=p.review_id where p.id=package;
$$;
revoke all on function ecod_private.erasure_inventory(uuid,uuid),ecod_private.subject_access_content(uuid) from public,anon,authenticated;
commit;
