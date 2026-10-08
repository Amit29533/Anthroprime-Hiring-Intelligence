begin;
create schema if not exists ecod_access_private;
revoke all on schema ecod_access_private from public,anon,authenticated;
grant usage on schema ecod_access_private to authenticated;
create table if not exists ecod_access_private.token_secret(id boolean primary key default true check(id),secret text not null default gen_random_uuid()::text||gen_random_uuid()::text);
insert into ecod_access_private.token_secret(id)values(true)on conflict do nothing;
alter table ecod_access_private.token_secret enable row level security;
revoke all on ecod_access_private.token_secret from public,anon,authenticated;

create or replace function ecod_access_private.member_workspace(p_edit boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();actor uuid:=auth.uid();role_name text;
begin
 select role into role_name from public.memberships where user_id=actor and workspace_id=ws for share;
 if actor is null or ws is null or role_name is null or role_name not in ('admin','recruiter','viewer') then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_edit and role_name not in ('admin','recruiter') then raise exception 'Editor access required' using errcode='42501';end if;
 return ws;
end $$;
create or replace function ecod_access_private.candidate_token(p_candidate uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();result text;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 select md5(s.secret||to_jsonb(c)::text) into result from public.candidates c cross join ecod_access_private.token_secret s where c.workspace_id=ws and c.id=p_candidate;
 if result is null then raise exception 'Candidate not found in your workspace';end if;return result;
end $$;
create or replace function ecod_access_private.redact_financial(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;item record;
begin
 if jsonb_typeof(p_value)='object' then
  result:='{}';for item in select * from jsonb_each(p_value) loop
   if (item.key='current' and jsonb_typeof(item.value)='object') or item.key not in ('current','expected','currency','amount','offeredCtc','ctc','clientRate','payRate','cost','margin','revenue','billRate','rate','budgetMin','budgetMax','compensationHistory','components','fixed','variable','bonus','equity','approvedTerms') then result:=result||jsonb_build_object(item.key,ecod_access_private.redact_financial(item.value));end if;
  end loop;
  if p_value?'ctc'and p_value?'approvedTerms'then result:=result||jsonb_build_object('termsApproved',p_value->>'approvedAt'is not null and p_value->'approvedTerms'=jsonb_build_object('candidateId',p_value->'candidateId','demandId',p_value->'demandId','role',p_value->'role','location',p_value->'location','ctc',p_value->'ctc','joining',p_value->'joining'));end if;
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(ecod_access_private.redact_financial(value) order by n),'[]') into result from jsonb_array_elements(p_value)with ordinality t(value,n);return result;
 end if;return p_value;
end $$;

create or replace function ecod_access_private.audit_candidate_reads(ws uuid,p_rows jsonb,p_source text)returns void language plpgsql security invoker set search_path=''as $$
begin
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)
 select ws,'candidates',c.id,'server_read',p_source,auth.uid()::text from public.candidates c where c.workspace_id=ws and c.id in(select distinct coalesce(value->>'candidateId',value->>'id')::uuid from jsonb_array_elements(p_rows));
end $$;
revoke all on function ecod_access_private.audit_candidate_reads(uuid,jsonb,text)from public,anon,authenticated;

-- Fixed audited compatibility manifest. Unchecked cores have no application execution grant.
do $$
declare spec record;definition text;arg_types text;arg_declarations text;arg_calls text;core_name text;guard_name text;editor boolean;extra text;audit_sql text;
begin
 for spec in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'api_candidate_section','api_repository_page','api_candidate_quick_context','api_candidate_quick_edit',
 'api_candidate_profile_context','api_candidate_profile_edit','api_candidate_availability','api_changes_since','api_changes_page','api_import_page') loop
  core_name:=spec.proname||'_stage1_core';guard_name:=spec.proname||'_stage1_guard';
  arg_types:=pg_get_function_identity_arguments(spec.oid);arg_declarations:=pg_get_function_arguments(spec.oid);
  select string_agg(quote_ident(x),',' order by n) into arg_calls from unnest(spec.proargnames)with ordinality t(x,n);
  if to_regprocedure(format('ecod_access_private.%I(%s)',core_name,oidvectortypes(spec.proargtypes))) is null then
   definition:=pg_get_functiondef(spec.oid);
   definition:=replace(definition,format('FUNCTION public.%I(',spec.proname),format('FUNCTION ecod_access_private.%I(',core_name));
   definition:=replace(definition,'md5(to_jsonb(c)::text)','ecod_access_private.candidate_token(c.id)');
   definition:=replace(definition,'md5(to_jsonb(person)::text)','ecod_access_private.candidate_token(person.id)');
   execute definition;
  end if;
  execute format('alter function ecod_access_private.%I(%s) security definer',core_name,arg_types);
  execute format('revoke all on function ecod_access_private.%I(%s) from public,anon,authenticated',core_name,arg_types);
  editor:=spec.proname in ('api_candidate_quick_context','api_candidate_quick_edit','api_candidate_profile_context','api_candidate_profile_edit');
  extra:=case when spec.proname='api_candidate_section' then 'if p_section=''compensationHistory'' and not public.is_admin() then raise exception ''Administrator access required'' using errcode=''42501'';end if;' else '' end;
  audit_sql:=case when spec.proname='api_repository_page'then 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),coalesce(result->''rows'',''[]''),''Repository page'');' when spec.proname in('api_changes_since','api_changes_page')then 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),coalesce(result->''candidates'',''[]''),''Change feed'');' when spec.proname='api_import_page'then ''else 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),jsonb_build_array(jsonb_build_object(''id'',p_candidate)),''Candidate context'');'end;
  execute format('create or replace function ecod_access_private.%I(%s) returns jsonb language plpgsql security definer set search_path='''' as $guard$
   declare result jsonb;begin perform ecod_access_private.member_workspace(%L);%s result:=ecod_access_private.%I(%s);%s
   return case when public.is_admin() then result else ecod_access_private.redact_financial(result) end;end $guard$',guard_name,arg_declarations,editor,extra,core_name,arg_calls,audit_sql);
  execute format('revoke all on function ecod_access_private.%I(%s) from public,anon,authenticated',guard_name,arg_types);
  execute format('grant execute on function ecod_access_private.%I(%s) to authenticated',guard_name,arg_types);
  execute format('create or replace function public.%I(%s) returns jsonb language sql security invoker set search_path='''' as $public$select ecod_access_private.%I(%s)$public$',spec.proname,arg_declarations,guard_name,arg_calls);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',spec.proname,arg_types);
  execute format('grant execute on function public.%I(%s) to authenticated',spec.proname,arg_types);
 end loop;
end $$;

-- Recording uses the same opaque token without exposing protected columns or guessable compensation hashes.
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_repository_private.record_candidate_availability(uuid,uuid,text,jsonb)'::regprocedure);
 execute replace(definition,'md5(to_jsonb(person)::text)','ecod_access_private.candidate_token(person.id)');
end $$;

-- Column grants block raw salary reads/writes, including select(*) and filtering protected columns.
do $$declare cols text;write_cols text;begin
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute where attrelid='public.candidates'::regclass and attnum>0 and not attisdropped and attname not in ('current','expected','currency');
 revoke select,insert,update on public.candidates from authenticated;
 select string_agg(quote_ident(attname),',' order by attnum) into write_cols from pg_attribute where attrelid='public.candidates'::regclass and attnum>0 and not attisdropped and attname not in ('current','expected','currency','mergedInto');
 execute format('grant select(%s),insert(%s),update(%s) on public.candidates to authenticated',cols,write_cols,write_cols);
 revoke insert("mergedInto"),update("mergedInto") on public.candidates from authenticated;
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute where attrelid='public.history'::regclass and attnum>0 and not attisdropped and attname<>'snapshot';
 revoke select on public.history from authenticated;
 execute 'grant select('||cols||') on public.history to authenticated';
end $$;
drop policy if exists workspace_read on public."compensationHistory";
create policy workspace_read on public."compensationHistory" for select to authenticated using(workspace_id=public.current_workspace() and public.is_admin());
drop policy if exists workspace_insert on public."compensationHistory";
create policy workspace_insert on public."compensationHistory" for insert to authenticated with check(workspace_id=public.current_workspace() and public.is_admin());

create or replace function ecod_access_private.legacy_rows(p_table text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_access_private.member_workspace(false);result jsonb;predicate text;ordering text;
begin
 if p_table not in ('candidates','history','offers','submissions') or p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid legacy projection request';end if;
 predicate:=case when p_table='history'and not public.is_admin()then 'and ("entityType"<>''documents'' or snapshot->>''clientId'' is null)'else ''end;
 ordering:=case when p_table='history'then 'date desc,id desc'else'id'end;
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by %s),''[]'') from(select * from public.%I where workspace_id=$1 %s order by %s limit $2 offset $3)t',ordering,p_table,predicate,ordering) into result using ws,p_limit,p_offset;
 if p_table='candidates'then perform ecod_access_private.audit_candidate_reads(ws,result,'Legacy repository read');end if;
 return jsonb_build_object('rows',case when public.is_admin() then result else ecod_access_private.redact_financial(result) end);
end $$;
create or replace function public.api_legacy_rows(p_table text,p_offset integer default 0,p_limit integer default 1000)
returns jsonb language sql security invoker set search_path='' as $$select ecod_access_private.legacy_rows(p_table,p_offset,p_limit)$$;

-- Candidate writes preserve omitted columns. Full-row browser upserts can no longer bypass financial policy.
create or replace function ecod_access_private.save_candidates(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_access_private.member_workspace(true);entry jsonb;field text;columns_sql text;values_sql text;update_sql text;person_id uuid;existing_ws uuid;existing_merge uuid;was_existing boolean;result jsonb:='[]';saved jsonb;allowed text[];
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2097152 then raise exception 'Invalid candidate save request';end if;
 select array_agg(attname::text) into allowed from pg_attribute where attrelid='public.candidates'::regclass and attnum>0 and not attisdropped and attname not in ('workspace_id','anthroId','anthroNumber','processingRestricted','mergedInto');
 for entry in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(entry)<>'object' or not entry ? 'id' then raise exception 'Candidate ID is required';end if;
  for field in select * from jsonb_object_keys(entry) loop
   if field<>'workspace_id' and not field=any(allowed) then raise exception 'Protected candidate field: %',field;end if;
  end loop;
  if not public.is_admin() and entry ?| array['current','expected','currency'] then raise exception 'Compensation writes require administrator access' using errcode='42501';end if;
  person_id:=(entry->>'id')::uuid;
  select workspace_id,"mergedInto"into existing_ws,existing_merge from public.candidates where id=person_id for update;
  was_existing:=found;
  if was_existing and(existing_ws<>ws or existing_merge is not null)then raise exception 'Candidate not found or retired; reload the current identity';end if;
  if entry ? 'workspace_id' and (entry->>'workspace_id')::uuid is distinct from ws then raise exception 'Workspace cannot be changed';end if;
  entry:=entry||jsonb_build_object('workspace_id',ws);
  select string_agg(quote_ident(key),','),string_agg('r.'||quote_ident(key),','),string_agg(format('%I=r.%I',key,key),',')filter(where key not in ('id','workspace_id')) into columns_sql,values_sql,update_sql from jsonb_object_keys(entry) key;
  if update_sql is null then raise exception 'No editable candidate fields supplied';end if;
  if was_existing then
   execute format('update public.candidates c set %s from jsonb_populate_record(null::public.candidates,$1)r where c.id=$2 and c.workspace_id=$3 returning to_jsonb(c)',update_sql) into saved using entry,person_id,ws;
  else
   execute format('insert into public.candidates(%s) select %s from jsonb_populate_record(null::public.candidates,$1)r returning to_jsonb(candidates)',columns_sql,values_sql) into saved using entry;
  end if;
  result:=result||jsonb_build_array(case when public.is_admin() then saved else ecod_access_private.redact_financial(saved) end);
 end loop;
 return jsonb_build_object('rows',result);
end $$;
create or replace function ecod_access_private.save_offers(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_access_private.member_workspace(true);entry jsonb;field text;columns_sql text;values_sql text;update_sql text;person_id uuid;existing_ws uuid;was_existing boolean;result jsonb:='[]';saved jsonb;allowed text[];
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2097152 then raise exception 'Invalid candidate save request';end if;
 select array_agg(attname::text) into allowed from pg_attribute where attrelid='public.offers'::regclass and attnum>0 and not attisdropped and attname not in ('workspace_id','anthroId','anthroNumber','processingRestricted','mergedInto');
 for entry in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(entry)<>'object' or not entry ? 'id' then raise exception 'Candidate ID is required';end if;
  for field in select * from jsonb_object_keys(entry) loop
   if field<>'workspace_id' and not field=any(allowed) then raise exception 'Protected candidate field: %',field;end if;
  end loop;
  if not public.is_admin() and entry ?| array['ctc','approvedTerms','approvedAt','approvedBy'] then raise exception 'Compensation writes require administrator access' using errcode='42501';end if;
  person_id:=(entry->>'id')::uuid;
  select workspace_id into existing_ws from public.offers where id=person_id for update;
  was_existing:=found;
  if was_existing and existing_ws<>ws then raise exception 'Candidate not found in your workspace';end if;
  if entry ? 'workspace_id' and (entry->>'workspace_id')::uuid is distinct from ws then raise exception 'Workspace cannot be changed';end if;
  entry:=entry||jsonb_build_object('workspace_id',ws);
  select string_agg(quote_ident(key),','),string_agg('r.'||quote_ident(key),','),string_agg(format('%I=r.%I',key,key),',')filter(where key not in ('id','workspace_id')) into columns_sql,values_sql,update_sql from jsonb_object_keys(entry) key;
  if update_sql is null then raise exception 'No editable candidate fields supplied';end if;
  if was_existing then
   execute format('update public.offers c set %s from jsonb_populate_record(null::public.offers,$1)r where c.id=$2 and c.workspace_id=$3 returning to_jsonb(c)',update_sql) into saved using entry,person_id,ws;
  else
   execute format('insert into public.offers(%s) select %s from jsonb_populate_record(null::public.offers,$1)r returning to_jsonb(offers)',columns_sql,values_sql) into saved using entry;
  end if;
  result:=result||jsonb_build_array(case when public.is_admin() then saved else ecod_access_private.redact_financial(saved) end);
 end loop;
 return jsonb_build_object('rows',result);
end $$;
create or replace function public.api_save_offers(p_rows jsonb)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.save_offers(p_rows)$$;
revoke all on function ecod_access_private.save_offers(jsonb),public.api_save_offers(jsonb)from public,anon,authenticated;
grant execute on function ecod_access_private.save_offers(jsonb),public.api_save_offers(jsonb)to authenticated;
create or replace function public.api_save_candidates(p_rows jsonb)
returns jsonb language sql security invoker set search_path='' as $$select ecod_access_private.save_candidates(p_rows)$$;

revoke all on function ecod_access_private.member_workspace(boolean),ecod_access_private.candidate_token(uuid),ecod_access_private.redact_financial(jsonb),ecod_access_private.legacy_rows(text,integer,integer),ecod_access_private.save_candidates(jsonb),public.api_legacy_rows(text,integer,integer),public.api_save_candidates(jsonb) from public,anon,authenticated;
grant execute on function ecod_access_private.candidate_token(uuid),ecod_access_private.legacy_rows(text,integer,integer),ecod_access_private.save_candidates(jsonb),public.api_legacy_rows(text,integer,integer),public.api_save_candidates(jsonb) to authenticated;
-- Financial writes are guarded even when an older privileged RPC performs the mutation.
create or replace function ecod_access_private.financial_write_guard()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if TG_TABLE_NAME='candidates'then if new.current::text in('NaN','Infinity','-Infinity')or new.expected::text in('NaN','Infinity','-Infinity')then raise exception 'Compensation must be finite';end if;elsif TG_TABLE_NAME='offers'then if new.ctc::text in('NaN','Infinity','-Infinity')then raise exception 'Offer compensation must be finite';end if;end if;
 if auth.uid()is not null and not public.is_admin()then
  if TG_TABLE_NAME='candidates'then
   if (TG_OP='INSERT'and(new.current is not null or new.expected is not null))or(TG_OP='UPDATE'and(new.current,new.expected)is distinct from(old.current,old.expected))then raise exception 'Compensation writes require administrator access'using errcode='42501';end if;
  elsif TG_TABLE_NAME='offers'then
   if(TG_OP='INSERT'and new.ctc is not null)or(TG_OP='UPDATE'and new.ctc is distinct from old.ctc)then raise exception 'Offer terms require administrator access'using errcode='42501';end if;
  else
   if coalesce(new.payload->>'current','')<>''or coalesce(new.payload->>'expected','')<>''then raise exception 'Compensation imports require administrator review'using errcode='42501';end if;
  end if;
 end if;return new;
end $$;
revoke all on function ecod_access_private.financial_write_guard()from public,anon,authenticated;
drop trigger if exists stage1_financial_guard on public.candidates;
create trigger stage1_financial_guard before insert or update on public.candidates for each row execute function ecod_access_private.financial_write_guard();
drop trigger if exists stage1_financial_guard on public.offers;
create trigger stage1_financial_guard before insert or update on public.offers for each row execute function ecod_access_private.financial_write_guard();
drop trigger if exists stage1_financial_guard on public."importRows";
create trigger stage1_financial_guard before insert or update on public."importRows"for each row execute function ecod_access_private.financial_write_guard();
do $$declare cols text;definition text;begin
 -- Staged rows can contain administrator-reviewed pay. Only the guarded page API
 -- may return their payload; raw PostgREST queries retain nonfinancial metadata.
 select string_agg(quote_ident(attname),','order by attnum)into cols from pg_attribute where attrelid='public."importRows"'::regclass and attnum>0 and not attisdropped and attname<>'payload';
 revoke select on public."importRows" from authenticated;revoke select(payload)on public."importRows"from authenticated;execute format('grant select(%s)on public."importRows"to authenticated',cols);
 select string_agg(quote_ident(attname),','order by attnum)into cols from pg_attribute where attrelid='public.offers'::regclass and attnum>0 and not attisdropped and attname not in('ctc','approvedTerms');
 revoke select on public.offers from authenticated;execute format('grant select(%s)on public.offers to authenticated',cols);
 definition:=pg_get_functiondef('public.worker_run_imports(integer)'::regprocedure);
 if strpos(definition,'Financial approval revoked')=0 then
  definition:=replace(definition,'d:=r.payload;',$patch$d:=r.payload; if (coalesce(d->>'current','')<>'' or coalesce(d->>'expected','')<>'')and not exists(select 1 from public.memberships where workspace_id=b.workspace_id and user_id=b.approved_by and role='admin')then update public."importBatches"set status='paused',version=version+1 where id=b.id;return jsonb_build_object('paused',true,'reason','Financial approval revoked');end if;$patch$);execute definition;
 end if;
end $$;
commit;
