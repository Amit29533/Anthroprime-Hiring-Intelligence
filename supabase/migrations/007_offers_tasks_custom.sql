-- ECOD blueprint R1 batch 6 (Phase 1, Zoho G1 + F6 + J1). Apply AFTER 001-006.
-- Adds: the offers module (offer records with terms, Draft-Sent-Accepted/Rejected/Withdrawn
-- lifecycle), the tasks checklist, and per-record custom fields (jsonb) on candidates and
-- demands administered through workspace settings. Offers and tasks join the
-- api_changes_since sync payload.
begin;
create table if not exists public.offers (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, "demandId" uuid,
 role text not null default '', location text not null default '',
 ctc numeric, joining date,
 status text not null default 'Draft' check(status in ('Draft','Sent','Accepted','Rejected','Withdrawn')),
 "sentDate" date, "decidedDate" date, notes text not null default '',
 created timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id) on delete cascade,
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id) on delete set null
);
create index if not exists offers_person on public.offers(workspace_id,"candidateId");

create table if not exists public.tasks (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 title text not null, due date, done boolean not null default false,
 owner text not null default '', "candidateId" uuid, "demandId" uuid,
 created timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id) on delete cascade,
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id) on delete set null
);
create index if not exists tasks_due on public.tasks(workspace_id,due);

alter table public.candidates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table public.demands add column if not exists custom jsonb not null default '{}'::jsonb;

alter table public.offers enable row level security;
alter table public.tasks enable row level security;
revoke all on public.offers from anon;
revoke all on public.tasks from anon;
revoke delete on public.offers from authenticated;
revoke delete on public.tasks from authenticated;
grant select,insert,update on public.offers to authenticated;
grant select,insert,update on public.tasks to authenticated;
do $$
declare t text;
begin
 foreach t in array array['offers','tasks'] loop
  execute format('drop policy if exists %I on public.%I',t||'_read',t);
  execute format('create policy %I on public.%I for select to authenticated using (workspace_id=public.current_workspace())',t||'_read',t);
  execute format('drop policy if exists %I on public.%I',t||'_insert',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_workspace(workspace_id))',t||'_insert',t);
  execute format('drop policy if exists %I on public.%I',t||'_update',t);
  execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))',t||'_update',t);
  execute format('drop trigger if exists track_change on public.%I',t);
  execute format('create trigger track_change after insert or update on public.%I for each row execute function public.record_change()',t);
 end loop;
end $$;

-- Re-publish the sync RPC so offers and tasks travel with the same updated_since feed.
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
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;
commit;
