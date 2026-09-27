-- Batch 11: candidate self-service portal (Zoho H-area groundwork) and offer approvals.
-- A candidate who signs in with the email on their profile gets a curated view of their
-- own record — applications, interviews, offers, consents — and can update availability
-- preferences. Internal notes, owner/source metadata and current-CTC are never exposed.
create or replace function public.portal_candidate_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.candidates c
  join auth.users u on u.id = auth.uid()
  where u.email is not null and lower(btrim(u.email)) = lower(btrim(c.email))
  limit 1
$$;

create or replace function public.api_portal_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.portal_candidate_id();
  c public.candidates%rowtype;
begin
  if me is null then
    return jsonb_build_object('error','no candidate profile is linked to this account');
  end if;
  select * into c from public.candidates where id = me;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', c.id, 'name', c.name, 'title', c.title, 'location', c.location,
      'mode', c.mode, 'engagement', c.engagement, 'notice', c.notice,
      'earliestStart', c."earliestStart", 'activeStatus', c."activeStatus",
      'expected', c.expected, 'preferredLocations', c."preferredLocations",
      'timezone', c.timezone, 'skills', to_jsonb(c.skills), 'skillsDetail', c."skillsDetail",
      'summary', c.summary),
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'demand', d.title, 'client', d.client, 'stage', k.stage, 'updated', k.updated) order by k.updated desc),
        '[]'::jsonb)
      from public.considerations k join public.demands d on d.id = k."demandId"
      where k."candidateId" = me),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'demand', d.title, 'client', d.client, 'status', s."clientStatus", 'submittedOn', s."submittedOn")
        order by s."submittedOn" desc), '[]'::jsonb)
      from public.submissions s join public.demands d on d.id = s."demandId"
      where s."candidateId" = me),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'round', i.round, 'mode', i.mode, 'scheduledAt', i."scheduledAt", 'status', i.status)
        order by i."scheduledAt" desc), '[]'::jsonb)
      from public.interviews i where i."candidateId" = me),
    'offers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', o.role, 'status', o.status, 'ctc', o.ctc, 'joining', o.joining)
        order by o.created desc), '[]'::jsonb)
      from public.offers o where o."candidateId" = me),
    'consents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cn.id, 'purpose', cn.purpose, 'status', cn.status, 'date', cn.date)
        order by cn.date desc), '[]'::jsonb)
      from public.consents cn where cn."candidateId" = me)
  );
end $$;

-- Whitelisted self-service: only availability preferences are writable.
create or replace function public.api_portal_update(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.portal_candidate_id();
begin
  if me is null then
    return jsonb_build_object('error','no candidate profile is linked to this account');
  end if;
  update public.candidates set
    notice = coalesce(nullif(payload->>'notice','')::int, notice),
    "earliestStart" = coalesce(nullif(payload->>'earliestStart','')::date, "earliestStart"),
    "activeStatus" = coalesce(nullif(payload->>'activeStatus',''), "activeStatus"),
    mode = coalesce(nullif(payload->>'mode',''), mode),
    engagement = coalesce(nullif(payload->>'engagement',''), engagement),
    "preferredLocations" = coalesce(nullif(payload->>'preferredLocations',''), "preferredLocations"),
    expected = coalesce(nullif(payload->>'expected','')::numeric, expected)
  where id = me;
  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
    select workspace_id, 'candidates', id, 'updated', 'Candidate portal self-service update', 'Candidate (portal)'
    from public.candidates where id = me;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_portal_revoke_consent(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.portal_candidate_id();
begin
  if me is null then
    return jsonb_build_object('error','no candidate profile is linked to this account');
  end if;
  update public."consents" set status = 'revoked'
  where id = p_id and "candidateId" = me and status <> 'revoked';
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.portal_candidate_id() from public, anon, authenticated;
revoke all on function public.api_portal_overview() from public, anon;
revoke all on function public.api_portal_update(jsonb) from public, anon;
revoke all on function public.api_portal_revoke_consent(uuid) from public, anon;
grant execute on function public.api_portal_overview() to authenticated;
grant execute on function public.api_portal_update(jsonb) to authenticated;
grant execute on function public.api_portal_revoke_consent(uuid) to authenticated;

-- Offer approvals (I7 groundwork): a 'Pending approval' state between Draft and Sent.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('Draft','Pending approval','Sent','Accepted','Rejected','Withdrawn'));
