-- ECOD initial schema. Apply once to a NEW Supabase project using SQL Editor.
-- No anonymous access. Workspace membership is provisioned by an administrator.
begin;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default now()
);
create table public.memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id),
 role text not null check(role in ('admin','recruiter','viewer')) default 'recruiter'
);
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
create or replace function public.current_workspace() returns uuid
language sql stable security definer set search_path = '' as $$
 select workspace_id from public.memberships where user_id = auth.uid()
$$;
create or replace function public.can_edit_workspace(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.memberships where user_id=auth.uid()
 and workspace_id=target and role in ('admin','recruiter'))
$$;
revoke all on function public.current_workspace() from public, anon;
revoke all on function public.can_edit_workspace(uuid) from public, anon;
grant execute on function public.current_workspace(), public.can_edit_workspace(uuid) to authenticated;
create policy workspace_read on public.workspaces for select to authenticated using(id=public.current_workspace());
create policy membership_self_read on public.memberships for select to authenticated using(user_id=auth.uid());
grant select on public.workspaces,public.memberships to authenticated;
revoke all on public.workspaces,public.memberships from anon;
revoke insert,update,delete on public.workspaces,public.memberships from authenticated;

create table public.candidates (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 name text not null check(length(trim(name))>0), email text not null default '', phone text not null default '',
 title text not null default '', company text not null default '', location text not null default '',
 experience numeric check(experience>=0), "relevantExperience" numeric check("relevantExperience">=0),
 notice integer check(notice>=0), current numeric check(current>=0), expected numeric check(expected>=0),
 skills text[] not null default '{}',
 status text not null check(status in ('Assessing','Near-ready','Ready','Unavailable')) default 'Assessing',
 mode text not null check(mode in ('Flexible','Remote','Hybrid','Onsite')) default 'Flexible',
 source text not null default 'Manual entry', summary text not null default '', linkedin text not null default '',
 owner text not null default '', verified date not null default current_date, created date not null default current_date,
 check(email<>'' or phone<>''),
 check("relevantExperience" is null or experience is null or "relevantExperience"<=experience),
 unique(workspace_id,id)
);
create unique index candidates_email_unique on public.candidates(workspace_id,lower(trim(email))) where trim(email)<>'';
create unique index candidates_phone_unique on public.candidates(workspace_id,ltrim(regexp_replace(phone,'[^0-9]','','g'),'0')) where regexp_replace(phone,'[^0-9]','','g')<>'';
create index candidates_skills on public.candidates using gin(skills);
create index candidates_workspace on public.candidates(workspace_id);

create function public.valid_weights(w jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(w)='object'
 and (select count(*)=6 and sum(value::numeric)=100 and min(value::numeric)>=0 and max(value::numeric)<=100 from jsonb_each_text(w))
 and w ?& array['skills','experience','readiness','availability','budget','location']
$$;
create table public.demands (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 title text not null check(length(trim(title))>0), client text not null check(length(trim(client))>0),
 skills text[] not null check(cardinality(skills)>0),
 "minExperience" numeric not null check("minExperience">=0), "maxNotice" integer not null check("maxNotice">=0),
 budget numeric not null check(budget>0), location text not null,
 mode text not null check(mode in ('Remote','Hybrid','Onsite')),
 positions integer not null check(positions>0), priority text not null check(priority in ('High','Medium','Low')),
 status text not null check(status in ('Open','On hold','Closed')) default 'Open',
 target date not null, description text not null default '', created date not null default current_date,
 weights jsonb not null check(public.valid_weights(weights)), unique(workspace_id,id)
);
create table public.considerations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, "demandId" uuid not null,
 stage text not null check(stage in ('Identified','Contacted','Assessed','Enrichment','Submitted','Interview','Offer','Deployed','Rejected','Withdrawn')),
 created date not null default current_date, updated date not null default current_date, reason text not null default '',
 unique(workspace_id,"candidateId","demandId"),
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id),
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id),
 check(stage not in ('Rejected','Withdrawn') or length(trim(reason))>0)
);
create table public.assessments (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, "demandId" uuid,
 title text not null, score numeric not null check(score>=0 and score<=100),
 assessor text not null check(length(trim(assessor))>0), date date not null,
 evidence text not null check(length(trim(evidence))>0), gap text not null default '',
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id),
 foreign key(workspace_id,"demandId") references public.demands(workspace_id,id)
);
create table public.notes (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, text text not null check(length(trim(text))>0),
 date date not null default current_date, "followUp" date, completed boolean not null default false,
 author text not null default '',
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create table public.enrichment (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
 "candidateId" uuid not null, title text not null, description text not null,
 due date not null, owner text not null,
 status text not null check(status in ('Planned','In progress','Complete','Validated')),
 created date not null default current_date,
 foreign key(workspace_id,"candidateId") references public.candidates(workspace_id,id)
);
create table public.history (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 "entityId" uuid not null, "entityType" text not null, action text not null,
 date timestamptz not null default now(), actor text not null, snapshot jsonb
);
create index history_entity on public.history(workspace_id,"entityId",date desc);
create function public.record_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.history(workspace_id,"entityId","entityType",action,actor,snapshot)
 values(new.workspace_id,new.id,TG_TABLE_NAME,
 case when TG_TABLE_NAME='candidates' then 'Profile' else TG_TABLE_NAME end || case when TG_OP='INSERT' then ' created' else ' updated' end,
 coalesce(auth.uid()::text,'System administrator'),case when TG_OP='UPDATE' then to_jsonb(old) else null end);
 return new;
end $$;
revoke all on function public.record_change() from public,anon,authenticated;
do $$
declare table_name text;
begin
 foreach table_name in array array['candidates','demands','considerations','assessments','notes','enrichment'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from anon',table_name);
  execute format('revoke delete on public.%I from authenticated',table_name);
  execute format('grant select,insert,update on public.%I to authenticated',table_name);
  execute format('create policy workspace_read on public.%I for select to authenticated using (workspace_id=public.current_workspace())',table_name);
  execute format('create policy workspace_insert on public.%I for insert to authenticated with check (public.can_edit_workspace(workspace_id))',table_name);
  execute format('create policy workspace_update on public.%I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))',table_name);
  execute format('create trigger track_change after insert or update on public.%I for each row execute function public.record_change()',table_name);
 end loop;
end $$;
alter table public.history enable row level security;
revoke all on public.history from anon;
revoke insert,update,delete on public.history from authenticated;
grant select on public.history to authenticated;
create policy history_read on public.history for select to authenticated using(workspace_id=public.current_workspace());
commit;
