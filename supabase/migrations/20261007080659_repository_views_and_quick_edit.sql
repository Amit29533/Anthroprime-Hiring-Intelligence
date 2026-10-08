-- Existing-stack Phase 1: private saved views, bounded sorts and conflict-aware quick edits.
begin;
create schema if not exists ecod_repository_private;
revoke all on schema ecod_repository_private from public,anon,authenticated;
create or replace function public.repository_sort_number(p_sort text,p_verified date,p_experience numeric,p_notice integer)
returns numeric language sql immutable parallel safe set search_path='' as $$
 select case p_sort when 'verified' then coalesce(-(p_verified-date '1970-01-01')::numeric,1000000000000)
 when 'experience' then coalesce(-p_experience,1000000000000) when 'notice' then coalesce(p_notice,1000000000000) else 0 end
$$;
create or replace function public.repository_validate_filters(p_filters jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare q text:=btrim(coalesce(p_filters->>'query',''));
begin
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>4000 then raise exception 'Invalid repository request'; end if;
 if exists(select 1 from jsonb_object_keys(p_filters) k where k<>all(array['query','status','location','skill','employer','engagement','mode','minExperience','maxNotice','maxExpected','maxExperience','tag','sort'])) then raise exception 'Unsupported repository filter'; end if;
 if exists(select 1 from jsonb_each(p_filters) x where jsonb_typeof(x.value) not in ('string','number')) then raise exception 'Invalid filter value'; end if;
 if length(q)>200 or length(coalesce(p_filters->>'location',''))>120 or length(coalesce(p_filters->>'skill',''))>120 or length(coalesce(p_filters->>'employer',''))>120 then raise exception 'Search value is too long'; end if;
 if coalesce(p_filters->>'status','') not in ('','Assessing','Near-ready','Ready','Unavailable') or coalesce(p_filters->>'mode','') not in ('','Flexible','Remote','Hybrid','Onsite') or coalesce(p_filters->>'engagement','') not in ('','Permanent','Contract','C2H','Subcontract') then raise exception 'Invalid repository filter'; end if;
 if nullif(p_filters->>'maxExpected','') is not null and not public.is_admin() then raise exception 'Compensation filters require administrator access' using errcode='42501'; end if;
 if (nullif(p_filters->>'minExperience','')::numeric not between 0 and 60) or (nullif(p_filters->>'maxNotice','')::integer not between 0 and 365)
 or (nullif(p_filters->>'maxExpected','')::numeric<0) or coalesce(p_filters->>'maxExpected','') in ('NaN','Infinity','-Infinity') then raise exception 'Invalid numeric filter'; end if;
 if length(coalesce(p_filters->>'tag',''))>120 or coalesce(p_filters->>'sort','name') not in ('name','verified','experience','notice') then raise exception 'Invalid repository sort or tag'; end if;
 if nullif(p_filters->>'maxExperience','') is not null and ((p_filters->>'maxExperience')::numeric not between 0 and 60 or (p_filters->>'maxExperience')::numeric<coalesce(nullif(p_filters->>'minExperience','')::numeric,0)) then raise exception 'Invalid experience range'; end if;
end $$;

create table if not exists ecod_repository_private.repository_views (
 id uuid primary key, workspace_id uuid not null references public.workspaces(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80),
 filters jsonb not null check(jsonb_typeof(filters)='object' and octet_length(filters::text)<=4000),
 created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists repository_view_name on ecod_repository_private.repository_views(workspace_id,user_id,lower(btrim(name)));
alter table ecod_repository_private.repository_views enable row level security;
revoke all on ecod_repository_private.repository_views from public,anon,authenticated;

-- This narrow privileged helper owns private rows; every lookup binds actor and active workspace.
create or replace function ecod_repository_private.repository_views_action(p_action text,p_id uuid,p_name text,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); actor uuid:=auth.uid(); result jsonb; prior ecod_repository_private.repository_views;
begin
 if actor is null or ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 if p_action not in ('list','save','delete') or p_action is null then raise exception 'Invalid saved-view action'; end if;
 if p_action<>'list' then
  perform 1 from public.memberships where user_id=actor and workspace_id=ws for update;
  if not found then raise exception 'Workspace membership required' using errcode='42501'; end if;
  if p_id is null then raise exception 'Saved view ID is required'; end if;
 end if;
 if p_action='save' then
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'View name must contain 1â€“80 characters'; end if;
  perform public.repository_validate_filters(p_filters);
  select * into prior from ecod_repository_private.repository_views where id=p_id;
  if found then
   if prior.workspace_id<>ws or prior.user_id<>actor or prior.name<>btrim(p_name) or prior.filters<>p_filters then
    raise exception 'Saved view operation conflict' using errcode='40001';
   end if;
  else
   if (select count(*) from ecod_repository_private.repository_views where workspace_id=ws and user_id=actor)>=50 then raise exception 'Keep at most 50 personal views per workspace'; end if;
   insert into ecod_repository_private.repository_views(id,workspace_id,user_id,name,filters) values(p_id,ws,actor,btrim(p_name),p_filters);
  end if;
 elsif p_action='delete' then
  delete from ecod_repository_private.repository_views where id=p_id and workspace_id=ws and user_id=actor;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'filters',
  case when not public.is_admin() then filters-'maxExpected' else filters end,
  'restricted',not public.is_admin() and nullif(filters->>'maxExpected','') is not null) order by lower(name) collate "C",id),'[]')
 into result from ecod_repository_private.repository_views where workspace_id=ws and user_id=actor;
 return jsonb_build_object('views',result);
end $$;
create or replace function public.api_repository_views(p_action text default 'list',p_id uuid default null,p_name text default null,p_filters jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select ecod_repository_private.repository_views_action(p_action,p_id,p_name,p_filters)
$$;

create or replace function public.api_candidate_quick_context(p_candidate uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select jsonb_build_object('candidateId',id,'owner',owner,'nextAction',"nextAction",'token',md5(to_jsonb(c)::text)) into result
 from public.candidates c where workspace_id=ws and id=p_candidate and "mergedInto" is null;
 if result is null then raise exception 'Candidate not found in your workspace'; end if;
 return result;
end $$;
create or replace function public.api_candidate_quick_edit(p_candidate uuid,p_token text,p_owner text,p_next_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); person public.candidates;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_token is null or p_token!~'^[0-9a-f]{32}$' or p_owner is null or p_next_action is null
  or length(p_owner)>120 or length(p_next_action)>1000 then raise exception 'Invalid quick-edit request'; end if;
 select * into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace'; end if;
 if (person.owner,person."nextAction") is distinct from (btrim(p_owner),btrim(p_next_action)) then
  if md5(to_jsonb(person)::text)<>p_token then raise exception 'Candidate changed. Reload quick-edit fields before saving.' using errcode='40001'; end if;
  update public.candidates set owner=btrim(p_owner),"nextAction"=btrim(p_next_action) where workspace_id=ws and id=p_candidate;
 end if;
 return public.api_candidate_quick_context(p_candidate);
end $$;

revoke all on function public.repository_sort_number(text,date,numeric,integer),public.repository_validate_filters(jsonb),
 ecod_repository_private.repository_views_action(text,uuid,text,jsonb),public.api_repository_views(text,uuid,text,jsonb),
 public.api_candidate_quick_context(uuid),public.api_candidate_quick_edit(uuid,text,text,text) from public,anon,authenticated;
grant usage on schema ecod_repository_private to authenticated;
grant execute on function public.repository_sort_number(text,date,numeric,integer),public.repository_validate_filters(jsonb),
 ecod_repository_private.repository_views_action(text,uuid,text,jsonb),public.api_repository_views(text,uuid,text,jsonb),
 public.api_candidate_quick_context(uuid),public.api_candidate_quick_edit(uuid,text,text,text) to authenticated;
create or replace function public.api_repository_page(p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); q text:=btrim(coalesce(p_filters->>'query','')); query tsquery;
 resolved uuid; identity_query boolean:=false; result jsonb; next_cursor jsonb; sort_key text:=coalesce(p_filters->>'sort','name');
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 perform public.repository_validate_filters(p_filters);
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid repository request'; end if;
 if p_cursor is not null and (jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->'filters' is distinct from p_filters or length(coalesce(p_cursor->>'name',''))>10000 or p_cursor->>'id' is null) then raise exception 'Cursor does not match this search'; end if;
 if p_cursor is not null and sort_key<>'name' and (p_cursor->>'value' is null or (p_cursor->>'value')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid sort cursor'; end if;
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
   lower(c.name) cursor_name, public.repository_sort_number(sort_key,c.verified,c.experience,c.notice) cursor_value
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
   and (nullif(p_filters->>'maxExperience','') is null or c.experience<=nullif(p_filters->>'maxExperience','')::numeric)
   and (coalesce(p_filters->>'tag','')='' or exists(select 1 from unnest(c.tags) t where lower(t)=lower(p_filters->>'tag')))
   and (nullif(p_filters->>'maxNotice','') is null or c.notice<=nullif(p_filters->>'maxNotice','')::integer)
   and (nullif(p_filters->>'maxExpected','') is null or c.expected<=nullif(p_filters->>'maxExpected','')::numeric)
   and (p_cursor is null or (public.repository_sort_number(sort_key,c.verified,c.experience,c.notice),lower(c.name) collate "C",c.id)>(coalesce((p_cursor->>'value')::numeric,0),(p_cursor->>'name') collate "C",(p_cursor->>'id')::uuid))
  order by public.repository_sort_number(sort_key,c.verified,c.experience,c.notice),lower(c.name) collate "C",c.id limit p_limit+1
 ), numbered as(select *,row_number() over(order by cursor_value,cursor_name collate "C",id) n from page)
 select coalesce(jsonb_agg(to_jsonb(v)-'cursor_name'-'cursor_value'-'n' order by cursor_value,cursor_name collate "C",id) filter(where n<=p_limit),'[]'),
  case when count(*)>p_limit then (select jsonb_build_object('value',cursor_value,'name',cursor_name,'id',id,'filters',p_filters) from numbered where n=p_limit) end
 into result,next_cursor from numbered v;
 return jsonb_build_object('rows',result,'next',next_cursor);
end $$;

revoke all on function public.api_repository_page(jsonb,jsonb,integer) from public,anon;
grant execute on function public.api_repository_page(jsonb,jsonb,integer) to authenticated;
commit;
