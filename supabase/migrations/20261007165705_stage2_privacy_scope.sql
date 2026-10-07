begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
 if strpos(definition,'journeyClaims')=0 then
  definition:=replace(definition,'(''worklistReceipts'',''integrations'')','(''worklistReceipts'',''integrations''),(''journeyClaims'',''records''),(''journeyCycles'',''records''),(''journeyEvaluations'',''records''),(''journeyDebriefs'',''records''),(''journeyGaps'',''records''),(''journeyDecisions'',''history''),(''journeyReceipts'',''integrations'')');
  definition:=replace(definition,'predicate:=case d.name','predicate:=case d.name when ''journeyClaims''then''t.candidate_id=any($1)''when''journeyCycles''then''t.candidate_id=any($1)''when''journeyEvaluations''then''t.candidate_id=any($1)''when''journeyDebriefs''then''t.candidate_id=any($1)''when''journeyGaps''then''t.candidate_id=any($1)''when''journeyDecisions''then''t.candidate_id=any($1)''when''journeyReceipts''then''t.candidate_id=any($1)''');
  definition:=replace(definition,'case when d.name in(''duplicateDecisions''','case when d.name in(''journeyClaims'',''journeyCycles'',''journeyEvaluations'',''journeyDebriefs'',''journeyGaps'',''journeyDecisions'',''journeyReceipts'')then''ecod_journey_private'' when d.name in(''duplicateDecisions''');
  definition:=replace(definition,'case d.name when ''duplicateDecisions''','case d.name when''journeyClaims''then''claims''when''journeyCycles''then''cycles''when''journeyEvaluations''then''evaluations''when''journeyDebriefs''then''debriefs''when''journeyGaps''then''gap_events''when''journeyDecisions''then''decisions''when''journeyReceipts''then''receipts'' when ''duplicateDecisions''');execute definition;
 end if;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 if strpos(definition,'demand journey evidence')=0 then definition:=replace(definition,'and limited-access assignment records','and limited-access assignment records, demand journey evidence, blind scorecards, gap plans and demand-specific validator history');execute definition;end if;
end$$;
commit;
