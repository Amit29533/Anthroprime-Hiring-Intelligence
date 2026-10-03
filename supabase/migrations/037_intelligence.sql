-- Phase 5: tenant-scoped retrieval and human-reviewed AI artifacts. AI starts disabled.
begin;
create table if not exists public."intelligenceSettings" (
 workspace_id uuid primary key references public.workspaces(id), enabled boolean not null default false,
 daily_limit integer not null default 20 check(daily_limit between 1 and 100)
);
create table if not exists public."candidateVectors" (
 workspace_id uuid not null, candidate_id uuid not null, namespace text not null,
 fingerprint text not null, embedding real[] not null check(array_length(embedding,1)=384),
 updated timestamptz not null default now(),primary key(workspace_id,candidate_id,namespace),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id) on delete cascade
);
create table if not exists public."intelligenceRequests" (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 candidate_id uuid, kind text not null check(kind in ('embedding','draft','query')),
 fingerprint text not null, status text not null default 'pending' check(status in ('pending','draft','completed','failed','approved','rejected')),
 content text not null default '', model text not null default '', version text not null default 'professional-v1',
 created timestamptz not null default now(),reviewed timestamptz,
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id) on delete cascade
);
create index if not exists intelligence_usage on public."intelligenceRequests"(workspace_id,created);
alter table public."intelligenceRequests" add column if not exists provider text not null default 'openai' check(provider='openai');
alter table public."intelligenceRequests" add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public."intelligenceRequests" add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public."intelligenceRequests" add column if not exists generated_content text not null default '';
create or replace function public.audit_intelligence_metadata()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new);
begin
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot)
 values(new.workspace_id,tg_table_name,coalesce(row_data->>'id',new.workspace_id::text)::uuid,'Intelligence '||lower(tg_op),coalesce(auth.uid()::text,'Background worker'),
  case when tg_table_name='intelligenceSettings' then jsonb_build_object('enabled',row_data->'enabled','dailyLimit',row_data->'daily_limit')
  else jsonb_build_object('candidateId',row_data->'candidate_id','kind',row_data->'kind','status',row_data->'status','provider',row_data->'provider','model',row_data->'model','version',row_data->'version') end);
 return new;
end $$;
revoke all on function public.audit_intelligence_metadata() from public,anon,authenticated;
drop trigger if exists intelligence_audit on public."intelligenceSettings";
create trigger intelligence_audit after insert or update on public."intelligenceSettings" for each row execute function public.audit_intelligence_metadata();
drop trigger if exists intelligence_audit on public."intelligenceRequests";
create trigger intelligence_audit after insert or update on public."intelligenceRequests" for each row execute function public.audit_intelligence_metadata();
do $$ declare tbl text; begin
 foreach tbl in array array['intelligenceSettings','candidateVectors','intelligenceRequests'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
 end loop;
end $$;

-- No name, contact details, salary, notes, raw CV text or employer names in this projection.
create or replace function public.professional_text(c public.candidates) returns text
language sql immutable set search_path='' as $$
 select left(concat_ws(' ',c.title,array_to_string(c.skills,' '),c.experience::text||' years experience',c.location,c.mode),8000)
$$;
revoke all on function public.professional_text(public.candidates) from public,anon;

create or replace function public.api_intelligence_settings(p_operation text default 'get',p_enabled boolean default false,p_daily_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501'; end if;
 if p_operation='save' then
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  insert into public."intelligenceSettings" values(ws,p_enabled,p_daily_limit) on conflict(workspace_id) do update set enabled=excluded.enabled,daily_limit=excluded.daily_limit;
 elsif p_operation<>'get' then raise exception 'Invalid operation'; end if;
 select jsonb_build_object('enabled',enabled,'dailyLimit',daily_limit) into result from public."intelligenceSettings" where workspace_id=ws;
 return coalesce(result,'{"enabled":false,"dailyLimit":20}'::jsonb)||jsonb_build_object('usedToday',(select count(*) from public."intelligenceRequests" where workspace_id=ws and created>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'));
end $$;

create or replace function public.api_index_candidates(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (select c.id,public.professional_text(c) as text,md5(public.professional_text(c)) as fingerprint from public.candidates c where c.workspace_id=ws and c."mergedInto" is null order by c.id limit 20 offset p_offset) rows;
 return result;
end $$;

create or replace function public.put_candidate_vector(ws uuid,cid uuid,fp text,vec real[],ns text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if array_ndims(vec) is distinct from 1 or array_length(vec,1) is distinct from 384 or exists(select 1 from unnest(vec) v where v is null or v::text in ('NaN','Infinity','-Infinity')) or (select sum(v::double precision*v) from unnest(vec) v)<=0 then raise exception 'Invalid 384 dimensional vector'; end if;
 if not exists(select 1 from public.candidates c where c.workspace_id=ws and c.id=cid and c."mergedInto" is null and md5(public.professional_text(c))=fp) then raise exception 'Candidate changed; refresh before indexing' using errcode='40001'; end if;
 insert into public."candidateVectors"(workspace_id,candidate_id,namespace,fingerprint,embedding) values(ws,cid,ns,fp,vec)
 on conflict(workspace_id,candidate_id,namespace) do update set fingerprint=excluded.fingerprint,embedding=excluded.embedding,updated=now();
end $$;
revoke all on function public.put_candidate_vector(uuid,uuid,text,real[],text) from public,anon,authenticated;

create or replace function public.api_index_candidate(p_id uuid,p_fingerprint text,p_vector real[])
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 perform public.put_candidate_vector(ws,p_id,p_fingerprint,p_vector,'local-v1');
end $$;

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
  select c.id,c.name,c.title,c.location,c.skills,c.experience,c.status,
   (select sum(v.embedding[i]::double precision*p_vector[i])/nullif(sqrt(sum(v.embedding[i]::double precision*v.embedding[i]))*norm,0) from generate_series(1,384) i) as similarity
  from public."candidateVectors" v join public.candidates c on c.id=v.candidate_id and c.workspace_id=v.workspace_id
  where v.workspace_id=ws and v.namespace=p_namespace and c."mergedInto" is null and v.fingerprint=md5(public.professional_text(c))
   and (p_location='' or lower(c.location)=lower(p_location)) and (p_status='' or c.status=p_status) and coalesce(c.experience,0)>=greatest(p_min_experience,0)
  order by similarity desc,c.id limit 20
 ) rows;
 return result;
end $$;

create or replace function public.api_intelligence_reserve(p_kind text,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); cfg record; input text; fp text; rid uuid;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into cfg from public."intelligenceSettings" where workspace_id=ws for update;
 if not found or not cfg.enabled then raise exception 'External AI is disabled' using errcode='42501'; end if;
 if p_kind not in ('embedding','draft','query') then raise exception 'Invalid AI operation'; end if;
 if (select count(*) from public."intelligenceRequests" where workspace_id=ws and created>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cfg.daily_limit then raise exception 'Daily AI request limit reached'; end if;
 if p_kind<>'query' then
  select public.professional_text(c) into input from public.candidates c where c.workspace_id=ws and c.id=p_id and c."mergedInto" is null;
  if not found then raise exception 'Candidate not found'; end if;
 end if;
 fp:=md5(coalesce(input,''));
 insert into public."intelligenceRequests"(workspace_id,candidate_id,kind,fingerprint) values(ws,case when p_kind='query' then null else p_id end,p_kind,fp) returning id into rid;
 return jsonb_build_object('id',rid,'text',input,'fingerprint',fp);
end $$;

create or replace function public.worker_intelligence_complete(p_id uuid,p_model text,p_content text default '',p_vector real[] default null,p_failed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare job record;
begin
 select * into job from public."intelligenceRequests" where id=p_id and status='pending' for update;
 if not found then raise exception 'AI request is no longer pending'; end if;
 if p_failed then update public."intelligenceRequests" set status='failed' where id=p_id; return; end if;
 if not exists(select 1 from public."intelligenceSettings" where workspace_id=job.workspace_id and enabled) then raise exception 'External AI was disabled during this request'; end if;
 if length(p_model) not between 1 and 100 or length(p_content)>5000 then raise exception 'Invalid AI result'; end if;
 if job.kind<>'query' and not exists(select 1 from public.candidates c where c.workspace_id=job.workspace_id and c.id=job.candidate_id and c."mergedInto" is null and md5(public.professional_text(c))=job.fingerprint) then raise exception 'Candidate changed during AI processing'; end if;
 if job.kind='embedding' then perform public.put_candidate_vector(job.workspace_id,job.candidate_id,job.fingerprint,p_vector,'openai:'||p_model||':384:v1'); end if;
 if job.kind='draft' and length(btrim(p_content))=0 then raise exception 'Empty AI draft'; end if;
 update public."intelligenceRequests" set status=case when kind='draft' then 'draft' else 'completed' end,model=p_model,content=case when kind='draft' then p_content else '' end,generated_content=case when kind='draft' then p_content else '' end where id=p_id;
end $$;
revoke all on function public.worker_intelligence_complete(uuid,text,text,real[],boolean) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_intelligence_complete(uuid,text,text,real[],boolean) to service_role; end if; end $$;

create or replace function public.api_intelligence_drafts(p_candidate uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from (select r.id,r.candidate_id,c.name,r.status,r.content,r.provider,r.model,r.version,r.created,r.created_by,r.reviewed,r.reviewed_by,(r.fingerprint=md5(public.professional_text(c)) and c."mergedInto" is null) as current from public."intelligenceRequests" r join public.candidates c on c.id=r.candidate_id and c.workspace_id=r.workspace_id where r.workspace_id=ws and r.kind='draft' and (p_candidate is null or r.candidate_id=p_candidate) order by r.created desc limit 50) rows;
 return result;
end $$;
create or replace function public.api_review_intelligence(p_id uuid,p_approve boolean,p_content text default '')
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); job record;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into job from public."intelligenceRequests" where id=p_id and workspace_id=ws and status='draft' for update;
 if not found then raise exception 'Draft is no longer available'; end if;
 if p_approve and (length(btrim(p_content)) not between 1 and 5000 or not exists(select 1 from public.candidates c where c.id=job.candidate_id and c.workspace_id=ws and c."mergedInto" is null and md5(public.professional_text(c))=job.fingerprint)) then raise exception 'Draft is empty or candidate changed; regenerate'; end if;
 update public."intelligenceRequests" set status=case when p_approve then 'approved' else 'rejected' end,content=case when p_approve then p_content else content end,reviewed=now(),reviewed_by=auth.uid() where id=p_id;
end $$;
do $$ declare fn regprocedure; begin
 foreach fn in array array['public.api_intelligence_settings(text,boolean,integer)'::regprocedure,'public.api_index_candidates(integer)'::regprocedure,'public.api_index_candidate(uuid,text,real[])'::regprocedure,'public.api_hosted_search(real[],text,text,text,numeric)'::regprocedure,'public.api_intelligence_reserve(text,uuid)'::regprocedure,'public.api_intelligence_drafts(uuid)'::regprocedure,'public.api_review_intelligence(uuid,boolean,text)'::regprocedure] loop
 execute format('revoke all on function %s from public,anon',fn);execute format('grant execute on function %s to authenticated',fn);
 end loop;
end $$;
commit;
