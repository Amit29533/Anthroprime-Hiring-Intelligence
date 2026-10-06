-- Phase B2: immutable private originals, leased extraction, reviewed atomic imports.
begin;
create table if not exists public."importFiles" (
 workspace_id uuid not null,batch_id uuid not null,row_no integer not null,
 id uuid not null default gen_random_uuid() unique,
 name text not null check(length(name) between 1 and 160),
 ext text not null check(ext in ('pdf','docx','txt','md','csv')),
 mime text not null,size integer not null check(size between 1 and 5242880),
 hash text not null check(hash ~ '^[0-9a-f]{64}$'),storage_path text not null,
 state text not null default 'uploading' check(state in ('uploading','queued','extracting','ready','manual','failed')),
 lease uuid,lease_until timestamptz,attempts integer not null default 0,
 extracted text not null default '' check(length(extracted)<=40000),warning text not null default '',
 primary key(batch_id,row_no),foreign key(workspace_id,batch_id) references public."importBatches"(workspace_id,id) on delete cascade
);
create index if not exists import_files_queue on public."importFiles"(state,lease_until,batch_id,row_no) where state in ('queued','extracting');
alter table public."importFiles" enable row level security;
revoke all on public."importFiles" from public,anon,authenticated;
grant select on public."importFiles" to authenticated;
drop policy if exists import_files_editor_read on public."importFiles";
create policy import_files_editor_read on public."importFiles" for select to authenticated
 using(workspace_id=(select public.current_workspace()) and public.can_edit_workspace(workspace_id));

-- Staging preview is opt-in. Leave disabled in production until Phase C's scan gate is integrated.
create or replace function ecod_private.cv_staging_enabled(ws uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'durableCvImports'='true'::jsonb)
$$;
revoke all on function ecod_private.cv_staging_enabled(uuid) from public,anon,authenticated;

create or replace function public.api_create_cv_import(p_id uuid,p_files jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches"; f jsonb; n integer:=0; v_id uuid; v_ext text; v_mime text; existing public."importFiles";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if not ecod_private.cv_staging_enabled(ws) then raise exception 'Durable CV staging is not enabled for this workspace'; end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 20 then raise exception 'Choose 1 to 20 CV files'; end if;
 perform public.api_create_import(p_id,'CV upload',jsonb_array_length(p_files),'{"_kind":"cv"}');
 select * into b from public."importBatches" where id=p_id and workspace_id=ws for update;
 for f in select value from jsonb_array_elements(p_files) loop
  n:=n+1; v_ext:=lower(f->>'ext');
  v_mime:=case v_ext when 'pdf' then 'application/pdf' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' when 'csv' then 'text/csv' when 'txt' then 'text/plain' when 'md' then 'text/plain' end;
  if v_mime is null or length(coalesce(f->>'name','')) not between 1 and 160 or coalesce(f->>'hash','') !~ '^[0-9a-f]{64}$' or (f->>'size') is null or (f->>'size')::integer not between 1 and 5242880 then raise exception 'Invalid CV file'; end if;
  select * into existing from public."importFiles" where batch_id=b.id and row_no=n;
  if found then
   if existing.name<>f->>'name' or existing.ext<>v_ext or existing.hash<>f->>'hash' or existing.size<>(f->>'size')::integer then raise exception 'CV manifest conflict'; end if;
  else
   if b.status<>'draft' then raise exception 'Import is no longer editable'; end if;
   v_id:=gen_random_uuid();
   insert into public."importFiles"(workspace_id,batch_id,row_no,id,name,ext,mime,size,hash,storage_path)
    values(ws,b.id,n,v_id,f->>'name',v_ext,v_mime,(f->>'size')::integer,f->>'hash',ws::text||'/imports/'||b.id::text||'/'||v_id::text);
   insert into public."importRows"(workspace_id,batch_id,row_no,source_line,payload,status,error)
    values(ws,b.id,n,n,'{}','excluded','Original CV is awaiting upload and extraction.');
  end if;
 end loop;
 return jsonb_build_object('id',b.id);
end $$;

create or replace function public.api_cv_files(p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(f)-'lease'-'lease_until'-'storage_path'-'extracted'),'[]') into result from public."importFiles" f where workspace_id=ws and batch_id=p_batch;
 return result;
end $$;

create or replace function public.api_cv_uploaded(p_batch uuid,p_row integer)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into b from public."importBatches" where id=p_batch and workspace_id=ws for update;
 if not found or b.status<>'draft' then raise exception 'Import is no longer editable'; end if;
 update public."importFiles" set attempts=case when state='failed' then 0 else attempts end,state='queued',warning='',lease=null,lease_until=null
  where batch_id=b.id and row_no=p_row and state in ('uploading','failed');
end $$;

create or replace function public.worker_claim_cv()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 -- Lock parent first, like all review and approval operations. SKIP LOCKED permits parallel workers.
 select ib.* into b from public."importBatches" ib where ib.status='draft' and ecod_private.cv_staging_enabled(ib.workspace_id) and exists(
  select 1 from public."importFiles" x where x.batch_id=ib.id and (x.state='queued' or (x.state='extracting' and x.lease_until<now())))
  order by ib.created_at,ib.id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into f from public."importFiles" where batch_id=b.id and (state='queued' or (state='extracting' and lease_until<now())) order by row_no limit 1 for update;
 if f.attempts>=3 then
  update public."importFiles" set state='failed',warning='Extraction interrupted repeatedly. Retry processing.' where id=f.id; return null;
 end if;
 update public."importFiles" set state='extracting',lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1 where id=f.id returning * into f;
 return to_jsonb(f);
end $$;

create or replace function public.worker_finish_cv(p_file uuid,p_lease uuid,p_state text,p_text text,p_draft jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches"; draft jsonb;
begin
 select ib.* into b from public."importBatches" ib join public."importFiles" x on x.batch_id=ib.id where x.id=p_file for update of ib;
 if not found or b.status<>'draft' or not ecod_private.cv_staging_enabled(b.workspace_id) then return false; end if;
 select * into f from public."importFiles" where id=p_file for update;
 if f.state<>'extracting' or f.lease is distinct from p_lease or f.lease_until<now() then return false; end if;
 if p_state not in ('ready','manual','failed') or p_state is null or p_text is null or length(p_text)>40000 or jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>20000 then raise exception 'Invalid extraction result'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into draft from jsonb_each(p_draft)
  where key=any(array['name','email','phone','linkedin','title','skills','experience','summary']);
 draft:=draft||'{"source":"CV upload","status":"Assessing","mode":"Flexible"}';
 update public."importFiles" set state=p_state,extracted=p_text,lease=null,lease_until=null,
  warning=case p_state when 'failed' then 'Original could not be verified or read. Retry upload/processing.' when 'manual' then 'No usable text extracted. Enter candidate details manually; OCR is not available.' else '' end where id=f.id;
 -- A later extraction result must not overwrite a recruiter's edits. Waiting rows only.
 update public."importRows" set payload=draft,status='excluded',error=case when p_state='failed' then 'Original file verification failed.' else 'Review CV name and contact, then save this row to include it.' end
  where batch_id=b.id and row_no=f.row_no and payload='{}';
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id;
 return true;
end $$;

create or replace function ecod_private.guard_cv_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='queued' and old.status is distinct from new.status and exists(
  select 1 from public."importRows" r join public."importFiles" f on f.batch_id=r.batch_id and f.row_no=r.row_no
   where r.batch_id=new.id and ((r.status in ('draft','pending') and f.state not in ('ready','manual'))
    or (r.status='excluded' and r.error<>'Excluded by reviewer.'))) then
  raise exception 'Verify and review each included CV, or explicitly exclude its row before approval';
 end if;
 return new;
end $$;
drop trigger if exists cv_approval_guard on public."importBatches";
create trigger cv_approval_guard before update on public."importBatches" for each row execute function ecod_private.guard_cv_approval();

create or replace function ecod_private.commit_import_document()
returns trigger language plpgsql security definer set search_path='' as $$
declare f public."importFiles";
begin
 if new.status='completed' and old.status is distinct from new.status then
  select * into f from public."importFiles" where batch_id=new.batch_id and row_no=new.row_no;
  if found then
   if not ecod_private.cv_staging_enabled(f.workspace_id) then raise exception 'CV staging is disabled'; end if;
   if f.state not in ('ready','manual') then raise exception 'CV original is not verified'; end if;
   insert into public.documents(id,workspace_id,"candidateId",kind,name,mime,size,hash,"storagePath","storageProvider",stored,"parserStatus",extracted,"uploadedBy")
    values(f.id,f.workspace_id,new.candidate_id,'CV',f.name,f.mime,f.size,f.hash,f.storage_path,'r2',true,case f.state when 'ready' then 'parsed' else 'manual' end,f.extracted,'Recruiter');
  end if;
 end if;
 return new;
end $$;
drop trigger if exists commit_import_document on public."importRows";
create trigger commit_import_document before update on public."importRows" for each row execute function ecod_private.commit_import_document();
revoke all on function ecod_private.guard_cv_approval(),ecod_private.commit_import_document() from public,anon,authenticated;
revoke all on function public.api_create_cv_import(uuid,jsonb),public.api_cv_files(uuid),public.api_cv_uploaded(uuid,integer) from public,anon;
grant execute on function public.api_create_cv_import(uuid,jsonb),public.api_cv_files(uuid),public.api_cv_uploaded(uuid,integer) to authenticated;
revoke all on function public.worker_claim_cv(),public.worker_finish_cv(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_claim_cv(),public.worker_finish_cv(uuid,uuid,text,text,jsonb) to service_role; end if; end $$;
commit;
