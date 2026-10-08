-- B3: bounded reads with RLS; compatibility workflows keep their complete snapshots.
begin;
-- TEXT[] serialization has no locale/timezone-dependent element formatter.
create or replace function public.repository_skill_text(p_skills text[])
returns text language sql immutable parallel safe set search_path='' as $$select coalesce(array_to_string(p_skills,' '),'')$$;
revoke all on function public.repository_skill_text(text[]) from public,anon;
grant execute on function public.repository_skill_text(text[]) to authenticated;
create index if not exists candidates_repository_cursor on public.candidates(workspace_id,(lower(name) collate "C"),id) where "mergedInto" is null;
create index if not exists candidates_repository_text on public.candidates using gin(to_tsvector('simple'::regconfig,
 name||' '||email||' '||phone||' '||title||' '||company||' '||location||' '||summary||' '||linkedin||' '||public.repository_skill_text(skills))) where "mergedInto" is null;
create index if not exists documents_repository_text on public.documents using gin(to_tsvector('simple'::regconfig,extracted)) where not removed;

create or replace function public.api_repository_overview()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 select jsonb_build_object('candidates',count(*),'ready',count(*) filter(where status='Ready'),
  'fresh',count(*) filter(where verified>=current_date-30),'stale',count(*) filter(where verified<current_date-90)) into result
 from public.candidates where workspace_id=ws and "mergedInto" is null;
 return result||jsonb_build_object('openDemands',(select count(*) from public.demands where workspace_id=ws and status='Open'));
end $$;

create or replace function public.api_repository_page(p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); q text:=btrim(coalesce(p_filters->>'query','')); query tsquery;
 resolved uuid; identity_query boolean:=false; result jsonb; next_cursor jsonb;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>4000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid repository request'; end if;
 if exists(select 1 from jsonb_object_keys(p_filters) k where k<>all(array['query','status','location','skill','employer','engagement','mode','minExperience','maxNotice','maxExpected'])) then raise exception 'Unsupported repository filter'; end if;
 if length(q)>200 or length(coalesce(p_filters->>'location',''))>120 or length(coalesce(p_filters->>'skill',''))>120 or length(coalesce(p_filters->>'employer',''))>120 then raise exception 'Search value is too long'; end if;
 if coalesce(p_filters->>'status','') not in ('','Assessing','Near-ready','Ready','Unavailable') or coalesce(p_filters->>'mode','') not in ('','Flexible','Remote','Hybrid','Onsite') or coalesce(p_filters->>'engagement','') not in ('','Permanent','Contract','C2H','Subcontract') then raise exception 'Invalid repository filter'; end if;
 if nullif(p_filters->>'maxExpected','') is not null and not public.is_admin() then raise exception 'Compensation filters require administrator access' using errcode='42501'; end if;
 if (nullif(p_filters->>'minExperience','')::numeric not between 0 and 60) or (nullif(p_filters->>'maxNotice','')::integer not between 0 and 365)
 or (nullif(p_filters->>'maxExpected','')::numeric<0) or coalesce(p_filters->>'maxExpected','') in ('NaN','Infinity','-Infinity') then raise exception 'Invalid numeric filter'; end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->'filters' is distinct from p_filters or length(coalesce(p_cursor->>'name',''))>10000 or p_cursor->>'id' is null) then raise exception 'Cursor does not match this search'; end if;
 if q ~* '^ANTHRO-([0-9]{5}|[0-9a-f-]{36})$' then
  identity_query:=true;resolved:=(public.api_candidate_by_anthro_id(q)->>'candidateId')::uuid;
 elsif q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  identity_query:=true;resolved:=(public.api_candidate_by_anthro_id('ANTHRO-'||q)->>'candidateId')::uuid;
 elsif q<>'' then query:=websearch_to_tsquery('simple'::regconfig,q); end if;
 with recursive merge_links as (
  select c.id retained_id,c."mergedInto" current_id,array[c.id] visited from public.candidates c where c.workspace_id=ws and c."mergedInto" is not null
  union all select m.retained_id,c."mergedInto",m.visited||c.id from merge_links m join public.candidates c on c.id=m.current_id
   where c.workspace_id=ws and c."mergedInto" is not null and not c.id=any(m.visited)
 ), page as (
  select c.id,c."anthroId",left(c.name,300) name,left(c.title,200) title,left(c.company,200) company,left(c.location,200) location,
   c.status,c.mode,c.experience,c.notice,c.verified,c.engagement,
   (select coalesce(jsonb_agg(left(s,120)),'[]') from unnest(c.skills) with ordinality x(s,n) where n<=40) skills,
   lower(c.name) cursor_name
  from public.candidates c where c.workspace_id=ws and c."mergedInto" is null
   and (not identity_query or c.id=resolved)
   and (query is null or to_tsvector('simple'::regconfig,c.name||' '||c.email||' '||c.phone||' '||c.title||' '||c.company||' '||c.location||' '||c.summary||' '||c.linkedin||' '||public.repository_skill_text(c.skills)) @@ query
    or numnode(query)>1
    or exists(select 1 from public.documents d where d.workspace_id=ws and d."candidateId"=any(array[c.id]||array(select m.retained_id from merge_links m where m.current_id=c.id)) and not d.removed and to_tsvector('simple'::regconfig,d.extracted) @@ query))
   -- Evaluate compound/negative searches across profile and originals together. A negative term
   -- in a CV must not be bypassed just because the profile text matched on its own.
   and (query is null or (to_tsvector('simple'::regconfig,c.name||' '||c.email||' '||c.phone||' '||c.title||' '||c.company||' '||c.location||' '||c.summary||' '||c.linkedin||' '||public.repository_skill_text(c.skills))
     || coalesce((select to_tsvector('simple'::regconfig,string_agg(d.extracted,' ')) from public.documents d where d.workspace_id=ws and d."candidateId"=any(array[c.id]||array(select m.retained_id from merge_links m where m.current_id=c.id)) and not d.removed),''::tsvector)) @@ query)
   and (coalesce(p_filters->>'status','')='' or c.status=p_filters->>'status')
   and (coalesce(p_filters->>'mode','')='' or c.mode=p_filters->>'mode')
   and (coalesce(p_filters->>'engagement','')='' or c.engagement=p_filters->>'engagement')
   and (coalesce(p_filters->>'location','')='' or lower(c.location)=lower(p_filters->>'location'))
   and (coalesce(p_filters->>'employer','')='' or strpos(lower(c.company),lower(p_filters->>'employer'))>0)
   and (coalesce(p_filters->>'skill','')='' or exists(select 1 from unnest(c.skills) s where lower(s)=lower(p_filters->>'skill')))
   and (nullif(p_filters->>'minExperience','') is null or c.experience>=nullif(p_filters->>'minExperience','')::numeric)
   and (nullif(p_filters->>'maxNotice','') is null or c.notice<=nullif(p_filters->>'maxNotice','')::integer)
   and (nullif(p_filters->>'maxExpected','') is null or c.expected<=nullif(p_filters->>'maxExpected','')::numeric)
   and (p_cursor is null or (lower(c.name) collate "C",c.id)>((p_cursor->>'name') collate "C",(p_cursor->>'id')::uuid))
  order by lower(c.name) collate "C",c.id limit p_limit+1
 ), numbered as(select *,row_number() over(order by cursor_name collate "C",id) n from page)
 select coalesce(jsonb_agg(to_jsonb(v)-'cursor_name'-'n' order by cursor_name collate "C",id) filter(where n<=p_limit),'[]'),
  case when count(*)>p_limit then (select jsonb_build_object('name',cursor_name,'id',id,'filters',p_filters) from numbered where n=p_limit) end
 into result,next_cursor from numbered v;
 return jsonb_build_object('rows',result,'next',next_cursor);
end $$;

create or replace function public.api_candidate_section(p_candidate uuid,p_section text default 'profile',p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); person uuid; related uuid[]; table_name text; result jsonb; n integer;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid profile page'; end if;
 person:=(public.api_candidate_by_anthro_id('ANTHRO-'||p_candidate::text)->>'candidateId')::uuid;
 if person is null then raise exception 'Candidate not found in your workspace'; end if;
 with recursive ancestry as (
  select c.id,array[c.id] visited from public.candidates c where c.workspace_id=ws and c.id=person
  union all select c.id,a.visited||c.id from ancestry a join public.candidates c on c."mergedInto"=a.id
   where c.workspace_id=ws and not c.id=any(a.visited)
 ) select array_agg(id) into related from ancestry;
 if p_section='profile' then
  select to_jsonb(c) into result from public.candidates c where c.id=person and c.workspace_id=ws;
  return jsonb_build_object('candidate',result);
 end if;
 -- Identifier interpolation is restricted to this fixed table allowlist; parameters stay bound.
 if p_section=any(array['notes','assessments','considerations','enrichment','employmentHistory','compensationHistory','availabilityHistory','interviews','offers','placements','consents']) then table_name:=p_section;
 elsif p_section='personSkills' then
  select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') into result from
   (select ps.*,sk.name skill from public."personSkills" ps join public.skills sk on sk.id=ps."skillId" and sk.workspace_id=ps.workspace_id
     where ps.workspace_id=ws and ps."candidateId"=any(related) order by ps.id limit 51 offset p_offset) s;
 elsif p_section='skillEvidence' then
  select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') into result from
   (select se.*,sk.name skill from public."skillEvidence" se join public."personSkills" ps on ps.id=se."personSkillId" and ps.workspace_id=se.workspace_id
     join public.skills sk on sk.id=ps."skillId" and sk.workspace_id=ps.workspace_id
     where se.workspace_id=ws and ps."candidateId"=any(related) order by se.id limit 51 offset p_offset) e;
 elsif p_section='documents' then
  select coalesce(jsonb_agg(to_jsonb(d)-'extracted'-'dataUrl'-'storageError' order by id),'[]') into result
   from (select * from public.documents where workspace_id=ws and "candidateId"=any(related) and not removed order by id limit 51 offset p_offset) d;
 elsif p_section='history' then
  select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') into result from
   (select * from public.history where workspace_id=ws and "entityType"='candidates' and "entityId"=any(related) order by id limit 51 offset p_offset) h;
 else raise exception 'Unsupported candidate section'; end if;
 if table_name is not null then
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from (select * from public.%I where workspace_id=$1 and "candidateId"=any($2) order by id limit 51 offset $3) t',table_name)
   into result using ws,related,p_offset;
 end if;
 n:=jsonb_array_length(result);
 if n>50 then result:=result-50; end if;
 return jsonb_build_object('candidateId',person,'rows',result,'more',n>50,'offset',p_offset);
end $$;
revoke all on function public.api_repository_overview(),public.api_repository_page(jsonb,jsonb,integer),public.api_candidate_section(uuid,text,integer) from public,anon;
grant execute on function public.api_repository_overview(),public.api_repository_page(jsonb,jsonb,integer),public.api_candidate_section(uuid,text,integer) to authenticated;
commit;
