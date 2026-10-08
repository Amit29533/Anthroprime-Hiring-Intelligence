begin;
-- Extend the existing bounded inventories; retain their source hashes and stale-review checks.
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_private.subject_access_inventory(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'''company,title,startDate,endDate,location,source,verified,created''','''company,title,startDate,endDate,location,employmentType,source,verified,created,observed,recordedAt,verification,verifiedAt,supersedes,appliedCurrent''');
 definition:=replace(definition,'''kind,amount,currency,basis,source,verified''','''kind,amount,currency,basis,components,amountUnit,source,verified,observed,recordedAt,verification,verifiedAt,supersedes,appliedCurrent''');
 definition:=replace(definition,'''notice,earliestStart,status,mode,captured,source,observed,recordedAt''','''notice,earliestStart,status,mode,captured,source,observed,recordedAt,verification,verifiedAt,supersedes,appliedCurrent''');
 definition:=replace(definition,'''role,status,offeredCtc,currency,joiningDate,created,sentOn,acceptedOn''','''role,status,ctc,joining,created,sentDate,decidedDate''');execute definition;
 definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'(''worklistReceipts'',''integrations'')','(''worklistReceipts'',''integrations''),(''duplicateDecisions'',''history''),(''evaluationAssignments'',''records''),(''assignmentReceipts'',''integrations'')');
 definition:=replace(definition,'when ''worklistReceipts'' then ''t.candidate_id=any($1)''','when ''duplicateDecisions'' then ''(t.candidate_a=any($1) or t.candidate_b=any($1))'' when ''evaluationAssignments'' then ''t.kind=''''evaluation'''' and t.target_id=any($1)'' when ''assignmentReceipts'' then ''t.candidate_id=any($1)'' when ''worklistReceipts'' then ''t.candidate_id=any($1)''');
 definition:=replace(definition,'case when d.name=''worklistReceipts'' then ''ecod_worklist_private''','case when d.name in(''duplicateDecisions'',''evaluationAssignments'',''assignmentReceipts'')then''ecod_access_private'' when d.name=''worklistReceipts'' then ''ecod_worklist_private''');
 definition:=replace(definition,'case d.name when ''worklistReceipts'' then ''receipts''','case d.name when ''duplicateDecisions''then''duplicate_events''when''evaluationAssignments''then''assignments''when''assignmentReceipts''then''assignment_receipts'' when ''worklistReceipts'' then ''receipts''');
 -- Earlier browser audit events used singular candidate; include those records as well.
 definition:=replace(definition,'when ''auditEvents'' then ''(t."entityType",t."entityId") in','when ''auditEvents'' then ''(case when t."entityType"=''''candidate''''then''''candidates''''else t."entityType"end,t."entityId") in');execute definition;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 definition:=replace(definition,'and worklist decision receipts','and worklist decision receipts, duplicate review history and limited-access assignment records');execute definition;
end $$;
create or replace function ecod_access_private.audit_candidate_reads(ws uuid,p_rows jsonb,p_source text)
returns void language plpgsql security invoker set search_path=''as $$
begin
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)
 select ws,'candidates',c.id,'server_read',p_source,auth.uid()::text from public.candidates c where c.workspace_id=ws and c.id in(select distinct coalesce(value->>'candidateId',value->>'id')::uuid from jsonb_array_elements(p_rows));
end $$;
revoke all on function ecod_access_private.audit_candidate_reads(uuid,jsonb,text)from public,anon,authenticated;
-- The checked compatibility wrappers record reads after projection. Never trust browser audit calls.
do $$declare spec record;definition text;extra text;begin
 for spec in select p.*from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ecod_access_private'and p.proname in('api_candidate_section_stage1_guard','api_repository_page_stage1_guard','api_candidate_quick_context_stage1_guard','api_candidate_profile_context_stage1_guard','api_candidate_availability_stage1_guard','api_changes_since_stage1_guard','api_changes_page_stage1_guard')loop
  definition:=pg_get_functiondef(spec.oid);
  if strpos(definition,'audit_candidate_reads')=0 then
   extra:=case
    when spec.proname='api_repository_page_stage1_guard'then 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),coalesce(result->''rows'',''[]''),''Repository page'');'
    when spec.proname in('api_changes_since_stage1_guard','api_changes_page_stage1_guard')then 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),coalesce(result->''candidates'',''[]''),''Change feed'');'
    else 'perform ecod_access_private.audit_candidate_reads(public.current_workspace(),jsonb_build_array(jsonb_build_object(''id'',p_candidate)),''Candidate context'');'end;
   definition:=replace(definition,'return case when public.is_admin()',extra||'return case when public.is_admin()');execute definition;
  end if;
 end loop;
 definition:=pg_get_functiondef('ecod_access_private.legacy_rows(text,integer,integer)'::regprocedure);
 if strpos(definition,'audit_candidate_reads')=0 then
  definition:=replace(definition,'return jsonb_build_object(''rows''','if p_table=''candidates''then perform ecod_access_private.audit_candidate_reads(ws,result,''Legacy repository read'');end if;return jsonb_build_object(''rows''');execute definition;
 end if;
end $$;
commit;
