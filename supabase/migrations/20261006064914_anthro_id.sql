-- Permanent candidate identity. Additive migration: existing UUID foreign keys and
-- workspace access policies remain authoritative. Full UUIDs avoid prefix collisions.
begin;
alter table public.candidates add column if not exists "anthroId" text
  generated always as ('ANTHRO-' || upper(id::text)) stored not null;
create unique index if not exists candidates_anthro_id_unique on public.candidates("anthroId");

-- A retired merge tombstone keeps its identity while releasing contact details.
-- Active profiles still require an email or phone, as before.
alter table public.candidates drop constraint if exists candidates_check;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.candidates'::regclass
    and conname='candidates_contact_or_merged') then
    alter table public.candidates add constraint candidates_contact_or_merged
      check ("mergedInto" is not null or email<>'' or phone<>'');
  end if;
end $$;

-- The underlying UUID must stay fixed too, including for profiles with no linked rows.
create or replace function public.guard_candidate_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Candidate identity and Anthro-ID cannot be changed' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_candidate_identity() from public,anon,authenticated;
drop trigger if exists guard_candidate_identity on public.candidates;
create trigger guard_candidate_identity before update on public.candidates
for each row execute function public.guard_candidate_identity();

-- Exact lookup with RLS and active-workspace isolation, including retired merge IDs.
-- IDs are identifiers, never credentials. A caller still needs workspace access.
create or replace function public.api_candidate_by_anthro_id(p_anthro_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  with recursive chain as (
    select c.id,c."anthroId",c."mergedInto",array[c.id] as visited
    from public.candidates c
    where c.workspace_id=public.current_workspace()
      and c."anthroId"=upper(btrim(p_anthro_id))
    union all
    select c.id,c."anthroId",c."mergedInto",chain.visited||c.id
    from chain join public.candidates c on c.id=chain."mergedInto"
    where c.workspace_id=public.current_workspace() and not c.id=any(chain.visited)
  )
  select jsonb_build_object('candidateId',id,'anthroId',"anthroId",
    'matchedAnthroId',upper(btrim(p_anthro_id)))
  from chain where "mergedInto" is null limit 1
$$;
revoke all on function public.api_candidate_by_anthro_id(text) from public,anon;
grant execute on function public.api_candidate_by_anthro_id(text) to authenticated;

-- Preserve the portal's curated projection and email-authenticated ownership check.
create or replace function public.api_portal_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.portal_candidate_id();
  c public.candidates%rowtype;
begin
  if me is null then
    return jsonb_build_object('error','no candidate profile is linked to this account');
  end if;
  select * into c from public.candidates where id = me;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', c.id, 'anthroId', c."anthroId", 'name', c.name, 'title', c.title, 'location', c.location,
      'mode', c.mode, 'engagement', c.engagement, 'notice', c.notice,
      'earliestStart', c."earliestStart", 'activeStatus', c."activeStatus",
      'expected', c.expected, 'preferredLocations', c."preferredLocations",
      'timezone', c.timezone, 'skills', to_jsonb(c.skills), 'skillsDetail', c."skillsDetail",
      'summary', c.summary),
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'demand', d.title, 'client', d.client, 'stage', k.stage, 'updated', k.updated) order by k.updated desc),
        '[]'::jsonb)
      from public.considerations k join public.demands d on d.id = k."demandId"
      where k."candidateId" = me),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'demand', d.title, 'client', d.client, 'status', s."clientStatus", 'submittedOn', s."submittedOn")
        order by s."submittedOn" desc), '[]'::jsonb)
      from public.submissions s join public.demands d on d.id = s."demandId"
      where s."candidateId" = me),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'round', i.round, 'mode', i.mode, 'scheduledAt', i."scheduledAt", 'status', i.status)
        order by i."scheduledAt" desc), '[]'::jsonb)
      from public.interviews i where i."candidateId" = me),
    'offers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', o.role, 'status', o.status, 'ctc', o.ctc, 'joining', o.joining)
        order by o.created desc), '[]'::jsonb)
      from public.offers o where o."candidateId" = me),
    'consents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cn.id, 'purpose', cn.purpose, 'status', cn.status, 'date', cn.date)
        order by cn.date desc), '[]'::jsonb)
      from public.consents cn where cn."candidateId" = me)
  );
end $$;


revoke all on function public.api_portal_overview() from public,anon;
grant execute on function public.api_portal_overview() to authenticated;

-- Integration receipts include the permanent identity, including replays recorded
-- before this migration. Candidate payload fields remain the existing allowlist.
create or replace function public.api_integrate_candidate(p_source text,p_external_id text,p_key text,p_candidate jsonb,p_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); req jsonb; cached jsonb; mapping record; cid uuid; col text; val jsonb; document public.candidates; result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_source is null or length(p_source) not between 1 and 100 or p_external_id is null or length(p_external_id) not between 1 and 200 or p_key is null or length(p_key) not between 8 and 200 then raise exception 'Source, external ID and idempotency key are required'; end if;
 if jsonb_typeof(p_candidate) is distinct from 'object' or octet_length(p_candidate::text)>30000 then raise exception 'Invalid candidate payload'; end if;
 for col,val in select * from jsonb_each(p_candidate) loop
  if col not in ('name','email','phone','title','company','location','skills','status','mode','source','summary','linkedin','owner','experience','notice','engagement') then raise exception 'Unsupported candidate field: %',col; end if;
 end loop;
 req:=jsonb_build_object('source',p_source,'externalId',p_external_id,'candidate',p_candidate,'version',p_version);
 insert into public."integrationReceipts"(workspace_id,key,request) values(ws,p_key,req) on conflict do nothing;
 select request,response into cached,result from public."integrationReceipts" where workspace_id=ws and key=p_key for update;
 if cached is distinct from req then raise exception 'Idempotency key was used for a different request' using errcode='23505'; end if;
 if result is not null then return result||jsonb_build_object('replayed',true); end if;
 -- Serialize only this workspace/source/external ID; concurrent new keys cannot duplicate it.
 perform pg_advisory_xact_lock(hashtext(ws::text||p_source),hashtext(p_external_id));
 select * into mapping from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id;
 if found then
  cid:=mapping."candidateId";
  select * into document from public.candidates where workspace_id=ws and id=cid for update;
  -- Match the UI's candidate-before-mapping lock order and recheck after waiting.
  select * into mapping from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id for update;
  if p_version is null or p_version<>mapping.version or mapping."candidateId"<>cid then raise exception 'External record version conflict' using errcode='40001'; end if;
  if document."mergedInto" is not null then raise exception 'Candidate was merged; reconcile the external mapping' using errcode='40001'; end if;
  document:=jsonb_populate_record(document,p_candidate);
  perform public.validate_integration_candidate(document);
  update public.candidates set name=document.name,email=document.email,phone=document.phone,title=document.title,company=document.company,location=document.location,skills=document.skills,status=document.status,mode=document.mode,source=document.source,summary=document.summary,linkedin=document.linkedin,owner=document.owner,experience=document.experience,notice=document.notice,engagement=document.engagement where workspace_id=ws and id=cid;
  -- The candidate update trigger increments every mapping, including edits made in the UI.
  select version into p_version from public."externalMappings" where workspace_id=ws and source=p_source and "externalId"=p_external_id;
 else
  if p_version is not null and p_version<>0 then raise exception 'External record does not exist' using errcode='40001'; end if;
  document:=jsonb_populate_record(null::public.candidates,p_candidate);
  perform public.validate_integration_candidate(document);
  insert into public.candidates(workspace_id,name,email,phone,title,company,location,skills,status,mode,source,summary,linkedin,owner,experience,notice,engagement)
  values(ws,document.name,coalesce(document.email,''),coalesce(document.phone,''),coalesce(document.title,''),coalesce(document.company,''),coalesce(document.location,''),coalesce(document.skills,'{}'),coalesce(document.status,'Assessing'),coalesce(document.mode,'Flexible'),coalesce(document.source,p_source),coalesce(document.summary,''),coalesce(document.linkedin,''),coalesce(document.owner,''),document.experience,document.notice,coalesce(document.engagement,'')) returning id into cid;
  insert into public."externalMappings"(workspace_id,source,"externalId","candidateId") values(ws,p_source,p_external_id,cid);
  p_version:=1;
 end if;
 result:=jsonb_build_object('candidateId',cid,'anthroId',(select "anthroId" from public.candidates where id=cid and workspace_id=ws),'version',p_version,'replayed',false);
 update public."integrationReceipts" set response=result where workspace_id=ws and key=p_key;
 return result;
end $$;
revoke all on function public.api_integrate_candidate(text,text,text,jsonb,integer) from public,anon;
grant execute on function public.api_integrate_candidate(text,text,text,jsonb,integer) to authenticated;


update public."integrationReceipts" r set response = r.response ||
  jsonb_build_object('anthroId',c."anthroId")
from public.candidates c where r.workspace_id=c.workspace_id
  and r.response->>'candidateId'=c.id::text and not r.response ? 'anthroId';

-- Lifecycle events expose the same identity without exposing the candidate profile.
create or replace function public.enqueue_integration_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare envelope jsonb; payload jsonb; cid uuid;
begin
  payload:=to_jsonb(new);
  cid:=case when tg_table_name='candidates' then new.id
    else nullif(payload->>'candidateId','')::uuid end;
  envelope:=jsonb_build_object('id',gen_random_uuid(),
    'type',tg_table_name||'.'||lower(tg_op),'workspaceId',new.workspace_id,
    'occurredAt',now(),'data',jsonb_build_object('id',new.id));
  if cid is not null then
    envelope:=jsonb_set(envelope,'{data}',envelope->'data'||jsonb_build_object(
      'candidateId',cid,'anthroId',(select "anthroId" from public.candidates
        where id=cid and workspace_id=new.workspace_id)));
    if tg_table_name='candidates' and payload->>'mergedInto' is not null then
      envelope:=jsonb_set(envelope,'{data}',envelope->'data'||jsonb_build_object(
        'mergedInto',payload->>'mergedInto','survivingAnthroId',
        (select "anthroId" from public.candidates where id=new."mergedInto" and workspace_id=new.workspace_id)));
    end if;
  end if;
  insert into public."webhookDeliveries"(workspace_id,subscription_id,event)
    select new.workspace_id,s.id,envelope from public."webhookSubscriptions" s
    where s.workspace_id=new.workspace_id and s.enabled;
  return new;
end $$;
revoke all on function public.enqueue_integration_event() from public,anon,authenticated;
-- Extend the existing webhook mechanism to training, evidence, and deployment.
do $$ declare tbl text; begin
  foreach tbl in array array['assessments','enrichment','placements','submissions','referrals'] loop
    execute format('drop trigger if exists integration_event on public.%I',tbl);
    execute format('create trigger integration_event after insert or update on public.%I for each row execute function public.enqueue_integration_event()',tbl);
  end loop;
end $$;
commit;
