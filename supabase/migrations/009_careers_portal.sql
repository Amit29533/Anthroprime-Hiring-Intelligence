-- ECOD blueprint R1 batch 8 (Phase 1.5 / R2 groundwork: D1 careers portal + D3 application
-- form with consent, C5 client decision recording, §14 external mapping). Apply AFTER 001-008.
begin;
-- Anyone can see open roles; applications arrive through the security-definer RPC below.
drop policy if exists demands_public_read on public.demands;
create policy demands_public_read on public.demands for select to anon using (status='Open');
grant select on public.demands to anon;

create table if not exists public."publicApplications" (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "demandId" uuid,
 name text not null, email text not null, phone text not null default '', linkedin text not null default '',
 message text not null default '',
 "consentContact" boolean not null default false,
 "consentSharing" boolean not null default false,
 status text not null default 'pending' check(status in ('pending','accepted','dismissed')),
 created timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id) on delete set null ("demandId")
);
create index if not exists public_apps_ws on public."publicApplications"(workspace_id,status);

alter table public."publicApplications" enable row level security;
revoke all on public."publicApplications" from anon;
revoke delete on public."publicApplications" from authenticated;
grant select,insert,update on public."publicApplications" to authenticated;
drop policy if exists public_apps_read on public."publicApplications";
create policy public_apps_read on public."publicApplications" for select to authenticated using (workspace_id=public.current_workspace());
drop policy if exists public_apps_write on public."publicApplications";
create policy public_apps_write on public."publicApplications" for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop policy if exists public_apps_insert on public."publicApplications";
create policy public_apps_insert on public."publicApplications" for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop trigger if exists track_change on public."publicApplications";
create trigger track_change after insert or update on public."publicApplications" for each row execute function public.record_change();

-- Anonymous careers-page application: the page posts the workspace id (public config) and the
-- applicant payload; the RPC validates the bare minimum and stamps the workspace.
-- Dropped first: this function's return type changes later in the chain, and a
-- `create or replace` cannot change one. Without this, re-running the chain fails here.
drop function if exists public.api_public_apply(uuid, jsonb);
create or replace function public.api_public_apply(ws uuid, payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
 app_id uuid;
 ws_exists boolean;
begin
 if payload is null or coalesce(trim(payload->>'name'),'')='' or coalesce(trim(payload->>'email'),'')='' then
  raise exception 'name and email are required';
 end if;
 if payload->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
  raise exception 'enter a valid email address';
 end if;
 select true into ws_exists from public.workspaces w where w.id=ws;
 if ws_exists is null then raise exception 'unknown workspace'; end if;
 insert into public."publicApplications"(workspace_id,"demandId",name,email,phone,linkedin,message,"consentContact","consentSharing")
 values(ws,(payload->>'demandId')::uuid,trim(payload->>'name'),trim(payload->>'email'),
        coalesce(trim(payload->>'phone'),''),coalesce(trim(payload->>'linkedin'),''),
        coalesce(payload->>'message',''),coalesce((payload->>'consentContact')::boolean,false),coalesce((payload->>'consentSharing')::boolean,false))
 returning id into app_id;
 return app_id;
end $$;
revoke all on function public.api_public_apply(uuid,jsonb) from public, authenticated;
grant execute on function public.api_public_apply(uuid,jsonb) to anon, authenticated;

alter table public.submissions
 add column if not exists "clientStatus" text not null default 'Pending' check("clientStatus" in ('Pending','Shortlisted','Rejected','Hired')),
 add column if not exists "clientComment" text not null default '',
 add column if not exists "decidedOn" date;
alter table public.demands add column if not exists "externalId" text not null default '';

-- Re-publish the sync RPC with applications and client decision fields.
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
  'submissions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"candidateId","demandId","clientContact",method,notes,"submittedOn","clientStatus","clientComment","decidedOn" from public.submissions where workspace_id=ws and "submittedOn"::date>=day) t),
  'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"demandId",name,email,phone,linkedin,message,status,"consentContact","consentSharing",created from public."publicApplications" where workspace_id=ws and created::date>=day) t),
  'history', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select id,"entityId","entityType",action,date,actor from public.history where workspace_id=ws and date::date>=day) t)
 );
end $$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;
commit;
