begin;
create schema if not exists ecod_external_private;
revoke all on schema ecod_external_private from public,anon,authenticated;
create table if not exists ecod_external_private.policies(workspace_id uuid references public.workspaces(id),kind text check(kind in('ai','enrichment','publishing','signing')),generation integer not null default 1,body jsonb not null,state text not null default 'configured',accepted_at timestamptz,primary key(workspace_id,kind));
create table if not exists ecod_external_private.evaluations(id uuid primary key,workspace_id uuid not null,kind text not null,generation integer not null,body jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp());
create index if not exists external_evaluation_scope on ecod_external_private.evaluations(workspace_id,kind,generation,at desc);
create table if not exists ecod_external_private.work(id uuid primary key,workspace_id uuid not null,candidate_id uuid references public.candidates(id),kind text not null,generation integer not null,actor uuid not null,source_head text not null,source jsonb not null,request jsonb not null,status text not null default 'Queued',reason text not null default '',lease uuid,lease_until timestamptz,started boolean not null default false,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval'1 day',provider_id text);
create index if not exists external_work_scope on ecod_external_private.work(workspace_id,candidate_id,created_at desc,id);
create unique index if not exists external_equivalent_active on ecod_external_private.work(workspace_id,kind,source_head)where status in('Queued','Running','Unknown','Review','Accepted','Fixture prepared','Fixture completed','Export ready');
create table if not exists ecod_external_private.revisions(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,candidate_id uuid references public.candidates(id),work_id uuid not null references ecod_external_private.work(id),version integer not null,content jsonb not null,origin text not null,actor uuid,reason text not null default '',at timestamptz not null default clock_timestamp(),unique(work_id,version));
create index if not exists external_revision_candidate on ecod_external_private.revisions(workspace_id,candidate_id);
create table if not exists ecod_external_private.events(id uuid primary key,workspace_id uuid not null,candidate_id uuid references public.candidates(id),work_id uuid not null references ecod_external_private.work(id),body jsonb not null,at timestamptz not null default clock_timestamp());
create index if not exists external_event_candidate on ecod_external_private.events(workspace_id,candidate_id);
create table if not exists ecod_external_private.receipts(workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid references public.candidates(id),request jsonb not null,result jsonb not null,primary key(workspace_id,actor,id));
create index if not exists external_receipt_candidate on ecod_external_private.receipts(workspace_id,candidate_id);

create or replace function ecod_external_private.policy_head(q ecod_external_private.policies)returns text language sql stable security invoker set search_path=''as $$select ecod_journey_private.token(q.workspace_id,jsonb_build_array(q.generation,q.body,q.state,q.accepted_at))$$;
create or replace function ecod_external_private.owner_ok(q ecod_external_private.policies)returns boolean language sql stable security invoker set search_path=''as $$select q.state='enabled'and q.accepted_at>clock_timestamp()-interval'30 days'and not(select paused from ecod_processing_private.lockdown)and exists(select 1 from public.memberships where workspace_id=q.workspace_id and user_id=(q.body->>'owner')::uuid and role='admin')$$;
create or replace function ecod_external_private.source(ws uuid,cid uuid,k text,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare q ecod_external_private.policies;c public.candidates;o public.offers;d public.demands;ct ecod_contacts_private.contacts;consent jsonb;pref jsonb;s jsonb;ok boolean:=true;reason text:='';begin
 select *into q from ecod_external_private.policies where workspace_id=ws and kind=k;
 if k='publishing'then
  select *into d from public.demands where workspace_id=ws and id=(p->>'demand')::uuid;
  ok:=d.id is not null and d.status='Open'and d."careersVisible"and d."approvalStatus"='Approved'and d."jobFeedApprovedHash"=ecod_machine_private.job_hash(d);
  s:=jsonb_build_object('demand',d.id,'fields',jsonb_build_object('id',d.id,'title',d.title,'location',d.location,'mode',d.mode,'positions',d.positions,'target',d.target,'description',d.description,'skills',d.skills,'minExperience',d."minExperience"),'source','Approved job feed','application',jsonb_build_object('workspace',ws,'role',d.id,'source',q.body->>'attribution'));
  reason:='Current approved public job content required';
 else
  select *into c from public.candidates where workspace_id=ws and id=cid;
  if c.id is null then raise exception 'Candidate unavailable in workspace';end if;
  ok:=c."mergedInto"is null and not c."processingRestricted"and c.status<>'Unavailable';
  s:=jsonb_build_object('candidate',c.id,'fields',jsonb_build_object('title',c.title,'skills',array_to_string(c.skills,', '),'experience',c.experience::text,'mode',c.mode),'source','Curated professional fields; assertions are not independently verified');
  reason:='Current unrestricted candidate required';
  if k='enrichment'then
   ok:=ok and c.linkedin~'^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%.-]+/?$';
   s:=s||jsonb_build_object('profile',c.linkedin,'source','Existing reviewed profile URL; returned provider assertions remain unverified');reason:='Existing reviewed LinkedIn profile URL required';
  elsif k='signing'then
   select *into o from public.offers where workspace_id=ws and id=(p->>'offer')::uuid and "candidateId"=cid;
   select *into ct from ecod_contacts_private.contacts where workspace_id=ws and candidate_id=cid and kind='email'and active and verified_at between clock_timestamp()-interval'365 days'and clock_timestamp()order by preferred desc,verified_at desc,id limit 1;
   select to_jsonb(x)into consent from public.consents x where workspace_id=ws and "candidateId"=cid and purpose='recruiting-contact'order by date desc,(status<>'granted')desc,id desc limit 1;
   select body into pref from ecod_comms_private.preferences where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,cid))and purpose='recruiting-contact'order by sequence desc limit 1;
   ok:=ok and o.id is not null and o.status in('Draft','Sent')and o."approvedAt"is not null and o."approvedTerms"=jsonb_build_object('candidateId',o."candidateId",'demandId',o."demandId",'role',o.role,'location',o.location,'ctc',o.ctc,'joining',o.joining)and ct.id is not null and consent->>'status'='granted'and(consent->>'date')::timestamptz<=clock_timestamp()and coalesce(pref->'optOut','false'::jsonb)<>'true'::jsonb;
   s:=jsonb_build_object('candidate',c.id,'offer',o.id,'approval',jsonb_build_object('at',o."approvedAt",'by',o."approvedBy"),'fields',o."approvedTerms",'currency',q.body->>'currency','recipient',ct.value,'contact',to_jsonb(ct),'consent',consent,'preference',pref,'source','Current administrator-approved offer terms; internal notes excluded');
   reason:='Current approved offer, confirmed contact and recruiting consent required';
  end if;
 end if;
 s:=s||jsonb_build_object('provenance',jsonb_build_object('provider',case k when'ai'then'openai'when'enrichment'then'People Data Labs'when'publishing'then'approved-feed'else'neutral-sign-fixture'end,'providerVersion',q.body->>'providerVersion','mode',q.body->>'mode','generation',q.generation,'projection','controlled-professional-v2'),'policySnapshot',q.body);
 if octet_length(s::text)>20000 then raise exception 'Source exceeds bounded review projection';end if;
 return jsonb_build_object('head',ecod_journey_private.token(ws,jsonb_build_array(k,p,s,q.generation,q.body)),'eligible',coalesce(ok,false)and ecod_external_private.owner_ok(q),'reason',case when not coalesce(ecod_external_private.owner_ok(q),false)then'Configure and accept the current policy before enabling'else reason end,'snapshot',s,'policy',q.body,'generation',q.generation);
end$$;
create or replace function ecod_external_private.work_head(w ecod_external_private.work)returns text language sql stable security invoker set search_path=''as $$select ecod_journey_private.token(w.workspace_id,jsonb_build_array(to_jsonb(w),(select max(version)from ecod_external_private.revisions where work_id=w.id)))$$;
create or replace function ecod_external_private.allowed(w ecod_external_private.work)returns jsonb language plpgsql security invoker set search_path=''as $$declare s jsonb;begin
 if (w.status in('Queued','Running')and w.expires_at<=clock_timestamp())or not exists(select 1 from public.memberships where workspace_id=w.workspace_id and user_id=w.actor and role=any(case when w.kind='signing'then array['admin']else array['admin','recruiter']end))then return jsonb_build_object('eligible',false,'reason','Actor authority or operation expiry changed');end if;
 s:=ecod_external_private.source(w.workspace_id,w.candidate_id,w.kind,w.request);
 return s||jsonb_build_object('eligible',s->'eligible'='true'::jsonb and s->>'head'=w.source_head);
end$$;
create or replace function ecod_external_private.validate_draft(k text,s jsonb,r jsonb)returns void language plpgsql security invoker set search_path=''as $$declare item jsonb;f text;fields jsonb;begin
 if jsonb_typeof(r)is distinct from'object'or octet_length(r::text)>20000 or exists(select 1 from jsonb_object_keys(r)x where x<>all(array['highlights','unknowns','notes','fields','fixture','envelope','status','export']))then raise exception 'Invalid bounded workflow result';end if;
 if k in('ai','enrichment')then
  if k='ai'and r ? 'fields'then raise exception 'AI output cannot introduce another source projection';end if;
  fields:=case when k='ai'then s->'fields'else r->'fields'end;
  if jsonb_typeof(fields)is distinct from'object'or exists(select 1 from jsonb_each(fields)x where x.key<>all(array['title','skills','experience','mode','location']))or jsonb_typeof(r->'highlights')is distinct from'array'or jsonb_array_length(r->'highlights')not between 1 and 12 or jsonb_typeof(r->'unknowns')is distinct from'array'or jsonb_array_length(r->'unknowns')>10 or length(coalesce(r->>'notes',''))>2000 then raise exception 'Reviewed professional draft schema required';end if;
  for item in select value from jsonb_array_elements(r->'highlights')loop
   f:=item->>'field';if f is null or f<>all(array['title','skills','experience','mode','location'])or(k='ai'and f='location')or jsonb_typeof(item)is distinct from'object'or exists(select 1 from jsonb_object_keys(item)x where x<>all(array['field','quote']))or jsonb_typeof(item->'quote')is distinct from'string'or length(item->>'quote')not between 1 and 1500 or item->>'quote'is distinct from(fields->f)#>>'{}'then raise exception 'Each highlight must quote its exact permitted source field';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(r->'unknowns')x where jsonb_typeof(x)<>'string'or length(x#>>'{}')>200)then raise exception 'Invalid missing-evidence description';end if;
 end if;
end$$;

create or replace function ecod_external_private.api(a text,cid uuid,op uuid,h text,p jsonb,off integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(true);q ecod_external_private.policies;w ecod_external_private.work;prior ecod_external_private.receipts;req jsonb;r jsonb;s jsonb;rows jsonb;k text:=p->>'kind';ev jsonb;n integer;begin
 if a is null or a not in('context','catalog','browse','preview','configure','evaluate','accept','enable','pause','revoke','prepare','cancel','edit','review','report','dispatch','export','versions','reconcile','resolve')or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>24000 or off is null or off not between 0 and 10000 then raise exception 'Invalid bounded external workflow request';end if;
 if k='signing'and not public.is_admin()then raise exception 'Signing terms require financial administrator authority';end if;
 if cid is not null and not exists(select 1 from public.candidates where workspace_id=ws and id=cid)then raise exception 'Candidate unavailable in workspace';end if;
 if a='context'then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select kind,generation,body,state,accepted_at,ecod_external_private.policy_head(t)head from ecod_external_private.policies t where workspace_id=ws and(kind<>'signing'or public.is_admin())order by kind)x;
  return jsonb_build_object('actor',auth.uid(),'policies',rows,'defaultHead',ecod_journey_private.token(ws,'null'::jsonb),'paused',(select paused from ecod_processing_private.lockdown),'evaluations',coalesce((select jsonb_agg(to_jsonb(x))from(select *from ecod_external_private.evaluations where workspace_id=ws and(kind<>'signing'or public.is_admin())order by at desc,id limit 25)x),'[]'));
 elsif a='browse'then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select t.id,t.candidate_id,t.kind,t.generation,t.actor,t.status,t.reason,t.created_at,t.expires_at,t.provider_id,t.source,ecod_external_private.work_head(t)head,(select content from ecod_external_private.revisions where work_id=t.id order by version desc limit 1)content from ecod_external_private.work t where workspace_id=ws and(kind<>'signing'or public.is_admin())and(cid is null or candidate_id=any(ecod_access_private.identity_family(ws,cid)))order by created_at desc,id limit 26 offset off)x;
  if cid is not null then insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',cid,'server_read','Controlled external workflow history',auth.uid()::text);end if;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='catalog'then
  if length(coalesce(p->>'search',''))>100 or p->>'entity'not in('candidates','demands','offers')then raise exception 'Bounded catalog required';end if;
  if p->>'entity'='offers'then if not public.is_admin()then raise exception 'Administrator offer catalog required';end if;select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select id,role,"candidateId"candidate_id,"approvedAt"approved_at from public.offers where workspace_id=ws and(cid is null or "candidateId"=cid)and status in('Draft','Sent')order by id limit 26 offset off)x;
  elsif p->>'entity'='demands'then select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select id,title from public.demands where workspace_id=ws and status='Open'and strpos(lower(title),lower(coalesce(p->>'search','')))>0 order by id limit 26 offset off)x;
  else select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select id,name,"anthroId"anthro_id,title from public.candidates where workspace_id=ws and "mergedInto"is null and strpos(lower(name||' '||title||' '||"anthroId"),lower(coalesce(p->>'search','')))>0 order by id limit 26 offset off)x;perform ecod_access_private.audit_candidate_reads(ws,rows,'Controlled workflow candidate picker');end if;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='preview'then return ecod_external_private.source(ws,cid,k,p-'kind');
 elsif a='versions'then
  select *into w from ecod_external_private.work where workspace_id=ws and id=(p->>'id')::uuid;if w.id is null or(w.kind='signing'and not public.is_admin())then raise exception 'Work unavailable';end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]')into rows from(select *from ecod_external_private.revisions where work_id=w.id order by version desc limit 26 offset off)x;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 elsif a='export'then
  select *into w from ecod_external_private.work where workspace_id=ws and id=(p->>'id')::uuid;
  if w.id is null or w.kind<>'publishing'or w.status<>'Export ready'or ecod_external_private.allowed(w)->'eligible'<>'true'::jsonb or h is distinct from ecod_external_private.work_head(w)then raise exception 'Refresh current approved export';end if;
  return jsonb_build_object('version',w.id,'sourceHead',w.source_head,'job',w.source->'fields','application',w.source->'application','verification','Reviewed export; external posting is not verified');
 end if;
 if op is null or h is null then raise exception 'Exact operation and review head required';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||auth.uid()::text||op::text,0));
 req:=jsonb_build_array(a,cid,h,p);select *into prior from ecod_external_private.receipts where workspace_id=ws and actor=auth.uid()and id=op;
 if prior.id is not null then if prior.request<>req then raise exception 'Exact operation conflict'using errcode='40001';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if a in('configure','evaluate','accept','enable','pause','revoke')then
  if not public.is_admin()then raise exception 'Administrator required';end if;perform ecod_private.require_privileged_mfa(ws);
  if k is null or k<>all(array['ai','enrichment','publishing','signing'])then raise exception 'Supported policy required';end if;
  select *into q from ecod_external_private.policies where workspace_id=ws and kind=k for update;
  if h is distinct from(case when q.kind is null then ecod_journey_private.token(ws,'null'::jsonb)else ecod_external_private.policy_head(q)end)then raise exception 'Policy changed; refresh'using errcode='40001';end if;
  if a='configure'then
   if exists(select 1 from jsonb_each(p)x where (x.key='dailyLimit'and jsonb_typeof(x.value)<>'number')or(x.key<>'dailyLimit'and jsonb_typeof(x.value)<>'string'))or not(p ?& array['kind','owner','purpose','rights','processing','costDecision','providerVersion','mode','dailyLimit'])or exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','owner','purpose','rights','processing','costDecision','providerVersion','mode','dailyLimit','attribution','currency','embeddingModel']))or not exists(select 1 from public.memberships where workspace_id=ws and user_id=(p->>'owner')::uuid and role='admin')or length(coalesce(p->>'purpose',''))not between 10 and 500 or length(coalesce(p->>'rights',''))not between 20 and 1000 or length(coalesce(p->>'processing',''))not between 20 and 1000 or length(coalesce(p->>'costDecision',''))not between 10 and 500 or(p->>'dailyLimit')::integer not between 1 and 100 or p->>'providerVersion'!~'^[A-Za-z0-9._:-]{1,100}$'or p->>'mode'not in('fixture','live')then raise exception 'Owner, purpose, rights, processing, version and budget evidence required';end if;
   if(k='signing'and(p->>'mode'<>'fixture'or p->>'providerVersion'<>'neutral-sign-v1'or coalesce(p->>'currency','')!~'^[A-Z]{3}$'))or(k='publishing'and(p->>'providerVersion'<>'approved-feed-v1'or coalesce(p->>'attribution','')!~'^[A-Za-z0-9 ._-]{3,100}$'))or(k='enrichment'and p->>'providerVersion'<>'pdl-v5')then raise exception 'Provider contract or attribution unavailable';end if;
   insert into ecod_external_private.policies values(ws,k,coalesce(q.generation,0)+1,p-'kind','configured',null)on conflict(workspace_id,kind)do update set generation=excluded.generation,body=excluded.body,state='configured',accepted_at=null;
   update ecod_external_private.work set status='Suppressed',reason='Policy generation changed'where workspace_id=ws and kind=k and status='Queued';r:=jsonb_build_object('status','Configured');
  elsif a='evaluate'then
   ev:=p-'kind';if exists(select 1 from jsonb_each(ev)x where(x.key=any(array['cases','baselineUtility','providerUtility','safetyFailures','groundingPercent'])and jsonb_typeof(x.value)<>'number')or(x.key<>all(array['cases','baselineUtility','providerUtility','safetyFailures','groundingPercent'])and jsonb_typeof(x.value)<>'string'))or not(ev ?& array['cases','baselineUtility','providerUtility','safetyFailures','groundingPercent','datasetHash','evidence','mode'])or jsonb_typeof(ev)is distinct from'object'or exists(select 1 from jsonb_object_keys(ev)x where x<>all(array['cases','baselineUtility','providerUtility','safetyFailures','groundingPercent','datasetHash','evidence','mode']))or(ev->>'cases')::integer not between 10 and 10000 or(ev->>'baselineUtility')::numeric not between 0 and 5 or(ev->>'providerUtility')::numeric not between 0 and 5 or(ev->>'safetyFailures')::integer<0 or(ev->>'groundingPercent')::numeric not between 0 and 100 or ev->>'datasetHash'!~'^[a-f0-9]{64}$'or length(coalesce(ev->>'evidence',''))not between 20 and 1000 or ev->>'mode'is distinct from q.body->>'mode'then raise exception 'Bounded baseline evaluation evidence required';end if;
   insert into ecod_external_private.evaluations values(op,ws,k,q.generation,ev,auth.uid(),clock_timestamp());r:=jsonb_build_object('status','Evaluation recorded; evidence is an operating decision');
  elsif a='accept'then
   select body into ev from ecod_external_private.evaluations where workspace_id=ws and kind=k and generation=q.generation and at>clock_timestamp()-interval'30 days'order by at desc,id limit 1;
   if ev is null or(ev->>'safetyFailures')::integer<>0 or(ev->>'groundingPercent')::numeric<>100 or(ev->>'providerUtility')::numeric<(ev->>'baselineUtility')::numeric or(k='ai'and q.body->>'mode'='live'and(ev->>'providerUtility')::numeric<=(ev->>'baselineUtility')::numeric)then raise exception 'Fresh safe grounded evaluation against baseline required';end if;
   update ecod_external_private.policies set state='accepted',accepted_at=clock_timestamp()where workspace_id=ws and kind=k;r:=jsonb_build_object('status','Accepted for configured mode');
  elsif a='enable'then
   if q.state<>'accepted'or q.accepted_at<=clock_timestamp()-interval'30 days'or not exists(select 1 from public.memberships where workspace_id=ws and user_id=(q.body->>'owner')::uuid and role='admin')then raise exception 'Current owner and fresh acceptance required';end if;
   update ecod_external_private.policies set state='enabled'where workspace_id=ws and kind=k;r:=jsonb_build_object('status','Enabled for configured mode');
  else
   update ecod_external_private.policies set state=case when a='pause'then'paused'else'revoked'end,generation=generation+1,accepted_at=null where workspace_id=ws and kind=k;
   update ecod_external_private.work set status='Suppressed',reason='Policy paused or revoked'where workspace_id=ws and kind=k and status='Queued';r:=jsonb_build_object('status','Paused or revoked; started outcomes require review');
  end if;
 elsif a='prepare'then
  if k='signing'then perform ecod_private.require_privileged_mfa(ws);end if;
  if k is null or k<>all(array['ai','enrichment','publishing','signing'])or exists(select 1 from jsonb_object_keys(p)x where x<>all(array['kind','offer','demand']))then raise exception 'Only scoped workflow locators are allowed';end if;
  s:=ecod_external_private.source(ws,cid,k,p-'kind');if s->'eligible'<>'true'::jsonb or h is distinct from s->>'head'then raise exception 'Source or policy changed; refresh review'using errcode='40001';end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||k,0));select *into q from ecod_external_private.policies where workspace_id=ws and kind=k;
  if(select count(*)from ecod_external_private.work where workspace_id=ws and kind=k and created_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')+(case when k='ai'then(select count(*)from public."intelligenceRequests"where workspace_id=ws and created>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')when k='enrichment'then coalesce((select attempts from ecod_private.linkedin_lookup_limits where workspace_id=ws and day=(clock_timestamp()at time zone'UTC')::date),0)else 0 end)>=(q.body->>'dailyLimit')::integer then raise exception 'Daily workflow budget exhausted';end if;
  insert into ecod_external_private.work(id,workspace_id,candidate_id,kind,generation,actor,source_head,source,request)values(op,ws,case when k='publishing'then null else cid end,k,q.generation,auth.uid(),h,s->'snapshot',p-'kind');r:=jsonb_build_object('status','Queued','id',op);
 else
  select *into w from ecod_external_private.work where workspace_id=ws and id=(p->>'id')::uuid for update;
  if w.id is null or(w.kind='signing'and not public.is_admin())then raise exception 'Work unavailable';end if;
  if h is distinct from ecod_external_private.work_head(w)then raise exception 'Work changed; refresh'using errcode='40001';end if;
  cid:=w.candidate_id;if w.kind='signing'then perform ecod_private.require_privileged_mfa(ws);end if;
  if a='cancel'and w.status='Queued'then update ecod_external_private.work set status='Cancelled',reason='Cancelled before provider dispatch'where id=w.id;r:=jsonb_build_object('status','Cancelled');
  elsif a='dispatch'and(w.status='Queued'or(w.status='Running'and w.lease_until<=clock_timestamp()))and ecod_external_private.allowed(w)->'eligible'='true'::jsonb then r:=jsonb_build_object('id',w.id,'workspace',ws,'actor',auth.uid());
  elsif a in('edit','review')and w.status='Review'and((a='review'and p->>'decision'='reject')or ecod_external_private.allowed(w)->'eligible'='true'::jsonb)then
   if length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 then raise exception 'Review reason required';end if;
   if a='edit'then perform ecod_external_private.validate_draft(w.kind,w.source,p->'content');select coalesce(max(version),0)+1 into n from ecod_external_private.revisions where work_id=w.id;insert into ecod_external_private.revisions(workspace_id,candidate_id,work_id,version,content,origin,actor,reason)values(ws,cid,w.id,n,p->'content','reviewer-edit',auth.uid(),p->>'reason');
   else if w.actor=auth.uid()then raise exception 'Independent reviewer required';end if;if coalesce(p->>'decision','')not in('accept','reject')then raise exception 'Review decision required';end if;update ecod_external_private.work set status=case when p->>'decision'='accept'then'Accepted'else'Rejected'end,reason=p->>'reason'where id=w.id;end if;r:=jsonb_build_object('status','Review recorded; candidate facts unchanged');
  elsif a='report'and w.kind='publishing'and w.status in('Export ready','Reported posted','Reported withdrawn','Unknown')then
   if not public.is_admin()or coalesce(p->>'outcome','')not in('posted','withdrawn','uncertain')or length(btrim(coalesce(p->>'evidence','')))not between 20 and 1000 then raise exception 'Administrator external-copy report and evidence required';end if;perform ecod_private.require_privileged_mfa(ws);
   insert into ecod_external_private.events values(op,ws,null,w.id,p-'id',clock_timestamp());update ecod_external_private.work set status=case p->>'outcome'when'posted'then'Reported posted'when'withdrawn'then'Reported withdrawn'else'Unknown'end,reason='Human external-copy report; provider outcome not verified'where id=w.id;r:=jsonb_build_object('status','Reported; external posting is not verified');
  elsif a='resolve'and(w.status='Unknown'or(w.status='Running'and w.lease_until<=clock_timestamp()))then
   if not public.is_admin()or length(btrim(coalesce(p->>'evidence','')))not between 20 and 1000 then raise exception 'Administrator resolution evidence required';end if;perform ecod_private.require_privileged_mfa(ws);insert into ecod_external_private.events values(op,ws,cid,w.id,p-'id',clock_timestamp());update ecod_external_private.work set status='Closed by review',reason='Human resolution of uncertain outcome; no provider proof or automatic retry'where id=w.id;r:=jsonb_build_object('status','Closed by reviewed decision');
  elsif a='reconcile'and w.status='Unknown'and w.kind='signing'then
   if not public.is_admin()then raise exception 'Administrator required';end if;perform ecod_private.require_privileged_mfa(ws);
   if exists(select 1 from ecod_external_private.events where work_id=w.id and body->>'state'='completed'and body->>'generation'=w.generation::text)then update ecod_external_private.work set status='Fixture completed',reason='Authenticated fixture event; no legal signature'where id=w.id;r:=jsonb_build_object('status','Fixture reconciled');else r:=jsonb_build_object('status','No authenticated outcome; manual review required');end if;
  else raise exception 'Transition unavailable; refresh current work';end if;
 end if;
 insert into ecod_external_private.receipts values(ws,auth.uid(),op,cid,req,r);return r;
end$$;

create or replace function ecod_external_private.worker(a text,p jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare w ecod_external_private.work;q ecod_external_private.policies;s jsonb;v jsonb;old ecod_external_private.events;begin
 if a is null or a not in('claim','gate','finish','fixture-event','legacy-ai-gate','legacy-enrichment-gate')or jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>24000 then raise exception 'Invalid external worker request';end if;
 if a like'legacy-%'then
  select *into q from ecod_external_private.policies where workspace_id=(p->>'workspace')::uuid and kind=case when a='legacy-ai-gate'then'ai'else'enrichment'end;
  if not ecod_external_private.owner_ok(q)or q.body->>'mode'is distinct from'live'or not exists(select 1 from public.memberships where workspace_id=q.workspace_id and user_id=(p->>'actor')::uuid and role in('admin','recruiter'))then raise exception 'Enable and accept Stage 4 live policy first';end if;
  if a='legacy-ai-gate'then if not exists(select 1 from public."intelligenceRequests"r left join public.candidates c on c.id=r.candidate_id and c.workspace_id=r.workspace_id where r.id=(p->>'id')::uuid and r.workspace_id=q.workspace_id and r.created_by=(p->>'actor')::uuid and r.status='pending'and(r.candidate_id is null or(c."mergedInto"is null and not c."processingRestricted"and c.status<>'Unavailable'and r.fingerprint=md5(public.professional_text(c)))))then raise exception 'Legacy source or authority changed';end if;end if;
  if p ? 'generation'and(p->>'generation')::integer<>q.generation then raise exception 'Policy generation changed before provider I/O';end if;
  if a='legacy-enrichment-gate'and exists(select 1 from public.candidates where workspace_id=q.workspace_id and linkedin=p->>'profile'and("mergedInto"is not null or "processingRestricted"or status='Unavailable'))then raise exception 'Existing candidate profile is restricted';end if;
  if (case when a='legacy-ai-gate'then(select count(*)from public."intelligenceRequests"where workspace_id=q.workspace_id and created>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')else coalesce((select attempts from ecod_private.linkedin_lookup_limits where workspace_id=q.workspace_id and day=(clock_timestamp()at time zone'UTC')::date),0)end)+(select count(*)from ecod_external_private.work where workspace_id=q.workspace_id and kind=q.kind and created_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')>(q.body->>'dailyLimit')::integer then raise exception 'Stage 4 daily provider budget exhausted';end if;
  return jsonb_build_object('allowed',true,'generation',q.generation,'embeddingModel',coalesce(q.body->>'embeddingModel','text-embedding-3-small'));
 end if;
 select *into w from ecod_external_private.work where id=(p->>'id')::uuid for update;if w.id is null then raise exception 'Work unavailable';end if;
 select *into q from ecod_external_private.policies where workspace_id=w.workspace_id and kind=w.kind;
 if a='fixture-event'then
  if w.kind<>'signing'or q.body->>'mode'<>'fixture'or p->>'generation'is distinct from w.generation::text or q.generation<>w.generation or p->>'state'not in('accepted','completed','declined')or w.provider_id is distinct from p->>'envelope'then raise exception 'Fixture envelope/generation mismatch';end if;
  select *into old from ecod_external_private.events where id=(p->>'event')::uuid;if old.id is not null then if old.work_id<>w.id or old.body<>p then raise exception 'Event replay conflict';end if;return jsonb_build_object('status','duplicate');end if;
  insert into ecod_external_private.events values((p->>'event')::uuid,w.workspace_id,w.candidate_id,w.id,p,clock_timestamp());
  if w.status in('Fixture prepared','Unknown')and p->>'state'in('completed','declined')then update ecod_external_private.work set status=case when p->>'state'='completed'then'Fixture completed'else'Fixture declined'end,reason='Authenticated fixture event; no legal signature or offer acceptance'where id=w.id;end if;
  return jsonb_build_object('status','Fixture event recorded');
 end if;
 if a='claim'then
  if p->>'workspace'is distinct from w.workspace_id::text or not exists(select 1 from public.memberships where workspace_id=w.workspace_id and user_id=(p->>'actor')::uuid and role=any(case when w.kind='signing'then array['admin']else array['admin','recruiter']end))then raise exception 'Current dispatch authority required';end if;
  if w.status='Running'and w.lease_until<=clock_timestamp()then update ecod_external_private.work set status=case when started then'Unknown'else'Queued'end,reason='Lease expired; provider outcome requires review'where id=w.id returning *into w;end if;
  if w.status<>'Queued'then return jsonb_build_object('status',w.status,'id',w.id);end if;
  s:=ecod_external_private.allowed(w);if s->'eligible'<>'true'::jsonb then update ecod_external_private.work set status='Suppressed',reason='Source, policy or actor changed'where id=w.id;return jsonb_build_object('status','Suppressed','id',w.id);end if;
  update ecod_external_private.work set status='Running',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval'45 seconds'where id=w.id returning *into w;
  return jsonb_build_object('status','Running','id',w.id,'lease',w.lease,'generation',w.generation);
 end if;
 if w.status<>'Running'or w.lease_until<=clock_timestamp()or p->>'lease'is distinct from w.lease::text or(p->>'generation')::integer<>w.generation then raise exception 'Current lease required';end if;
 s:=ecod_external_private.allowed(w);if s->'eligible'<>'true'::jsonb then raise exception 'Final source, policy or actor gate changed';end if;
 if a='gate'then update ecod_external_private.work set started=true where id=w.id;return jsonb_build_object('kind',w.kind,'source',w.source,'policy',q.body,'generation',w.generation,'workspace',w.workspace_id,'id',w.id);end if;
 if p->>'outcome'not in('ok','failed','unknown')then raise exception 'Explicit outcome required';end if;
 if p->>'outcome'='ok'then
  v:=p->'content';perform ecod_external_private.validate_draft(w.kind,w.source,v);if coalesce(v->'fixture','false'::jsonb)is distinct from to_jsonb(q.body->>'mode'='fixture')then raise exception 'Exact configured fixture mode required';end if;
  if w.kind in('publishing','signing')and(v->'fixture'is distinct from to_jsonb(q.body->>'mode'='fixture')or(w.kind='signing'and v->>'envelope'is distinct from w.id::text))then raise exception 'Exact fixture contract required';end if;
  insert into ecod_external_private.revisions(workspace_id,candidate_id,work_id,version,content,origin)values(w.workspace_id,w.candidate_id,w.id,1,v,'provider-original');
  update ecod_external_private.work set status=case when kind='publishing'then'Export ready'when kind='signing'then'Fixture prepared'else'Review'end,provider_id=case when kind='signing'then w.id::text else null end,reason=case when q.body->>'mode'='fixture'then'Fictional local fixture; not live provider acceptance'else'Provider draft requires independent review'end where id=w.id;
 else update ecod_external_private.work set status=case when p->>'outcome'='failed'then'Failed'else'Unknown'end,reason='Provider outcome unavailable; no automatic re-execution'where id=w.id;end if;
 return jsonb_build_object('status','Recorded');
end$$;
create or replace function public.api_controlled_workflows(p_action text default'context',p_candidate uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_external_private.api(p_action,p_candidate,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.worker_controlled_workflows(p_action text,p_payload jsonb default'{}')returns jsonb language sql security invoker set search_path=''as $$select ecod_external_private.worker(p_action,p_payload)$$;
do $$declare n text;begin foreach n in array array['policies','evaluations','work','revisions','events','receipts']loop
 execute format('alter table ecod_external_private.%I enable row level security',n);execute format('drop trigger if exists stage2_recovery_lockdown on ecod_external_private.%I',n);execute format('drop trigger if exists stage2_recovery_truncate on ecod_external_private.%I',n);execute format('create trigger stage2_recovery_lockdown before insert or update or delete on ecod_external_private.%I for each row execute function ecod_processing_private.guard_lockdown()',n);execute format('create trigger stage2_recovery_truncate before truncate on ecod_external_private.%I for each statement execute function ecod_processing_private.guard_lockdown()',n);
end loop;end$$;
revoke all on all tables in schema ecod_external_private from public,anon,authenticated;
revoke all on all functions in schema ecod_external_private from public,anon,authenticated;
revoke all on function public.api_controlled_workflows(text,uuid,uuid,text,jsonb,integer),public.worker_controlled_workflows(text,jsonb)from public,anon,authenticated;
grant usage on schema ecod_external_private to authenticated;
grant execute on function ecod_external_private.api(text,uuid,uuid,text,jsonb,integer),public.api_controlled_workflows(text,uuid,uuid,text,jsonb,integer)to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role')then grant usage on schema ecod_external_private to service_role;grant execute on function ecod_external_private.worker(text,jsonb),public.worker_controlled_workflows(text,jsonb)to service_role;end if;end$$;
do $$declare fn text;d text;begin foreach fn in array array['ecod_private.erasure_inventory','ecod_ops_private.source_inventory']loop d:=pg_get_functiondef((fn||'(uuid,uuid)')::regprocedure);
 if strpos(d,'controlledWork')=0 then d:=replace(d,'(''foundationReceipts'',''integrations'')','(''foundationReceipts'',''integrations''),(''controlledWork'',''integrations''),(''controlledRevisions'',''history''),(''controlledEvents'',''integrations''),(''controlledReceipts'',''integrations'')');
 d:=replace(d,'predicate:=case d.name','predicate:=case d.name when''controlledWork''then''t.candidate_id=any($1)''when''controlledRevisions''then''t.candidate_id=any($1)''when''controlledEvents''then''t.candidate_id=any($1)''when''controlledReceipts''then''t.candidate_id=any($1)''');
 d:=replace(d,'case when d.name','case when d.name in(''controlledWork'',''controlledRevisions'',''controlledEvents'',''controlledReceipts'')then''ecod_external_private''when d.name');
 d:=replace(d,'end,case d.name when','end,case d.name when''controlledWork''then''work''when''controlledRevisions''then''revisions''when''controlledEvents''then''events''when''controlledReceipts''then''receipts''when');execute d;end if;end loop;
 d:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);if strpos(d,'controlled intelligence drafts')=0 then d:=replace(d,'leased delivery sandbox','controlled intelligence drafts/revisions, enrichment, offer signing fixtures and external workflow receipts (separately reviewed private journals), leased delivery sandbox');execute d;end if;
 d:=pg_get_functiondef('ecod_processing_private.worker(text,jsonb)'::regprocedure);if strpos(d,'update ecod_external_private.policies')=0 then d:=replace(d,'update ecod_collaboration_private.connections','update ecod_external_private.policies set state=''paused'',accepted_at=null;update ecod_collaboration_private.connections');execute d;end if;
 d:=pg_get_functiondef('ecod_processing_private.api(text,uuid,text,jsonb,integer)'::regprocedure);d:=replace(d,'''formal'',74,''operations'',71','''formal'',78,''operations'',75');execute d;end$$;
commit;
