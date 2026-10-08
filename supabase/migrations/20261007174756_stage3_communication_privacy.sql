begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
 if strpos(definition,'communicationPreferences')=0 then
  definition:=replace(definition,'(''journeyReceipts'',''integrations'')','(''journeyReceipts'',''integrations''),(''communicationPreferences'',''records''),(''communicationIntents'',''records''),(''communicationAttempts'',''history''),(''communicationReceipts'',''integrations'')');
  definition:=replace(definition,'predicate:=case d.name','predicate:=case d.name when ''communicationPreferences''then''t.candidate_id=any($1)''when''communicationIntents''then''t.candidate_id=any($1)''when''communicationAttempts''then''t.candidate_id=any($1)''when''communicationReceipts''then''t.candidate_id=any($1)''');
  definition:=replace(definition,'case when d.name in(''journeyClaims''','case when d.name in(''communicationPreferences'',''communicationIntents'',''communicationAttempts'',''communicationReceipts'')then''ecod_comms_private'' when d.name in(''journeyClaims''');
  definition:=replace(definition,'case d.name when''journeyClaims''','case d.name when''communicationPreferences''then''preferences''when''communicationIntents''then''intents''when''communicationAttempts''then''attempts''when''communicationReceipts''then''receipts'' when''journeyClaims''');execute definition;
 end if;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 if strpos(definition,'communication test intents')=0 then definition:=replace(definition,'demand-specific validator history','demand-specific validator history, communication test intents, preferences, attempts and recovery receipts');execute definition;end if;
end$$;
commit;
