-- Phase C1: private scan gate for durable CV imports. No CV bytes go to VirusTotal.
begin;
alter table public."importFiles" add column if not exists scan_status text not null default 'pending' check(scan_status in ('pending','scanning','clean','infected','error'));
alter table public."importFiles" add column if not exists scan_lease uuid;
alter table public."importFiles" add column if not exists scan_until timestamptz;
alter table public."importFiles" add column if not exists scan_attempts integer not null default 0;
alter table public."importFiles" add column if not exists scan_after timestamptz not null default now();
alter table public."importFiles" add column if not exists scan_etag text;
alter table public."importFiles" add column if not exists scan_engine text;
alter table public."importFiles" add column if not exists scanned_at timestamptz;
-- Verdicts survive deletion of review batches. They are never writable by browsers.
create table if not exists ecod_private.cv_scan_verdicts (
 id uuid primary key,workspace_id uuid not null,storage_path text not null,
 hash text not null,size integer not null,etag text not null,engine text not null,scanned_at timestamptz not null
);
revoke all on ecod_private.cv_scan_verdicts from public,anon,authenticated;
alter table public.documents add column if not exists "scanRequired" boolean not null default false;
update public.documents d set "scanRequired"=true where not d."scanRequired" and exists(select 1 from public."importFiles" f where f.id=d.id or f.storage_path=d."storagePath");

create or replace function public.worker_claim_cv_scan()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 select ib.* into b from public."importBatches" ib where ib.status='draft' and ecod_private.cv_staging_enabled(ib.workspace_id) and exists(
  select 1 from public."importFiles" x where x.batch_id=ib.id and x.state<>'uploading' and x.scan_attempts<3 and x.scan_after<=now() and
  (x.scan_status in ('pending','error') or (x.scan_status='scanning' and x.scan_until<now())))
 order by ib.created_at,ib.id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into f from public."importFiles" where batch_id=b.id and state<>'uploading' and scan_attempts<3 and scan_after<=now() and
  (scan_status in ('pending','error') or (scan_status='scanning' and scan_until<now())) order by row_no limit 1 for update;
 update public."importFiles" set scan_status='scanning',scan_lease=gen_random_uuid(),scan_until=now()+interval '90 seconds',scan_attempts=scan_attempts+1 where id=f.id returning * into f;
 return to_jsonb(f);
end $$;
create or replace function public.worker_finish_cv_scan(p_file uuid,p_lease uuid,p_status text,p_etag text default null,p_engine text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 select ib.* into b from public."importBatches" ib join public."importFiles" x on x.batch_id=ib.id where x.id=p_file for update of ib;
 if not found or b.status<>'draft' or not ecod_private.cv_staging_enabled(b.workspace_id) then return false; end if;
 select * into f from public."importFiles" where id=p_file for update;
 if f.scan_status<>'scanning' or f.scan_lease is distinct from p_lease or f.scan_until<now() then return false; end if;
 if p_status is null or p_status not in ('clean','infected','error') then raise exception 'Invalid scan result'; end if;
 if p_status='clean' and (coalesce(length(p_etag),0) not between 1 and 200 or coalesce(length(p_engine),0) not between 1 and 200) then raise exception 'Missing scan provenance'; end if;
 update public."importFiles" set scan_status=p_status,scan_lease=null,scan_until=null,scan_after=now()+interval '1 minute',
 scan_etag=case when p_status='clean' then p_etag end,scan_engine=case when p_status='clean' then p_engine end,
 scanned_at=case when p_status='clean' then now() end,
 warning=case p_status when 'infected' then 'File blocked by antivirus. Exclude this row and use a new batch for a replacement.' when 'error' then 'Scan unavailable or original verification failed. File remains quarantined.' else '' end where id=f.id;
 if p_status='clean' then
  insert into ecod_private.cv_scan_verdicts values(f.id,f.workspace_id,f.storage_path,f.hash,f.size,p_etag,p_engine,now())
   on conflict(id) do update set etag=excluded.etag,engine=excluded.engine,scanned_at=excluded.scanned_at;
 end if;
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id;
 return true;
end $$;
-- Editor retry may reset transient exhaustion, never an infected verdict or a clean fingerprint.
create or replace function ecod_private.cv_scan_gate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state in ('extracting','ready','manual') and new.state is distinct from old.state and (new.scan_status<>'clean' or new.scan_etag is null) then raise exception 'CV is quarantined pending antivirus scan'; end if;
 if old.state='failed' and new.state='queued' and old.scan_status='error' then
  new.scan_status:='pending';new.scan_attempts:=0;new.scan_after:=now();
 end if;
 return new;
end $$;
drop trigger if exists cv_scan_gate on public."importFiles";
create trigger cv_scan_gate before update on public."importFiles" for each row execute function ecod_private.cv_scan_gate();

create or replace function ecod_private.cv_scan_approval_gate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='queued' and old.status is distinct from new.status and exists(
  select 1 from public."importRows" r join public."importFiles" f on f.batch_id=r.batch_id and f.row_no=r.row_no
  where r.batch_id=new.id and r.status in ('draft','pending') and f.scan_status<>'clean') then raise exception 'Included CV is quarantined pending antivirus scan'; end if;
 return new;
end $$;
drop trigger if exists cv_scan_approval_gate on public."importBatches";
create trigger cv_scan_approval_gate before update on public."importBatches" for each row execute function ecod_private.cv_scan_approval_gate();

create or replace function ecod_private.cv_document_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare v ecod_private.cv_scan_verdicts; required boolean;
begin
 required:=exists(select 1 from public."importFiles" f where f.id=new.id or f.storage_path=new."storagePath") or exists(select 1 from ecod_private.cv_scan_verdicts x where x.id=new.id or x.storage_path=new."storagePath");
 if tg_op='UPDATE' then
  if old."scanRequired" and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new."storagePath" is distinct from old."storagePath" or new.hash is distinct from old.hash or new.size is distinct from old.size or new."storageProvider" is distinct from old."storageProvider") then raise exception 'Scanned original identity is immutable'; end if;
  required:=required or old."scanRequired";
 end if;
 new."scanRequired":=required;
 -- Existing unverified originals remain blocked for download, but can still be archived.
 if required and (tg_op='INSERT' or not old."scanRequired") then
  select * into v from ecod_private.cv_scan_verdicts where id=new.id and workspace_id=new.workspace_id and storage_path=new."storagePath" and hash=new.hash and size=new.size;
  if not found then raise exception 'CV document is quarantined pending antivirus scan'; end if;
 end if;
 return new;
end $$;
drop trigger if exists cv_document_gate on public.documents;
create trigger cv_document_gate before insert or update on public.documents for each row execute function ecod_private.cv_document_gate();

-- Same tenant/client rules as document SELECT; missing proof always blocks scanned originals.
create or replace function public.api_document_scan(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.documents; v ecod_private.cv_scan_verdicts; ws uuid:=public.current_workspace();
begin
 select * into d from public.documents where id=p_document and workspace_id=ws and ("clientId" is null or public.is_admin());
 if not found or d.removed then return null; end if;
 if not d."scanRequired" then return jsonb_build_object('required',false); end if;
 select * into v from ecod_private.cv_scan_verdicts where id=d.id and workspace_id=ws and storage_path=d."storagePath" and hash=d.hash and size=d.size;
 return jsonb_build_object('required',true,'status',case when v.id is not null then 'clean' else 'unverified' end,'etag',v.etag,'size',v.size);
end $$;
revoke all on function public.worker_claim_cv_scan(),public.worker_finish_cv_scan(uuid,uuid,text,text,text),public.api_document_scan(uuid) from public,anon,authenticated;
do $$begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.worker_claim_cv_scan(),public.worker_finish_cv_scan(uuid,uuid,text,text,text) to service_role;
 end if;
end $$;
grant execute on function public.api_document_scan(uuid) to authenticated;
revoke all on function ecod_private.cv_scan_gate(),ecod_private.cv_scan_approval_gate(),ecod_private.cv_document_gate() from public,anon,authenticated;
create or replace function public.worker_claim_cv()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 -- Lock parent first, like all review and approval operations. SKIP LOCKED permits parallel workers.
 select ib.* into b from public."importBatches" ib where ib.status='draft' and ecod_private.cv_staging_enabled(ib.workspace_id) and exists(
  select 1 from public."importFiles" x where x.batch_id=ib.id and x.scan_status='clean' and (x.state='queued' or (x.state='extracting' and x.lease_until<now())))
  order by ib.created_at,ib.id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into f from public."importFiles" where batch_id=b.id and scan_status='clean' and (state='queued' or (state='extracting' and lease_until<now())) order by row_no limit 1 for update;
 if f.attempts>=3 then
  update public."importFiles" set state='failed',warning='Extraction interrupted repeatedly. Retry processing.' where id=f.id; return null;
 end if;
 update public."importFiles" set state='extracting',lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1 where id=f.id returning * into f;
 return to_jsonb(f);
end $$;

create or replace function public.api_cv_files(p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(f)-'lease'-'lease_until'-'storage_path'-'extracted'-'scan_lease'-'scan_until'-'scan_etag'),'[]') into result from public."importFiles" f where workspace_id=ws and batch_id=p_batch;
 return result;
end $$;


create or replace function public.api_retry_cv_scan(p_batch uuid,p_row integer)
returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into b from public."importBatches" where id=p_batch and workspace_id=ws for update;
 if not found or b.status<>'draft' then raise exception 'Import is no longer editable'; end if;
 update public."importFiles" set scan_status='pending',scan_attempts=0,scan_after=now(),warning=''
 where batch_id=b.id and row_no=p_row and (scan_status='error' or (scan_status='scanning' and scan_until<now()));
end $$;
revoke all on function public.api_retry_cv_scan(uuid,integer) from public,anon,authenticated;
grant execute on function public.api_retry_cv_scan(uuid,integer) to authenticated;

commit;
