-- Phase C5: explicitly adopted R2 originals and reversible retention review. No deletion worker.
begin;
alter table public."documentJobs" add column if not exists legacy boolean not null default false;
create unique index if not exists documents_workspace_identity on public.documents(workspace_id,id);
create or replace function ecod_private.legacy_document_eligible(d public.documents) returns boolean language sql immutable set search_path='' as $$
 select coalesce(not d.removed and not d."scanRequired" and d.stored and d."storageProvider"='r2'
 and d.size between 1 and 5242880 and d.hash ~ '^[0-9a-f]{64}$'
 and ((d."candidateId" is null)<>(d."clientId" is null))
 and coalesce(length(d.name),0) between 1 and 160 and coalesce(length(d.kind),0) between 1 and 80
 and length(d."storagePath") between 1 and 1024
 and strpos(d."storagePath",d.workspace_id::text||case when d."clientId" is null then '/candidates/'||d."candidateId"::text else '/clients/'||d."clientId"::text end||'/')=1
 and d."storagePath" !~ '(^|/)[.]{1,2}(/|$)' and strpos(d."storagePath",E'\\')=0
 and lower(split_part(d.name,'.',-1)) in ('pdf','docx','txt','md','csv'),false)
$$;
revoke all on function ecod_private.legacy_document_eligible(public.documents) from public,anon,authenticated;

create or replace function public.api_adopt_legacy_document(p_document uuid) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); d public.documents; ext text; mt text;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if not ecod_private.attachments_enabled(ws) then raise exception 'Enable private document processing after scanner acceptance'; end if;
 select * into d from public.documents where id=p_document and workspace_id=ws for update;
 if not found then raise exception 'Document not found'; end if;
 if exists(select 1 from public."documentJobs" where id=d.id and legacy) then return; end if;
 if ecod_private.legacy_document_eligible(d) is not true or exists(select 1 from public."documentJobs" where storage_path=d."storagePath") or exists(select 1 from public."importFiles" where id=d.id) then raise exception 'Original cannot be adopted. Re-upload it through private document processing'; end if;
 ext:=lower(split_part(d.name,'.',-1));
 mt:=case ext when 'pdf' then 'application/pdf' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' else 'text/plain' end;
 insert into public."documentJobs"(id,workspace_id,candidate_id,client_id,name,ext,mime,kind,size,hash,storage_path,uploaded,legacy)
 values(d.id,ws,d."candidateId",d."clientId",d.name,ext,mt,d.kind,d.size::integer,d.hash,d."storagePath",true,true);
 -- The existing gate derives quarantine fields and clears current text/inline bytes.
 update public.documents set "scanRequired"=true,"parserStatus"='quarantined',extracted='',"dataUrl"='' where id=d.id;
end $$;

create table if not exists ecod_private.document_retention_reviews (
 id uuid primary key, workspace_id uuid not null,document_id uuid not null,
 decision text not null check(decision in ('keep','hold','archive')),note text not null check(length(btrim(note)) between 1 and 1000),
 reviewed_by uuid not null,reviewed_at timestamptz not null default now(),review_after timestamptz not null,
 hash text not null,storage_path text not null,
 foreign key(workspace_id,document_id) references public.documents(workspace_id,id)
);
alter table ecod_private.document_retention_reviews enable row level security;
revoke all on ecod_private.document_retention_reviews from public,anon,authenticated;
create index if not exists retention_document_latest on ecod_private.document_retention_reviews(workspace_id,document_id,reviewed_at desc,id desc);

create or replace function ecod_private.document_hold_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare decision text;
begin
 if tg_op='UPDATE' then
  if new.removed is not true or old.removed is true then return new; end if;
 end if;
 select r.decision into decision from ecod_private.document_retention_reviews r where r.document_id=old.id and r.workspace_id=old.workspace_id order by reviewed_at desc,id desc limit 1;
 if decision='hold' then raise exception 'Document is on retention hold. An administrator must release it with a keep decision'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function ecod_private.document_hold_guard() from public,anon,authenticated;
drop trigger if exists document_hold_guard on public.documents;
create trigger document_hold_guard before update or delete on public.documents for each row execute function ecod_private.document_hold_guard();

create or replace function public.api_review_document_retention(p_request uuid,p_document uuid,p_decision text,p_note text,p_days integer) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); d public.documents; prior ecod_private.document_retention_reviews; latest text; recorded timestamptz;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_request is null or p_decision is null or p_decision not in ('keep','hold','archive') or coalesce(length(btrim(p_note)),0) not between 1 and 1000 or p_days is null or p_days not between 1 and 3650 then raise exception 'Provide a decision, note and review interval of 1 to 3650 days'; end if;
 select * into d from public.documents where id=p_document and workspace_id=ws for update;
 if not found then raise exception 'Document not found'; end if;
 select * into prior from ecod_private.document_retention_reviews where id=p_request;
 if found then
  if prior.workspace_id<>ws or prior.document_id<>d.id or prior.decision<>p_decision or prior.note<>btrim(p_note) or prior.review_after<>prior.reviewed_at+make_interval(days=>p_days) then raise exception 'Retention request conflict'; end if;
  return;
 end if;
 select r.decision into latest from ecod_private.document_retention_reviews r where r.document_id=d.id and r.workspace_id=ws order by reviewed_at desc,id desc limit 1;
 if latest='hold' and p_decision='archive' then raise exception 'Release hold with a keep decision before archiving'; end if;
 recorded:=clock_timestamp();
 insert into ecod_private.document_retention_reviews values(p_request,ws,d.id,p_decision,btrim(p_note),auth.uid(),recorded,recorded+make_interval(days=>p_days),d.hash,d."storagePath");
 if p_decision='archive' then update public.documents set removed=true where id=d.id; end if;
end $$;

create or replace function public.api_document_review_queue(p_offset integer default 0,p_deferred boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb; total integer;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 1000000 or p_deferred is null then raise exception 'Invalid offset or review filter'; end if;
 select count(*) into total from public.documents d where d.workspace_id=ws and (p_deferred or not exists(select 1 from ecod_private.document_retention_reviews r where r.document_id=d.id and r.workspace_id=ws and r.review_after>now() and r.id=(select x.id from ecod_private.document_retention_reviews x where x.document_id=d.id and x.workspace_id=ws order by reviewed_at desc,id desc limit 1)));
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
  select d.id,d.name,d."storageProvider" as provider,d.removed,d."scanRequired" as required,
   coalesce(j.scan_status,case when d."scanRequired" then 'scan-required' else 'unverified' end) as scan,
   ecod_private.attachments_enabled(ws) and ecod_private.legacy_document_eligible(d) as eligible,
   r.decision,r.review_after as "reviewAfter",r.note,
   case when d."clientId" is null then 'candidate' else 'client' end as owner
  from public.documents d left join public."documentJobs" j on j.id=d.id
  left join lateral(select x.* from ecod_private.document_retention_reviews x where x.document_id=d.id and x.workspace_id=ws order by reviewed_at desc,id desc limit 1) r on true
  where d.workspace_id=ws and (p_deferred or r.id is null or r.review_after<=now()) order by d.uploaded,d.id limit 50 offset p_offset
 ) q;
 return jsonb_build_object('rows',result,'total',total,'privateDocuments',ecod_private.attachments_enabled(ws));
end $$;
revoke all on function public.api_adopt_legacy_document(uuid),public.api_review_document_retention(uuid,uuid,text,text,integer),public.api_document_review_queue(integer,boolean) from public,anon,authenticated;
grant execute on function public.api_adopt_legacy_document(uuid),public.api_review_document_retention(uuid,uuid,text,text,integer),public.api_document_review_queue(integer,boolean) to authenticated;
commit;
