-- D2: bounded candidate CSV preparation with server-owned projection and receipts.
begin;
create table if not exists ecod_private.candidate_export_limits (
 workspace_id uuid not null,actor uuid not null,started_at timestamptz not null,attempts integer not null,denied integer not null default 0,primary key(workspace_id,actor)
);
create table if not exists ecod_private.candidate_export_events (
 id uuid primary key,workspace_id uuid not null,actor uuid not null,prepared_at timestamptz not null,
 outcome text not null check(outcome in ('prepared','throttled')),row_count integer not null,candidate_ids uuid[] not null,
 projection text not null check(projection in ('admin','recruiter')),sha256 text,schema_version integer not null default 1
);
alter table ecod_private.candidate_export_limits enable row level security;
alter table ecod_private.candidate_export_events enable row level security;
revoke all on ecod_private.candidate_export_limits,ecod_private.candidate_export_events from public,anon,authenticated;
create index if not exists candidate_export_workspace_time on ecod_private.candidate_export_events(workspace_id,prepared_at desc,id desc);
create or replace function public.api_candidate_export_mode() returns boolean language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 return exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'auditedCandidateExports'='true'::jsonb);
end $$;
create or replace function public.api_prepare_candidate_export(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();requester uuid:=auth.uid();role_name text;lim ecod_private.candidate_export_limits;at timestamptz;request_id uuid:=gen_random_uuid();rows jsonb;fingerprint text;
begin
 -- Keep the authorized role stable for the preparation transaction.
 select role into role_name from public.memberships where workspace_id=ws and user_id=requester for share;
 if ws is null or requester is null or role_name is null or role_name not in ('admin','recruiter') then raise exception 'Export permission required' using errcode='42501';end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 500 or array_ndims(p_ids)<>1 or array_position(p_ids,null) is not null or (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids) then raise exception 'Select 1 to 500 distinct candidates';end if;
 if (select count(*) from public.candidates where workspace_id=ws and id=any(p_ids) and "mergedInto" is null)<>cardinality(p_ids) then raise exception 'Candidate selection is unavailable; refresh and retry' using errcode='42501';end if;
 at:=clock_timestamp();
 insert into ecod_private.candidate_export_limits values(ws,requester,at,0,0) on conflict(workspace_id,actor) do nothing;
 select * into lim from ecod_private.candidate_export_limits where workspace_id=ws and actor=requester for update;
 at:=clock_timestamp();
 if lim.started_at<=at-interval '60 seconds' then lim.started_at:=at;lim.attempts:=0;lim.denied:=0;end if;
 if lim.attempts>=6 then
  if lim.denied=0 then insert into ecod_private.candidate_export_events values(request_id,ws,requester,at,'throttled',0,'{}',role_name,null,1);end if;
  update ecod_private.candidate_export_limits set denied=least(lim.denied+1,1000000) where workspace_id=ws and actor=requester;
  return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from lim.started_at+interval '60 seconds'-at))::integer));
 end if;
 -- Explicit projection, never serialize entire candidate records or accept browser values.
 select jsonb_agg(jsonb_build_object('anthroId',c."anthroId",'name',c.name,'email',c.email,'phone',c.phone,'title',c.title,'company',c.company,'location',c.location,
  'experience',c.experience,'relevantExperience',c."relevantExperience",'notice',c.notice,'skills',array_to_string(c.skills,'; '),'status',c.status,'source',c.source,'mode',c.mode,'verified',c.verified)
  ||case when role_name='admin' then jsonb_build_object('current',c.current,'expected',c.expected) else '{}'::jsonb end order by input.n) into rows
 from unnest(p_ids) with ordinality input(id,n) join public.candidates c on c.id=input.id and c.workspace_id=ws and c."mergedInto" is null;
 if jsonb_array_length(rows)<>cardinality(p_ids) then raise exception 'Candidate selection changed; refresh and retry';end if;
 if octet_length(rows::text)>1048576 then raise exception 'Export is too large; select fewer candidates';end if;
 fingerprint:=encode(sha256(convert_to(rows::text,'UTF8')),'hex');
 update ecod_private.candidate_export_limits set started_at=lim.started_at,attempts=lim.attempts+1,denied=lim.denied where workspace_id=ws and actor=requester;
 insert into ecod_private.candidate_export_events values(request_id,ws,requester,at,'prepared',cardinality(p_ids),p_ids,role_name,fingerprint,1);
 return jsonb_build_object('allowed',true,'receiptId',request_id,'preparedAt',at,'actor',requester,'rows',rows,'count',cardinality(p_ids),'sha256',fingerprint,'schemaVersion',1);
end $$;
create or replace function public.api_candidate_export_page(p_offset integer default 0,p_hours integer default 24) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();since timestamptz;rows jsonb;total integer;volume bigint;throttled bigint;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 1000000 or p_hours is null or p_hours not between 1 and 168 then raise exception 'Invalid export audit page';end if;
 since:=now()-make_interval(hours=>p_hours);
 select count(*),coalesce(sum(row_count),0),count(*) filter(where outcome='throttled') into total,volume,throttled from ecod_private.candidate_export_events where workspace_id=ws and prepared_at>=since;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (select id,actor,prepared_at as "preparedAt",outcome,row_count as "rowCount",projection,schema_version as "schemaVersion",sha256 from ecod_private.candidate_export_events where workspace_id=ws and prepared_at>=since order by prepared_at desc,id desc limit 50 offset p_offset)q;
 return jsonb_build_object('rows',rows,'total',total,'volume',volume,'throttled',throttled,'enabled',public.api_candidate_export_mode());
end $$;
revoke all on function public.api_candidate_export_mode(),public.api_prepare_candidate_export(uuid[]),public.api_candidate_export_page(integer,integer) from public,anon,authenticated;
grant execute on function public.api_candidate_export_mode(),public.api_prepare_candidate_export(uuid[]),public.api_candidate_export_page(integer,integer) to authenticated;
commit;
