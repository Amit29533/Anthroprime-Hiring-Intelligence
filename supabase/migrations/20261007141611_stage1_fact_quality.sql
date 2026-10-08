begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_repository_private.quality_review(text,jsonb)'::regprocedure);
 if strpos(definition,'employment-fact-review')=0 then
  definition:=replace(definition,'''missing-current-skill-evidence'') then','''missing-current-skill-evidence'',''employment-fact-review'',''availability-fact-review'') then');
  definition:=replace(definition,'), findings as materialized (',$patch$), latest_employment as (
   select distinct on(f.current_id)f.current_id,t.*from identity_family f join public."employmentHistory"t on t.workspace_id=ws and t."candidateId"=f.retained_id where t.verification='confirmed'and t.observed<=day and(t."startDate"is null or t."startDate"<=day)and(t."endDate"is null or t."endDate">=day)and not exists(select 1 from public."employmentHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by f.current_id,t.observed desc,t."recordedAt"desc nulls last,t.id desc
  ),latest_availability as (
   select distinct on(f.current_id)f.current_id,t.*from identity_family f join public."availabilityHistory"t on t.workspace_id=ws and t."candidateId"=f.retained_id where t.verification='confirmed'and t.observed<=day and not exists(select 1 from public."availabilityHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by f.current_id,t.observed desc,t."recordedAt"desc nulls last,t.id desc
  ), findings as materialized ($patch$);
  definition:=replace(definition,'case when ev.current_id is null then ''missing-current-skill-evidence'' end',$patch$case when ev.current_id is null then 'missing-current-skill-evidence' end,
    case when emp.id is null or emp.observed<day-120 or(emp.company,emp.title,emp.location,emp."employmentType")is distinct from(c.company,c.title,c.location,c.engagement)then 'employment-fact-review'end,
    case when avail.id is null or avail.observed<day-120 or(avail.notice,avail."earliestStart",avail.status,avail.mode)is distinct from(c.notice,c."earliestStart",c."activeStatus",c.mode)then'availability-fact-review'end$patch$);
  definition:=replace(definition,'left join current_evidence ev on ev.current_id=c.id where','left join current_evidence ev on ev.current_id=c.id left join latest_employment emp on emp.current_id=c.id left join latest_availability avail on avail.current_id=c.id where');execute definition;
 end if;
end $$;
commit;
