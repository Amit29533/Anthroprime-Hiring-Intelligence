-- Optional acceleration after 037. Core hosted retrieval also works without this extension.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
do $$ declare ns text; begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector';
 execute format('alter table public."candidateVectors" add column if not exists indexed_embedding %I.vector(384) generated always as (embedding::%I.vector(384)) stored',ns,ns);
 execute format('create index if not exists candidate_vectors_cosine on public."candidateVectors" using hnsw (indexed_embedding %I.vector_cosine_ops)',ns);
 execute format($ddl$
 create or replace function public.api_hosted_search(p_vector real[],p_namespace text default 'local-v1',p_location text default '',p_status text default '',p_min_experience numeric default 0)
 returns jsonb language plpgsql stable security definer set search_path='' as $fn$
 declare ws uuid:=public.current_workspace(); result jsonb;
 begin
  if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
  if p_min_experience is null or p_min_experience<0 or p_min_experience>60 or p_status not in ('','Ready','Near-ready','Assessing','Unavailable') then raise exception 'Invalid hosted search filters'; end if;
  if array_ndims(p_vector) is distinct from 1 or array_length(p_vector,1) is distinct from 384 or exists(select 1 from unnest(p_vector) v where v is null or v::text in ('NaN','Infinity','-Infinity')) or (select sum(v::double precision*v) from unnest(p_vector) v)<=0 then raise exception 'Invalid query vector'; end if;
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (
   select c.id,c.name,c.title,c.location,c.skills,c.experience,c.status,1-(v.indexed_embedding operator(%1$I.<=>) p_vector::%1$I.vector(384)) as similarity
   from public."candidateVectors" v join public.candidates c on c.id=v.candidate_id and c.workspace_id=v.workspace_id
   where v.workspace_id=ws and v.namespace=p_namespace and c."mergedInto" is null and v.fingerprint=md5(public.professional_text(c))
    and (p_location='' or lower(c.location)=lower(p_location)) and (p_status='' or c.status=p_status) and coalesce(c.experience,0)>=greatest(p_min_experience,0)
   order by v.indexed_embedding operator(%1$I.<=>) p_vector::%1$I.vector(384),c.id limit 20
  ) rows;
  return result;
 end $fn$;
 $ddl$,ns);
end $$;
commit;
