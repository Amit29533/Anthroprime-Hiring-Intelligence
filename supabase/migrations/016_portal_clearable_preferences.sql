-- Candidate self-service parity with the local portal.
--
-- The prior RPC used COALESCE(value, existing), which made a blank field mean "keep the old
-- value" in cloud mode, even though the local portal correctly stored unknown as NULL. It also
-- exposed an Unavailable option for activeStatus although the database allows Active/Passive,
-- and did not enforce the shared notice-period ceiling at the API boundary.
create or replace function public.api_portal_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.portal_candidate_id();
  notice_value numeric;
  expected_value numeric;
  start_value date;
  active_value text;
  mode_value text;
begin
  if me is null then
    return jsonb_build_object('error', 'no candidate profile is linked to this account');
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Candidate preferences must be an object';
  end if;

  -- Validate before casting to integer/numeric/date so a malformed client payload produces a
  -- clear field error rather than a database conversion detail.
  if payload ? 'notice' then
    begin
      notice_value := nullif(trim(payload->>'notice'), '')::numeric;
    exception when others then
      raise exception 'Notice period must be a whole number from 0 to 365 days';
    end;
    if notice_value is not null and
       (notice_value < 0 or notice_value > 365 or notice_value <> trunc(notice_value)) then
      raise exception 'Notice period must be a whole number from 0 to 365 days';
    end if;
  end if;

  if payload ? 'expected' then
    begin
      expected_value := nullif(trim(payload->>'expected'), '')::numeric;
    exception when others then
      raise exception 'Expected CTC must be a non-negative number';
    end;
    if expected_value is not null and
       (expected_value < 0 or expected_value::text in ('NaN', 'Infinity', '-Infinity')) then
      raise exception 'Expected CTC must be a finite non-negative number';
    end if;
  end if;

  if payload ? 'earliestStart' then
    begin
      start_value := nullif(trim(payload->>'earliestStart'), '')::date;
    exception when others then
      raise exception 'Choose a valid earliest start date';
    end;
  end if;

  if payload ? 'activeStatus' then
    active_value := nullif(trim(payload->>'activeStatus'), '');
    if active_value is null or active_value not in ('Active', 'Passive') then
      raise exception 'Choose Active or Passive availability status';
    end if;
  end if;

  if payload ? 'mode' then
    mode_value := nullif(trim(payload->>'mode'), '');
    if mode_value is null or mode_value not in ('Flexible', 'Remote', 'Hybrid', 'Onsite') then
      raise exception 'Choose a valid work mode';
    end if;
  end if;

  update public.candidates set
    notice = case when payload ? 'notice' then notice_value::integer else notice end,
    "earliestStart" = case when payload ? 'earliestStart' then start_value else "earliestStart" end,
    "activeStatus" = case when payload ? 'activeStatus' then active_value else "activeStatus" end,
    mode = case when payload ? 'mode' then mode_value else mode end,
    engagement = case when payload ? 'engagement' then coalesce(payload->>'engagement', '') else engagement end,
    "preferredLocations" = case when payload ? 'preferredLocations' then coalesce(payload->>'preferredLocations', '') else "preferredLocations" end,
    expected = case when payload ? 'expected' then expected_value else expected end
  where id = me;

  insert into public."auditEvents" (workspace_id, "entityType", "entityId", action, detail, actor)
    select workspace_id, 'candidates', id, 'updated', 'Candidate portal self-service update', 'Candidate (portal)'
      from public.candidates where id = me;
  return jsonb_build_object('ok', true);
end;
$$;
