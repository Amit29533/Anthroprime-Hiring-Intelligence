begin;
create table if not exists ecod_access_private.duplicate_events(id uuid primary key,workspace_id uuid not null,candidate_a uuid not null,candidate_b uuid not null,actor uuid not null,status text not null check(status in('distinct','deferred','merged')),reason text not null,profile_head text not null,request_hash text not null,result jsonb not null,at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,check(candidate_a<candidate_b));
create index if not exists stage1_duplicate_pair on ecod_access_private.duplicate_events(workspace_id,candidate_a,candidate_b,at desc);
alter table ecod_access_private.duplicate_events enable row level security;
revoke all on ecod_access_private.duplicate_events from public,anon,authenticated;
create or replace function ecod_access_private.duplicate_head(ws uuid,a uuid,b uuid)returns text language plpgsql stable security invoker set search_path=''as $$
declare stamps text;name text;records jsonb;family uuid[];begin
 stamps:=ecod_access_private.facts_head(ws,a)||ecod_access_private.facts_head(ws,b);family:=ecod_access_private.identity_family(ws,a)||ecod_access_private.identity_family(ws,b);
 for name in select table_name from information_schema.columns where table_schema='public'and column_name='candidateId' order by table_name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from(select *from public.%I x where workspace_id=$1 and "candidateId"=any($2)order by to_jsonb(x)::text limit 2001)t',name)into records using ws,family;
  if jsonb_array_length(records)>2000 then raise exception 'Linked history exceeds safe merge limit; request a manual review';end if;stamps:=stamps||encode(sha256(convert_to(records::text,'UTF8')),'hex');
 end loop;
 select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')into records from(select *from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=any(family)order by id limit 2001)t;
 if jsonb_array_length(records)>2000 then raise exception 'Contact history exceeds safe merge limit';end if;stamps:=stamps||records::text;
 select coalesce(jsonb_agg(to_jsonb(t)order by sequence),'[]')into records from(select *from ecod_access_private.duplicate_events where workspace_id=ws and candidate_a=least(a,b)and candidate_b=greatest(a,b)order by sequence limit 2001)t;
 if jsonb_array_length(records)>2000 then raise exception 'Review history exceeds safe limit';end if;stamps:=stamps||records::text;
 return md5((select secret from ecod_access_private.token_secret)||stamps);
end $$;
create or replace function ecod_access_private.duplicate_context(p_a uuid,p_b uuid,p_events_offset integer default 0)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);a public.candidates;b public.candidates;events jsonb;fields text[]:=array['name','email','phone','title','company','location','experience','relevantExperience','notice','mode','status','source','engagement','earliestStart','activeStatus','summary','linkedin'];begin
 if p_a is null or p_b is null or p_a=p_b or p_events_offset is null or p_events_offset<0 or p_events_offset>1000000 then raise exception 'Two different candidates and a valid history page are required';end if;
 select *into a from public.candidates where workspace_id=ws and id=p_a and "mergedInto"is null;select *into b from public.candidates where workspace_id=ws and id=p_b and "mergedInto"is null;
 if a.id is null or b.id is null then raise exception 'Candidate not found in your workspace';end if;
 if public.is_admin()then fields:=fields||array['current','expected'];end if;
 select coalesce(jsonb_agg(to_jsonb(t)-array['request_hash','result']order by sequence desc),'[]')into events from(select *from ecod_access_private.duplicate_events where workspace_id=ws and candidate_a=least(p_a,p_b)and candidate_b=greatest(p_a,p_b)order by sequence desc limit 26 offset p_events_offset)t;
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',p_a,'duplicate_review_read',p_b::text,auth.uid()::text),(ws,'candidates',p_b,'duplicate_review_read',p_a::text,auth.uid()::text);
 return jsonb_build_object('a',case when public.is_admin()then to_jsonb(a)else ecod_access_private.redact_financial(to_jsonb(a))end,'b',case when public.is_admin()then to_jsonb(b)else ecod_access_private.redact_financial(to_jsonb(b))end,'head',ecod_access_private.duplicate_head(ws,p_a,p_b),'profileHead',md5(ecod_access_private.candidate_token(least(p_a,p_b))||ecod_access_private.candidate_token(greatest(p_a,p_b))),'fields',fields,'events',case when jsonb_array_length(events)>25 then events-25 else events end,'eventsMore',jsonb_array_length(events)>25,'eventsOffset',p_events_offset,'held',a."processingRestricted"or b."processingRestricted");
end $$;
create or replace function ecod_access_private.duplicate_queue(p_offset integer,p_reviewed boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);rows jsonb;bounded boolean;begin
 if p_offset is null or p_offset<0 or p_offset>1000000 or p_reviewed is null then raise exception 'Invalid duplicate page';end if;
 select count(*)>1000 into bounded from(select id from public.candidates where workspace_id=ws and "mergedInto"is null limit 1001)t;
 with roots as materialized(select id,name,company,location,linkedin,"anthroId"from public.candidates where workspace_id=ws and "mergedInto"is null order by id limit 1000),pairs as(
 select a.id a,b.id b,a.name a_name,b.name b_name,a."anthroId"a_anthro,b."anthroId"b_anthro,case when btrim(a.linkedin)<>''and lower(btrim(a.linkedin))=lower(btrim(b.linkedin))then'Exact LinkedIn reference'when btrim(a.company)<>''and lower(btrim(a.company))=lower(btrim(b.company))then'Name and employer match'else'Name and location match'end reason
 from roots a join roots b on a.id<b.id and((btrim(a.linkedin)<>''and lower(btrim(a.linkedin))=lower(btrim(b.linkedin)))or(btrim(a.name)<>''and lower(btrim(a.name))=lower(btrim(b.name))and((btrim(a.company)<>''and lower(btrim(a.company))=lower(btrim(b.company)))or(btrim(a.location)<>''and lower(btrim(a.location))=lower(btrim(b.location)))))))
 select coalesce(jsonb_agg(to_jsonb(t)order by a,b),'[]')into rows from(select p.*,decision.status,decision.reason review_reason from pairs p left join lateral(select status,reason,profile_head from ecod_access_private.duplicate_events where workspace_id=ws and candidate_a=p.a and candidate_b=p.b order by sequence desc limit 1)decision on true where p_reviewed or decision.status is null or decision.profile_head<>md5(ecod_access_private.candidate_token(p.a)||ecod_access_private.candidate_token(p.b))order by p.a,p.b limit 26 offset p_offset)t;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'bounded',bounded,'scope','Suggestions compare the first 1000 active identities. Review any other pair by Anthro-ID. Similarity is not proof of identity.');
end $$;
create or replace function ecod_access_private.duplicate_decide(p_a uuid,p_b uuid,p_operation uuid,p_head text,p_status text,p_reason text,p_picks jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(true);a public.candidates;b public.candidates;prior ecod_access_private.duplicate_events;context jsonb;fingerprint text;entry jsonb;field text;changes text;contact_kind text;contact_value text;original jsonb;normal text;contact_id uuid;result jsonb;alias_count integer;begin
 if p_a is null or p_b is null or p_a=p_b or p_operation is null or p_head is null or p_head!~'^[a-f0-9]{32}$'or p_status is null or p_status not in('distinct','deferred','merged')or p_reason is null or length(btrim(p_reason))not between 3 and 1000 or jsonb_typeof(p_picks)is distinct from'object'or octet_length(p_picks::text)>4000 then raise exception 'Invalid duplicate decision';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_operation::text,0));
 fingerprint:=md5(jsonb_build_array(p_a,p_b,p_status,btrim(p_reason),p_picks)::text);
 select *into prior from ecod_access_private.duplicate_events where id=p_operation;
 if found then if prior.workspace_id<>ws or prior.actor<>auth.uid()or prior.request_hash<>fingerprint then raise exception 'Duplicate operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform 1 from public.candidates where workspace_id=ws and id in(p_a,p_b)order by id for update;
 select *into a from public.candidates where workspace_id=ws and id=p_a and "mergedInto"is null;select *into b from public.candidates where workspace_id=ws and id=p_b and "mergedInto"is null;
 if a.id is null or b.id is null then raise exception 'Candidate not found or already merged';end if;
 context:=ecod_access_private.duplicate_context(p_a,p_b);
 if context->>'head'<>p_head then raise exception 'Candidate, contacts or links changed. Reload before deciding.'using errcode='40001';end if;
 if p_status='merged'then
  if(context->>'held')::boolean then raise exception 'Release the outbound hold before merging';end if;
  alias_count:=cardinality(ecod_access_private.identity_family(ws,p_a))+cardinality(ecod_access_private.identity_family(ws,p_b));if alias_count>100 then raise exception 'Merged identity family exceeds safe limit';end if;
  if exists(select 1 from jsonb_object_keys(p_picks)k where not(context->'fields')?k)or exists(select 1 from jsonb_each_text(p_picks)x where x.value is null or x.value not in('a','b'))or not p_picks?&array(select jsonb_array_elements_text(context->'fields'))then raise exception 'Review every permitted field before merging';end if;
  entry:='{}';for field in select jsonb_array_elements_text(context->'fields')loop entry:=entry||jsonb_build_object(field,case when p_picks->>field='b'then to_jsonb(b)->field else to_jsonb(a)->field end);end loop;
  -- Release unique primary identifiers before applying reviewed values. All changes roll back together.
  update public.candidates set email='',phone='',"mergedInto"=p_a where workspace_id=ws and id=p_b;
  -- Preserve discarded primary contacts as unconfirmed alternate evidence, without granting consent.
  for original in select *from jsonb_array_elements(jsonb_build_array(to_jsonb(a),to_jsonb(b)))loop
  foreach contact_kind in array array['email','phone']loop
   contact_value:=original->>contact_kind;
   if coalesce(contact_value,'')<>''then
    normal:=case when contact_kind='email'then lower(btrim(contact_value))else ltrim(regexp_replace(contact_value,'[^0-9]','','g'),'0')end;
    if not exists(select 1 from ecod_contacts_private.contacts where workspace_id=ws and kind=contact_kind and normalized=normal and active)then
     insert into ecod_contacts_private.contacts(id,workspace_id,candidate_id,kind,value,normalized,label,source,created_by)values(gen_random_uuid(),ws,p_a,contact_kind,contact_value,normal,'Merged primary','Reviewed merge',auth.uid())returning id into contact_id;
     insert into ecod_contacts_private.contact_events(workspace_id,contact_id,candidate_id,action,actor,reason,snapshot)select ws,id,p_a,'merged_primary',auth.uid(),'Original primary retained; confirmation required',to_jsonb(t)from ecod_contacts_private.contacts t where id=contact_id;
    end if;
   end if;
  end loop;end loop;
  select string_agg(format('%I=r.%I',key,key),',')into changes from jsonb_object_keys(entry)key;
  execute format('update public.candidates c set %s from jsonb_populate_record(null::public.candidates,$1)r where c.workspace_id=$2 and c.id=$3',changes)using entry,ws,p_a;
  update ecod_access_private.assignments set revoked_at=clock_timestamp(),version=version+1 where workspace_id=ws and kind='evaluation'and target_id=p_b and revoked_at is null;
 else if p_picks<>'{}'::jsonb then raise exception 'Field choices apply only to a merge';end if;end if;
 result:=jsonb_build_object('status',p_status,'survivor',case when p_status='merged'then p_a end,'retired',case when p_status='merged'then p_b end,'replayed',false);
 insert into ecod_access_private.duplicate_events(id,workspace_id,candidate_a,candidate_b,actor,status,reason,profile_head,request_hash,result)values(p_operation,ws,least(p_a,p_b),greatest(p_a,p_b),auth.uid(),p_status,btrim(p_reason),context->>'profileHead',fingerprint,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',p_a,'duplicate_'||p_status,p_b::text||': '||btrim(p_reason),auth.uid()::text),(ws,'candidates',p_b,'duplicate_'||p_status,p_a::text||': '||btrim(p_reason),auth.uid()::text);
 return result;
end $$;
create or replace function public.api_duplicate_queue(p_offset integer default 0,p_reviewed boolean default false)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.duplicate_queue(p_offset,p_reviewed)$$;
create or replace function public.api_duplicate_context(p_a uuid,p_b uuid,p_events_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.duplicate_context(p_a,p_b,p_events_offset)$$;
create or replace function public.api_duplicate_decision(p_a uuid,p_b uuid,p_operation uuid,p_head text,p_status text,p_reason text,p_picks jsonb default'{}')returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.duplicate_decide(p_a,p_b,p_operation,p_head,p_status,p_reason,p_picks)$$;
revoke all on function ecod_access_private.duplicate_head(uuid,uuid,uuid),ecod_access_private.duplicate_context(uuid,uuid,integer),ecod_access_private.duplicate_queue(integer,boolean),ecod_access_private.duplicate_decide(uuid,uuid,uuid,text,text,text,jsonb),public.api_duplicate_queue(integer,boolean),public.api_duplicate_context(uuid,uuid,integer),public.api_duplicate_decision(uuid,uuid,uuid,text,text,text,jsonb)from public,anon,authenticated;
grant execute on function ecod_access_private.duplicate_context(uuid,uuid,integer),ecod_access_private.duplicate_queue(integer,boolean),ecod_access_private.duplicate_decide(uuid,uuid,uuid,text,text,text,jsonb),public.api_duplicate_queue(integer,boolean),public.api_duplicate_context(uuid,uuid,integer),public.api_duplicate_decision(uuid,uuid,uuid,text,text,text,jsonb)to authenticated;
commit;
