begin;
alter table public.candidates drop constraint if exists candidates_mode_check;
alter table public.candidates add constraint candidates_mode_check check(mode in ('','Flexible','Remote','Hybrid','Onsite'));
do $$declare name text;begin
 foreach name in array array['employmentHistory','compensationHistory','availabilityHistory'] loop
  execute format('alter table public.%I add column if not exists observed date, add column if not exists "recordedBy" uuid, add column if not exists "recordedAt" timestamptz, add column if not exists verification text not null default ''observed'', add column if not exists "verifiedBy" uuid, add column if not exists "verifiedAt" timestamptz, add column if not exists supersedes uuid, add column if not exists "appliedCurrent" boolean not null default false, add column if not exists "operationApplied" boolean not null default false, add column if not exists "requestFingerprint" text not null default ''''',name);
  execute format('create unique index if not exists %I on public.%I(workspace_id,supersedes) where supersedes is not null',lower(name)||'_superseded_once',name);
 end loop;
end $$;
alter table public."compensationHistory" add column if not exists components jsonb not null default '{}',add column if not exists "amountUnit" text not null default 'legacy-profile';

create or replace function ecod_access_private.stamp_fact_record()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new."recordedBy":=auth.uid();new."recordedAt":=clock_timestamp();
 if new.verification='confirmed' then new."verifiedBy":=auth.uid();new."verifiedAt":=clock_timestamp();else new."verifiedBy":=null;new."verifiedAt":=null;end if;
 return new;
end $$;
revoke all on function ecod_access_private.stamp_fact_record()from public,anon,authenticated;
do $$declare name text;cols text;begin
 foreach name in array array['employmentHistory','compensationHistory','availabilityHistory'] loop
  execute format('drop trigger if exists zz_stage1_fact_stamp on public.%I',name);
  execute format('create trigger zz_stage1_fact_stamp before insert on public.%I for each row execute function ecod_access_private.stamp_fact_record()',name);
  select string_agg(quote_ident(attname),',') into cols from pg_attribute where attrelid=format('public.%I',name)::regclass and attnum>0 and not attisdropped and attname not in ('verification','verifiedBy','verifiedAt','supersedes','appliedCurrent','operationApplied','requestFingerprint','amountUnit','recordedBy','recordedAt');
  execute format('revoke insert on public.%I from authenticated',name);
  execute format('grant insert(%s) on public.%I to authenticated',cols,name);
 end loop;
end $$;

create or replace function ecod_access_private.identity_family(ws uuid,person uuid)returns uuid[]language plpgsql stable security invoker set search_path='' as $$
declare family uuid[];begin
 with recursive relatives as(select id from public.candidates where workspace_id=ws and id=person union select c.id from public.candidates c join relatives r on c."mergedInto"=r.id where c.workspace_id=ws)
 select array_agg(id)into family from(select id from relatives limit 101)t;
 if cardinality(family)>100 then raise exception 'Identity scope exceeds its safe limit';end if;return family;
end $$;
create or replace function ecod_access_private.facts_head(ws uuid,person uuid)returns text language plpgsql stable security invoker set search_path='' as $$
declare family uuid[]:=ecod_access_private.identity_family(ws,person);name text;rows jsonb;stamps text:=ecod_access_private.candidate_token(person);begin
 foreach name in array array['employmentHistory','compensationHistory','availabilityHistory']loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by id),''[]'')from(select * from public.%I where workspace_id=$1 and "candidateId"=any($2)order by id limit 2001)t',name)into rows using ws,family;
  if jsonb_array_length(rows)>2000 then raise exception 'Fact history exceeds safe limit; use an approved manual review';end if;
  stamps:=stamps||encode(sha256(convert_to(rows::text,'UTF8')),'hex');
 end loop;
 return md5((select secret from ecod_access_private.token_secret)||stamps);
end $$;
create or replace function ecod_access_private.fact_date(p_value jsonb,p_name text,p_required boolean default false)returns date language plpgsql immutable security invoker set search_path='' as $$
declare result date;begin
 if p_value is null or p_value='null'::jsonb then if p_required then raise exception '% is required',p_name;end if;return null;end if;
 if jsonb_typeof(p_value)<>'string' or p_value#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid %',p_name;end if;
 result:=(p_value#>>'{}')::date;if result<date '1900-01-01' or result>date '2100-12-31'then raise exception 'Invalid %',p_name;end if;return result;
end $$;

create or replace function ecod_access_private.confirmation_state(p_kind text,p_profile jsonb,p_fact jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare matches boolean;state text;amount numeric;begin
 if p_fact is null then return jsonb_build_object('state','unconfirmed','stale',true);end if;
 if p_kind='employment'then matches:=(p_fact->>'company',p_fact->>'title',p_fact->>'location',p_fact->>'employmentType')is not distinct from(p_profile->>'company',p_profile->>'title',p_profile->>'location',p_profile->>'engagement');
 elsif p_kind='availability'then matches:=(p_fact->>'notice',p_fact->>'earliestStart',p_fact->>'status',p_fact->>'mode')is not distinct from(p_profile->>'notice',p_profile->>'earliestStart',p_profile->>'activeStatus',p_profile->>'mode');
 else
  if p_fact->>'amountUnit'<>'currency'or p_fact->>'currency'<>'INR'or p_fact->>'basis'not in('Annual','Monthly')then state:='historical-currency';
  else amount:=(p_fact->>'amount')::numeric*(case when p_fact->>'basis'='Monthly'then 12 else 1 end)/100000;matches:=amount is not distinct from(p_profile->>(p_fact->>'kind'))::numeric;end if;
 end if;
 return jsonb_build_object('state',coalesce(state,case when matches then'matches-current'else'current-differs'end),'stale',p_fact->>'observed'is null or(p_fact->>'observed')::date<(statement_timestamp()at time zone'UTC')::date-120,'observed',p_fact->>'observed','recordId',p_fact->>'id');
end $$;
revoke all on function ecod_access_private.confirmation_state(text,jsonb,jsonb)from public,anon,authenticated;

create or replace function ecod_access_private.facts_read(p_candidate uuid,p_kind text,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_access_private.member_workspace(false);person uuid;family uuid[];name text;rows jsonb;latest jsonb;profile jsonb;states jsonb;confirmed_by_kind jsonb:='{}';pay_kind text;item jsonb;
begin
 if p_kind not in ('employment','compensation','availability')or p_kind is null or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid facts request';end if;
 if p_kind='compensation'and not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;if person is null then raise exception 'Candidate not found in your workspace';end if;
 family:=ecod_access_private.identity_family(ws,person);name:=case p_kind when'employment'then'employmentHistory'when'compensation'then'compensationHistory'else'availabilityHistory'end;
 execute format('select coalesce(jsonb_agg(j order by recorded desc nulls last,id desc),''[]'')from(select to_jsonb(t)||jsonb_build_object(''superseded'',exists(select 1 from public.%I child where child.workspace_id=$1 and child.supersedes=t.id))j,t."recordedAt"recorded,t.id from public.%I t where t.workspace_id=$1 and t."candidateId"=any($2)order by t."recordedAt"desc nulls last,t.id desc limit 26 offset $3)q',name,name)into rows using ws,family,p_offset;
 execute format('select to_jsonb(t)from public.%I t where t.workspace_id=$1 and t."candidateId"=any($2)and t.verification=''confirmed''and not exists(select 1 from public.%I child where child.workspace_id=$1 and child.supersedes=t.id)and(t.observed is null or t.observed<=(statement_timestamp()at time zone''UTC'')::date) %s order by t.observed desc nulls last,t."recordedAt"desc nulls last,t.id desc limit 1',name,name,case when p_kind='employment'then'and(t."startDate"is null or t."startDate"<=current_date)and(t."endDate"is null or t."endDate">=current_date)'else''end)into latest using ws,family;
 select jsonb_build_object('company',company,'title',title,'location',location,'engagement',engagement,'notice',notice,'earliestStart',"earliestStart",'activeStatus',"activeStatus",'mode',mode)
 ||case when p_kind='compensation'then jsonb_build_object('current',current,'expected',expected,'currency','INR')else'{}'::jsonb end into profile from public.candidates where workspace_id=ws and id=person;
 if p_kind='compensation'then
  states:='{}';foreach pay_kind in array array['current','expected']loop
   select to_jsonb(t)into item from public."compensationHistory"t where t.workspace_id=ws and t."candidateId"=any(family)and t.kind=pay_kind and t.verification='confirmed'and t.observed<=(statement_timestamp()at time zone'UTC')::date and not exists(select 1 from public."compensationHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by t.observed desc,t."recordedAt"desc nulls last,t.id desc limit 1;
   confirmed_by_kind:=confirmed_by_kind||jsonb_build_object(pay_kind,item);states:=states||jsonb_build_object(pay_kind,ecod_access_private.confirmation_state(p_kind,profile,item));
  end loop;
 else states:=ecod_access_private.confirmation_state(p_kind,profile,latest);end if;
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',person,'server_read','Sourced '||p_kind||' facts',auth.uid()::text);
 return jsonb_build_object('candidateId',person,'kind',p_kind,'head',ecod_access_private.facts_head(ws,person),'current',profile,'latestConfirmed',latest,'latestConfirmedByKind',confirmed_by_kind,'confirmationState',states,'rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'offset',p_offset);
end $$;

create or replace function ecod_access_private.facts_record(p_candidate uuid,p_kind text,p_operation uuid,p_head text,p_details jsonb,p_confirmed boolean,p_apply_current boolean,p_supersedes uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_access_private.member_workspace(true);actor uuid:=auth.uid();family uuid[];name text;person public.candidates;prior jsonb;parent jsonb;entry jsonb;key text;keys text[];fingerprint text;columns_sql text;values_sql text;
 observed_day date;start_day date;end_day date;source_text text;amount numeric;part numeric;total numeric:=0;legacy_amount numeric;today_utc date:=(statement_timestamp()at time zone'UTC')::date;
begin
 if p_kind not in ('employment','compensation','availability')or p_kind is null or p_operation is null or p_head is null or p_head!~'^[a-f0-9]{32}$'or jsonb_typeof(p_details)is distinct from'object'or octet_length(p_details::text)>16000 or p_confirmed is null or p_apply_current is null then raise exception 'Invalid fact request';end if;
 if p_kind='compensation'and not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;
 select * into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto"is null for update;if not found then raise exception 'Candidate not found in your workspace';end if;
 family:=ecod_access_private.identity_family(ws,p_candidate);name:=case p_kind when'employment'then'employmentHistory'when'compensation'then'compensationHistory'else'availabilityHistory'end;
 keys:=case p_kind when'employment'then array['company','title','location','employmentType','startDate','endDate','source','observed']when'compensation'then array['kind','amount','currency','basis','components','source','observed']else array['notice','earliestStart','activeStatus','mode','source','observed']end;
 if not p_details?&keys or exists(select 1 from jsonb_object_keys(p_details)k where not k=any(keys))then raise exception 'Invalid fact fields';end if;
 if jsonb_typeof(p_details->'source')<>'string'or length(btrim(p_details->>'source'))not between 1 and 1000 then raise exception 'Source is required (1-1000 characters)';end if;
 source_text:=btrim(p_details->>'source');observed_day:=ecod_access_private.fact_date(p_details->'observed','Observation date',true);if observed_day>today_utc then raise exception 'Observation date cannot be in the future';end if;
 entry:=jsonb_build_object('id',p_operation,'workspace_id',ws,'candidateId',p_candidate,'source',source_text,'observed',observed_day,'verification',case when p_confirmed then'confirmed'else'observed'end,'operationApplied',true,'appliedCurrent',p_apply_current,'supersedes',p_supersedes);
 if p_kind='employment'then
  foreach key in array array['company','title','location','employmentType']loop
   if jsonb_typeof(p_details->key)<>'string'or length(p_details->>key)>300 then raise exception 'Invalid employment %',key;end if;entry:=entry||jsonb_build_object(key,btrim(p_details->>key));
  end loop;
  if entry->>'company'=''or entry->>'title'=''then raise exception 'Employer and role title are required';end if;
  if entry->>'employmentType'not in('','Permanent','Contract','C2H','Subcontract')then raise exception 'Invalid employment type';end if;
  start_day:=ecod_access_private.fact_date(p_details->'startDate','Start date');end_day:=ecod_access_private.fact_date(p_details->'endDate','End date');if start_day>end_day then raise exception 'Employment ends before it starts';end if;
  if p_apply_current and(start_day>today_utc or end_day<today_utc)then raise exception 'Only an applicable role can update the current profile';end if;
  entry:=entry||jsonb_build_object('startDate',start_day,'endDate',end_day);
 elsif p_kind='compensation'then
  if p_details->>'kind'not in('current','expected')or jsonb_typeof(p_details->'kind')<>'string'or jsonb_typeof(p_details->'currency')<>'string'or p_details->>'currency'!~'^[A-Z]{3}$'or p_details->>'basis'not in('Annual','Monthly','Daily','Hourly')or jsonb_typeof(p_details->'basis')<>'string' or jsonb_typeof(p_details->'components')is distinct from'object'then raise exception 'Invalid compensation choices';end if;
  if p_details->'amount'<>'null'::jsonb then
   if jsonb_typeof(p_details->'amount')<>'number'then raise exception 'Amount must be numeric or unknown';end if;amount:=(p_details->>'amount')::numeric;if amount<0 or amount>1000000000000 then raise exception 'Invalid amount';end if;
  end if;
  for key in select * from jsonb_object_keys(p_details->'components')loop
   if key not in('fixed','variable','bonus','equity')or jsonb_typeof(p_details->'components'->key)not in('number','null')then raise exception 'Invalid compensation component';end if;
   part:=(p_details->'components'->>key)::numeric;if part<0 or part>1000000000000 then raise exception 'Invalid compensation component';end if;total:=total+coalesce(part,0);
  end loop;if amount is not null and total>amount then raise exception 'Components exceed total amount';end if;
  if p_apply_current and(p_details->>'currency'<>'INR'or p_details->>'basis'not in('Annual','Monthly'))then raise exception 'Current legacy profile uses annual INR LPA; keep this as a currency fact without applying it';end if;
  legacy_amount:=amount*(case when p_details->>'basis'='Monthly'then 12 else 1 end)/100000;
  entry:=entry||jsonb_build_object('kind',p_details->>'kind','amount',amount,'currency',p_details->>'currency','basis',p_details->>'basis','components',p_details->'components','amountUnit','currency');
 else
  if p_details->'notice'<>'null'::jsonb then
   if jsonb_typeof(p_details->'notice')<>'number'or(p_details->>'notice')::numeric<0 or(p_details->>'notice')::numeric>3650 or(p_details->>'notice')::numeric<>trunc((p_details->>'notice')::numeric)then raise exception 'Invalid notice days';end if;
  end if;
  if p_details->>'activeStatus'not in('Active','Passive')or jsonb_typeof(p_details->'activeStatus')<>'string'or p_details->>'mode'not in('','Flexible','Remote','Hybrid','Onsite')or jsonb_typeof(p_details->'mode')<>'string'then raise exception 'Invalid availability choices';end if;
  start_day:=ecod_access_private.fact_date(p_details->'earliestStart','Earliest start');
  entry:=entry||jsonb_build_object('notice',(p_details->>'notice')::integer,'earliestStart',start_day,'status',p_details->>'activeStatus','mode',p_details->>'mode','captured',today_utc);
 end if;
 fingerprint:=md5((select secret from ecod_access_private.token_secret)||jsonb_build_object('kind',p_kind,'candidate',p_candidate,'entry',entry)::text);
 execute format('select to_jsonb(t)from public.%I t where workspace_id=$1 and id=$2',name)into prior using ws,p_operation;
 if prior is not null then
  if prior->>'requestFingerprint'<>fingerprint or prior->>'recordedBy'is distinct from actor::text or prior->>'candidateId'<>p_candidate::text then raise exception 'Fact operation conflict'using errcode='40001';end if;
  return ecod_access_private.facts_read(p_candidate,p_kind,0)||jsonb_build_object('recordedId',p_operation,'replayed',true);
 end if;
 if ecod_access_private.facts_head(ws,p_candidate)<>p_head then raise exception 'Candidate or facts changed. Reload before recording.'using errcode='40001';end if;
 if p_supersedes is not null then
  execute format('select to_jsonb(t)from public.%I t where workspace_id=$1 and id=$2 and "candidateId"=any($3)',name)into parent using ws,p_supersedes,family;
  if parent is null then raise exception 'Correction target not found in this identity';end if;
  if p_kind='compensation'and parent->>'kind'<>entry->>'kind'then raise exception 'Correction must preserve compensation kind';end if;

 end if;
 if p_apply_current then
  execute format('select to_jsonb(t)from public.%I t where workspace_id=$1 and "candidateId"=any($2)and "appliedCurrent"and observed>$3 %s limit 1',name,case when p_kind='compensation'then 'and kind=$4'else ''end)into prior using ws,family,observed_day,entry->>'kind';
  if prior is not null then raise exception 'A newer applied fact exists';end if;
 end if;
 entry:=entry||jsonb_build_object('requestFingerprint',fingerprint);
 select string_agg(quote_ident(x.field),','),string_agg('r.'||quote_ident(x.field),',')into columns_sql,values_sql from jsonb_object_keys(entry)x(field);
 execute format('insert into public.%I(%s)select %s from jsonb_populate_record(null::public.%I,$1)r',name,columns_sql,values_sql,name)using entry;
 if p_apply_current then
  if p_kind='employment'then update public.candidates set company=entry->>'company',title=entry->>'title',location=entry->>'location',engagement=entry->>'employmentType'where workspace_id=ws and id=p_candidate;
  elsif p_kind='compensation'then
   if entry->>'kind'='current'then update public.candidates set current=legacy_amount where workspace_id=ws and id=p_candidate;else update public.candidates set expected=legacy_amount where workspace_id=ws and id=p_candidate;end if;
  else update public.candidates set notice=(entry->>'notice')::integer,"earliestStart"=start_day,"activeStatus"=entry->>'status',mode=entry->>'mode' where workspace_id=ws and id=p_candidate;
  end if;
 end if;
 return ecod_access_private.facts_read(p_candidate,p_kind,0)||jsonb_build_object('recordedId',p_operation,'replayed',false);
end $$;
create or replace function public.api_candidate_facts(p_candidate uuid,p_kind text default'employment',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.facts_read(p_candidate,p_kind,p_offset)$$;
create or replace function public.api_record_candidate_fact(p_candidate uuid,p_kind text,p_operation uuid,p_head text,p_details jsonb,p_confirmed boolean default false,p_apply_current boolean default false,p_supersedes uuid default null)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.facts_record(p_candidate,p_kind,p_operation,p_head,p_details,p_confirmed,p_apply_current,p_supersedes)$$;
revoke all on function ecod_access_private.identity_family(uuid,uuid),ecod_access_private.facts_head(uuid,uuid),ecod_access_private.fact_date(jsonb,text,boolean),ecod_access_private.facts_read(uuid,text,integer),ecod_access_private.facts_record(uuid,text,uuid,text,jsonb,boolean,boolean,uuid),public.api_candidate_facts(uuid,text,integer),public.api_record_candidate_fact(uuid,text,uuid,text,jsonb,boolean,boolean,uuid)from public,anon,authenticated;
grant execute on function ecod_access_private.facts_read(uuid,text,integer),ecod_access_private.facts_record(uuid,text,uuid,text,jsonb,boolean,boolean,uuid),public.api_candidate_facts(uuid,text,integer),public.api_record_candidate_fact(uuid,text,uuid,text,jsonb,boolean,boolean,uuid)to authenticated;
commit;
