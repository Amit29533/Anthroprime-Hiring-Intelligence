-- Phase D1: optional audited signing, distributed per-user quotas and legacy Storage gate.
begin;
create or replace function ecod_private.document_audit_enabled(ws uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'auditedDocumentAccess'='true'::jsonb)
$$;
revoke all on function ecod_private.document_audit_enabled(uuid) from public,anon,authenticated;
create table if not exists ecod_private.document_access_limits (
 workspace_id uuid not null,actor uuid not null,started_at timestamptz not null,attempts integer not null,denied integer not null default 0,
 primary key(workspace_id,actor)
);
create table if not exists ecod_private.document_access_events (
 id uuid primary key,workspace_id uuid not null,actor uuid not null,document_id uuid not null,
 provider text not null,storage_path text not null,hash text not null,size bigint not null,candidate_id uuid,client_id uuid,scan_required boolean not null,scan_etag text,
 requested_at timestamptz not null,expires_at timestamptz not null,finished_at timestamptz,
 outcome text not null check(outcome in ('requested','issued','failed','throttled')),reason text not null default 'none'
);
alter table ecod_private.document_access_limits enable row level security;
alter table ecod_private.document_access_events enable row level security;
revoke all on ecod_private.document_access_limits,ecod_private.document_access_events from public,anon,authenticated;
create index if not exists document_access_workspace_time on ecod_private.document_access_events(workspace_id,requested_at desc,id desc);

create or replace function public.api_document_access_mode() returns boolean language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 if ws is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 return ecod_private.document_audit_enabled(ws);
end $$;
create or replace function public.api_begin_document_access(p_document uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();d public.documents;lim ecod_private.document_access_limits;request_id uuid:=gen_random_uuid();at timestamptz;etag text;
begin
 if ws is null then raise exception 'Workspace access required' using errcode='42501'; end if;
 select * into d from public.documents where id=p_document and workspace_id=ws and not removed and ("clientId" is null or public.is_admin());
 if not found then raise exception 'Document not found' using errcode='42501'; end if;
 if not ecod_private.document_audit_enabled(ws) then return jsonb_build_object('enforced',false); end if;
 -- One row lock per actor/workspace serializes concurrent Netlify invocations.
 at:=clock_timestamp();
 insert into ecod_private.document_access_limits values(ws,auth.uid(),at,0,0) on conflict(workspace_id,actor) do nothing;
 select * into lim from ecod_private.document_access_limits where workspace_id=ws and actor=auth.uid() for update;
 at:=clock_timestamp();
 if lim.started_at<=at-interval '60 seconds' then lim.started_at:=at;lim.attempts:=0;lim.denied:=0;end if;
 if lim.attempts>=60 then
  -- One denial event per window; repeated abuse is aggregated without unbounded receipts.
  if lim.denied=0 then
   insert into ecod_private.document_access_events values(request_id,ws,auth.uid(),d.id,d."storageProvider",d."storagePath",d.hash,d.size,d."candidateId",d."clientId",d."scanRequired",null,at,at,at,'throttled','rate_limit');
  end if;
  update ecod_private.document_access_limits set denied=least(lim.denied+1,1000000) where workspace_id=ws and actor=auth.uid();
  return jsonb_build_object('enforced',true,'allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from lim.started_at+interval '60 seconds'-at))::integer));
 end if;
 update ecod_private.document_access_limits set started_at=lim.started_at,attempts=lim.attempts+1,denied=lim.denied where workspace_id=ws and actor=auth.uid();
 select v.etag into etag from ecod_private.cv_scan_verdicts v where v.id=d.id and v.workspace_id=ws and v.hash=d.hash and v.storage_path=d."storagePath" and v.size=d.size;
 insert into ecod_private.document_access_events values(request_id,ws,auth.uid(),d.id,d."storageProvider",d."storagePath",d.hash,d.size,d."candidateId",d."clientId",d."scanRequired",etag,at,at+interval '60 seconds',null,'requested','none');
 return jsonb_build_object('enforced',true,'allowed',true,'requestId',request_id,'document',jsonb_build_object('id',d.id,'storageProvider',d."storageProvider",'storagePath',d."storagePath",'scanRequired',d."scanRequired",'hash',d.hash,'size',d.size));
end $$;

create or replace function public.worker_finish_document_access(p_request uuid,p_outcome text,p_reason text default 'none') returns boolean language plpgsql security definer set search_path='' as $$
declare r ecod_private.document_access_events;valid boolean;
begin
 if p_outcome is null or p_outcome not in ('issued','failed') or p_reason is null or p_reason not in ('none','quarantined','changed_original','storage_unavailable','invalid_provider','invalid_path','stale_access') or (p_outcome='issued' and p_reason<>'none') then raise exception 'Invalid signing receipt'; end if;
 select * into r from ecod_private.document_access_events where id=p_request for update;
 if not found then return false;end if;
 if r.outcome<>'requested' then return r.outcome=p_outcome and r.reason=p_reason;end if;
 valid:=r.expires_at>clock_timestamp() and exists(
  select 1 from public.documents d join public.memberships m on m.workspace_id=d.workspace_id and m.user_id=r.actor
  where d.id=r.document_id and d.workspace_id=r.workspace_id and not d.removed
  and (d."clientId" is null or m.role='admin') and m.role in ('admin','recruiter','viewer')
  and d."storageProvider"=r.provider and d."storagePath"=r.storage_path and d.hash=r.hash and d.size=r.size
  and d."candidateId" is not distinct from r.candidate_id and d."clientId" is not distinct from r.client_id and d."scanRequired"=r.scan_required
  and (not d."scanRequired" or exists(select 1 from ecod_private.cv_scan_verdicts v where v.id=d.id and v.workspace_id=d.workspace_id and v.hash=d.hash and v.storage_path=d."storagePath" and v.size=d.size and v.etag=r.scan_etag
   and not exists(select 1 from public."documentJobs" j where j.id=d.id and j.scan_status<>'clean')))
 );
 update ecod_private.document_access_events set outcome=case when p_outcome='issued' and not valid then 'failed' else p_outcome end,
 reason=case when p_outcome='issued' and not valid then 'stale_access' else p_reason end,finished_at=clock_timestamp() where id=r.id;
 return p_outcome='failed' or valid;
end $$;

-- Restrictive alongside existing bucket policies; no permissive read access is added.
create or replace function public.allow_direct_document_storage(p_name text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or ecod_private.document_audit_enabled(public.current_workspace()) then return false;end if;
 return not exists(select 1 from public.settings s where s.id='workspace' and s.custom->'auditedDocumentAccess'='true'::jsonb and
  (s.workspace_id::text=split_part(p_name,'/',1) or exists(select 1 from public.documents d where d.workspace_id=s.workspace_id and d."storageProvider"='supabase' and d."storagePath"=p_name)));
end $$;
revoke all on function public.allow_direct_document_storage(text) from public,anon,authenticated;
grant execute on function public.allow_direct_document_storage(text) to anon,authenticated;
do $$begin if to_regclass('storage.objects') is not null then
 drop policy if exists audited_document_direct_read on storage.objects;
 create policy audited_document_direct_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'documents' or public.allow_direct_document_storage(name));
end if;end $$;

create or replace function public.api_document_access_page(p_offset integer default 0,p_hours integer default 24) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();since timestamptz;rows jsonb;counts jsonb;total integer;
begin
 if ws is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 1000000 or p_hours is null or p_hours not between 1 and 168 then raise exception 'Invalid audit page';end if;
 since:=now()-make_interval(hours=>p_hours);
 select count(*) into total from ecod_private.document_access_events where workspace_id=ws and requested_at>=since;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (
  select id,actor,document_id as "documentId",provider,requested_at as "requestedAt",finished_at as "finishedAt",case when outcome='requested' and expires_at<now() then 'abandoned' else outcome end as outcome,reason
  from ecod_private.document_access_events where workspace_id=ws and requested_at>=since order by requested_at desc,id desc limit 50 offset p_offset
 )q;
 select coalesce(jsonb_object_agg(outcome,n),'{}') into counts from (
  select case when outcome='requested' and expires_at<now() then 'abandoned' else outcome end as outcome,count(*) n from ecod_private.document_access_events where workspace_id=ws and requested_at>=since group by 1
 )q;
 return jsonb_build_object('rows',rows,'total',total,'counts',counts,'enabled',ecod_private.document_audit_enabled(ws));
end $$;
revoke all on function public.api_document_access_mode(),public.api_begin_document_access(uuid),public.api_document_access_page(integer,integer) from public,anon,authenticated;
grant execute on function public.api_document_access_mode(),public.api_begin_document_access(uuid),public.api_document_access_page(integer,integer) to authenticated;
revoke all on function public.worker_finish_document_access(uuid,text,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_finish_document_access(uuid,text,text) to service_role;end if;end $$;
commit;
