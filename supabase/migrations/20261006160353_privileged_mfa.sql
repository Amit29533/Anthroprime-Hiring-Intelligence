-- D5: opt-in step-up for the covered administrator RPCs, not all application access.
begin;
create or replace function ecod_private.require_privileged_mfa(ws uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.memberships where workspace_id=ws and user_id=auth.uid() and role='admin' for share;
 if not found then return;end if;
 -- Check policy at entry without a settings lock: hold application upgrades
 -- that row after locking its candidate, so an earlier share lock can deadlock.
 perform 1 from public.settings where workspace_id=ws and id='workspace' and custom->'privilegedMfa'='true'::jsonb;
 if found then
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
   raise exception 'Verify your authenticator in Settings before this administrator action' using errcode='42501';
  end if;
 end if;
end $$;
revoke all on function ecod_private.require_privileged_mfa(uuid) from public,anon,authenticated;

create or replace function ecod_private.guard_privileged_mfa_settings() returns trigger
language plpgsql security definer set search_path='' as $$
declare was_enabled boolean:=false;is_enabled boolean:=false;
begin
 if tg_op<>'INSERT' then was_enabled:=old.id='workspace' and coalesce(old.custom->'privilegedMfa'='true'::jsonb,false);end if;
 if tg_op<>'DELETE' then is_enabled:=new.id='workspace' and coalesce(new.custom->'privilegedMfa'='true'::jsonb,false);end if;
 if was_enabled or is_enabled then
  -- Trusted migration/operator sessions have no end-user identity; browser writes are checked.
  if auth.uid() is not null then
   if not public.is_admin() or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception 'Verify your authenticator before changing the MFA policy' using errcode='42501';
   end if;
  end if;
  if tg_op='UPDATE' and was_enabled and (new.id<>old.id or new.workspace_id<>old.workspace_id) then raise exception 'Cannot move MFA workspace settings';end if;
  if is_enabled and (coalesce(new.custom->'auditedDocumentAccess'='true'::jsonb,false)=false or coalesce(new.custom->'auditedCandidateExports'='true'::jsonb,false)=false) then
   raise exception 'Enable audited document access and candidate exports before requiring MFA';
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ecod_private.guard_privileged_mfa_settings() from public,anon,authenticated;
drop trigger if exists privileged_mfa_settings on public.settings;
create trigger privileged_mfa_settings before insert or update or delete on public.settings for each row execute function ecod_private.guard_privileged_mfa_settings();

create or replace function public.api_privileged_mfa_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 if ws is null then raise exception 'Workspace membership required' using errcode='42501';end if;
 return jsonb_build_object('enabled',exists(select 1 from public.settings where workspace_id=ws and id='workspace' and custom->'privilegedMfa'='true'::jsonb));
end $$;
revoke all on function public.api_privileged_mfa_status() from public,anon,authenticated;
grant execute on function public.api_privileged_mfa_status() to authenticated;
create or replace function public.api_set_privileged_mfa(p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 perform 1 from public.memberships where workspace_id=ws and user_id=auth.uid() and role='admin' for share;
 if ws is null or not found then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_enabled is null or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'Verify your authenticator before changing the MFA policy' using errcode='42501';end if;
 update public.settings set custom=coalesce(custom,'{}'::jsonb)||jsonb_build_object('privilegedMfa',p_enabled) where workspace_id=ws and id='workspace';
 if not found then raise exception 'Workspace settings must be configured first';end if;
 return jsonb_build_object('enabled',p_enabled);
end $$;
revoke all on function public.api_set_privileged_mfa(boolean) from public,anon,authenticated;
grant execute on function public.api_set_privileged_mfa(boolean) to authenticated;

create or replace function ecod_private.subject_request_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace();begin
 perform 1 from public.memberships where workspace_id=ws and user_id=auth.uid() and role='admin' for share;
 if ws is null or not found then raise exception 'Administrator access required' using errcode='42501';end if;
 perform ecod_private.require_privileged_mfa(ws);
 return ws;
end $$;
revoke all on function ecod_private.subject_request_admin() from public,anon,authenticated;

-- Keep D4's hold checks and D1/D2 receipt implementations behind private wrappers.
do $$begin
 if to_regprocedure('ecod_private.mfa_export_base(uuid[])') is null then
  alter function public.api_prepare_candidate_export(uuid[]) rename to mfa_export_base;
  alter function public.mfa_export_base(uuid[]) set schema ecod_private;
 end if;
 if to_regprocedure('ecod_private.mfa_document_base(uuid)') is null then
  alter function public.api_begin_document_access(uuid) rename to mfa_document_base;
  alter function public.mfa_document_base(uuid) set schema ecod_private;
 end if;
end $$;
revoke all on function ecod_private.mfa_export_base(uuid[]),ecod_private.mfa_document_base(uuid) from public,anon,authenticated;
create or replace function public.api_prepare_candidate_export(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform ecod_private.require_privileged_mfa(public.current_workspace());
 return ecod_private.mfa_export_base(p_ids);
end $$;
create or replace function public.api_begin_document_access(p_document uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform ecod_private.require_privileged_mfa(public.current_workspace());
 return ecod_private.mfa_document_base(p_document);
end $$;
revoke all on function public.api_prepare_candidate_export(uuid[]),public.api_begin_document_access(uuid) from public,anon,authenticated;
grant execute on function public.api_prepare_candidate_export(uuid[]),public.api_begin_document_access(uuid) to authenticated;
commit;
