-- ECOD blueprint R1 batch 5 (Phase 1, Zoho F3/F4/F9 + A3). Apply AFTER 001-005.
-- Adds: the interviews module (candidate x demand x panel x datetime, status lifecycle and
-- structured feedback), tags on candidates and demands, and interviews in the
-- api_changes_since sync payload.
begin;
alter table public.candidates add column if not exists tags text[] not null default '{}';
alter table public.demands add column if not exists tags text[] not null default '{}';

create table if not exists public.interviews (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, "demandId" uuid,
 round text not null default 'Round 1', mode text not null default 'Video',
 "scheduledAt" timestamptz not null, "durationMins" int not null default 45,
 interviewers text[] not null default '{}',
 status text not null default 'Scheduled' check(status in ('Scheduled','Completed','Cancelled','No-show')),
 recommendation text check(recommendation in ('Strong hire','Hire','Hold','No hire') or recommendation is null),
 feedback jsonb not null default '{}'::jsonb, notes text not null default '',
 completed timestamptz, created timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id) on delete cascade,
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id) on delete set null
);
create index if not exists interviews_when on public.interviews(workspace_id,"scheduledAt");

alter table public.interviews enable row level security;
revoke all on public.interviews from anon;
revoke delete on public.interviews from authenticated;
grant select,insert,update on public.interviews to authenticated;
create policy interviews_read on public.interviews for select to authenticated using (workspace_id=public.current_workspace());
create policy interviews_insert on public.interviews for insert to authenticated with check (public.can_edit_workspace(workspace_id));
create policy interviews_update on public.interviews for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
create trigger track_change after insert or update on public.interviews for each row execute function public.record_change();

-- Re-publish the sync RPC so interviews travel with the same updated_since feed.
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
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;
commit;
