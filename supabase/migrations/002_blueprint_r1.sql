-- ECOD blueprint R1 additions. Apply AFTER 001_ecod.sql, once, in the same SQL Editor session style.
-- Adds: candidate engagement/availability/skill-detail fields, demand nice-to-have skills and
-- engagement/proficiency requirements, structured history tables (§7) and a view/export audit
-- trail (§12). History tables are insert+select only: application roles never update or delete them.
begin;
alter table public.candidates
 add column if not exists engagement text not null default '',
 add column if not exists "earliestStart" date,
 add column if not exists "activeStatus" text not null default 'Active',
 add column if not exists "skillsDetail" jsonb not null default '[]';
alter table public.candidates add constraint candidates_active_status check("activeStatus" in ('Active','Passive'));

alter table public.demands
 add column if not exists "niceToHave" text[] not null default '{}',
 add column if not exists "engagementType" text not null default 'Any',
 add column if not exists "minProficiency" text not null default 'Working',
 add column if not exists "skillMinimums" jsonb not null default '{}';
alter table public.demands add constraint demands_engagement_type check("engagementType" in ('Any','Permanent','Contract','C2H','Subcontract'));
alter table public.demands add constraint demands_min_proficiency check("minProficiency" in ('Exposure','Working','Proficient','Advanced','Expert'));

create table if not exists public."employmentHistory" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, company text not null default '', title text not null default '',
 "employmentType" text not null default '', "startDate" date, "endDate" date, location text not null default '',
 source text not null default '', verified date not null default current_date, created timestamptz not null default now(),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists employment_history_person on public."employmentHistory"(workspace_id,"candidateId");

create table if not exists public."compensationHistory" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, kind text not null check(kind in ('current','expected')),
 amount numeric, currency text not null default 'INR', basis text not null default 'Annual',
 source text not null default '', verified date not null default current_date,
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists compensation_history_person on public."compensationHistory"(workspace_id,"candidateId");

create table if not exists public."availabilityHistory" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, notice integer, "earliestStart" date,
 status text not null default 'Active' check(status in ('Active','Passive')),
 mode text not null default '', captured date not null default current_date,
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create index if not exists availability_history_person on public."availabilityHistory"(workspace_id,"candidateId");

-- §12 audit trail for profile views and data exports. Insert+select for every workspace member,
-- including viewers, so view events can always be recorded; updates and deletes are denied.
create table if not exists public."auditEvents" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "entityType" text not null default '', "entityId" uuid, action text not null,
 detail text not null default '', actor text not null default '', date timestamptz not null default now()
);
create index if not exists audit_events_recent on public."auditEvents"(workspace_id,date desc);

alter table public."employmentHistory" enable row level security;
revoke all on public."employmentHistory" from anon;
revoke update,delete on public."employmentHistory" from authenticated;
grant select,insert on public."employmentHistory" to authenticated;
create policy workspace_read on public."employmentHistory" for select to authenticated using (workspace_id=public.current_workspace());
create policy workspace_insert on public."employmentHistory" for insert to authenticated with check (public.can_edit_workspace(workspace_id));

alter table public."compensationHistory" enable row level security;
revoke all on public."compensationHistory" from anon;
revoke update,delete on public."compensationHistory" from authenticated;
grant select,insert on public."compensationHistory" to authenticated;
create policy workspace_read on public."compensationHistory" for select to authenticated using (workspace_id=public.current_workspace());
create policy workspace_insert on public."compensationHistory" for insert to authenticated with check (public.can_edit_workspace(workspace_id));

alter table public."availabilityHistory" enable row level security;
revoke all on public."availabilityHistory" from anon;
revoke update,delete on public."availabilityHistory" from authenticated;
grant select,insert on public."availabilityHistory" to authenticated;
create policy workspace_read on public."availabilityHistory" for select to authenticated using (workspace_id=public.current_workspace());
create policy workspace_insert on public."availabilityHistory" for insert to authenticated with check (public.can_edit_workspace(workspace_id));

alter table public."auditEvents" enable row level security;
revoke all on public."auditEvents" from anon;
revoke update,delete on public."auditEvents" from authenticated;
grant select,insert on public."auditEvents" to authenticated;
create policy workspace_read on public."auditEvents" for select to authenticated using (workspace_id=public.current_workspace());
create policy workspace_insert on public."auditEvents" for insert to authenticated with check (workspace_id=public.current_workspace());
commit;
