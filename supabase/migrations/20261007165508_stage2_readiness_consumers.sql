begin;
create or replace function ecod_journey_private.require_ready(ws uuid,d uuid,c uuid)returns void language plpgsql stable security invoker set search_path=''as $$
declare cfg jsonb:=ecod_journey_private.configuration(ws,d);begin
 if cfg->'body'->'requireReadyForSubmission'='true'::jsonb and(ecod_journey_private.state(ws,d,c)->>'validatedReady')::boolean is distinct from true then raise exception 'Demand-specific validated readiness is missing, expired or needs review'using errcode='42501';end if;
end$$;
create or replace function ecod_journey_private.submission_gate()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if auth.uid()is not null then
  if public.current_workspace()is distinct from new.workspace_id or not public.can_edit_workspace(new.workspace_id)then raise exception 'Editor membership required';end if;
 end if;
 if tg_op='INSERT'or(new."candidateId",new."demandId")is distinct from(old."candidateId",old."demandId")then perform ecod_journey_private.require_ready(new.workspace_id,new."demandId",new."candidateId");end if;
 return new;
end$$;
drop trigger if exists stage2_submission_ready on public.submissions;
create trigger stage2_submission_ready before insert or update on public.submissions for each row execute function ecod_journey_private.submission_gate();
-- All pack preparation, approval and portal current-version checks use the same source function.
-- Include readiness provenance in its fingerprint so expiry/review changes withdraw old shares.
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_client_private.source(uuid,uuid)'::regprocedure);
 if strpos(definition,'Demand-specific validated readiness')=0 then
  definition:=replace(definition,'select * into consent from public.consents',$patch$perform ecod_journey_private.require_ready(ws,d.id,c.id); -- Demand-specific validated readiness
 select * into consent from public.consents$patch$);
  definition:=replace(definition,'jsonb_build_array(s."candidateId",s."demandId",s.notes,s.method,s."clientContact",s."submittedOn"))',$patch$jsonb_build_array(s."candidateId",s."demandId",s.notes,s.method,s."clientContact",s."submittedOn"),case when ecod_journey_private.configuration(ws,d.id)->'body'->'requireReadyForSubmission'='true'::jsonb then ecod_journey_private.state(ws,d.id,c.id)-array['source','head']else null end)$patch$);
  definition:=replace(definition,'''profileStatus'',c.status,''profileVerified'',c.verified,',$patch$'profileStatus',c.status,'profileVerified',c.verified,'demandReadiness',case when ecod_journey_private.configuration(ws,d.id)->'body'->'requireReadyForSubmission'='true'::jsonb then ecod_journey_private.state(ws,d.id,c.id)-array['source','head','decisionId','cycleId']else null end,$patch$);
  execute definition;
 end if;
 definition:=pg_get_functiondef('ecod_client_private.is_current(ecod_client_private.packs)'::regprocedure);
 if strpos(definition,'insufficient_privilege')=0 then definition:=replace(definition,'exception when raise_exception then','exception when raise_exception or insufficient_privilege then');execute definition;end if;
end$$;
revoke all on function ecod_journey_private.require_ready(uuid,uuid,uuid),ecod_journey_private.submission_gate()from public,anon,authenticated;

create or replace function ecod_journey_private.export_report(p_demand uuid,p_operation uuid,p_head text)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(true);request_hash text;prior ecod_journey_private.receipts;data jsonb;result jsonb;begin
 perform ecod_private.require_privileged_mfa(ws);
 if p_demand is null or p_operation is null or p_head is null or p_head!~'^[a-f0-9]{32}$'then raise exception 'Review an aggregate report before exporting';end if;
 perform 1 from public.workspaces where id=ws for update;
 request_hash:=ecod_journey_private.token(ws,jsonb_build_array('report_export',p_demand,p_operation,p_head));
 select *into prior from ecod_journey_private.receipts where workspace_id=ws and actor=auth.uid()and id=p_operation;
 if found then if prior.fingerprint<>request_hash then raise exception 'Report export operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if(select count(*)from ecod_journey_private.receipts r where r.workspace_id=ws and r.actor=auth.uid()and r.result?'reportExport'and r.at>clock_timestamp()-interval'60 seconds')>=6 then raise exception 'Report export limit reached; wait 60 seconds';end if;
 data:=ecod_journey_private.action('report',p_demand,null,null,null,'{}',0);
 if ecod_journey_private.token(ws,data)<>p_head then raise exception 'Report counts changed; refresh and review before export';end if;
 result:=jsonb_build_object('reportExport',true,'snapshot',data,'sha256',encode(sha256(convert_to(data::text,'UTF8')),'hex'),'receiptId',p_operation,'actor',auth.uid(),'preparedAt',clock_timestamp(),'replayed',false);
 insert into ecod_journey_private.receipts(workspace_id,actor,id,demand_id,fingerprint,result)values(ws,auth.uid(),p_operation,p_demand,request_hash,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'demands',p_demand,'server_export','Aggregate demand readiness report '||p_operation::text,auth.uid()::text);return result;
end$$;
create or replace function ecod_journey_private.report_preview(p_demand uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);data jsonb;begin
 data:=ecod_journey_private.action('report',p_demand,null,null,null,'{}',0);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'demands',p_demand,'server_read','Aggregate demand readiness report',auth.uid()::text);
 return jsonb_build_object('snapshot',data,'head',ecod_journey_private.token(ws,data));
end$$;
create or replace function public.api_demand_readiness_report(p_demand uuid)returns jsonb language sql security invoker set search_path=''as $$select ecod_journey_private.report_preview(p_demand)$$;
create or replace function public.api_export_demand_readiness_report(p_demand uuid,p_operation uuid,p_head text)returns jsonb language sql security invoker set search_path=''as $$select ecod_journey_private.export_report(p_demand,p_operation,p_head)$$;
revoke all on function ecod_journey_private.export_report(uuid,uuid,text),ecod_journey_private.report_preview(uuid),public.api_demand_readiness_report(uuid),public.api_export_demand_readiness_report(uuid,uuid,text)from public,anon,authenticated;
grant execute on function ecod_journey_private.export_report(uuid,uuid,text),ecod_journey_private.report_preview(uuid),public.api_demand_readiness_report(uuid),public.api_export_demand_readiness_report(uuid,uuid,text)to authenticated;

commit;
