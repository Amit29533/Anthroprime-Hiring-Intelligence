-- ECOD blueprint R1 batch 7. Apply AFTER 001-007.
-- Adds: client submission records (Stage 7 Deliver, §3/§16 exit condition "run a real
-- client demand end-to-end") and demand owner / business-unit fields (§4.2). Submissions
-- join the api_changes_since sync payload.
begin;
alter table public.demands add column if not exists owner text not null default '';
alter table public.demands add column if not exists "businessUnit" text not null default '';

create table if not exists public.submissions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, "demandId" uuid,
 "clientContact" text not null default '', method text not null default 'Email',
 notes text not null default '', "submittedOn" date not null default current_date,
 created timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id) on delete cascade,
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id) on delete set null ("demandId")
);
create index if not exists submissions_demand on public.submissions(workspace_id,"demandId");

alter table public.submissions enable row level security;
revoke all on public.submissions from anon;
revoke delete on public.submissions from authenticated;
grant select,insert,update on public.submissions to authenticated;
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop trigger if exists track_change on public.submissions;
create trigger track_change after insert or update on public.submissions for each row execute function public.record_change();

-- Re-publish the sync RPC so submissions travel with the same updated_since feed.
create or replace function public.api_changes_since(day date default current_date - 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace();
begin
 if ws is null then return jsonb_build_object('error','no workspace membership'); end if;
 return jsonb_build_object(
  'since', day,
  'candidates', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.candidates where workspace_id=ws and (created>=day or verified>=day)) t),
  'demands', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.demands where workspace_id=ws and created>=day) t),
  'considerations', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.considerations where workspace_id=ws and (created>=day or updated>=day)) t),
  'assessments', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.assessments where workspace_id=ws and date>=day) t),
  'notes', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.notes where workspace_id=ws and date>=day) t),
  'documents', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,workspace_id,"candidateId",kind,name,mime,size,version,hash,"parserStatus",uploaded from public."documents" where workspace_id=ws and uploaded::date>=day) t),
  'interviews', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId",round,mode,"scheduledAt","durationMins",interviewers,status,recommendation,feedback,notes,completed,created from public.interviews where workspace_id=ws and ("scheduledAt"::date>=day or created::date>=day or (completed is not null and completed::date>=day))) t),
  'offers', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId",role,location,ctc,joining,status,"sentDate","decidedDate",notes,created from public.offers where workspace_id=ws and (created::date>=day or "sentDate"::date>=day or ("decidedDate" is not null and "decidedDate"::date>=day))) t),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,title,due,done,owner,"candidateId","demandId",created from public.tasks where workspace_id=ws and (created::date>=day or due::date>=day)) t),
  'submissions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId","clientContact",method,notes,"submittedOn" from public.submissions where workspace_id=ws and "submittedOn"::date>=day) t),
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;
commit;
