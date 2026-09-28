-- Offer approvals (I7), completed: record which draft was approved, by whom and when.
--
-- 012 added the 'Pending approval' status, but approving simply moved the offer back to
-- 'Draft', and every Draft could be marked Sent — so switching the workspace policy on
-- changed nothing a recruiter could not click straight past. These columns make the gate
-- enforceable: an offer may only be sent when approvals are off, or when an approval exists
-- that still covers its current terms. The app clears "approvedAt" whenever a material term
-- (candidate, demand, role, location, ctc, joining) is edited, so approval cannot outlive
-- the package it was granted for.
alter table public.offers add column if not exists "approvedAt" timestamptz;
alter table public.offers add column if not exists "approvedBy" text not null default '';

-- Enforced server-side too, so a direct API write cannot skip the gate the client shows.
create or replace function public.offers_approval_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approvals_on boolean;
begin
  if new.status is distinct from 'Sent' then
    return new;
  end if;
  -- Only the transition into Sent is gated; re-saving an already-sent offer is not.
  if tg_op = 'UPDATE' and old.status = 'Sent' then
    return new;
  end if;

  select coalesce((custom->>'offerApprovals')::boolean, false) into approvals_on
    from public."settings"
   where workspace_id = coalesce(new.workspace_id, public.current_workspace())
     and id = 'workspace';

  if coalesce(approvals_on, false) and new."approvedAt" is null then
    raise exception 'This workspace requires offer approval before an offer can be sent';
  end if;

  return new;
end;
$$;

drop trigger if exists offers_approval_gate on public.offers;
drop trigger if exists offers_approval_gate on public.offers;
create trigger offers_approval_gate
  before insert or update on public.offers
  for each row execute function public.offers_approval_gate();
