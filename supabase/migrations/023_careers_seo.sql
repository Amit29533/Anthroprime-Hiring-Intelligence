-- Batch 19: discoverable career pages (Zoho Recruit B6, blueprint §8 public surfaces).
--
-- Google's JobPosting rich result requires `datePosted`, and the "job expires" signal keeps
-- stale roles out of Google Jobs. The public listing RPC returned neither, so the careers page
-- could never emit valid structured data.
--
-- Only two additional columns are exposed, and both are already public information implied by
-- the listing itself:
--   * `created`   — when the role was opened, which becomes schema.org `datePosted`.
--   * `target`    — the target start date, used as a conservative `validThrough` so an expired
--                   posting drops out of search rather than lingering.
-- Budget, matching weights, internal tags, owner, commercials, business unit, approval state and
-- tenant identifiers all remain excluded exactly as migration 018 established.
begin;

drop function if exists public.api_public_open_roles(uuid);
create or replace function public.api_public_open_roles(p_workspace uuid)
returns table (
  id uuid,
  title text,
  client text,
  location text,
  mode text,
  "engagementType" text,
  positions integer,
  description text,
  skills text[],
  created date,
  target date
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.title, d.client, d.location, d.mode, d."engagementType",
         d.positions, d.description, d.skills, d.created, d.target
  from public.demands d
  where d.workspace_id = p_workspace
    and d.status = 'Open'
    and d."careersVisible" is true
  order by d.created desc, d.id;
$$;
revoke all on function public.api_public_open_roles(uuid) from public;
grant execute on function public.api_public_open_roles(uuid) to anon, authenticated;

commit;
