begin;

-- The demand editor has always submitted this field, but hosted deployments lacked it.
alter table public.demands add column "stageSet" text[] not null default '{}';
alter table public.demands add constraint demands_stage_set_allowed check (
  cardinality("stageSet") <= 10 and
  array_position("stageSet", null) is null and
  "stageSet" <@ array['Identified','Contacted','Assessed','Enrichment','Submitted',
    'Interview','Offer','Deployed','Rejected','Withdrawn']::text[]
);

-- Preserve membership checks, stale-index exclusion, filters and the result limit.
create or replace function public.api_hosted_search(p_vector real[],p_namespace text default 'local-v1',p_location text default '',p_status text default '',p_min_experience numeric default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); norm double precision; result jsonb;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 if p_min_experience is null or p_min_experience<0 or p_min_experience>60 or p_status not in ('','Ready','Near-ready','Assessing','Unavailable') then raise exception 'Invalid hosted search filters'; end if;
 if array_ndims(p_vector) is distinct from 1 or array_length(p_vector,1) is distinct from 384 or exists(select 1 from unnest(p_vector) v where v is null or v::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid query vector'; end if;
 select sqrt(sum(v::double precision*v)) into norm from unnest(p_vector) v;
 if norm is null or norm=0 then raise exception 'Enter a search with professional terms'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (
  select c.id,c.name,c."anthroNumber",c."anthroId",c.title,c.location,c.skills,c.experience,c.status,
   (select sum(v.embedding[i]::double precision*p_vector[i])/nullif(sqrt(sum(v.embedding[i]::double precision*v.embedding[i]))*norm,0) from generate_series(1,384) i) as similarity
  from public."candidateVectors" v join public.candidates c on c.id=v.candidate_id and c.workspace_id=v.workspace_id
  where v.workspace_id=ws and v.namespace=p_namespace and c."mergedInto" is null and v.fingerprint=md5(public.professional_text(c))
   and (p_location='' or lower(c.location)=lower(p_location)) and (p_status='' or c.status=p_status) and coalesce(c.experience,0)>=greatest(p_min_experience,0)
  order by similarity desc,c.id limit 20
 ) rows;
 return result;
end $$;

notify pgrst, 'reload schema';
commit;
