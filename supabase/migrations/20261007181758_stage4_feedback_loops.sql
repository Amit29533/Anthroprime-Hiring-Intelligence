begin;
create schema if not exists ecod_feedback_private;
revoke all on schema ecod_feedback_private from public,anon,authenticated;
grant usage on schema ecod_feedback_private to authenticated;
create table if not exists ecod_feedback_private.grants(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,user_id uuid not null references auth.users(id),
 expires_at timestamptz not null,revoked_at timestamptz,actor uuid not null,reason text not null,at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create index if not exists feedback_grant_user on ecod_feedback_private.grants(user_id,expires_at)where revoked_at is null;
create index if not exists feedback_grant_candidate on ecod_feedback_private.grants(workspace_id,candidate_id,at desc,id);
create table if not exists ecod_feedback_private.proposals(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,actor uuid not null,base jsonb not null,head text not null,fields jsonb not null,
 reason text not null,status text not null default 'Pending' check(status in('Pending','Accepted','Rejected','Withdrawn')),
 reviewed_by uuid,review_reason text,reviewed_at timestamptz,at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create index if not exists feedback_proposal_queue on ecod_feedback_private.proposals(workspace_id,status,at desc,id);
create index if not exists feedback_proposal_candidate on ecod_feedback_private.proposals(workspace_id,candidate_id,at desc,id);
create table if not exists ecod_feedback_private.prompts(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid,client_id uuid,demand_id uuid,recipient uuid not null references auth.users(id),
 kind text not null check(kind in('freshness','redeployment','survey')),question text not null,source jsonb not null,source_head text not null,
 expires_at timestamptz not null,status text not null default 'Open' check(status in('Open','Responded','Cancelled')),
 actor uuid not null,reason text not null,at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id),foreign key(workspace_id,client_id)references public.clients(workspace_id,id),
 foreign key(workspace_id,demand_id)references public.demands(workspace_id,id),check((candidate_id is null)<>(client_id is null)),unique(workspace_id,id));
create index if not exists feedback_prompt_recipient on ecod_feedback_private.prompts(recipient,at desc,id);
create index if not exists feedback_prompt_candidate on ecod_feedback_private.prompts(workspace_id,candidate_id,at desc,id);
create index if not exists feedback_prompt_client on ecod_feedback_private.prompts(workspace_id,client_id,at desc,id);
create table if not exists ecod_feedback_private.responses(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid,client_id uuid,prompt_id uuid not null unique,actor uuid not null,body jsonb not null,
 disposition text not null default 'Pending' check(disposition in('Pending','Actioned','Dismissed')),reviewed_by uuid,review_reason text,reviewed_at timestamptz,
 at timestamptz not null default clock_timestamp(),foreign key(workspace_id,prompt_id)references ecod_feedback_private.prompts(workspace_id,id));
create index if not exists feedback_response_queue on ecod_feedback_private.responses(workspace_id,disposition,at desc,id);
create index if not exists feedback_response_candidate on ecod_feedback_private.responses(workspace_id,candidate_id,at desc,id);
create index if not exists feedback_response_client on ecod_feedback_private.responses(workspace_id,client_id,at desc,id);
create table if not exists ecod_feedback_private.receipts(
 workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid,client_id uuid,request jsonb not null,result jsonb not null,
 at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
do $$declare n text;begin foreach n in array array['grants','proposals','prompts','responses','receipts']loop
 execute format('alter table ecod_feedback_private.%I enable row level security',n);execute format('revoke all on ecod_feedback_private.%I from public,anon,authenticated',n);end loop;end$$;

-- The baseline is curated and opaque: no contact, salary, internal notes or verification claims.
create or replace function ecod_feedback_private.fields(ws uuid,c uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare result jsonb;begin
 select jsonb_build_object('name',name,'title',title,'company',company,'location',location,'summary',summary,'experience',experience,
 'relevantExperience',"relevantExperience",'notice',notice,'earliestStart',"earliestStart",'activeStatus',"activeStatus",'mode',mode,
 'engagement',engagement,'preferredLocations',"preferredLocations")into result from public.candidates where workspace_id=ws and id=c and "mergedInto"is null;
 if octet_length(result::text)>16000 then raise exception 'Profile context exceeds safe review size. Ask for an internal profile correction.';end if;return result;
end
$$;
create or replace function ecod_feedback_private.validate_fields(p jsonb)returns jsonb language plpgsql immutable security invoker set search_path=''as $$
declare k text;v jsonb;result jsonb:='{}';n numeric;day date;begin
 if jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>16000 or(select count(*)from jsonb_object_keys(p))not between 1 and 15 then raise exception 'Supply bounded proposed profile fields';end if;
 for k,v in select *from jsonb_each(p)loop
  if k in('contactEmail','contactPhone')then
   if jsonb_typeof(v)is distinct from'string'then raise exception 'Invalid proposed contact';end if;
   perform ecod_contacts_private.normalize_contact(case when k='contactEmail'then'email'else'phone'end,p->>k);v:=to_jsonb(btrim(p->>k));
  elsif k in('name','title','company','location','summary','engagement','preferredLocations','activeStatus','mode')then
   if jsonb_typeof(v)is distinct from'string'or length(p->>k)>(case when k='summary'then 10000 else 300 end)then raise exception 'Invalid proposed text: %',k;end if;
   v:=to_jsonb(btrim(p->>k));
   if k='name'and v='""'::jsonb or k='activeStatus'and v#>>'{}'not in('Active','Passive')or k='mode'and v#>>'{}'not in('Flexible','Remote','Hybrid','Onsite')then raise exception 'Invalid proposed choice: %',k;end if;
  elsif k in('experience','relevantExperience','notice')then
   if v<>'null'::jsonb then
    if jsonb_typeof(v)<>'number'then raise exception 'Invalid proposed number: %',k;end if;n:=(v::text)::numeric;
    if n<0 or n>(case when k='notice'then 365 else 100 end)or(k='notice'and n<>trunc(n))then raise exception 'Invalid proposed range: %',k;end if;
   end if;
  elsif k='earliestStart'then
   if v<>'null'::jsonb then
    if jsonb_typeof(v)<>'string'or(v#>>'{}')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'Invalid proposed date';end if;
    day:=(v#>>'{}')::date;if day::text<>v#>>'{}'then raise exception 'Invalid proposed date';end if;
   end if;
  else raise exception 'Field is not self-editable: %',k;end if;
  result:=result||jsonb_build_object(k,v);
 end loop;return result;
end$$;
create or replace function ecod_feedback_private.candidate_access(ws uuid,c uuid)returns void language plpgsql volatile security invoker set search_path=''as $$
begin
 if auth.uid()is null or not exists(select 1 from public.candidates where workspace_id=ws and id=c and "mergedInto"is null)then raise exception 'Candidate access unavailable'using errcode='42501';end if;
 perform 1 from ecod_feedback_private.grants where workspace_id=ws and candidate_id=c and user_id=auth.uid()and revoked_at is null and expires_at>clock_timestamp()for share;
 if not found then raise exception 'Candidate access unavailable'using errcode='42501';end if;
end$$;
create or replace function ecod_feedback_private.client_access(ws uuid,c uuid,d uuid)returns void language plpgsql volatile security invoker set search_path=''as $$
begin
 if auth.uid()is null then raise exception 'Client access unavailable'using errcode='42501';end if;
 perform 1 from ecod_client_private.members where workspace_id=ws and client_id=c and user_id=auth.uid()and active and expires_at>clock_timestamp()and(demand_id is null or demand_id=d)for share;
 if not found then raise exception 'Client access unavailable'using errcode='42501';end if;
end$$;
create or replace function ecod_feedback_private.prompt_source(ws uuid,c uuid,client_scope uuid,d uuid,kind text)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare person public.candidates;demand jsonb;placements jsonb;consent jsonb;pref jsonb;begin
 if c is not null then
  select *into person from public.candidates where workspace_id=ws and id=c and "mergedInto"is null and not "processingRestricted"and status<>'Unavailable';
  if not found then raise exception 'Candidate recruiting access unavailable';end if;
  select to_jsonb(x)into consent from public.consents x where workspace_id=ws and "candidateId"=c and purpose='recruiting-contact'order by date desc,(status<>'granted')desc,id desc limit 1;
  select body into pref from ecod_comms_private.preferences where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,c))and purpose='recruiting-contact'order by sequence desc limit 1;
  if consent->>'status'is distinct from'granted'or(consent->>'date')::timestamptz>clock_timestamp()or pref->'optOut'='true'::jsonb then raise exception 'Recruiting consent or preferences suppress this prompt';end if;
  if kind='redeployment'then
   select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]')into placements from(select id,status,"endDate"from public.placements where workspace_id=ws and "candidateId"=any(ecod_access_private.identity_family(ws,c))and status in('Active','Completed')and "endDate"is not null and "endDate"between(current_date-180)and(current_date+30)order by id limit 101)x;
   if jsonb_array_length(placements)not between 1 and 100 then raise exception 'Redeployment requires a placement ending within 30 days or ended within 180 days';end if;
  end if;
 elsif client_scope is null or kind<>'survey'or not exists(select 1 from public.clients where workspace_id=ws and id=client_scope)then raise exception 'Client survey context unavailable';end if;
 if d is not null then
  select jsonb_build_object('id',id,'title',left(title,300),'status',status)into demand from public.demands where workspace_id=ws and id=d and(client_scope is null or "clientId"=client_scope);
  if demand is null then raise exception 'Demand context unavailable';end if;
 end if;
 if kind='redeployment'and(d is null or demand->>'status'not in('Open','In progress'))then raise exception 'Choose an open redeployment demand';end if;
 return jsonb_build_object('profile',case when c is not null then ecod_feedback_private.fields(ws,c)end,'demand',demand,'placements',placements,'consent',consent,'preference',pref);
end$$;

-- Full members administer the journal. Every change shares the workspace->candidate lock order.
create or replace function ecod_feedback_private.prompt_current(p ecod_feedback_private.prompts)returns boolean language plpgsql stable security invoker set search_path=''as $$
begin
 if p.expires_at<=statement_timestamp()or not exists(select 1 from public.memberships where workspace_id=p.workspace_id and user_id=p.actor and role in('admin','recruiter'))then return false;end if;
 if p.candidate_id is not null then
  if not exists(select 1 from ecod_feedback_private.grants where workspace_id=p.workspace_id and candidate_id=p.candidate_id and user_id=p.recipient and revoked_at is null and expires_at>statement_timestamp())then return false;end if;
 elsif not exists(select 1 from ecod_client_private.members where workspace_id=p.workspace_id and client_id=p.client_id and user_id=p.recipient and active and expires_at>statement_timestamp()and(demand_id is null or demand_id=p.demand_id))then return false;end if;
 return p.source=ecod_feedback_private.prompt_source(p.workspace_id,p.candidate_id,p.client_id,p.demand_id,p.kind);
exception when raise_exception then return false;
end$$;
create or replace function ecod_feedback_private.staff(p_action text,p_candidate uuid,p_client uuid,p_id uuid,p_operation uuid,p_head text,p_payload jsonb,p_offset integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(p_action<>'context');prior ecod_feedback_private.receipts;req jsonb;result jsonb;rows jsonb;grants jsonb;proposals jsonb;prompts jsonb;responses jsonb;person public.candidates;proposal ecod_feedback_private.proposals;prompt ecod_feedback_private.prompts;response ecod_feedback_private.responses;data jsonb;source jsonb;fields jsonb;patch jsonb;target_user uuid;expires timestamptz;review_note text;k text;sets text;family uuid[];begin
 if p_action is null or p_action not in('context','grant','revoke','preview','invite','review','cancel','triage')or p_offset is null or p_offset not between 0 and 1000000
 or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>20000 or (p_candidate is null and p_client is null)or(p_candidate is not null and p_client is not null)then raise exception 'Invalid feedback scope or request';end if;
 perform 1 from public.workspaces where id=ws for update;
 if p_candidate is not null then
  select *into person from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto"is null for update;
  if not found then raise exception 'Candidate unavailable';end if;family:=ecod_access_private.identity_family(ws,p_candidate);
 elsif not exists(select 1 from public.clients where workspace_id=ws and id=p_client)then raise exception 'Client unavailable';end if;
 if p_action='context'then
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into proposals from(select p.id,p.candidate_id,p.actor,p.base,p.fields,p.reason,p.status,p.reviewed_by,p.review_reason,p.reviewed_at,p.at,
   ecod_journey_private.token(ws,to_jsonb(p))as "reviewHead"from ecod_feedback_private.proposals p where workspace_id=ws and candidate_id=any(family)order by at desc,id offset p_offset limit 26)x;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into prompts from(select p.id,p.candidate_id,p.client_id,p.recipient,p.kind,p.question,p.expires_at,p.status,p.at,
   case when p.status='Open'and p.expires_at<=clock_timestamp()then'Expired'when p.status='Open'and not ecod_feedback_private.prompt_current(p)then'Suppressed or stale'else p.status end as state from ecod_feedback_private.prompts p where workspace_id=ws and((p_candidate is not null and candidate_id=any(family))or(client_id=p_client))order by at desc,id offset p_offset limit 26)x;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into responses from(select r.*,ecod_journey_private.token(ws,to_jsonb(r))as "reviewHead"from ecod_feedback_private.responses r where workspace_id=ws and((p_candidate is not null and candidate_id=any(family))or client_id=p_client)order by at desc,id offset p_offset limit 26)x;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into grants from(select g.id,g.user_id,g.expires_at,g.revoked_at,g.reason,g.at from ecod_feedback_private.grants g where workspace_id=ws and candidate_id=any(family)order by at desc,id offset p_offset limit 26)x;
  data:=case when p_candidate is not null then ecod_feedback_private.fields(ws,p_candidate)end;
  if p_candidate is not null then perform ecod_access_private.audit_candidate_reads(ws,jsonb_build_array(jsonb_build_object('id',p_candidate)),'feedback journal');end if;
  return jsonb_build_object('fields',data,'head',ecod_journey_private.token(ws,data),'grants',case when jsonb_array_length(grants)>25 then grants-25 else grants end,
   'proposals',case when jsonb_array_length(proposals)>25 then proposals-25 else proposals end,'prompts',case when jsonb_array_length(prompts)>25 then prompts-25 else prompts end,
   'responses',case when jsonb_array_length(responses)>25 then responses-25 else responses end,'more',greatest(jsonb_array_length(grants),jsonb_array_length(proposals),jsonb_array_length(prompts),jsonb_array_length(responses))>25,
   'demands',coalesce((select jsonb_agg(to_jsonb(x))from(select id,left(title,300)title from public.demands where workspace_id=ws and(p_client is null or "clientId"=p_client)and status in('Open','In progress')and title ilike'%'||left(coalesce(p_payload->>'query',''),200)||'%'order by title,id limit 100)x),'[]'),
   'recipients',case when p_client is not null then coalesce((select jsonb_agg(to_jsonb(x))from(select distinct m.user_id,m.demand_id,m.expires_at from ecod_client_private.members m where workspace_id=ws and client_id=p_client and active and expires_at>clock_timestamp()order by user_id limit 100)x),'[]')else'[]'::jsonb end,
   'surveySummary',(select jsonb_build_object('responses',count(*),'averageRating',round(avg((r.body->>'rating')::numeric),2),'pendingReview',count(*)filter(where r.disposition='Pending'))from ecod_feedback_private.responses r join ecod_feedback_private.prompts p on p.workspace_id=r.workspace_id and p.id=r.prompt_id where r.workspace_id=ws and p.kind='survey'and((r.candidate_id=any(family))or r.client_id=p_client)));
 end if;
 if p_action<>'preview'then
  if p_operation is null then raise exception 'An operation ID is required';end if;
  req:=jsonb_build_array(p_action,p_candidate,p_client,p_id,p_head,p_payload);
  select *into prior from ecod_feedback_private.receipts where workspace_id=ws and actor=auth.uid()and id=p_operation;
  if found then if prior.request<>req then raise exception 'Feedback operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 end if;
 if p_action in('preview','invite')then
  if exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['recipient','kind','question','demand','expiresAt','reason']))or coalesce(p_payload->>'kind','')not in('freshness','redeployment','survey')or jsonb_typeof(p_payload->'question')is distinct from'string'or length(btrim(p_payload->>'question'))not between 10 and 500 then raise exception 'Invalid prompt content';end if;
  target_user:=(p_payload->>'recipient')::uuid;expires:=(p_payload->>'expiresAt')::timestamptz;
  if target_user is null or expires is null or expires not between clock_timestamp()+interval'5 minutes'and clock_timestamp()+interval'30 days'then raise exception 'Choose a recipient and expiry within 30 days';end if;
  if p_candidate is not null then
   if not exists(select 1 from ecod_feedback_private.grants where workspace_id=ws and candidate_id=p_candidate and user_id=target_user and revoked_at is null and expires_at>=expires)then raise exception 'Recipient needs a candidate grant covering the invitation';end if;
  elsif not exists(select 1 from ecod_client_private.members where workspace_id=ws and client_id=p_client and user_id=target_user and active and expires_at>=expires and(demand_id is null or demand_id=(p_payload->>'demand')::uuid))then raise exception 'Recipient needs scoped client access covering the invitation';end if;
  source:=ecod_feedback_private.prompt_source(ws,p_candidate,p_client,(p_payload->>'demand')::uuid,p_payload->>'kind');
  data:=jsonb_build_object('recipient',target_user,'kind',p_payload->>'kind','question',btrim(p_payload->>'question'),'expiresAt',expires,'demand',source->'demand','candidateId',p_candidate,'clientId',p_client);
  result:=jsonb_build_object('preview',data,'head',ecod_journey_private.token(ws,jsonb_build_array(source,data)));
  if p_action='preview'then return result;end if;
 end if;
 review_note:=btrim(coalesce(p_payload->>'reason',''));if jsonb_typeof(p_payload->'reason')is distinct from'string'or length(review_note)not between 10 and 1000 then raise exception 'Record a review reason of 10 to 1000 characters';end if;
 if p_action in('cancel','revoke')and exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>'reason')then raise exception 'Unknown feedback review detail';end if;
 if p_action='grant'then
  if not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;perform ecod_private.require_privileged_mfa(ws);
  if p_candidate is null or person."processingRestricted"or exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['user','expiresAt','reason']))then raise exception 'Candidate grant unavailable';end if;
  target_user:=(p_payload->>'user')::uuid;expires:=(p_payload->>'expiresAt')::timestamptz;
  if target_user is null or not exists(select 1 from auth.users where id=target_user)or expires is null or expires not between clock_timestamp()+interval'5 minutes'and clock_timestamp()+interval'30 days'then raise exception 'Verify a registered account and expiry within 30 days';end if;
  if exists(select 1 from ecod_feedback_private.grants where workspace_id=ws and candidate_id=p_candidate and user_id=target_user and revoked_at is null and expires_at>clock_timestamp())then raise exception 'Revoke the existing grant before renewing';end if;
  insert into ecod_feedback_private.grants(id,workspace_id,candidate_id,user_id,expires_at,actor,reason)values(p_operation,ws,p_candidate,target_user,expires,auth.uid(),review_note);
  result:=jsonb_build_object('id',p_operation,'path','/portal.html','expiresAt',expires);
 elsif p_action='revoke'then
  if not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;perform ecod_private.require_privileged_mfa(ws);
  update ecod_feedback_private.grants set revoked_at=clock_timestamp()where workspace_id=ws and id=p_id and candidate_id=any(family)and revoked_at is null;
  if not found then raise exception 'Active grant unavailable';end if;result:=jsonb_build_object('id',p_id,'status','Revoked');
 elsif p_action='invite'then
  if p_head is distinct from result->>'head'then raise exception 'Prompt source changed. Review again.'using errcode='40001';end if;
  if(select count(*)from ecod_feedback_private.prompts where workspace_id=ws and((candidate_id=p_candidate)or(client_id=p_client))and at>clock_timestamp()-interval'24 hours')>=20 then raise exception 'Daily prompt limit reached';end if;
  if exists(select 1 from ecod_feedback_private.prompts where workspace_id=ws and candidate_id is not distinct from p_candidate and client_id is not distinct from p_client and recipient=target_user and kind=p_payload->>'kind'and demand_id is not distinct from(p_payload->>'demand')::uuid and status='Open'and expires_at>clock_timestamp())then raise exception 'Equivalent open invitation exists';end if;
  insert into ecod_feedback_private.prompts(id,workspace_id,candidate_id,client_id,demand_id,recipient,kind,question,source,source_head,expires_at,actor,reason)
   values(p_operation,ws,p_candidate,p_client,(p_payload->>'demand')::uuid,target_user,p_payload->>'kind',btrim(p_payload->>'question'),source,result->>'head',expires,auth.uid(),review_note);
  result:=jsonb_build_object('id',p_operation,'path',case when p_candidate is not null then'/portal.html#request='else'/client.html#request='end||p_operation::text,'status','Open');
 elsif p_action='review'then
  if exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['decision','reason']))or coalesce(p_payload->>'decision','')not in('Accepted','Rejected')then raise exception 'Choose accept or reject';end if;
  select *into proposal from ecod_feedback_private.proposals where workspace_id=ws and candidate_id=any(family)and id=p_id for update;
  if not found or proposal.status<>'Pending'then raise exception 'Pending proposal unavailable';end if;
  if proposal.actor=auth.uid()then raise exception 'Independent reviewer required';end if;
  if p_head is distinct from ecod_journey_private.token(ws,to_jsonb(proposal))then raise exception 'Proposal review changed'using errcode='40001';end if;
  if p_payload->>'decision'='Accepted'then
   if proposal.candidate_id<>p_candidate or person."processingRestricted"then raise exception 'Retired or held proposals cannot be applied';end if;
   fields:=ecod_feedback_private.fields(ws,p_candidate);
   if proposal.head<>ecod_journey_private.token(ws,fields)then raise exception 'Profile changed. Candidate must submit a fresh proposal.'using errcode='40001';end if;
   patch:=ecod_feedback_private.validate_fields(proposal.fields);data:=fields||patch;
   if(data->>'relevantExperience')::numeric>(data->>'experience')::numeric then raise exception 'Relevant experience exceeds total experience';end if;
   sets:='';for k in select jsonb_object_keys(patch-'contactEmail'-'contactPhone')loop sets:=sets||case when sets=''then''else','end||format('%I = ($1).%I',k,k);end loop;
   if sets<>''then execute 'update public.candidates set '||sets||' where workspace_id=$2 and id=$3'using jsonb_populate_record(person,patch),ws,p_candidate;end if;
   for k in select x.key_name from jsonb_object_keys(patch)x(key_name)where x.key_name in('contactEmail','contactPhone')loop
    perform public.api_change_candidate_contact(p_candidate,gen_random_uuid(),'add',gen_random_uuid(),0,
     jsonb_build_object('kind',case when k='contactEmail'then'email'else'phone'end,'value',patch->>k,'source','Candidate portal proposal '||proposal.id::text));
   end loop;
   -- Candidate assertion and review do not renew verification or certify assessed readiness.
   if patch ?| array['notice','earliestStart','activeStatus','mode']then
    insert into public."availabilityHistory"(workspace_id,"candidateId",notice,"earliestStart",status,mode,source,observed)
     select ws,p_candidate,notice,"earliestStart","activeStatus",mode,'Candidate proposal reviewed: '||proposal.id::text,(proposal.at at time zone'UTC')::date from public.candidates where workspace_id=ws and id=p_candidate;
   end if;
  end if;
  update ecod_feedback_private.proposals set status=p_payload->>'decision',reviewed_by=auth.uid(),review_reason=review_note,reviewed_at=clock_timestamp()where id=proposal.id;
  result:=jsonb_build_object('id',proposal.id,'status',p_payload->>'decision');
 elsif p_action='cancel'then
  update ecod_feedback_private.prompts set status='Cancelled'where workspace_id=ws and id=p_id and(candidate_id=any(family)or client_id=p_client)and status='Open';
  if not found then raise exception 'Open invitation unavailable';end if;result:=jsonb_build_object('id',p_id,'status','Cancelled');
 elsif p_action='triage'then
  if exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['decision','reason']))or coalesce(p_payload->>'decision','')not in('Actioned','Dismissed')then raise exception 'Choose a response disposition';end if;
  select *into response from ecod_feedback_private.responses where workspace_id=ws and id=p_id and(candidate_id=any(family)or client_id=p_client)for update;
  if not found or response.disposition<>'Pending'then raise exception 'Pending response unavailable';end if;
  if p_head is distinct from ecod_journey_private.token(ws,to_jsonb(response))then raise exception 'Response changed'using errcode='40001';end if;
  update ecod_feedback_private.responses set disposition=p_payload->>'decision',reviewed_by=auth.uid(),review_reason=review_note,reviewed_at=clock_timestamp()where id=p_id;
  result:=jsonb_build_object('id',p_id,'status',p_payload->>'decision');
 end if;
 insert into ecod_feedback_private.receipts values(ws,auth.uid(),p_operation,p_candidate,p_client,req,result,clock_timestamp());
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when p_candidate is not null then'candidates'else'clients'end,coalesce(p_candidate,p_client),'Feedback '||p_action,left(review_note,1000),auth.uid()::text);
 return result;
end$$;

create or replace function ecod_feedback_private.portal(p_action text,p_candidate uuid,p_client uuid,p_id uuid,p_operation uuid,p_head text,p_payload jsonb,p_offset integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ws uuid;prior ecod_feedback_private.receipts;req jsonb;result jsonb;fields jsonb;patch jsonb;rows jsonb;proposals jsonb;preferences jsonb;person public.candidates;prompt ecod_feedback_private.prompts;proposal ecod_feedback_private.proposals;source jsonb;begin
 if auth.uid()is null then raise exception 'Sign in required'using errcode='42501';end if;
 if p_action is null or p_action not in('accounts','open','context','propose','withdraw','respond','preference')or p_offset is null or p_offset not between 0 and 1000000 or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>20000 then raise exception 'Invalid portal request';end if;
 if p_action='accounts'then
  return jsonb_build_object('candidates',coalesce((select jsonb_agg(to_jsonb(x))from(select distinct c.id,left(c.name,200)name,c."anthroId"from ecod_feedback_private.grants g join public.candidates c on c.workspace_id=g.workspace_id and c.id=g.candidate_id where g.user_id=auth.uid()and g.revoked_at is null and g.expires_at>clock_timestamp()and c."mergedInto"is null order by c.id limit 100)x),'[]'));
 end if;
 if p_action='open'then
  select *into prompt from ecod_feedback_private.prompts where id=p_id and recipient=auth.uid();
  if not found then raise exception 'Invitation access unavailable'using errcode='42501';end if;
  perform 1 from public.workspaces where id=prompt.workspace_id for update;
  if prompt.candidate_id is not null then
   perform 1 from public.candidates where workspace_id=prompt.workspace_id and id=prompt.candidate_id for update;
   perform ecod_feedback_private.candidate_access(prompt.workspace_id,prompt.candidate_id);
  else perform ecod_feedback_private.client_access(prompt.workspace_id,prompt.client_id,prompt.demand_id);end if;
  insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(prompt.workspace_id,case when prompt.candidate_id is null then'clients'else'candidates'end,coalesce(prompt.candidate_id,prompt.client_id),'Portal link read','Authenticated scoped invitation resolution',auth.uid()::text);
  return jsonb_build_object('candidateId',prompt.candidate_id,'clientId',prompt.client_id,'requestId',prompt.id);
 end if;
 if(p_candidate is null)=(p_client is null)then raise exception 'Choose one portal account';end if;
 if p_candidate is not null then select workspace_id into ws from public.candidates where id=p_candidate;else select workspace_id into ws from public.clients where id=p_client;end if;
 if ws is null then raise exception 'Portal access unavailable'using errcode='42501';end if;
 perform 1 from public.workspaces where id=ws for update;
 if p_candidate is not null then
  select *into person from public.candidates where workspace_id=ws and id=p_candidate for update;perform ecod_feedback_private.candidate_access(ws,p_candidate);
 else perform 1 from ecod_client_private.members where workspace_id=ws and client_id=p_client and user_id=auth.uid()and active and expires_at>clock_timestamp()for share; if not found then raise exception 'Client access unavailable'using errcode='42501';end if;end if;
 -- Demand-scoped client members use an invitation-specific membership check instead of broad client access.
 if p_action='context'then
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into rows from(select p.id,p.kind,p.question,p.expires_at,p.status,p.at,
   case when p.status='Open'and p.expires_at<=clock_timestamp()then'Expired'when p.status='Open'and not ecod_feedback_private.prompt_current(p)then'Suppressed or stale'else p.status end as state,
   left(d.title,300)as "demandTitle",r.body as response,r.disposition,
   ecod_journey_private.token(ws,jsonb_build_array(p.id,p.status,p.expires_at,p.question,p.source_head))as head
   from ecod_feedback_private.prompts p left join public.demands d on d.workspace_id=ws and d.id=p.demand_id left join ecod_feedback_private.responses r on r.workspace_id=ws and r.prompt_id=p.id
   where p.workspace_id=ws and p.recipient=auth.uid()and(p.candidate_id=p_candidate or p.client_id=p_client)and(not(p_payload?'request')or p.id=(p_payload->>'request')::uuid)
   and(p_candidate is not null or exists(select 1 from ecod_client_private.members m where m.workspace_id=ws and m.client_id=p_client and m.user_id=auth.uid()and m.active and m.expires_at>clock_timestamp()and(m.demand_id is null or m.demand_id=p.demand_id)))
   order by p.at desc,p.id offset p_offset limit 26)x;
  select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into proposals from(select p.id,p.fields,p.reason,p.status,p.review_reason,p.at from ecod_feedback_private.proposals p where workspace_id=ws and candidate_id=p_candidate and actor=auth.uid()order by at desc,id offset p_offset limit 26)x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into preferences from(select distinct on(purpose)purpose,body from ecod_comms_private.preferences where workspace_id=ws and candidate_id=any(case when p_candidate is null then'{}'::uuid[]else ecod_access_private.identity_family(ws,p_candidate)end)order by purpose,sequence desc)x;
  fields:=case when p_candidate is not null then ecod_feedback_private.fields(ws,p_candidate)end;
  insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when p_candidate is null then'clients'else'candidates'end,coalesce(p_candidate,p_client),'Portal feedback read','Curated account feedback view',auth.uid()::text);
  return jsonb_build_object('fields',fields,'head',ecod_journey_private.token(ws,fields),'held',coalesce(person."processingRestricted",false),'prompts',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'proposals',case when jsonb_array_length(proposals)>25 then proposals-25 else proposals end,'preferences',preferences,'more',greatest(jsonb_array_length(rows),jsonb_array_length(proposals))>25);
 end if;
 if p_operation is null then raise exception 'An operation ID is required';end if;
 req:=jsonb_build_array(p_action,p_candidate,p_client,p_id,p_head,p_payload);
 select *into prior from ecod_feedback_private.receipts where workspace_id=ws and actor=auth.uid()and id=p_operation;
 if found then if prior.request<>req then raise exception 'Feedback operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if p_action='propose'then
  if p_candidate is null or person."processingRestricted"then raise exception 'Profile proposals paused';end if;
  if exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['fields','reason']))or jsonb_typeof(p_payload->'reason')is distinct from'string'or length(btrim(coalesce(p_payload->>'reason','')))not between 10 and 1000 then raise exception 'Explain the proposed update';end if;
  fields:=ecod_feedback_private.fields(ws,p_candidate);patch:=ecod_feedback_private.validate_fields(p_payload->'fields');
  if p_head is distinct from ecod_journey_private.token(ws,fields)then raise exception 'Profile changed. Reload before proposing.'using errcode='40001';end if;
  if(fields||patch)->>'relevantExperience'is not null and((fields||patch)->>'relevantExperience')::numeric>((fields||patch)->>'experience')::numeric then raise exception 'Relevant experience exceeds total experience';end if;
  if(select count(*)from ecod_feedback_private.proposals where workspace_id=ws and candidate_id=p_candidate and status='Pending')>=5 or(select count(*)from ecod_feedback_private.proposals where workspace_id=ws and candidate_id=p_candidate and at>clock_timestamp()-interval'24 hours')>=20 then raise exception 'Proposal limit reached';end if;
  insert into ecod_feedback_private.proposals(id,workspace_id,candidate_id,actor,base,head,fields,reason)values(p_operation,ws,p_candidate,auth.uid(),fields,p_head,patch,btrim(p_payload->>'reason'));
  result:=jsonb_build_object('id',p_operation,'status','Pending');
 elsif p_action='withdraw'then
  update ecod_feedback_private.proposals set status='Withdrawn',reviewed_at=clock_timestamp()where workspace_id=ws and candidate_id=p_candidate and actor=auth.uid()and id=p_id and status='Pending';
  if not found then raise exception 'Own pending proposal unavailable';end if;result:=jsonb_build_object('id',p_id,'status','Withdrawn');
 elsif p_action='preference'then
  if p_candidate is null or exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['purpose','optOut','windowStart','windowEnd']))or coalesce(p_payload->>'purpose','')not in('recruiting-contact','marketing')or jsonb_typeof(p_payload->'optOut')is distinct from'boolean'
   or jsonb_typeof(p_payload->'windowStart')is distinct from'number'or jsonb_typeof(p_payload->'windowEnd')is distinct from'number'or(p_payload->>'windowStart')::numeric<>trunc((p_payload->>'windowStart')::numeric)or(p_payload->>'windowEnd')::numeric<>trunc((p_payload->>'windowEnd')::numeric)
   or(p_payload->>'windowStart')::integer not between 0 and 23 or(p_payload->>'windowEnd')::integer not between 1 and 24 or(p_payload->>'windowStart')::integer>=(p_payload->>'windowEnd')::integer then raise exception 'Invalid communication preferences';end if;
  if(select count(*)from ecod_comms_private.preferences where workspace_id=ws and candidate_id=p_candidate and actor=auth.uid()and at>clock_timestamp()-interval'24 hours')>=20 then raise exception 'Daily preference limit reached';end if;
  insert into ecod_comms_private.preferences(id,workspace_id,candidate_id,purpose,body,actor)values(p_operation,ws,p_candidate,p_payload->>'purpose',p_payload||jsonb_build_object('source','Candidate authenticated portal preference'),auth.uid());
  result:=jsonb_build_object('id',p_operation,'status','Recorded','consentGranted',false);
 elsif p_action='respond'then
  select *into prompt from ecod_feedback_private.prompts where workspace_id=ws and id=p_id and recipient=auth.uid()and(candidate_id=p_candidate or client_id=p_client)for update;
  if not found or prompt.status<>'Open'or prompt.expires_at<=clock_timestamp()then raise exception 'Open invitation unavailable';end if;
  if p_client is not null then perform ecod_feedback_private.client_access(ws,p_client,prompt.demand_id);end if;
  if p_head is distinct from ecod_journey_private.token(ws,jsonb_build_array(prompt.id,prompt.status,prompt.expires_at,prompt.question,prompt.source_head))then raise exception 'Invitation changed'using errcode='40001';end if;
  source:=ecod_feedback_private.prompt_source(ws,p_candidate,p_client,prompt.demand_id,prompt.kind);
  if source is distinct from prompt.source then raise exception 'Invitation source changed. Ask for a fresh invitation.'using errcode='40001';end if;
  if not ecod_feedback_private.prompt_current(prompt)then raise exception 'Invitation access or issuing reviewer changed. Ask for a fresh invitation.'using errcode='40001';end if;
  if exists(select 1 from jsonb_object_keys(p_payload)x(k)where x.k<>all(array['answer','rating','comment']))or jsonb_typeof(p_payload->'comment')is distinct from'string'or length(btrim(p_payload->>'comment'))not between 1 and 2000 then raise exception 'Supply bounded feedback';end if;
  if prompt.kind='survey'then
   if p_payload?'answer'or jsonb_typeof(p_payload->'rating')is distinct from'number'or(p_payload->>'rating')::numeric not in(1,2,3,4,5)then raise exception 'Survey rating must be 1 to 5';end if;
  elsif p_payload?'rating'or coalesce(p_payload->>'answer','')not in('Interested','Not now','No change','Update proposed')then raise exception 'Choose a valid response';end if;
  insert into ecod_feedback_private.responses(id,workspace_id,candidate_id,client_id,prompt_id,actor,body)values(p_operation,ws,p_candidate,p_client,prompt.id,auth.uid(),jsonb_set(p_payload,'{comment}',to_jsonb(btrim(p_payload->>'comment'))));
  update ecod_feedback_private.prompts set status='Responded'where id=prompt.id;result:=jsonb_build_object('id',p_operation,'status','Recorded');
 end if;
 insert into ecod_feedback_private.receipts values(ws,auth.uid(),p_operation,p_candidate,p_client,req,result,clock_timestamp());
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when p_candidate is null then'clients'else'candidates'end,coalesce(p_candidate,p_client),'Portal '||p_action,'Authenticated self-service journal',auth.uid()::text);
 return result;
end$$;

-- Legacy portal routes now share explicit grants; ambiguous multiple-account legacy selection fails closed.
create or replace function public.portal_candidate_id()returns uuid language sql stable security definer set search_path=''as $$
 select case when count(distinct c.id)=1 then(array_agg(distinct c.id))[1]end from ecod_feedback_private.grants g join public.candidates c on c.workspace_id=g.workspace_id and c.id=g.candidate_id
 where g.user_id=auth.uid()and g.revoked_at is null and g.expires_at>statement_timestamp()and c."mergedInto"is null
$$;
create or replace function public.api_portal_update(payload jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
begin
 raise exception 'Use the reviewed profile proposal workflow with an operation ID';
end$$;
create or replace function public.api_feedback_staff(p_action text,p_candidate uuid default null,p_client uuid default null,p_id uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default '{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_feedback_private.staff(p_action,p_candidate,p_client,p_id,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.api_feedback_portal(p_action text,p_candidate uuid default null,p_client uuid default null,p_id uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default '{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_feedback_private.portal(p_action,p_candidate,p_client,p_id,p_operation,p_head,p_payload,p_offset)$$;
create or replace function ecod_feedback_private.queue(p_kind text,p_offset integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);rows jsonb;begin
 if p_kind is null or p_kind not in('proposals','responses','redeployment')or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid feedback queue';end if;
 with queue as(
  select p.id,p.candidate_id,null::uuid client_id,'Profile proposal'as label,p.at from ecod_feedback_private.proposals p where p.workspace_id=ws and p.status='Pending'and p_kind='proposals'
  union all select r.id,r.candidate_id,r.client_id,'Response: '||p.kind,r.at from ecod_feedback_private.responses r join ecod_feedback_private.prompts p on p.workspace_id=r.workspace_id and p.id=r.prompt_id where r.workspace_id=ws and r.disposition='Pending'and p_kind='responses'
  union all select p.id,c.id,null::uuid,'Placement ending '||p."endDate"::text,p."endDate"::timestamptz from public.placements p join public.candidates c on c.workspace_id=p.workspace_id and c.id=p."candidateId"and c."mergedInto"is null and not c."processingRestricted"and c.status<>'Unavailable'
   where p.workspace_id=ws and p.status in('Active','Completed')and p."endDate"between current_date-180 and current_date+30 and p_kind='redeployment'
 )select coalesce(jsonb_agg(to_jsonb(x)order by at desc,id),'[]')into rows from(select q.id,q.candidate_id as "candidateId",q.client_id as "clientId",q.label,q.at,
  left(coalesce(c.name,client.name),200)name,c."anthroId"from queue q left join public.candidates c on c.workspace_id=ws and c.id=q.candidate_id left join public.clients client on client.workspace_id=ws and client.id=q.client_id order by q.at desc,q.id offset p_offset limit 26)x;
 perform ecod_access_private.audit_candidate_reads(ws,coalesce((select jsonb_agg(jsonb_build_object('id',x->>'candidateId'))from jsonb_array_elements(rows)x where x->>'candidateId'is not null),'[]'),'Feedback queue');
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
end$$;
create or replace function public.api_feedback_queue(p_kind text default 'proposals',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_feedback_private.queue(p_kind,p_offset)$$;
revoke all on all functions in schema ecod_feedback_private from public,anon,authenticated;
grant execute on function ecod_feedback_private.staff(text,uuid,uuid,uuid,uuid,text,jsonb,integer),ecod_feedback_private.portal(text,uuid,uuid,uuid,uuid,text,jsonb,integer)to authenticated;
revoke all on function public.api_feedback_staff(text,uuid,uuid,uuid,uuid,text,jsonb,integer),public.api_feedback_portal(text,uuid,uuid,uuid,uuid,text,jsonb,integer),public.portal_candidate_id()from public,anon,authenticated;
grant execute on function public.api_feedback_staff(text,uuid,uuid,uuid,uuid,text,jsonb,integer),public.api_feedback_portal(text,uuid,uuid,uuid,uuid,text,jsonb,integer)to authenticated;
revoke all on function public.api_feedback_queue(text,integer)from public,anon,authenticated;
grant execute on function public.api_feedback_queue(text,integer),ecod_feedback_private.queue(text,integer)to authenticated;
commit;
