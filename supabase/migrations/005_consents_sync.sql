-- ECOD blueprint R1 batch 4. Apply AFTER 001–004.
-- Adds: consent records (§12 data governance), candidate preference/next-action/external-id
-- fields (§4.1), interaction channel on notes (§4.1), and a genuinely hostable incremental
-- sync endpoint: call supabase.rpc('api_changes_since', { day: '2026-09-01' }) — it returns
-- only the caller's workspace rows (§14 updated_since).
begin;
alter table public.candidates
 add column if not exists "externalId" text not null default '',
 add column if not exists timezone text not null default '',
 add column if not exists "preferredLocations" text not null default '',
 add column if not exists "nextAction" text not null default '';

alter table public.notes add column if not exists channel text not null default 'Note';

create table if not exists public."consents" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null,
 purpose text not null check(purpose in ('recruiting-contact','profile-sharing','assessment','marketing')),
 status text not null default 'granted' check(status in ('granted','revoked','expired')),
 "noticeVersion" text not null default 'v1', source text not null default '', note text not null default '',
 date timestamptz not null default now(),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists consents_person on public."consents"(workspace_id,"candidateId");

alter table public."consents" enable row level security;
revoke all on public."consents" from anon;
revoke delete on public."consents" from authenticated;
grant select,insert,update on public."consents" to authenticated;
drop policy if exists consents_read on public."consents";
create policy consents_read on public."consents" for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists consents_write on public."consents";
create policy consents_write on public."consents" for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists consents_update on public."consents";
create policy consents_update on public."consents" for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));

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
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;
commit;
