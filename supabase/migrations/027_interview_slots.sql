-- Batch 25 / Phase C: interviewer availability and candidate self-booking (Zoho Recruit F5).
--
-- Agreeing an interview time currently costs an email round trip per candidate. A recruiter
-- publishes the times an interviewer is free; the candidate picks one in the portal they already
-- have. No email, no server, no calendar integration required.
--
-- The hard part is concurrency, not UI. Two candidates offered the same slot must not both get
-- it, and "probably fine because collisions are rare" is not a design. Booking is therefore a
-- single conditional UPDATE — `set status='Booked' where status='Open'` — and the caller checks
-- how many rows it actually changed. Postgres serialises the two writers on the row lock; the
-- loser sees zero rows affected and is told the slot has gone. There is no read-then-write gap
-- for two sessions to slip through.
--
-- A slot may be offered to one named candidate, or left open to anyone the recruiter invites.
-- A candidate can only ever see and book slots offered to them, which is enforced in the RPC
-- rather than by the client asking nicely.
begin;

create table if not exists public."interviewSlots" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace() references public.workspaces(id),
  "demandId" uuid,
  "candidateId" uuid,
  interviewer text not null default '',
  round text not null default 'Round 1',
  mode text not null default 'Video' check (mode in ('Video', 'Phone', 'In person')),
  location text not null default '',
  "startsAt" timestamptz not null,
  "durationMins" integer not null default 45 check ("durationMins" between 5 and 480),
  status text not null default 'Open' check (status in ('Open', 'Booked', 'Cancelled')),
  "bookedAt" timestamptz,
  "interviewId" uuid,
  note text not null default '',
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, "demandId") references public.demands (workspace_id, id) on delete set null ("demandId"),
  foreign key (workspace_id, "candidateId") references public.candidates (workspace_id, id) on delete cascade,
  foreign key (workspace_id, "interviewId") references public.interviews (workspace_id, id) on delete set null ("interviewId")
);
create index if not exists interview_slots_when on public."interviewSlots" (workspace_id, "startsAt");
create index if not exists interview_slots_candidate on public."interviewSlots" (workspace_id, "candidateId", status);
-- The same interviewer cannot be published as free twice at the same moment.
create unique index if not exists interview_slots_no_double_booking
  on public."interviewSlots" (workspace_id, lower(btrim(interviewer)), "startsAt")
  where status <> 'Cancelled' and length(btrim(interviewer)) > 0;

alter table public."interviewSlots" enable row level security;
revoke all on public."interviewSlots" from anon, authenticated;
grant select, insert, update on public."interviewSlots" to authenticated;
drop policy if exists interview_slots_read on public."interviewSlots";
create policy interview_slots_read on public."interviewSlots" for select to authenticated
  using (workspace_id = public.current_workspace());
drop policy if exists interview_slots_insert on public."interviewSlots";
create policy interview_slots_insert on public."interviewSlots" for insert to authenticated
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));
drop policy if exists interview_slots_update on public."interviewSlots";
create policy interview_slots_update on public."interviewSlots" for update to authenticated
  using (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id))
  with check (workspace_id = public.current_workspace() and public.can_edit_workspace(workspace_id));

drop trigger if exists track_change on public."interviewSlots";
create trigger track_change after insert or update on public."interviewSlots"
  for each row execute function public.record_change();
drop trigger if exists touch_updated_column on public."interviewSlots";
create trigger touch_updated_column before update on public."interviewSlots"
  for each row execute function public.touch_updated_column();

-- What the signed-in candidate may choose from. Only future, open slots offered to them.
create or replace function public.api_portal_slots()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := public.portal_candidate_id();
begin
  if me is null then
    return jsonb_build_object('error', 'no candidate profile is linked to this account');
  end if;
  return jsonb_build_object(
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'startsAt', s."startsAt", 'durationMins', s."durationMins",
        'mode', s.mode, 'location', s.location, 'round', s.round,
        'role', d.title, 'client', d.client
      ) order by s."startsAt")
      from public."interviewSlots" s
      left join public.demands d on d.id = s."demandId"
      -- The interviewer's name is deliberately withheld: a candidate needs the time, not the
      -- panel's identity, and disclosing it before the interview is the recruiter's choice.
      where s.workspace_id = (select c.workspace_id from public.candidates c where c.id = me)
        and s."candidateId" = me
        and s.status = 'Open'
        and s."startsAt" > now()
    ), '[]'::jsonb),
    'booked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'startsAt', s."startsAt", 'durationMins', s."durationMins",
        'mode', s.mode, 'location', s.location, 'round', s.round)
        order by s."startsAt")
      from public."interviewSlots" s
      where s."candidateId" = me and s.status = 'Booked'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.api_portal_slots() from public, anon;
grant execute on function public.api_portal_slots() to authenticated;

-- Book a slot. The whole race is decided by the WHERE clause on the UPDATE.
create or replace function public.api_portal_book_slot(p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.portal_candidate_id();
  slot public."interviewSlots"%rowtype;
  taken integer;
  new_interview uuid;
begin
  if me is null then
    return jsonb_build_object('error', 'no candidate profile is linked to this account');
  end if;

  -- Claim the slot atomically. A second session reaching this line finds status <> 'Open'
  -- and updates nothing, so exactly one booking can ever succeed.
  update public."interviewSlots"
     set status = 'Booked', "bookedAt" = now(), updated = now()
   where id = p_slot
     and "candidateId" = me
     and status = 'Open'
     and "startsAt" > now()
  returning * into slot;
  get diagnostics taken = row_count;

  if taken = 0 then
    -- Do not distinguish "already taken" from "not yours" from "does not exist": all three
    -- would let a candidate probe for slots offered to other people.
    return jsonb_build_object('error', 'that time is no longer available');
  end if;

  insert into public.interviews (
    workspace_id, "candidateId", "demandId", round, mode, "scheduledAt", "durationMins", notes
  ) values (
    slot.workspace_id, me, slot."demandId", slot.round, slot.mode,
    slot."startsAt", slot."durationMins", 'Booked by the candidate from the portal'
  )
  returning id into new_interview;

  update public."interviewSlots" set "interviewId" = new_interview where id = slot.id;

  -- Any other slot still offered to this candidate for the same round is withdrawn, so the
  -- recruiter's calendar frees up the moment a choice is made.
  update public."interviewSlots"
     set status = 'Cancelled', updated = now()
   where "candidateId" = me
     and status = 'Open'
     and round = slot.round
     and id <> slot.id;

  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
  values (slot.workspace_id, 'interviews', new_interview, 'self-booked',
          format('Candidate booked %s on %s', slot.round, to_char(slot."startsAt", 'YYYY-MM-DD HH24:MI')),
          'Candidate portal');

  return jsonb_build_object('ok', true, 'interviewId', new_interview, 'startsAt', slot."startsAt");
end;
$$;
revoke all on function public.api_portal_book_slot(uuid) from public, anon;
grant execute on function public.api_portal_book_slot(uuid) to authenticated;

-- Extend both incremental-sync RPCs (blueprint §14) so slots travel with every other table.
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
    union all (select 1 from public."interviewSlots" s where s.workspace_id=public.current_workspace() and (s.created::date>=day or s.updated::date>=day) order by s.id limit 1 offset greatest(row_offset,0))
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
    'referrals', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select r.* from public.referrals r where r.workspace_id=ws and (r.created>=day or r.updated::date>=day) order by r.id limit lim offset off) t),
    'interviewSlots', (select coalesce(jsonb_agg(to_jsonb(t) - 'workspace_id'), '[]'::jsonb) from (select s.* from public."interviewSlots" s where s.workspace_id=ws and (s.created::date>=day or s.updated::date>=day) order by s.id limit lim offset off) t)
  );
end;
$$;
revoke all on function public.api_changes_page(date,int,int) from public, anon;
grant execute on function public.api_changes_page(date,int,int) to authenticated;

commit;
