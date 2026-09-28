-- ECOD blueprint R1 batch 2. Apply AFTER 001_ecod.sql and 002_blueprint_r1.sql.
-- Adds: CV/document metadata (originals live in a PRIVATE Supabase Storage bucket named
-- "documents" — create it in Storage → New bucket → Private), workspace skill-taxonomy
-- extensions (§6), the gap-map linkage columns on assessments/enrichment (§3 stage 4).
begin;
alter table public.assessments add column if not exists skill text;

alter table public.enrichment add column if not exists "demandId" uuid;
alter table public.enrichment add column if not exists "gapSkill" text;
do $$ begin
 alter table public.enrichment add constraint enrichment_demand_fk
  foreign key(workspace_id,"demandId") references public.demands(workspace_id,id);
exception when duplicate_object then null; end $$;

create table if not exists public."documents" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid, kind text not null default 'Other', name text not null,
 mime text not null default '', size bigint not null default 0, version integer not null default 1,
 hash text not null default '', "storagePath" text not null default '', "dataUrl" text not null default '',
 "parserStatus" text not null default 'manual', extracted text not null default '',
 removed boolean not null default false, "uploadedBy" text not null default '',
 uploaded timestamptz not null default now(),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists documents_person on public."documents"(workspace_id,"candidateId");

create table if not exists public."taxonomy" (
 id text not null, workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 custom jsonb not null default '{"skills":[],"aliases":{},"domains":{}}',
 updated timestamptz not null default now(),
 unique(workspace_id,id)
);

alter table public."documents" enable row level security;
revoke all on public."documents" from anon;
revoke delete on public."documents" from authenticated;
grant select,insert,update on public."documents" to authenticated;
drop policy if exists workspace_read on public."documents";
create policy workspace_read on public."documents" for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists workspace_insert on public."documents";
create policy workspace_insert on public."documents" for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists workspace_update on public."documents";
create policy workspace_update on public."documents" for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));

alter table public."taxonomy" enable row level security;
revoke all on public."taxonomy" from anon;
revoke delete on public."taxonomy" from authenticated;
grant select,insert,update on public."taxonomy" to authenticated;
drop policy if exists workspace_read on public."taxonomy";
create policy workspace_read on public."taxonomy" for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists workspace_insert on public."taxonomy";
create policy workspace_insert on public."taxonomy" for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists workspace_update on public."taxonomy";
create policy workspace_update on public."taxonomy" for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
commit;
