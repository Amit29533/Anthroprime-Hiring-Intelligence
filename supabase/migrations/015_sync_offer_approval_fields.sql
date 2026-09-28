-- Offer approvals must travel through both incremental-change RPCs. An approvedAt update
-- does not change offers.created, sentDate or decidedDate, so the old feed omitted an older
-- draft exactly when its most consequential state changed. Read the status/history dates and
-- include the server-owned approval snapshot in both the simple and paginated response.
-- This is a forward migration; it replaces the RPC definitions introduced in 010.
begin;

-- Stable ordering: identical days produce byte-identical feeds.
create or replace function public.api_changes_since(day date default current_date - 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace();
begin
 if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
 return jsonb_build_object(
  'since', day,
  'candidates', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.candidates where workspace_id=ws and (created>=day or verified>=day) order by id) t),
  'demands', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.demands where workspace_id=ws and created>=day order by id) t),
  'considerations', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.considerations where workspace_id=ws and (created>=day or updated>=day) order by id) t),
  'assessments', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.assessments where workspace_id=ws and date>=day order by id) t),
  'notes', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.notes where workspace_id=ws and date>=day order by id) t),
  'documents', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,workspace_id,"candidateId",kind,name,mime,size,version,hash,"parserStatus",uploaded from public."documents" where workspace_id=ws and uploaded::date>=day order by id) t),
  'interviews', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId",round,mode,"scheduledAt","durationMins",interviewers,status,recommendation,feedback,notes,completed,created from public.interviews where workspace_id=ws and ("scheduledAt"::date>=day or created::date>=day or (completed is not null and completed::date>=day)) order by id) t),
  'offers', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
   select o.id,o."candidateId",o."demandId",o.role,o.location,o.ctc,o.joining,o.status,o."sentDate",o."decidedDate",o.notes,o.created,o."approvedAt",o."approvedBy",o."approvedTerms"
     from public.offers o
    where o.workspace_id=ws and (
      o.created::date>=day or o."sentDate"::date>=day
      or (o."decidedDate" is not null and o."decidedDate"::date>=day)
      or (o."approvedAt" is not null and o."approvedAt"::date>=day)
      or exists(select 1 from public.history h where h.workspace_id=o.workspace_id and h."entityId"=o.id and h."entityType"='offers' and h.date::date>=day)
    ) order by o.id
  ) t),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,title,due,done,owner,"candidateId","demandId",created from public.tasks where workspace_id=ws and (created::date>=day or due::date>=day) order by id) t),
  'submissions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId","clientContact",method,notes,"submittedOn","clientStatus","clientComment","decidedOn" from public.submissions where workspace_id=ws and "submittedOn"::date>=day order by id) t),
  'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"demandId",name,email,phone,linkedin,message,status,"consentContact","consentSharing",created from public."publicApplications" where workspace_id=ws and created::date>=day order by id) t),
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day order by id) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;

-- Paginated feed: block 0,1,2… of `size` rows per table. `next` is true when at least
-- one table filled its page (keep paging until it is false).
create or replace function public.api_changes_page(day date default current_date - 30, page_block int default 0, page_size int default 200)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); off int := greatest(page_block,0)*greatest(page_size,1); lim int := greatest(page_size,1);
begin
 if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
 return jsonb_build_object(
  'since',day,'block',page_block,'size',page_size,
  'next',exists(
   (select 1 from public.candidates c where c.workspace_id=ws and (c.created>=day or c.verified>=day) order by id limit 1 offset off+lim)
   union all
   (select 1 from public.history h where h.workspace_id=ws and h.date>=day order by id limit 1 offset off+lim)
  ),
'candidates', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.candidates where workspace_id=ws and (created>=day or verified>=day) order by id limit lim offset off) t),
  'demands', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.demands where workspace_id=ws and created>=day order by id limit lim offset off) t),
  'considerations', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.considerations where workspace_id=ws and (created>=day or updated>=day) order by id limit lim offset off) t),
  'assessments', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.assessments where workspace_id=ws and date>=day order by id limit lim offset off) t),
  'notes', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.notes where workspace_id=ws and date>=day order by id limit lim offset off) t),
  'documents', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,workspace_id,"candidateId",kind,name,mime,size,version,hash,"parserStatus",uploaded from public."documents" where workspace_id=ws and uploaded::date>=day order by id limit lim offset off) t),
  'interviews', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId",round,mode,"scheduledAt","durationMins",interviewers,status,recommendation,feedback,notes,completed,created from public.interviews where workspace_id=ws and ("scheduledAt"::date>=day or created::date>=day or (completed is not null and completed::date>=day)) order by id limit lim offset off) t),
  'offers', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
   select o.id,o."candidateId",o."demandId",o.role,o.location,o.ctc,o.joining,o.status,o."sentDate",o."decidedDate",o.notes,o.created,o."approvedAt",o."approvedBy",o."approvedTerms"
     from public.offers o
    where o.workspace_id=ws and (
      o.created::date>=day or o."sentDate"::date>=day
      or (o."decidedDate" is not null and o."decidedDate"::date>=day)
      or (o."approvedAt" is not null and o."approvedAt"::date>=day)
      or exists(select 1 from public.history h where h.workspace_id=o.workspace_id and h."entityId"=o.id and h."entityType"='offers' and h.date::date>=day)
    ) order by o.id limit lim offset off
  ) t),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,title,due,done,owner,"candidateId","demandId",created from public.tasks where workspace_id=ws and (created::date>=day or due::date>=day) order by id limit lim offset off) t),
  'submissions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId","clientContact",method,notes,"submittedOn","clientStatus","clientComment","decidedOn" from public.submissions where workspace_id=ws and "submittedOn"::date>=day order by id limit lim offset off) t),
  'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"demandId",name,email,phone,linkedin,message,status,"consentContact","consentSharing",created from public."publicApplications" where workspace_id=ws and created::date>=day order by id limit lim offset off) t),
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day order by id limit lim offset off) t)
 );
end $$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;
commit;
