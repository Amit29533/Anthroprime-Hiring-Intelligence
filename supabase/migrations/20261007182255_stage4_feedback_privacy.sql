begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('ecod_private.erasure_inventory(uuid,uuid)'::regprocedure);
 if strpos(definition,'feedbackGrants')=0 then
  definition:=replace(definition,'(''communicationReceipts'',''integrations'')','(''communicationReceipts'',''integrations''),(''feedbackGrants'',''records''),(''feedbackProposals'',''records''),(''feedbackPrompts'',''records''),(''feedbackResponses'',''records''),(''feedbackReceipts'',''integrations'')');
  definition:=replace(definition,'predicate:=case d.name','predicate:=case d.name when ''feedbackGrants''then''t.candidate_id=any($1)''when''feedbackProposals''then''t.candidate_id=any($1)''when''feedbackPrompts''then''t.candidate_id=any($1)''when''feedbackResponses''then''t.candidate_id=any($1)''when''feedbackReceipts''then''t.candidate_id=any($1)''');
  definition:=replace(definition,'case when d.name in(''communicationPreferences''','case when d.name in(''feedbackGrants'',''feedbackProposals'',''feedbackPrompts'',''feedbackResponses'',''feedbackReceipts'')then''ecod_feedback_private'' when d.name in(''communicationPreferences''');
  definition:=replace(definition,'case d.name when''communicationPreferences''','case d.name when''feedbackGrants''then''grants''when''feedbackProposals''then''proposals''when''feedbackPrompts''then''prompts''when''feedbackResponses''then''responses''when''feedbackReceipts''then''receipts'' when''communicationPreferences''');execute definition;
 end if;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 if strpos(definition,'candidate feedback grants')=0 then definition:=replace(definition,'communication test intents, preferences, attempts and recovery receipts','communication test intents, preferences, attempts and recovery receipts, candidate feedback grants, profile proposals, scoped prompts, survey responses and their operation receipts');execute definition;end if;
end$$;
commit;
