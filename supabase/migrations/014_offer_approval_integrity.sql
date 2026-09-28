-- Harden blueprint I7 offer approvals at the database boundary.
--
-- Migration 013 added the gate, but a client with direct table access could set
-- approvedAt='now' and approvedBy='Admin' while sending, or edit a term while preserving
-- an old approval stamp. This migration makes approval admin-only and binds it to a
-- server-generated snapshot of the exact terms. A material change invalidates the snapshot;
-- sending (or changing terms on an already-sent offer) is rejected until an admin approves
-- the current package.
alter table public.offers add column if not exists "approvedTerms" jsonb;

create or replace function public.offers_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approvals_on boolean := false;
  user_is_admin boolean := false;
  approval_is_new boolean := false;
  terms_changed boolean := false;
  current_terms jsonb;
  old_terms jsonb;
begin
  current_terms := jsonb_build_object(
    'candidateId', new."candidateId",
    'demandId', new."demandId",
    'role', new.role,
    'location', new.location,
    'ctc', new.ctc,
    'joining', new.joining
  );

  user_is_admin := public.is_admin();

  if tg_op = 'INSERT' then
    -- A recruiter must not be able to manufacture an approval on the same request that
    -- creates/sends the offer. Only an authenticated workspace admin may grant one.
    if new."approvedAt" is not null and not user_is_admin then
      raise exception 'Only a workspace admin can approve an offer';
    end if;

    if new."approvedAt" is not null then
      new."approvedTerms" := current_terms;
      new."approvedBy" := null;
      select u.email into new."approvedBy"
        from auth.users as u
       where u.id = auth.uid();
      new."approvedBy" := coalesce(nullif(new."approvedBy", ''), auth.uid()::text, 'Admin');
    else
      if not user_is_admin and (coalesce(new."approvedBy", '') <> '' or new."approvedTerms" is not null) then
        raise exception 'Only a workspace admin can set offer approval fields';
      end if;
      new."approvedBy" := '';
      new."approvedTerms" := null;
    end if;
  else
    old_terms := jsonb_build_object(
      'candidateId', old."candidateId",
      'demandId', old."demandId",
      'role', old.role,
      'location', old.location,
      'ctc', old.ctc,
      'joining', old.joining
    );
    terms_changed := current_terms is distinct from old_terms;
    approval_is_new := new."approvedAt" is not null
      and (old."approvedAt" is null or new."approvedAt" is distinct from old."approvedAt");

    -- Non-admins may clear an approval, but cannot create, replace, or forge its metadata.
    if not user_is_admin and (
      (approval_is_new)
      or (new."approvedBy" is distinct from old."approvedBy" and coalesce(new."approvedBy", '') <> '')
      or (new."approvedTerms" is distinct from old."approvedTerms" and new."approvedTerms" is not null)
    ) then
      raise exception 'Only a workspace admin can approve an offer';
    end if;

    if approval_is_new then
      -- The snapshot and approver come from the row and authenticated session, never from
      -- caller-supplied JSON or text.
      new."approvedTerms" := current_terms;
      new."approvedBy" := null;
      select u.email into new."approvedBy"
        from auth.users as u
       where u.id = auth.uid();
      new."approvedBy" := coalesce(nullif(new."approvedBy", ''), auth.uid()::text, 'Admin');
    elsif new."approvedAt" is null then
      -- Clearing an approval is safe and is needed when a recruiter edits terms.
      new."approvedBy" := '';
      new."approvedTerms" := null;
    else
      -- Preserve the trusted database snapshot rather than accepting an edited client copy.
      new."approvedBy" := old."approvedBy";
      new."approvedTerms" := old."approvedTerms";
      if current_terms is distinct from old."approvedTerms" then
        new."approvedAt" := null;
        new."approvedBy" := '';
        new."approvedTerms" := null;
      end if;
    end if;
  end if;

  -- Non-sent edits need no gate; the invalidation logic above still runs for every update.
  if new.status is distinct from 'Sent' then
    return new;
  end if;

  select coalesce((custom->>'offerApprovals')::boolean, false)
    into approvals_on
    from public."settings"
   where workspace_id = coalesce(new.workspace_id, public.current_workspace())
     and id = 'workspace';

  -- Gate creation/transition into Sent, and any material change to an already-sent offer.
  -- Re-saving an existing sent offer with only notes/metadata is not a new send.
  if (tg_op = 'INSERT' or old.status is distinct from 'Sent' or terms_changed)
     and coalesce(approvals_on, false)
     and (new."approvedAt" is null or new."approvedTerms" is distinct from current_terms) then
    raise exception 'This workspace requires admin approval of the current offer terms before sending';
  end if;

  return new;
end;
$$;

drop trigger if exists offers_approval_gate on public.offers;
create trigger offers_approval_gate
  before insert or update on public.offers
  for each row execute function public.offers_approval_gate();
