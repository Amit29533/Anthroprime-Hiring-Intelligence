-- Phase C3: private OCR-only queue claims, longer bounded leases, immutable parsing provenance.
begin;
create or replace function ecod_private.ocr_enabled(ws uuid) returns boolean language sql stable security definer set search_path='' as $$
 select ecod_private.cv_staging_enabled(ws) and exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'ocrDocuments'='true'::jsonb)
$$;
revoke all on function ecod_private.ocr_enabled(uuid) from public,anon,authenticated;
create table if not exists ecod_private.parse_receipts (
 id uuid primary key,workspace_id uuid not null,hash text not null,text_hash text not null,
 method text not null check(method in ('text','ocr')),engine text not null,recorded_at timestamptz not null default now()
);
alter table ecod_private.parse_receipts enable row level security;
revoke all on ecod_private.parse_receipts from public,anon,authenticated;
alter table public.documents add column if not exists "parserMethod" text not null default 'none';
alter table public.documents add column if not exists "parserEngine" text not null default '';
create or replace function ecod_private.parser_provenance() returns trigger language plpgsql security definer set search_path='' as $$
declare receipt ecod_private.parse_receipts;
begin
 select * into receipt from ecod_private.parse_receipts where id=new.id and workspace_id=new.workspace_id and hash=new.hash and text_hash=encode(sha256(convert_to(new.extracted,'UTF8')),'hex');
 new."parserMethod":=case when found then receipt.method else 'none' end;
 new."parserEngine":=case when receipt.id is not null then receipt.engine else '' end;
 return new;
end $$;
drop trigger if exists ab_parser_provenance on public.documents;
create trigger ab_parser_provenance before insert or update on public.documents for each row execute function ecod_private.parser_provenance();

create or replace function public.worker_finish_ocr_cv(p_file uuid,p_lease uuid,p_state text,p_text text,p_draft jsonb,p_method text,p_engine text)
returns boolean language plpgsql security definer set search_path='' as $$
declare f public."importFiles";
begin
 if p_method is null or p_method not in ('text','ocr') or coalesce(length(p_engine),0) not between 1 and 200 then raise exception 'Invalid parser provenance'; end if;
 if not public.worker_finish_cv(p_file,p_lease,p_state,p_text,p_draft) then return false; end if;
 select * into f from public."importFiles" where id=p_file;
 if p_state<>'failed' then
  insert into ecod_private.parse_receipts(id,workspace_id,hash,text_hash,method,engine) values(f.id,f.workspace_id,f.hash,encode(sha256(convert_to(p_text,'UTF8')),'hex'),p_method,p_engine)
  on conflict(id) do update set text_hash=excluded.text_hash,method=excluded.method,engine=excluded.engine,recorded_at=now();
 end if;
 return true;
end $$;
create or replace function public.worker_finish_ocr_attachment(p_file uuid,p_lease uuid,p_state text,p_text text,p_method text,p_engine text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 if p_method is null or p_method not in ('text','ocr') or coalesce(length(p_engine),0) not between 1 and 200 then raise exception 'Invalid parser provenance'; end if;
 if not public.worker_finish_attachment_extract(p_file,p_lease,p_state,p_text) then return false; end if;
 select * into j from public."documentJobs" where id=p_file;
 if p_state<>'failed' then
  insert into ecod_private.parse_receipts(id,workspace_id,hash,text_hash,method,engine) values(j.id,j.workspace_id,j.hash,encode(sha256(convert_to(p_text,'UTF8')),'hex'),p_method,p_engine)
  on conflict(id) do update set text_hash=excluded.text_hash,method=excluded.method,engine=excluded.engine,recorded_at=now();
  update public.documents set "parserMethod"=p_method where id=j.id;
 end if;
 return true;
end $$;
create or replace function public.worker_claim_cv()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 -- Lock parent first, like all review and approval operations. SKIP LOCKED permits parallel workers.
 select ib.* into b from public."importBatches" ib where ib.status='draft' and ecod_private.cv_staging_enabled(ib.workspace_id) and not ecod_private.ocr_enabled(ib.workspace_id) and exists(
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

create or replace function public.worker_claim_ocr_cv()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches";
begin
 -- Lock parent first, like all review and approval operations. SKIP LOCKED permits parallel workers.
 select ib.* into b from public."importBatches" ib where ib.status='draft' and ecod_private.cv_staging_enabled(ib.workspace_id) and ecod_private.ocr_enabled(ib.workspace_id) and exists(
  select 1 from public."importFiles" x where x.batch_id=ib.id and x.scan_status='clean' and (x.state='queued' or (x.state='extracting' and x.lease_until<now())))
  order by ib.created_at,ib.id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into f from public."importFiles" where batch_id=b.id and scan_status='clean' and (state='queued' or (state='extracting' and lease_until<now())) order by row_no limit 1 for update;
 if f.attempts>=3 then
  update public."importFiles" set state='failed',warning='Extraction interrupted repeatedly. Retry processing.' where id=f.id; return null;
 end if;
 update public."importFiles" set state='extracting',lease=gen_random_uuid(),lease_until=now()+interval '180 seconds',attempts=attempts+1 where id=f.id returning * into f;
 return to_jsonb(f);
end $$;

create or replace function public.worker_claim_attachment_extract() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select x.* into j from public."documentJobs" x join public.documents d on d.id=x.id where not d.removed and ecod_private.attachments_enabled(x.workspace_id) and not ecod_private.ocr_enabled(x.workspace_id) and x.scan_status='clean' and x.parse_attempts<3 and (x.parse_state='queued' or (x.parse_state='extracting' and x.parse_until<now())) order by x.id limit 1 for update of x skip locked;
 if not found then return null; end if;
 update public."documentJobs" set parse_state='extracting',parse_lease=gen_random_uuid(),parse_until=now()+interval '90 seconds',parse_attempts=parse_attempts+1 where id=j.id returning * into j;
 update public.documents set "parserStatus"='extracting' where id=j.id;
 return to_jsonb(j)||jsonb_build_object('lease',j.parse_lease);
end $$;
create or replace function public.worker_claim_ocr_attachment() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public."documentJobs";
begin
 select x.* into j from public."documentJobs" x join public.documents d on d.id=x.id where not d.removed and ecod_private.attachments_enabled(x.workspace_id) and ecod_private.ocr_enabled(x.workspace_id) and x.scan_status='clean' and x.parse_attempts<3 and (x.parse_state='queued' or (x.parse_state='extracting' and x.parse_until<now())) order by x.id limit 1 for update of x skip locked;
 if not found then return null; end if;
 update public."documentJobs" set parse_state='extracting',parse_lease=gen_random_uuid(),parse_until=now()+interval '180 seconds',parse_attempts=parse_attempts+1 where id=j.id returning * into j;
 update public.documents set "parserStatus"='extracting' where id=j.id;
 return to_jsonb(j)||jsonb_build_object('lease',j.parse_lease);
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
  warning=case p_state when 'failed' then 'Original could not be verified or read. Retry upload/processing.' when 'manual' then 'No usable text extracted. Enter candidate details manually.' else '' end where id=f.id;
 -- A later extraction result must not overwrite a recruiter's edits. Waiting rows only.
 update public."importRows" set payload=draft,status='excluded',error=case when p_state='failed' then 'Original file verification failed.' else 'Review CV name and contact, then save this row to include it.' end
  where batch_id=b.id and row_no=f.row_no and payload='{}';
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id;
 return true;
end $$;

create or replace function public.api_cv_files(p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg((to_jsonb(f)||jsonb_build_object('parserMethod',r.method,'parserEngine',r.engine))-'lease'-'lease_until'-'storage_path'-'extracted'-'scan_lease'-'scan_until'-'scan_etag'),'[]') into result from public."importFiles" f left join ecod_private.parse_receipts r on r.id=f.id and r.hash=f.hash where f.workspace_id=ws and f.batch_id=p_batch;
 return result;
end $$;



revoke all on function public.worker_claim_ocr_cv(),public.worker_claim_ocr_attachment(),public.worker_finish_ocr_cv(uuid,uuid,text,text,jsonb,text,text),public.worker_finish_ocr_attachment(uuid,uuid,text,text,text,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.worker_claim_ocr_cv(),public.worker_claim_ocr_attachment(),public.worker_finish_ocr_cv(uuid,uuid,text,text,jsonb,text,text),public.worker_finish_ocr_attachment(uuid,uuid,text,text,text,text) to service_role;
end if;end $$;
revoke all on function ecod_private.parser_provenance() from public,anon,authenticated;
commit;
