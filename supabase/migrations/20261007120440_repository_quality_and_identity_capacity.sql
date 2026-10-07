-- Audit continuation: bounded review findings and non-allocating global identity telemetry.
begin;
create or replace function ecod_repository_private.quality_review(p_kind text,p_cursor jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();day date:=(statement_timestamp() at time zone 'UTC')::date;
 result jsonb;counts jsonb;total integer;next_cursor jsonb;
begin
 if auth.uid() is null or ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('missing-email','missing-phone','missing-availability','stale-profile','future-profile-date','missing-current-skill-evidence') then raise exception 'Unknown quality queue';end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor) is distinct from 'object' or octet_length(p_cursor::text)>3000 or p_cursor->>'kind' is distinct from p_kind or p_cursor->>'day' is distinct from day::text or jsonb_typeof(p_cursor->'name') is distinct from 'string' or length(p_cursor->>'name')>300 or jsonb_typeof(p_cursor->'id') is distinct from 'string' or exists(select 1 from jsonb_object_keys(p_cursor) k where k<>all(array['kind','day','name','id']))) then raise exception 'Quality cursor changed or expired; refresh the queue';end if;
 -- MATERIALIZED computes one snapshot for both complete counts and the bounded page.
 with recursive identity_family(current_id,retained_id) as (
  select id,id from public.candidates where workspace_id=ws and "mergedInto" is null
  union select f.current_id,c.id from identity_family f join public.candidates c on c."mergedInto"=f.retained_id where c.workspace_id=ws
 ), current_evidence as (
  select distinct f.current_id from identity_family f join public."personSkills" ps on ps."candidateId"=f.retained_id and ps.workspace_id=ws
   join public."skillEvidence" e on e.workspace_id=ps.workspace_id and e."personSkillId"=ps.id
   where public.skill_evidence_weight(e."evidenceType")>=70 and e.date>=((day-365)::timestamp at time zone 'UTC') and e.date<=statement_timestamp()
 ), findings as materialized (
  select c.id,c."anthroId",left(c.name,300)name,c.verified,left(lower(c.name),300) collate "C" cursor_name,
   array_remove(array[
    case when btrim(c.email)='' then 'missing-email' end,
    case when btrim(c.phone)='' then 'missing-phone' end,
    case when c.notice is null then 'missing-availability' end,
    case when c.verified is null or c.verified<day-120 then 'stale-profile' end,
    case when c.verified>day then 'future-profile-date' end,
    case when ev.current_id is null then 'missing-current-skill-evidence' end
   ],null) flags
  from public.candidates c left join current_evidence ev on ev.current_id=c.id where c.workspace_id=ws and c."mergedInto" is null
 ), page as (
  select * from findings where p_kind=any(flags) and (p_cursor is null or (cursor_name,id)>((p_cursor->>'name') collate "C",(p_cursor->>'id')::uuid))
  order by cursor_name,id limit 26
 ), numbered as(select *,row_number() over(order by cursor_name,id)n from page)
 select (select coalesce(jsonb_object_agg(kind,n),'{}') from(select flag kind,count(*)n from findings cross join lateral unnest(flags)flag group by flag)q),
  (select count(*) from findings where cardinality(flags)>0),
  (select coalesce(jsonb_agg(to_jsonb(r)-'cursor_name'-'n' order by cursor_name,id) filter(where n<=25),'[]') from numbered r),
  case when (select count(*) from numbered)>25 then (select jsonb_build_object('kind',p_kind,'day',day,'name',cursor_name,'id',id) from numbered where n=25) end
 into counts,total,result,next_cursor;
 return jsonb_build_object('rows',result,'counts',counts,'affectedCandidates',total,'nextCursor',next_cursor,'day',day,'timezone','UTC');
end $$;

create or replace function ecod_repository_private.identity_capacity()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare consumed bigint;called boolean;
begin
 if auth.uid() is null or public.current_workspace() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 select last_value,is_called into consumed,called from public.candidate_anthro_number_seq;
 if not called then consumed:=consumed-1;end if;
 return jsonb_build_object('limit',99999,'consumed',consumed,'remaining',99999-consumed,
  'level',case when consumed>=99999 then 'exhausted' when consumed>=95000 then 'critical' when consumed>=90000 then 'warning' else 'healthy' end,
  'scope','global','reusable',false);
end $$;
create or replace function public.api_repository_quality(p_kind text default 'stale-profile',p_cursor jsonb default null)
returns jsonb language sql stable security invoker set search_path='' as $$select ecod_repository_private.quality_review(p_kind,p_cursor)$$;
create or replace function public.api_anthro_id_capacity()
returns jsonb language sql stable security invoker set search_path='' as $$select ecod_repository_private.identity_capacity()$$;
revoke all on function ecod_repository_private.quality_review(text,jsonb),ecod_repository_private.identity_capacity(),public.api_repository_quality(text,jsonb),public.api_anthro_id_capacity() from public,anon,authenticated;
grant usage on schema ecod_repository_private to authenticated;
grant execute on function ecod_repository_private.quality_review(text,jsonb),ecod_repository_private.identity_capacity(),public.api_repository_quality(text,jsonb),public.api_anthro_id_capacity() to authenticated;
commit;
