-- Candidate-scoped factual edits. Existing history and invalidation triggers remain authoritative.
create or replace function public.api_candidate_profile_context(p_candidate uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select jsonb_build_object('candidateId',id,'token',md5(to_jsonb(c)::text),'fields',
 jsonb_build_object('name',name,'title',title,'company',company,'location',location,'summary',summary,
 'experience',experience,'relevantExperience',"relevantExperience",'notice',notice)) into result
 from public.candidates c where workspace_id=ws and id=p_candidate and "mergedInto" is null;
 if result is null then raise exception 'Candidate not found in your workspace'; end if;
 return result;
end $$;

create or replace function public.api_candidate_profile_edit(p_candidate uuid,p_token text,p_fields jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ws uuid:=public.current_workspace(); person public.candidates; desired jsonb; current_fields jsonb; k text; v jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_token is null or p_token!~'^[0-9a-f]{32}$' or jsonb_typeof(p_fields) is distinct from 'object'
 or octet_length(p_fields::text)>30000 then raise exception 'Invalid profile-edit request'; end if;
 if (select count(*) from jsonb_object_keys(p_fields))<>8 then raise exception 'Supply all editable profile fields'; end if;
 desired:=p_fields;
 for k,v in select * from jsonb_each(p_fields) loop
  if k in ('name','title','company','location','summary') then
   if jsonb_typeof(v)<>'string' or length(p_fields->>k)>(case when k='summary' then 10000 else 300 end) then raise exception 'Invalid text field: %',k; end if;
   desired:=jsonb_set(desired,array[k],to_jsonb(btrim(p_fields->>k)));
  elsif k in ('experience','relevantExperience','notice') then
   if v<>'null'::jsonb and (jsonb_typeof(v)<>'number') then raise exception 'Invalid numeric field: %',k; end if;
   if v<>'null'::jsonb then
    if (v::text)::numeric<0 or (v::text)::numeric>(case when k='notice' then 3650 else 100 end)
    or (k='notice' and (v::text)::numeric<>trunc((v::text)::numeric)) then raise exception 'Invalid numeric range: %',k; end if;
   end if;
  else raise exception 'Field is not editable: %',k;
  end if;
 end loop;
 if desired->>'name'='' then raise exception 'Candidate name is required'; end if;
 if (desired->>'relevantExperience')::numeric>(desired->>'experience')::numeric then raise exception 'Relevant experience exceeds total experience'; end if;
 select * into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto" is null for update;
 if not found then raise exception 'Candidate not found in your workspace'; end if;
 current_fields:=public.api_candidate_profile_context(p_candidate)->'fields';
 if current_fields is distinct from desired then
  if md5(to_jsonb(person)::text)<>p_token then raise exception 'Candidate changed. Reload profile fields before saving.' using errcode='40001'; end if;
  update public.candidates set name=desired->>'name',title=desired->>'title',company=desired->>'company',location=desired->>'location',summary=desired->>'summary',
  experience=(desired->>'experience')::numeric,"relevantExperience"=(desired->>'relevantExperience')::numeric,notice=(desired->>'notice')::integer
  where workspace_id=ws and id=p_candidate;
 end if;
 return public.api_candidate_profile_context(p_candidate);
end $$;
revoke all on function public.api_candidate_profile_context(uuid),public.api_candidate_profile_edit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.api_candidate_profile_context(uuid),public.api_candidate_profile_edit(uuid,text,jsonb) to authenticated;
