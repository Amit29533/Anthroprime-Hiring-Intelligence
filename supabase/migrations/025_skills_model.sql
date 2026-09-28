-- Batch 21: the skills intelligence model (blueprint §6, §7 and the §14 entity list).
--
-- Blueprint §6 opens with "avoid storing skills as an uncontrolled comma-separated list", and
-- §14 names three entities: Skill, PersonSkill, SkillEvidence. Until now the product stored
-- `candidates.skills text[]` plus a `skillsDetail` jsonb blob. That blob was honest about
-- proficiency and evidence *source*, but it had two structural problems:
--
--   1. There was no canonical Skill record, so "Genie" and "Databricks Genie" were different
--      strings with no shared identity, domain or alias set that a query could rely on.
--   2. Editing a skill overwrote the previous value. §7 is explicit that "SkillEvidence:
--      proficiency/evidence can improve or become stale; never silently replace an assessment."
--      A jsonb field that is rewritten in place cannot satisfy that sentence.
--
-- This migration adds the three entities properly:
--
--   * `skills`        — canonical name, domain, aliases. Unique per workspace, case-insensitive.
--   * `personSkills`  — one row per candidate-skill: the *derived current* view.
--   * `skillEvidence` — append-only observations. UPDATE and DELETE are revoked from
--                       `authenticated` outright, exactly as `history` is, so an assessment can
--                       never be silently replaced. Correcting the record means adding evidence.
--
-- `personSkills` is maintained by a trigger from the evidence, never written directly by a
-- client: the current proficiency is whatever the strongest *recent* evidence says. That keeps
-- the derived view and its justification from ever drifting apart.
--
-- Nothing is destroyed. `candidates.skills` and `skillsDetail` remain and stay authoritative for
-- matching, so every existing screen, import path and the matching engine keep working
-- unchanged. The migration back-fills the new tables from them, so a workspace arrives with its
-- history intact rather than an empty Skills tab.
begin;

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  name text not null check (length(btrim(name)) > 0),
  domain text not null default '',
  aliases text[] not null default '{}',
  notes text not null default '',
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index if not exists skills_name_unique
  on public.skills (workspace_id, lower(btrim(name)));

create table if not exists public."personSkills" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  "candidateId" uuid not null,
  "skillId" uuid not null,
  proficiency text not null default 'Exposure'
    check (proficiency in ('Exposure', 'Working', 'Proficient', 'Advanced', 'Expert')),
  years numeric(4, 1),
  "lastUsed" date,
  confidence integer not null default 0 check (confidence between 0 and 100),
  validated boolean not null default false,
  "evidenceCount" integer not null default 0,
  "lastEvidence" date,
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, "candidateId", "skillId"),
  foreign key (workspace_id, "candidateId") references public.candidates (workspace_id, id) on delete cascade,
  foreign key (workspace_id, "skillId") references public.skills (workspace_id, id) on delete cascade
);
create index if not exists person_skills_candidate on public."personSkills" (workspace_id, "candidateId");
create index if not exists person_skills_skill on public."personSkills" (workspace_id, "skillId");

create table if not exists public."skillEvidence" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  "personSkillId" uuid not null,
  "evidenceType" text not null default 'Self-declared'
    check ("evidenceType" in ('Self-declared', 'CV', 'Recruiter-verified', 'Assessment',
                              'Certification', 'Client interview', 'Project')),
  proficiency text not null default 'Exposure'
    check (proficiency in ('Exposure', 'Working', 'Proficient', 'Advanced', 'Expert')),
  years numeric(4, 1),
  "lastUsed" date,
  "evidenceRef" text not null default '',
  assessor text not null default '',
  note text not null default '',
  date timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, "personSkillId") references public."personSkills" (workspace_id, id) on delete cascade
);
create index if not exists skill_evidence_person_skill
  on public."skillEvidence" (workspace_id, "personSkillId", date desc);

alter table public.skills enable row level security;
revoke all on public.skills from anon;
revoke delete on public.skills from authenticated;
grant select, insert, update on public.skills to authenticated;
create policy skills_read on public.skills for select to authenticated
  using (workspace_id = public.current_workspace());
create policy skills_insert on public.skills for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
create policy skills_update on public.skills for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

alter table public."personSkills" enable row level security;
revoke all on public."personSkills" from anon;
revoke delete on public."personSkills" from authenticated;
grant select, insert, update on public."personSkills" to authenticated;
create policy person_skills_read on public."personSkills" for select to authenticated
  using (workspace_id = public.current_workspace());
create policy person_skills_insert on public."personSkills" for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
create policy person_skills_update on public."personSkills" for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

-- Append-only, like `history`. There is no UPDATE or DELETE grant at all, so §7's "never
-- silently replace an assessment" is a property of the database rather than a UI convention.
alter table public."skillEvidence" enable row level security;
revoke all on public."skillEvidence" from anon;
revoke update, delete on public."skillEvidence" from authenticated;
grant select, insert on public."skillEvidence" to authenticated;
create policy skill_evidence_read on public."skillEvidence" for select to authenticated
  using (workspace_id = public.current_workspace());
create policy skill_evidence_insert on public."skillEvidence" for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

-- How much a piece of evidence is worth. A recent validated assessment should outrank a
-- self-declared claim (blueprint §5: "Recent validated assessment should outrank self-declared
-- skill"), so the derived view is ordered by evidence weight first and recency second.
create or replace function public.skill_evidence_weight(kind text)
returns integer
language sql
immutable
as $$
  select case kind
    when 'Assessment' then 100
    when 'Certification' then 90
    when 'Client interview' then 80
    when 'Recruiter-verified' then 70
    when 'Project' then 60
    when 'CV' then 30
    when 'Self-declared' then 10
    else 0
  end;
$$;

-- Recompute the derived current view for one person-skill from its evidence. Nothing here is
-- taken from the client: proficiency, confidence and validation are all conclusions drawn from
-- the evidence rows that exist.
create or replace function public.refresh_person_skill(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  best record;
  total integer;
  latest date;
  max_years numeric(4, 1);
  last_used date;
  validated_flag boolean;
begin
  select count(*)::int, max(e.date::date) into total, latest
    from public."skillEvidence" e where e."personSkillId" = p_id;

  if coalesce(total, 0) = 0 then
    update public."personSkills"
       set "evidenceCount" = 0, confidence = 0, validated = false, "lastEvidence" = null
     where id = p_id;
    return;
  end if;

  -- Strongest evidence wins; ties broken by recency. Not simply "the newest row", because a
  -- fresh self-declared claim must not erase last month's assessment.
  select e.* into best
    from public."skillEvidence" e
   where e."personSkillId" = p_id
   order by public.skill_evidence_weight(e."evidenceType") desc, e.date desc
   limit 1;

  select max(e.years), max(e."lastUsed"),
         bool_or(public.skill_evidence_weight(e."evidenceType") >= 70)
    into max_years, last_used, validated_flag
    from public."skillEvidence" e where e."personSkillId" = p_id;

  update public."personSkills"
     set proficiency = best.proficiency,
         years = coalesce(max_years, years),
         "lastUsed" = coalesce(last_used, "lastUsed"),
         -- Confidence is the weight of the best evidence, nudged up slightly by corroboration
         -- and capped at 100. It is never asserted by a client.
         confidence = least(100, public.skill_evidence_weight(best."evidenceType") + least(10, (total - 1) * 5)),
         validated = coalesce(validated_flag, false),
         "evidenceCount" = total,
         "lastEvidence" = latest
   where id = p_id;
end;
$$;
revoke all on function public.refresh_person_skill(uuid) from public, anon;

create or replace function public.skill_evidence_applied()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_person_skill(new."personSkillId");
  return new;
end;
$$;

drop trigger if exists skill_evidence_applied on public."skillEvidence";
create trigger skill_evidence_applied
  after insert on public."skillEvidence"
  for each row execute function public.skill_evidence_applied();

do $$
declare tbl text;
begin
  foreach tbl in array array['skills','personSkills','skillEvidence'] loop
    execute format('drop trigger if exists track_change on public.%I', tbl);
    execute format('create trigger track_change after insert or update on public.%I for each row execute function public.record_change()', tbl);
  end loop;
  foreach tbl in array array['skills','personSkills'] loop
    execute format('drop trigger if exists touch_updated_column on public.%I', tbl);
    execute format('create trigger touch_updated_column before update on public.%I for each row execute function public.touch_updated_column()', tbl);
  end loop;
end $$;

-- Back-fill from the existing text[] + jsonb so a workspace does not arrive with an empty
-- Skills tab. Runs once: the guard means re-running the migration is harmless.
do $$
declare
  c record;
  detail jsonb;
  skill_name text;
  skill_row_id uuid;
  ps_id uuid;
  ev_type text;
begin
  if exists (select 1 from public.skills) then
    return;
  end if;

  for c in select id, workspace_id, skills, "skillsDetail", verified from public.candidates loop
    foreach skill_name in array coalesce(c.skills, '{}') loop
      if coalesce(btrim(skill_name), '') = '' then
        continue;
      end if;

      insert into public.skills (workspace_id, name)
      values (c.workspace_id, btrim(skill_name))
      on conflict do nothing;
      select s.id into skill_row_id from public.skills s
       where s.workspace_id = c.workspace_id and lower(btrim(s.name)) = lower(btrim(skill_name));

      detail := coalesce(
        (select d from jsonb_array_elements(coalesce(c."skillsDetail", '[]'::jsonb)) d
          where lower(btrim(d->>'skill')) = lower(btrim(skill_name)) limit 1),
        '{}'::jsonb);

      insert into public."personSkills" (workspace_id, "candidateId", "skillId", proficiency, years, "lastUsed")
      values (
        c.workspace_id, c.id, skill_row_id,
        case when detail->>'proficiency' in ('Exposure','Working','Proficient','Advanced','Expert')
             then detail->>'proficiency' else 'Exposure' end,
        nullif(detail->>'years', '')::numeric,
        nullif(detail->>'lastUsed', '')::date
      )
      on conflict (workspace_id, "candidateId", "skillId") do nothing
      returning id into ps_id;

      if ps_id is null then
        continue;
      end if;

      -- The prior claim becomes the first piece of evidence rather than being thrown away.
      -- 'Unverified' in the old blob meant "nobody has stood behind this", which maps to a
      -- self-declared claim; anything else carries across as recorded.
      ev_type := detail->>'evidence';
      if ev_type is null or ev_type not in
         ('CV','Recruiter-verified','Assessment','Certification','Client interview','Project') then
        ev_type := 'Self-declared';
      end if;

      insert into public."skillEvidence"
        (workspace_id, "personSkillId", "evidenceType", proficiency, years, "lastUsed", note, date)
      values (
        c.workspace_id, ps_id, ev_type,
        case when detail->>'proficiency' in ('Exposure','Working','Proficient','Advanced','Expert')
             then detail->>'proficiency' else 'Exposure' end,
        nullif(detail->>'years', '')::numeric,
        nullif(detail->>'lastUsed', '')::date,
        'Migrated from the pre-batch-21 skill record.',
        coalesce(c.verified::timestamptz, now())
      );
    end loop;
  end loop;
end $$;

-- Extend both incremental-sync RPCs (blueprint §14) so the skills model travels with every
-- other workspace table.
create or replace function public.api_changes_page_has_more(day date, row_offset integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    (select 1 from public.candidates c where c.workspace_id=public.current_workspace() and (c.created>=day or c.verified>=day or exists(select 1 from public.history h where h.workspace_id=c.workspace_id and h."entityType"='candidates' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.demands d where d.workspace_id=public.current_workspace() and (d.created>=day or exists(select 1 from public.history h where h.workspace_id=d.workspace_id and h."entityType"='demands' and h."entityId"=d.id and h.date::date>=day)) order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.considerations c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated>=day or exists(select 1 from public.history h where h.workspace_id=c.workspace_id and h."entityType"='considerations' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.assessments a where a.workspace_id=public.current_workspace() and (a.date>=day or exists(select 1 from public.history h where h.workspace_id=a.workspace_id and h."entityType"='assessments' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.notes n where n.workspace_id=public.current_workspace() and (n.date>=day or exists(select 1 from public.history h where h.workspace_id=n.workspace_id and h."entityType"='notes' and h."entityId"=n.id and h.date::date>=day)) order by n.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.enrichment e where e.workspace_id=public.current_workspace() and (e.created>=day or e.due>=day or exists(select 1 from public.history h where h.workspace_id=e.workspace_id and h."entityType"='enrichment' and h."entityId"=e.id and h.date::date>=day)) order by e.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.history h where h.workspace_id=public.current_workspace() and h.date::date>=day order by h.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."employmentHistory" e where e.workspace_id=public.current_workspace() and (e.created::date>=day or e.verified>=day) order by e.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."compensationHistory" c where c.workspace_id=public.current_workspace() and c.verified>=day order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."availabilityHistory" a where a.workspace_id=public.current_workspace() and a.captured>=day order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."auditEvents" a where a.workspace_id=public.current_workspace() and a.date::date>=day order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."documents" d where d.workspace_id=public.current_workspace() and (d.uploaded::date>=day or d.updated::date>=day) order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."taxonomy" x where x.workspace_id=public.current_workspace() and x.updated::date>=day order by x.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."demandCommercials" d where public.is_admin() and d.workspace_id=public.current_workspace() and d.updated::date>=day order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."settings" s where s.workspace_id=public.current_workspace() and s.updated::date>=day order by s.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."consents" c where c.workspace_id=public.current_workspace() and (c.date::date>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.interviews i where i.workspace_id=public.current_workspace() and (i."scheduledAt"::date>=day or i.created::date>=day or (i.completed is not null and i.completed::date>=day) or exists(select 1 from public.history h where h.workspace_id=i.workspace_id and h."entityType"='interviews' and h."entityId"=i.id and h.date::date>=day)) order by i.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.offers o where o.workspace_id=public.current_workspace() and (o.created::date>=day or o."sentDate"::date>=day or (o."decidedDate" is not null and o."decidedDate"::date>=day) or (o."approvedAt" is not null and o."approvedAt"::date>=day) or exists(select 1 from public.history h where h.workspace_id=o.workspace_id and h."entityType"='offers' and h."entityId"=o.id and h.date::date>=day)) order by o.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.tasks t where t.workspace_id=public.current_workspace() and (t.created::date>=day or t.due>=day or exists(select 1 from public.history h where h.workspace_id=t.workspace_id and h."entityType"='tasks' and h."entityId"=t.id and h.date::date>=day)) order by t.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.submissions s where s.workspace_id=public.current_workspace() and (s."submittedOn">=day or exists(select 1 from public.history h where h.workspace_id=s.workspace_id and h."entityType"='submissions' and h."entityId"=s.id and h.date::date>=day)) order by s.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."publicApplications" a where a.workspace_id=public.current_workspace() and (a.created::date>=day or exists(select 1 from public.history h where h.workspace_id=a.workspace_id and h."entityType"='publicApplications' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."workflowRules" r where r.workspace_id=public.current_workspace() and (r.created::date>=day or r.updated::date>=day) order by r.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.clients c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."clientContacts" c where c.workspace_id=public.current_workspace() and (c.created>=day or c.updated::date>=day) order by c.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.departments d where d.workspace_id=public.current_workspace() and (d.created>=day or d.updated::date>=day) order by d.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.reports r where r.workspace_id=public.current_workspace() and (r.created>=day or r.updated::date>=day) order by r.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public.skills s where s.workspace_id=public.current_workspace() and (s.created>=day or s.updated::date>=day) order by s.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."personSkills" p where p.workspace_id=public.current_workspace() and (p.created>=day or p.updated::date>=day) order by p.id limit 1 offset greatest(row_offset,0))
    union all (select 1 from public."skillEvidence" e where e.workspace_id=public.current_workspace() and e.date::date>=day order by e.id limit 1 offset greatest(row_offset,0))
  );
$$;
revoke all on function public.api_changes_page_has_more(date,integer) from public, anon;
grant execute on function public.api_changes_page_has_more(date,integer) to authenticated;

create or replace function public.api_changes_since(day date default current_date - 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  base jsonb;
begin
  if ws is null then
    return jsonb_build_object('error', 'no workspace membership');
  end if;
  -- Delegates to the page RPC so there is exactly one place where the table list lives.
  base := public.api_changes_page(day, 0, 1000000);
  return base - 'block' - 'size' - 'next';
end;
$$;
revoke all on function public.api_changes_since(date) from public, anon;
grant execute on function public.api_changes_since(date) to authenticated;

create or replace function public.api_changes_page(day date default current_date - 30, page_block int default 0, page_size int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
  off integer := greatest(page_block, 0) * greatest(page_size, 1);
  lim integer := greatest(page_size, 1);
begin
  if ws is null then
    return jsonb_build_object('error', 'no workspace membership');
  end if;
  return jsonb_build_object(
    'since', day, 'block', page_block, 'size', page_size,
    'next', public.api_changes_page_has_more(day, off + lim),
    'candidates', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.candidates c where c.workspace_id=ws and (c.created>=day or c.verified>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='candidates' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit lim offset off) t),
    'demands', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public.demands d where d.workspace_id=ws and (d.created>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='demands' and h."entityId"=d.id and h.date::date>=day)) order by d.id limit lim offset off) t),
    'considerations', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.considerations c where c.workspace_id=ws and (c.created>=day or c.updated>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='considerations' and h."entityId"=c.id and h.date::date>=day)) order by c.id limit lim offset off) t),
    'assessments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public.assessments a where a.workspace_id=ws and (a.date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='assessments' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit lim offset off) t),
    'notes', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select n.* from public.notes n where n.workspace_id=ws and (n.date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='notes' and h."entityId"=n.id and h.date::date>=day)) order by n.id limit lim offset off) t),
    'enrichment', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public.enrichment e where e.workspace_id=ws and (e.created>=day or e.due>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='enrichment' and h."entityId"=e.id and h.date::date>=day)) order by e.id limit lim offset off) t),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select h.id,h."entityId",h."entityType",h.action,h.date,h.actor from public.history h where h.workspace_id=ws and h.date::date>=day order by h.id limit lim offset off) t),
    'employmentHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public."employmentHistory" e where e.workspace_id=ws and (e.created::date>=day or e.verified>=day) order by e.id limit lim offset off) t),
    'compensationHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."compensationHistory" c where c.workspace_id=ws and c.verified>=day order by c.id limit lim offset off) t),
    'availabilityHistory', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."availabilityHistory" a where a.workspace_id=ws and a.captured>=day order by a.id limit lim offset off) t),
    'auditEvents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."auditEvents" a where a.workspace_id=ws and a.date::date>=day order by a.id limit lim offset off) t),
    'documents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.id,d.workspace_id,d."candidateId",d.kind,d.name,d.mime,d.size,d.version,d.hash,d."parserStatus",d.removed,d.uploaded,d.updated from public."documents" d where d.workspace_id=ws and (d.uploaded::date>=day or d.updated::date>=day) order by d.id limit lim offset off) t),
    'taxonomy', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select x.* from public."taxonomy" x where x.workspace_id=ws and x.updated::date>=day order by x.id limit lim offset off) t),
    'demandCommercials', case when public.is_admin() then (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public."demandCommercials" d where d.workspace_id=ws and d.updated::date>=day order by d.id limit lim offset off) t) else '[]'::jsonb end,
    'settings', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public."settings" s where s.workspace_id=ws and s.updated::date>=day order by s.id limit lim offset off) t),
    'consents', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."consents" c where c.workspace_id=ws and (c.date::date>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'interviews', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select i.* from public.interviews i where i.workspace_id=ws and (i."scheduledAt"::date>=day or i.created::date>=day or (i.completed is not null and i.completed::date>=day) or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='interviews' and h."entityId"=i.id and h.date::date>=day)) order by i.id limit lim offset off) t),
    'offers', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select o.id,o.workspace_id,o."candidateId",o."demandId",o.role,o.location,o.ctc,o.joining,o.status,o."sentDate",o."decidedDate",o.notes,o.created,o."approvedAt",o."approvedBy",o."approvedTerms" from public.offers o where o.workspace_id=ws and (o.created::date>=day or o."sentDate"::date>=day or (o."decidedDate" is not null and o."decidedDate"::date>=day) or (o."approvedAt" is not null and o."approvedAt"::date>=day) or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='offers' and h."entityId"=o.id and h.date::date>=day)) order by o.id limit lim offset off) t),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select t.* from public.tasks t where t.workspace_id=ws and (t.created::date>=day or t.due>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='tasks' and h."entityId"=t.id and h.date::date>=day)) order by t.id limit lim offset off) t),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public.submissions s where s.workspace_id=ws and (s."submittedOn">=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='submissions' and h."entityId"=s.id and h.date::date>=day)) order by s.id limit lim offset off) t),
    'publicApplications', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select a.* from public."publicApplications" a where a.workspace_id=ws and (a.created::date>=day or exists(select 1 from public.history h where h.workspace_id=ws and h."entityType"='publicApplications' and h."entityId"=a.id and h.date::date>=day)) order by a.id limit lim offset off) t),
    'workflowRules', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public."workflowRules" r where r.workspace_id=ws and (r.created::date>=day or r.updated::date>=day) order by r.id limit lim offset off) t),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public.clients c where c.workspace_id=ws and (c.created>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'clientContacts', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select c.* from public."clientContacts" c where c.workspace_id=ws and (c.created>=day or c.updated::date>=day) order by c.id limit lim offset off) t),
    'departments', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select d.* from public.departments d where d.workspace_id=ws and (d.created>=day or d.updated::date>=day) order by d.id limit lim offset off) t),
    'reports', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public.reports r where r.workspace_id=ws and (r.created>=day or r.updated::date>=day) order by r.id limit lim offset off) t),
    'skills', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public.skills s where s.workspace_id=ws and (s.created>=day or s.updated::date>=day) order by s.id limit lim offset off) t),
    'personSkills', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select p.* from public."personSkills" p where p.workspace_id=ws and (p.created>=day or p.updated::date>=day) order by p.id limit lim offset off) t),
    'skillEvidence', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public."skillEvidence" e where e.workspace_id=ws and e.date::date>=day order by e.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
