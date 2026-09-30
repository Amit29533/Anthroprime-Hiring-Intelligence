begin;
-- Persist the existing merge marker so retired profiles are excluded from cloud filters.
alter table public.candidates add column if not exists "mergedInto" uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='candidates_merge_workspace_fk') then
  alter table public.candidates add constraint candidates_merge_workspace_fk foreign key(workspace_id,"mergedInto") references public.candidates(workspace_id,id);
  alter table public.candidates add constraint candidates_merge_not_self check("mergedInto" is null or "mergedInto"<>id);
 end if;
end $$;
alter table public.documents add column if not exists "clientId" uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='documents_client_workspace_fk') then
    alter table public.documents add constraint documents_client_workspace_fk foreign key(workspace_id,"clientId") references public.clients(workspace_id,id);
    alter table public.documents add constraint documents_single_owner check("clientId" is null or "candidateId" is null);
  end if;
end $$;
create index if not exists documents_client on public.documents(workspace_id,"clientId") where "clientId" is not null;

-- Client agreements may contain internal commercial terms. Candidate documents keep their
-- existing member permissions; client files are accessible only to workspace administrators.
drop policy if exists workspace_read on public.documents;
create policy workspace_read on public.documents for select to authenticated using(workspace_id=public.current_workspace() and ("clientId" is null or public.is_admin()));
drop policy if exists workspace_insert on public.documents;
create policy workspace_insert on public.documents for insert to authenticated with check(public.can_edit_workspace(workspace_id) and ("clientId" is null or public.is_admin()));
drop policy if exists workspace_update on public.documents;
create policy workspace_update on public.documents for update to authenticated using(public.can_edit_workspace(workspace_id) and ("clientId" is null or public.is_admin())) with check(public.can_edit_workspace(workspace_id) and ("clientId" is null or public.is_admin()));
-- Updates retain old document snapshots in history; restrict those snapshots as well.
drop policy if exists history_read on public.history;
create policy history_read on public.history for select to authenticated using(workspace_id=public.current_workspace() and ("entityType"<>'documents' or snapshot->>'clientId' is null or public.is_admin()));

create or replace function public.check_client_document_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (old."clientId" is not null or new."clientId" is not null)
    and (old."clientId",old."candidateId",old."storagePath",old."storageProvider") is distinct from (new."clientId",new."candidateId",new."storagePath",new."storageProvider") then
    raise exception 'Client document ownership and storage location cannot be changed';
  end if;
  if new."clientId" is not null and new."storageProvider"='r2' and strpos(new."storagePath",new.workspace_id::text||'/clients/'||new."clientId"::text||'/')<>1 then
    raise exception 'Client document storage path must belong to its workspace and client';
  end if;
  return new;
end $$;
drop trigger if exists client_document_owner on public.documents;
create trigger client_document_owner before insert or update on public.documents for each row execute function public.check_client_document_owner();

create index if not exists candidates_engagement_filter on public.candidates(workspace_id,engagement,id) where "mergedInto" is null;
create index if not exists candidates_expected_filter on public.candidates(workspace_id,expected,id) where "mergedInto" is null;

create or replace function public.api_filter_candidates(p_employer text default '',p_engagement text default '',p_max_expected numeric default null,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); ids jsonb;
begin
  if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
  if p_max_expected is not null and not public.is_admin() then raise exception 'Compensation filters require administrator access'; end if;
  if p_max_expected<0 or p_max_expected::text in ('NaN','Infinity','-Infinity') then raise exception 'Maximum expected compensation must be zero or greater'; end if;
  if length(coalesce(p_employer,''))>120 then raise exception 'Employer search must be 120 characters or fewer'; end if;
  if coalesce(p_engagement,'') not in ('','Permanent','Contract','C2H','Subcontract') then raise exception 'Invalid engagement preference'; end if;
  if p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset<0 then raise exception 'Invalid pagination'; end if;
  select coalesce(jsonb_agg(t.id order by t.id),'[]'::jsonb) into ids from (
    select c.id from public.candidates c where c.workspace_id=ws and c."mergedInto" is null
    and (btrim(coalesce(p_employer,''))='' or strpos(lower(coalesce(c.company,'')),lower(btrim(p_employer)))>0)
    and (coalesce(p_engagement,'')='' or c.engagement=p_engagement)
    and (p_max_expected is null or c.expected<=p_max_expected)
    order by c.id limit p_limit offset p_offset
  ) t;
  return jsonb_build_object('ids',ids,'limit',p_limit,'offset',p_offset);
end $$;
revoke all on function public.api_filter_candidates(text,text,numeric,integer,integer) from public,anon;
grant execute on function public.api_filter_candidates(text,text,numeric,integer,integer) to authenticated;

-- Preserve the full previous feed, replacing only document metadata with the new linkage.
do $$ begin
 if to_regprocedure('public.api_changes_since_v032(date)') is null then alter function public.api_changes_since(date) rename to api_changes_since_v032; end if;
 if to_regprocedure('public.api_changes_page_v032(date,integer,integer)') is null then alter function public.api_changes_page(date,integer,integer) rename to api_changes_page_v032; end if;
end $$;
revoke all on function public.api_changes_since_v032(date),public.api_changes_page_v032(date,integer,integer) from public,anon,authenticated;
create or replace function public.api_changes_since(day date default current_date-30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 result:=public.api_changes_since_v032(day); if ws is null then return result; end if;
 return result||jsonb_build_object('documents',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb) from (
 select d.id,d.workspace_id,d."candidateId",d."clientId",d.kind,d.name,d.mime,d.size,d.version,d.hash,d."parserStatus",d.removed,d.uploaded,d.updated
 from public.documents d where d.workspace_id=ws and (d."clientId" is null or public.is_admin()) and (d.uploaded::date>=day or d.updated::date>=day) order by d.id) t));
end $$;
create or replace function public.api_changes_page(day date default current_date-30,page_block integer default 0,page_size integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb; off integer; lim integer;
begin
 result:=public.api_changes_page_v032(day,page_block,page_size); if ws is null then return result; end if;
 off:=greatest(page_block,0)*greatest(page_size,1); lim:=greatest(page_size,1);
 return result||jsonb_build_object('documents',(select coalesce(jsonb_agg(to_jsonb(t)-'workspace_id'),'[]'::jsonb) from (
 select d.id,d.workspace_id,d."candidateId",d."clientId",d.kind,d.name,d.mime,d.size,d.version,d.hash,d."parserStatus",d.removed,d.uploaded,d.updated
 from public.documents d where d.workspace_id=ws and (d."clientId" is null or public.is_admin()) and (d.uploaded::date>=day or d.updated::date>=day) order by d.id limit lim offset off) t));
end $$;
revoke all on function public.api_changes_since(date),public.api_changes_page(date,integer,integer) from public,anon;
grant execute on function public.api_changes_since(date),public.api_changes_page(date,integer,integer) to authenticated;
commit;
