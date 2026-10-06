begin;
create table if not exists ecod_private.linkedin_lookup_limits (
 workspace_id uuid not null references public.workspaces(id),day date not null,attempts integer not null default 0,primary key(workspace_id,day)
);
alter table ecod_private.linkedin_lookup_limits enable row level security;
revoke all on ecod_private.linkedin_lookup_limits from public,anon,authenticated;
create or replace function public.api_linkedin_import_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Candidate import permission required' using errcode='42501';end if;
 return jsonb_build_object('enabled',exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'linkedinEnrichment'='true'::jsonb));
end $$;
create or replace function public.api_set_linkedin_import(p_enabled boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare ws uuid:=ecod_private.subject_request_admin();begin
 if p_enabled is null then raise exception 'Choose enabled or disabled';end if;
 update public.settings set custom=coalesce(custom,'{}'::jsonb)||jsonb_build_object('linkedinEnrichment',p_enabled) where workspace_id=ws and id='workspace';
 if not found then raise exception 'Configure workspace settings first';end if;
 return p_enabled;
end $$;
create or replace function public.api_reserve_linkedin_lookup() returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();lookup_day date:=(clock_timestamp() at time zone 'UTC')::date;n integer;begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Candidate import permission required' using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);
 if not exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'linkedinEnrichment'='true'::jsonb) then return jsonb_build_object('enabled',false,'allowed',false);end if;
 insert into ecod_private.linkedin_lookup_limits values(ws,lookup_day,0) on conflict do nothing;
 select attempts into n from ecod_private.linkedin_lookup_limits where workspace_id=ws and day=lookup_day for update;
 if n>=20 then return jsonb_build_object('enabled',true,'allowed',false);end if;
 update ecod_private.linkedin_lookup_limits set attempts=attempts+1 where workspace_id=ws and day=lookup_day;
 return jsonb_build_object('enabled',true,'allowed',true);
end $$;
revoke all on function public.api_linkedin_import_status(),public.api_set_linkedin_import(boolean),public.api_reserve_linkedin_lookup() from public,anon,authenticated;
grant execute on function public.api_linkedin_import_status(),public.api_set_linkedin_import(boolean),public.api_reserve_linkedin_lookup() to authenticated;
commit;
