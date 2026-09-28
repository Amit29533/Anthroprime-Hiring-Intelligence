-- Batch 24: employee and partner referrals (Zoho Recruit D6).
--
-- Referrals are consistently the highest-quality hiring source, and the module is one of the
-- most-used parts of an ATS. The repository already tracks `candidates.source`, so what is
-- missing is the referral itself: who referred whom, for which role, what happened, and whether
-- a reward is owed.
--
-- The privacy problem this design takes seriously
-- -----------------------------------------------
-- A referral is somebody submitting a THIRD PARTY's contact details. The referred person has not
-- consented to anything and may not even know. Blueprint §12 does not allow us to treat that as
-- a candidate record. So:
--
--   * A referral is stored in its own table, NOT as a candidate. It holds the minimum needed to
--     make contact once, and is clearly not a profile.
--   * Promoting a referral into a candidate is a deliberate recruiter action, never automatic,
--     and the consent basis is recorded at that moment.
--   * The anonymous submit RPC is WRITE-ONLY. A referral list is a list of people who never
--     opted in, so nothing outside the workspace can read one back.
--
-- Rewards are recorded, never calculated: amounts and payment are an HR/payroll concern, and a
-- system that implies it has paid somebody when it has not is worse than one that only tracks
-- the state.
begin;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),

  "referrerName" text not null check (length(btrim("referrerName")) > 0),
  "referrerEmail" text not null default '',
  "referrerType" text not null default 'Employee'
    check ("referrerType" in ('Employee', 'Client', 'Partner', 'Candidate', 'Other')),

  -- Deliberately minimal: this is a third party's data.
  "refereeName" text not null check (length(btrim("refereeName")) > 0),
  "refereeEmail" text not null default '',
  "refereePhone" text not null default '',
  "refereeLinkedin" text not null default '',
  relationship text not null default '',
  note text not null default '',

  "demandId" uuid,
  "candidateId" uuid,
  status text not null default 'New'
    check (status in ('New', 'Contacted', 'In pipeline', 'Hired', 'Not proceeding', 'Duplicate')),
  outcome text not null default '',

  "rewardStatus" text not null default 'Not eligible'
    check ("rewardStatus" in ('Not eligible', 'Pending', 'Approved', 'Paid', 'Declined')),
  "rewardNote" text not null default '',

  source text not null default 'In-app',
  created date not null default current_date,
  updated timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, "demandId") references public.demands (workspace_id, id) on delete set null ("demandId"),
  foreign key (workspace_id, "candidateId") references public.candidates (workspace_id, id) on delete set null ("candidateId"),
  -- A referral must offer some way to reach the person, or it is not actionable.
  check (length(btrim("refereeEmail")) > 0 or length(btrim("refereePhone")) > 0 or length(btrim("refereeLinkedin")) > 0)
);
create index if not exists referrals_workspace on public.referrals (workspace_id, status);
create index if not exists referrals_referrer on public.referrals (workspace_id, lower(btrim("referrerEmail")));
create unique index if not exists referrals_no_duplicate
  on public.referrals (workspace_id, lower(btrim("refereeEmail")), coalesce("demandId", '00000000-0000-0000-0000-000000000000'::uuid))
  where length(btrim("refereeEmail")) > 0;

alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;
grant select, insert, update on public.referrals to authenticated;
drop policy if exists referrals_read on public.referrals;
create policy referrals_read on public.referrals for select to authenticated
  using (workspace_id = public.current_workspace());
drop policy if exists referrals_insert on public.referrals;
create policy referrals_insert on public.referrals for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
drop policy if exists referrals_update on public.referrals;
create policy referrals_update on public.referrals for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

drop trigger if exists track_change on public.referrals;
create trigger track_change after insert or update on public.referrals
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public.referrals;
create trigger touch_updated_column before update on public.referrals
  for each row execute function public.touch_updated_column();

-- Anonymous submission: write-only, mirroring the careers apply RPC. An employee who is not an
-- ATS user refers through the careers page; nothing can be read back.
drop function if exists public.api_public_refer(uuid, jsonb);
create or replace function public.api_public_refer(ws uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  role_id uuid;
  referee_email text := lower(btrim(coalesce(payload->>'refereeEmail', '')));
begin
  if payload is null
     or coalesce(btrim(payload->>'referrerName'), '') = ''
     or coalesce(btrim(payload->>'refereeName'), '') = '' then
    raise exception 'your name and the name of the person you are referring are required';
  end if;
  if referee_email = '' and coalesce(btrim(payload->>'refereePhone'), '') = '' then
    raise exception 'give an email address or phone number so we can reach them';
  end if;
  if referee_email <> '' and referee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address for the person you are referring';
  end if;
  -- The referrer confirms they have the person's permission. This is not consent in the §12
  -- sense (only the referred person can give that) but it records who asserted it, and when.
  if not coalesce((payload->>'confirmPermission')::boolean, false) then
    raise exception 'confirm that the person you are referring is happy to be contacted';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = ws) then
    raise exception 'unknown workspace';
  end if;

  begin
    role_id := nullif(payload->>'demandId', '')::uuid;
  exception when invalid_text_representation then
    role_id := null;
  end;
  if role_id is not null and not exists (
    select 1 from public.demands d
    where d.id = role_id and d.workspace_id = ws and d.status = 'Open' and d."careersVisible" is true
  ) then
    role_id := null;
  end if;

  -- A repeat referral of the same person for the same role reports success without saying so:
  -- the submitter must not learn whether that person is already in the pipeline.
  if exists (
    select 1 from public.referrals r
    where r.workspace_id = ws
      and referee_email <> ''
      and lower(btrim(r."refereeEmail")) = referee_email
      and coalesce(r."demandId", '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.referrals (
    workspace_id, "referrerName", "referrerEmail", "referrerType",
    "refereeName", "refereeEmail", "refereePhone", "refereeLinkedin",
    relationship, note, "demandId", source
  ) values (
    ws,
    btrim(payload->>'referrerName'),
    lower(btrim(coalesce(payload->>'referrerEmail', ''))),
    coalesce(nullif(btrim(payload->>'referrerType'), ''), 'Employee'),
    btrim(payload->>'refereeName'),
    referee_email,
    coalesce(btrim(payload->>'refereePhone'), ''),
    coalesce(btrim(payload->>'refereeLinkedin'), ''),
    coalesce(btrim(payload->>'relationship'), ''),
    coalesce(payload->>'note', ''),
    role_id,
    'Careers page'
  )
  returning id into new_id;

  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (ws, 'referrals', new_id, 'referral received',
          format('%s referred someone via the careers page', btrim(payload->>'referrerName')),
          'Careers page');

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.api_public_refer(uuid, jsonb) from public;
grant execute on function public.api_public_refer(uuid, jsonb) to anon, authenticated;

-- Extend both incremental-sync RPCs (blueprint §14) so referrals travel with every other table.
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
    union all (select 1 from public.referrals r where r.workspace_id=public.current_workspace() and (r.created>=day or r.updated::date>=day) order by r.id limit 1 offset greatest(row_offset,0))
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
    'skillEvidence', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select e.* from public."skillEvidence" e where e.workspace_id=ws and e.date::date>=day order by e.id limit lim offset off) t),
    'referrals', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public.referrals r where r.workspace_id=ws and (r.created>=day or r.updated::date>=day) order by r.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
