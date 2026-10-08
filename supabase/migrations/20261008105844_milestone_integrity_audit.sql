begin;

-- Preserve existing grants and Stage 5 actor checks while making nullable worker
-- predicates reject incomplete input at the gate rather than a later constraint.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'ecod_external_private.api(text,uuid,uuid,text,jsonb,integer)',
    'ecod_external_private.worker(text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition, 's->''eligible''<>''true''::jsonb', 's->''eligible'' is distinct from ''true''::jsonb');
    definition := replace(definition, 'ecod_external_private.allowed(w)->''eligible''<>''true''::jsonb', 'ecod_external_private.allowed(w)->''eligible'' is distinct from ''true''::jsonb');
    definition := replace(definition, '(p->>''generation'')::integer<>w.generation', '(p->>''generation'')::integer is distinct from w.generation');
    definition := replace(definition, 'if p->>''outcome''not in', 'if coalesce(p->>''outcome'','''')not in');
    definition := replace(definition, 'or p->>''state''not in', 'or coalesce(p->>''state'','''')not in');
    execute definition;
  end loop;
end $$;

-- Retained approval evidence must be visible to the next administrator reviewing
-- the plan, without exposing the private operation journal to ordinary clients.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('ecod_enterprise_private.api(text,uuid,text,jsonb,integer)'::regprocedure);
  if strpos(definition, '''approval''') = 0 then
    definition := replace(definition,
      '''plan'',to_jsonb(w),''head'',ecod_enterprise_private.plan_head(w)',
      '''plan'',to_jsonb(w),''approval'',(select jsonb_build_object(''actor'',r.actor,''at'',r.at,''evidence'',r.request->''payload''->>''evidence'') from ecod_enterprise_private.receipts r where r.workspace_id=ws and r.request->>''action''=''approve'' and r.request->''payload''->>''id''=w.id::text order by r.at desc,r.id limit 1),''head'',ecod_enterprise_private.plan_head(w)');
    execute definition;
  end if;
end $$;
commit;
