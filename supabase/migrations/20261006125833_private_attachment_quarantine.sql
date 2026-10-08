-- Phase C2: opted-in cloud attachment quarantine, private scan and text extraction.
begin;
create or replace function ecod_private.attachments_enabled(ws uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'privateDocuments'='true'::jsonb)
$$;
revoke all on function ecod_private.attachments_enabled(uuid) from public,anon,authenticated;
create or replace function ecod_private.cv_staging_enabled(ws uuid) returns boolean language sql stable security definer set search_path='' as $$
 select ecod_private.attachments_enabled(ws) or exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'durableCvImports'='true'::jsonb)
$$;
create table if not exists public."documentJobs" (
 id uuid primary key, workspace_id uuid not null references public.workspaces(id),
 candidate_id uuid,client_id uuid,name text not null,ext text not null,mime text not null,kind text not null,
 size integer not null check(size between 1 and 5242880),hash text not null check(hash ~ '^[0-9a-f]{64}$'),storage_path text not null unique,
 uploaded boolean not null default false,scan_status text not null default 'pending' check(scan_status in ('pending','scanning','clean','infected','error')),
 scan_lease uuid,scan_until timestamptz,scan_attempts integer not null default 0,scan_after timestamptz not null default now(),
 scan_etag text,scan_engine text,scanned_at timestamptz,
 parse_state text not null default 'quarantined' check(parse_state in ('quarantined','queued','extracting','parsed','manual','failed')),
 parse_lease uuid,parse_until timestamptz,parse_attempts integer not null default 0,
 extracted text not null default '' check(length(extracted)<=40000),
 check((candidate_id is null)<>(client_id is null)),
 foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id),
 foreign key(workspace_id,client_id) references public.clients(workspace_id,id)
);
alter table public."documentJobs" enable row level security;
revoke all on public."documentJobs" from public,anon,authenticated;
-- Status is available only through the bounded, permission-checked RPC; no private leases or keys.
create index if not exists document_scan_queue on public."documentJobs"(scan_after,id) where uploaded and scan_status in ('pending','scanning','error');
create index if not exists document_parse_queue on public."documentJobs"(id) where scan_status='clean' and parse_state in ('queued','extracting');

create or replace function public.api_attachment_mode() returns boolean language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 return ecod_private.attachments_enabled(ws);
end $$;
create or replace function public.api_prepare_attachment(p_id uuid,p_candidate uuid,p_client uuid,p_name text,p_ext text,p_size integer,p_hash text,p_kind text default 'Other')
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); j public."documentJobs"; mt text; key text;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if not ecod_private.attachments_enabled(ws) then return jsonb_build_object('required',false); end if;
 if (p_candidate is null)=(p_client is null) or (p_client is not null and not public.is_admin()) then raise exception 'Attachment owner is not permitted' using errcode='42501'; end if;
 if p_candidate is not null and not exists(select 1 from public.candidates where id=p_candidate and workspace_id=ws) or p_client is not null and not exists(select 1 from public.clients where id=p_client and workspace_id=ws) then raise exception 'Attachment owner not found'; end if;
 mt:=case p_ext when 'pdf' then 'application/pdf' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' when 'txt' then 'text/plain' when 'md' then 'text/plain' when 'csv' then 'text/csv' end;
 if p_id is null or mt is null or coalesce(length(p_name),0) not between 1 and 160 or p_size is null or p_size not between 1 and 5242880 or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' or coalesce(length(p_kind),0) not between 1 and 80 then raise exception 'Invalid attachment manifest'; end if;
 key:=ws::text||case when p_client is not null then '/clients/'||p_client::text else '/candidates/'||p_candidate::text end||'/'||p_id::text||'/original.'||p_ext;
 -- Serialize repeated reservation requests on this document UUID.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,37));
 select * into j from public."documentJobs" where id=p_id;
 if found then
  if j.workspace_id<>ws or j.candidate_id is distinct from p_candidate or j.client_id is distinct from p_client or j.name<>p_name or j.hash<>p_hash or j.size<>p_size or j.ext<>p_ext or j.kind<>p_kind then raise exception 'Attachment manifest conflict'; end if;
 else
  if exists(select 1 from public.documents where id=p_id) then raise exception 'Attachment ID already exists'; end if;
  insert into public."documentJobs"(id,workspace_id,candidate_id,client_id,name,ext,mime,kind,size,hash,storage_path) values(p_id,ws,p_candidate,p_client,p_name,p_ext,mt,p_kind,p_size,p_hash,key) returning * into j;
  insert into public.documents(id,workspace_id,"candidateId","clientId",kind,name,mime,size,hash,"storagePath","storageProvider",stored,"parserStatus",extracted,"dataUrl","uploadedBy")
   values(j.id,ws,j.candidate_id,j.client_id,j.kind,j.name,j.mime,j.size,j.hash,j.storage_path,'r2',false,'quarantined','','','Recruiter');
 end if;
 return jsonb_build_object('required',true,'id',j.id,'storagePath',j.storage_path,'mime',j.mime);
end $$;
create or replace function public.api_attachment_uploaded(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); j public."documentJobs";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into j from public."documentJobs" where id=p_id and workspace_id=ws for update;
 if not found or j.client_id is not null and not public.is_admin() then raise exception 'Attachment not found' using errcode='42501'; end if;
 if not exists(select 1 from public.documents where id=j.id and not removed) then raise exception 'Attachment is archived'; end if;
 update public."documentJobs" set uploaded=true where id=j.id;
 update public.documents set stored=true where id=j.id;
end $$;
create or replace function public.api_attachment_status(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0)>50 then raise exception 'At most 50 attachments'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'uploaded',j.uploaded,'scan',j.scan_status,'parse',j.parse_state,'attempts',j.scan_attempts,'retryable',j.scan_status='error' or (j.scan_status='scanning' and j.scan_until<now()) or j.parse_state='failed' or (j.parse_state='extracting' and j.parse_until<now()))),'[]') into result
 from public."documentJobs" j join public.documents d on d.id=j.id where j.id=any(p_ids) and j.workspace_id=ws and (d."clientId" is null or public.is_admin());
 return result;
end $$;
create or replace function public.api_retry_attachment(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); j public."documentJobs";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into j from public."documentJobs" where id=p_id and workspace_id=ws for update;
 if not found or j.client_id is not null and not public.is_admin() then raise exception 'Attachment not found' using errcode='42501'; end if;
 update public."documentJobs" set scan_status='pending',scan_attempts=0,scan_after=now() where id=j.id and (scan_status='error' or (scan_status='scanning' and scan_until<now()));
 update public."documentJobs" set parse_state='queued',parse_attempts=0 where id=j.id and scan_status='clean' and (parse_state='failed' or (parse_state='extracting' and parse_until<now()));
end $$;

-- Extend the existing immutable-document guard; derive trusted extraction fields from the queue.
create or replace function ecod_private.attachment_document_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select * into j from public."documentJobs" where id=new.id or storage_path=new."storagePath" limit 1;
 if found then
  if new.id<>j.id or new.workspace_id<>j.workspace_id or new."candidateId" is distinct from j.candidate_id or new."clientId" is distinct from j.client_id or new."storagePath"<>j.storage_path or new.hash<>j.hash or new.size<>j.size or new."storageProvider"<>'r2' then raise exception 'Attachment original identity is immutable'; end if;
  new."scanRequired":=true;new.stored:=j.uploaded;new."dataUrl":='';
  new."parserStatus":=case when j.scan_status='infected' then 'blocked' when j.scan_status='error' then 'scan-error' when j.scan_status<>'clean' then 'quarantined' else j.parse_state end;
  new.extracted:=case when j.scan_status='clean' and j.parse_state in ('parsed','manual') then j.extracted else '' end;
 elsif tg_op='INSERT' and ecod_private.attachments_enabled(new.workspace_id) and not exists(select 1 from public."importFiles" f where f.id=new.id) and not exists(select 1 from ecod_private.cv_scan_verdicts v where v.id=new.id) then
  raise exception 'Reserve a private attachment before saving a document';
 end if;
 return new;
end $$;
drop trigger if exists aa_attachment_document_gate on public.documents;
create trigger aa_attachment_document_gate before insert or update on public.documents for each row execute function ecod_private.attachment_document_gate();
create or replace function ecod_private.cv_document_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare v ecod_private.cv_scan_verdicts; required boolean;
begin
 if exists(select 1 from public."documentJobs" where id=new.id) then return new; end if;
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

create or replace function public.worker_claim_attachment_scan() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select x.* into j from public."documentJobs" x join public.documents d on d.id=x.id
 where not d.removed and x.uploaded and ecod_private.attachments_enabled(x.workspace_id) and x.scan_attempts<3 and x.scan_after<=now() and (x.scan_status in ('pending','error') or (x.scan_status='scanning' and x.scan_until<now()))
 order by x.scan_after,x.id limit 1 for update of x skip locked;
 if not found then return null; end if;
 update public."documentJobs" set scan_status='scanning',scan_lease=gen_random_uuid(),scan_until=now()+interval '90 seconds',scan_attempts=scan_attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create or replace function public.worker_finish_attachment_scan(p_file uuid,p_lease uuid,p_status text,p_etag text default null,p_engine text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select * into j from public."documentJobs" where id=p_file for update;
 if not found or j.scan_status<>'scanning' or j.scan_lease is distinct from p_lease or j.scan_until<now() or not ecod_private.attachments_enabled(j.workspace_id) then return false; end if;
 if not exists(select 1 from public.documents where id=j.id and not removed) then return false; end if;
 if p_status is null or p_status not in ('clean','infected','error') then raise exception 'Invalid scan result'; end if;
 if p_status='clean' and (coalesce(length(p_etag),0) not between 1 and 200 or coalesce(length(p_engine),0) not between 1 and 200) then raise exception 'Missing scan provenance'; end if;
 update public."documentJobs" set scan_status=p_status,scan_lease=null,scan_until=null,scan_after=now()+interval '1 minute',scan_etag=case when p_status='clean' then p_etag end,scan_engine=case when p_status='clean' then p_engine end,scanned_at=case when p_status='clean' then now() end,parse_state=case when p_status='clean' then 'queued' else 'quarantined' end where id=j.id;
 if p_status='clean' then
  insert into ecod_private.cv_scan_verdicts values(j.id,j.workspace_id,j.storage_path,j.hash,j.size,p_etag,p_engine,now()) on conflict(id) do update set etag=excluded.etag,engine=excluded.engine,scanned_at=excluded.scanned_at;
 end if;
 update public.documents set "parserStatus"='quarantined' where id=j.id;
 return true;
end $$;
create or replace function public.worker_claim_attachment_extract() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select x.* into j from public."documentJobs" x join public.documents d on d.id=x.id where not d.removed and ecod_private.attachments_enabled(x.workspace_id) and x.scan_status='clean' and x.parse_attempts<3 and (x.parse_state='queued' or (x.parse_state='extracting' and x.parse_until<now())) order by x.id limit 1 for update of x skip locked;
 if not found then return null; end if;
 update public."documentJobs" set parse_state='extracting',parse_lease=gen_random_uuid(),parse_until=now()+interval '90 seconds',parse_attempts=parse_attempts+1 where id=j.id returning * into j;
 update public.documents set "parserStatus"='extracting' where id=j.id;
 return to_jsonb(j)||jsonb_build_object('lease',j.parse_lease);
end $$;
create or replace function public.worker_finish_attachment_extract(p_file uuid,p_lease uuid,p_state text,p_text text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select * into j from public."documentJobs" where id=p_file for update;
 if not found or j.scan_status<>'clean' or j.parse_state<>'extracting' or j.parse_lease is distinct from p_lease or j.parse_until<now() or not ecod_private.attachments_enabled(j.workspace_id) then return false; end if;
 if not exists(select 1 from public.documents where id=j.id and not removed) then return false; end if;
 if p_state is null or p_state not in ('ready','manual','failed') or p_text is null or length(p_text)>40000 then raise exception 'Invalid extraction result'; end if;
 update public."documentJobs" set parse_state=case p_state when 'ready' then 'parsed' else p_state end,extracted=case when p_state='failed' then '' else p_text end,parse_lease=null,parse_until=null where id=j.id;
 update public.documents set extracted=p_text where id=j.id;
 return true;
end $$;
revoke all on function public.api_attachment_mode(),public.api_prepare_attachment(uuid,uuid,uuid,text,text,integer,text,text),public.api_attachment_uploaded(uuid),public.api_attachment_status(uuid[]),public.api_retry_attachment(uuid) from public,anon,authenticated;
grant execute on function public.api_attachment_mode(),public.api_prepare_attachment(uuid,uuid,uuid,text,text,integer,text,text),public.api_attachment_uploaded(uuid),public.api_attachment_status(uuid[]),public.api_retry_attachment(uuid) to authenticated;
revoke all on function public.worker_claim_attachment_scan(),public.worker_finish_attachment_scan(uuid,uuid,text,text,text),public.worker_claim_attachment_extract(),public.worker_finish_attachment_extract(uuid,uuid,text,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.worker_claim_attachment_scan(),public.worker_finish_attachment_scan(uuid,uuid,text,text,text),public.worker_claim_attachment_extract(),public.worker_finish_attachment_extract(uuid,uuid,text,text) to service_role;
end if;end $$;
revoke all on function ecod_private.attachment_document_gate() from public,anon,authenticated;
commit;
