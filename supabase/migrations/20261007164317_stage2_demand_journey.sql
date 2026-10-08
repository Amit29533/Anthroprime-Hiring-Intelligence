begin;
create schema if not exists ecod_journey_private;
revoke all on schema ecod_journey_private from public,anon,authenticated;
grant usage on schema ecod_journey_private to authenticated;
create table if not exists ecod_journey_private.configurations(
 id uuid primary key,workspace_id uuid not null,demand_id uuid not null,version integer not null,body jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp(),
 unique(workspace_id,demand_id,version),foreign key(workspace_id,demand_id)references public.demands(workspace_id,id));
create table if not exists ecod_journey_private.claims(
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,kind text not null,name text not null,value jsonb not null,source text not null,observed date not null,valid_until date not null,confirmed boolean not null,actor uuid not null,at timestamptz not null default clock_timestamp(),supersedes uuid,
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create unique index if not exists journey_claim_correction on ecod_journey_private.claims(supersedes)where supersedes is not null;
create table if not exists ecod_journey_private.cycles(
 id uuid primary key,workspace_id uuid not null,demand_id uuid not null,candidate_id uuid not null,configuration_id uuid not null references ecod_journey_private.configurations(id),members jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,
 unique(workspace_id,id),foreign key(workspace_id,demand_id)references public.demands(workspace_id,id),foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create table if not exists ecod_journey_private.evaluations(
 id uuid primary key,workspace_id uuid not null,cycle_id uuid not null references ecod_journey_private.cycles(id),candidate_id uuid not null,actor uuid not null,scores jsonb not null,evidence jsonb not null,score numeric not null,at timestamptz not null default clock_timestamp(),valid_until date not null,
 unique(cycle_id,actor),foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create table if not exists ecod_journey_private.debriefs(
 id uuid primary key,workspace_id uuid not null,cycle_id uuid not null references ecod_journey_private.cycles(id),candidate_id uuid not null,decision text not null,reason text not null,actor uuid not null,at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,
 unique(cycle_id),foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id));
create table if not exists ecod_journey_private.gap_events(
 id uuid primary key,workspace_id uuid not null,demand_id uuid not null,candidate_id uuid not null,plan_id uuid not null,action text not null,body jsonb not null,actor uuid not null,at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id),foreign key(workspace_id,demand_id)references public.demands(workspace_id,id));
create table if not exists ecod_journey_private.decisions(
 id uuid primary key,workspace_id uuid not null,demand_id uuid not null,candidate_id uuid not null,cycle_id uuid references ecod_journey_private.cycles(id),decision text not null,reason text not null,source text not null,valid_until date,actor uuid not null,at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,
 foreign key(workspace_id,candidate_id)references public.candidates(workspace_id,id),foreign key(workspace_id,demand_id)references public.demands(workspace_id,id));
create table if not exists ecod_journey_private.receipts(
 workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid,demand_id uuid not null,fingerprint text not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
create index if not exists journey_claims_person on ecod_journey_private.claims(workspace_id,candidate_id,kind,name,at desc);
create index if not exists journey_cycles_person on ecod_journey_private.cycles(workspace_id,demand_id,candidate_id,sequence desc);
create index if not exists journey_decisions_person on ecod_journey_private.decisions(workspace_id,demand_id,candidate_id,sequence desc);
create index if not exists journey_gap_person on ecod_journey_private.gap_events(workspace_id,demand_id,candidate_id,plan_id,sequence desc);
do $$declare n text;begin foreach n in array array['configurations','claims','cycles','evaluations','debriefs','gap_events','decisions','receipts']loop execute format('alter table ecod_journey_private.%I enable row level security',n);execute format('revoke all on ecod_journey_private.%I from public,anon,authenticated',n);end loop;end$$;

create or replace function ecod_journey_private.configuration(ws uuid,d uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select to_jsonb(t)from ecod_journey_private.configurations t where workspace_id=ws and demand_id=d order by version desc limit 1
$$;
create or replace function ecod_journey_private.validate_configuration(p jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare x jsonb;k text;total numeric:=0;ids text[]:='{}';begin
 if jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>24000 or exists(select 1 from jsonb_object_keys(p)keys(key_name)where key_name<>all(array['requirements','kit','threshold','assessmentDays','reviewers','requireReadyForSubmission']))then raise exception 'Invalid demand journey configuration';end if;
 if jsonb_typeof(p->'requirements')is distinct from'array'or jsonb_array_length(p->'requirements')>40 or jsonb_typeof(p->'kit')is distinct from'array'or jsonb_array_length(p->'kit')not between 1 and 20 then raise exception 'Choose at most 40 constraints and 1 to 20 kit criteria';end if;
 foreach k in array array['threshold','assessmentDays','reviewers']loop if jsonb_typeof(p->k)is distinct from'number'then raise exception 'Configuration numbers are required';end if;end loop;
 if (p->>'threshold')::numeric not between 1 and 100 or(p->>'assessmentDays')::numeric not between 1 and 180 or(p->>'assessmentDays')::numeric<>trunc((p->>'assessmentDays')::numeric)or(p->>'reviewers')::numeric not between 1 and 5 or(p->>'reviewers')::numeric<>trunc((p->>'reviewers')::numeric)or jsonb_typeof(p->'requireReadyForSubmission')is distinct from'boolean'then raise exception 'Invalid validity, reviewer count or threshold';end if;
 for x in select value from jsonb_array_elements(p->'kit')loop
  if jsonb_typeof(x)is distinct from'object'or exists(select 1 from jsonb_object_keys(x)keys(key_name)where key_name<>all(array['id','label','weight','minScore']))or jsonb_typeof(x->'id')is distinct from'string'or coalesce(x->>'id','')!~'^[a-z][a-z0-9_]{0,39}$'or x->>'id'=any(ids)or jsonb_typeof(x->'label')is distinct from'string'or length(btrim(coalesce(x->>'label','')))not between 1 and 160 or jsonb_typeof(x->'weight')is distinct from'number'or(x->>'weight')::numeric not between 0.01 and 100 then raise exception 'Invalid or repeated kit criterion';end if;
  if x?'minScore'and(jsonb_typeof(x->'minScore')is distinct from'number'or(x->>'minScore')::numeric not between 0 and 100)then raise exception 'Invalid criterion passing floor';end if;
  ids:=array_append(ids,x->>'id');total:=total+(x->>'weight')::numeric;
 end loop;if total<>100 then raise exception 'Criterion weights must total 100';end if;ids:='{}';
 for x in select value from jsonb_array_elements(p->'requirements')loop
  if jsonb_typeof(x)is distinct from'object'or exists(select 1 from jsonb_object_keys(x)keys(key_name)where key_name<>all(array['id','kind','name','minimum','recencyDays','currency','basis','level']))or coalesce(x->>'id','')!~'^[a-z][a-z0-9_]{0,39}$'or x->>'id'=any(ids)or coalesce(x->>'kind','')not in('skill','experience','language','certification','eligibility','location','engagement','mode','notice','compensation')or jsonb_typeof(x->'name')is distinct from'string'or length(btrim(coalesce(x->>'name','')))not between 1 and 160 then raise exception 'Invalid or repeated requirement';end if;
  ids:=array_append(ids,x->>'id');
  if x->>'kind'in('skill','experience','notice','compensation')then if jsonb_typeof(x->'minimum')is distinct from'number'or(x->>'minimum')::numeric not between 0 and 1000000000000 then raise exception 'Invalid numeric requirement';end if;end if;
  if x?'level'and(x->>'kind'<>'skill'or coalesce(x->>'level','')not in('Exposure','Working','Proficient','Advanced','Expert'))then raise exception 'Invalid skill proficiency requirement';end if;
  if x->>'kind'in('skill','experience')and(x->>'minimum')::numeric>60 then raise exception 'Experience must be 0 to 60 years';end if;
  if x->>'kind'='notice'and(x->>'minimum')::numeric>3650 then raise exception 'Notice limit too large';end if;
  if x ?'recencyDays'and(jsonb_typeof(x->'recencyDays')is distinct from'number'or(x->>'recencyDays')::numeric not between 1 and 3650 or(x->>'recencyDays')::numeric<>trunc((x->>'recencyDays')::numeric))then raise exception 'Invalid evidence recency';end if;
  if x->>'kind'='language'and coalesce(x->>'minimum','')not in('Basic','Working','Fluent')then raise exception 'Choose a language level';end if;
  if x->>'kind'='compensation'and(coalesce(x->>'currency','')!~'^[A-Z]{3}$'or coalesce(x->>'basis','')not in('Annual','Monthly','Daily','Hourly'))then raise exception 'Specify compensation currency and basis';end if;
 end loop;
end$$;

create or replace function ecod_journey_private.inventory(ws uuid,d uuid,c uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare family uuid[];result jsonb;part jsonb;n text;begin
 result:=jsonb_build_object('configuration',ecod_journey_private.configuration(ws,d),'demand',(select to_jsonb(t)from public.demands t where workspace_id=ws and id=d));
 if c is null then return result;end if;family:=ecod_access_private.identity_family(ws,c);result:=result||jsonb_build_object('identities',to_jsonb(array(select unnest(family)order by 1)));
 result:=result||jsonb_build_object('candidate',(select to_jsonb(t)from public.candidates t where workspace_id=ws and id=c));
 foreach n in array array['employmentHistory','compensationHistory','availabilityHistory']loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by id),''[]'')from(select *from public.%I where workspace_id=$1 and "candidateId"=any($2)order by id limit 2001)t',n)into part using ws,family;
  if jsonb_array_length(part)>2000 then raise exception 'Fact history exceeds safe review limit';end if;result:=result||jsonb_build_object(n,part);
 end loop;
 foreach n in array array['claims','cycles','evaluations','debriefs','gap_events']loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from(select *from ecod_journey_private.%I where workspace_id=$1 and candidate_id=any($2)limit 1001)t',n)into part using ws,family;
  if jsonb_array_length(part)>1000 then raise exception 'Journey history exceeds safe review limit';end if;result:=result||jsonb_build_object(n,part);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')into part from(select *from public."personSkills"where workspace_id=ws and "candidateId"=any(family)order by id limit 1001)t;
 if jsonb_array_length(part)>1000 then raise exception 'Skill inventory exceeds safe limit';end if;result:=result||jsonb_build_object('personSkills',part);
 select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')into part from(select e.*from public."skillEvidence"e join public."personSkills"s on s.workspace_id=e.workspace_id and s.id=e."personSkillId"where s.workspace_id=ws and s."candidateId"=any(family)order by e.id limit 1001)t;
 if jsonb_array_length(part)>1000 or octet_length((result||jsonb_build_object('skillEvidence',part))::text)>2000000 then raise exception 'Evidence inventory exceeds safe limit';end if;return result||jsonb_build_object('skillEvidence',part);
end$$;
create or replace function ecod_journey_private.token(ws uuid,p jsonb)returns text language sql stable security invoker set search_path=''as $$select md5(secret||ws::text||p::text)from ecod_access_private.token_secret$$;
create or replace function ecod_journey_private.claim(ws uuid,c uuid,k text,n text)returns jsonb language sql stable security invoker set search_path=''as $$
 select to_jsonb(t)from ecod_journey_private.claims t where workspace_id=ws and candidate_id=any(ecod_access_private.identity_family(ws,c))and kind=k and lower(name)=lower(n)and not exists(select 1 from ecod_journey_private.claims child where child.workspace_id=ws and child.supersedes=t.id)order by at desc,id desc limit 1
$$;
create or replace function ecod_journey_private.scorecard_passes(p_config jsonb,p_record jsonb)returns boolean language sql immutable security invoker set search_path=''as $$
 select (p_record->>'score')::numeric>=(p_config->>'threshold')::numeric and not exists(select 1 from jsonb_array_elements(p_config->'kit')criterion where(p_record->'scores'->>(criterion->>'id'))::numeric<coalesce((criterion->>'minScore')::numeric,0))
$$;

create or replace function ecod_journey_private.checks(ws uuid,d uuid,c uuid,p_financial boolean)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare cfg jsonb:=ecod_journey_private.configuration(ws,d);person public.candidates;family uuid[];req jsonb;fact jsonb;state text;why text;items jsonb:='[]';day date:=(statement_timestamp()at time zone'UTC')::date;cutoff date;proof_until date;ev record;levels text[]:=array['Exposure','Working','Proficient','Advanced','Expert'];begin
 select *into person from public.candidates where workspace_id=ws and id=c and "mergedInto"is null;if not found then raise exception 'Candidate unavailable';end if;family:=ecod_access_private.identity_family(ws,c);
 if cfg is null then return jsonb_build_array(jsonb_build_object('id','configuration','name','Reviewed demand requirements','status','unknown','reason','No configured requirements and interview kit'));end if;
 items:=items||jsonb_build_array(jsonb_build_object('id','availability','name','Recruiting availability','status',case when person."processingRestricted"or person.status='Unavailable'then'failed'else'satisfied'end,'reason',case when person."processingRestricted"then'Outbound recruiting hold'when person.status='Unavailable'then'Candidate unavailable'else'Available for review'end));
 for req in select value from jsonb_array_elements(cfg->'body'->'requirements')loop
  state:='unknown';why:='No current confirmed evidence';fact:=null;proof_until:=null;cutoff:=day-coalesce((req->>'recencyDays')::integer,case when req->>'kind'='skill'then 365 else 120 end);
  if req->>'kind'='skill'then
   select e.*into ev from public."personSkills"s join public.skills skill on skill.workspace_id=s.workspace_id and skill.id=s."skillId"join public."skillEvidence"e on e.workspace_id=s.workspace_id and e."personSkillId"=s.id where s.workspace_id=ws and s."candidateId"=any(family)and lower(skill.name)=lower(req->>'name')and public.skill_evidence_weight(e."evidenceType")>=70 and e.date<=statement_timestamp()order by e.date desc,e.id desc limit 1;
   if found and (ev.date at time zone'UTC')::date>=cutoff and ev."lastUsed">=cutoff and ev."lastUsed"<=day and ev.years is not null then state:=case when ev.years>=(req->>'minimum')::numeric and array_position(levels,ev.proficiency)>=array_position(levels,coalesce(req->>'level','Working'))then'satisfied'else'failed'end;why:='Latest current validated skill evidence';proof_until:=least((ev.date at time zone'UTC')::date+coalesce((req->>'recencyDays')::integer,365),ev."lastUsed"+coalesce((req->>'recencyDays')::integer,365));end if;
  elsif req->>'kind'in('experience','language','certification','eligibility')then
   fact:=ecod_journey_private.claim(ws,c,req->>'kind',req->>'name');
   if fact->'confirmed'='true'::jsonb and(fact->>'observed')::date between cutoff and day and(fact->>'valid_until')::date>=day then
    state:=case when req->>'kind'='experience'then case when(fact->>'value')::numeric>=(req->>'minimum')::numeric then'satisfied'else'failed'end when req->>'kind'='language'then case when array_position(array['Basic','Working','Fluent'],fact->>'value')>=array_position(array['Basic','Working','Fluent'],req->>'minimum')then'satisfied'else'failed'end else case when fact->'value'='true'::jsonb then'satisfied'else'failed'end end;why:='Confirmed dated candidate evidence';proof_until:=least((fact->>'valid_until')::date,(fact->>'observed')::date+coalesce((req->>'recencyDays')::integer,120));
   end if;
  elsif req->>'kind'in('location','engagement')then
   select to_jsonb(t)into fact from public."employmentHistory"t where workspace_id=ws and "candidateId"=any(family)and verification='confirmed'and observed<=day and("startDate"is null or"startDate"<=day)and("endDate"is null or"endDate">=day)and not exists(select 1 from public."employmentHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by observed desc,"recordedAt"desc nulls last,id desc limit 1;
   if(fact->>'observed')::date>=cutoff and(ecod_access_private.confirmation_state('employment',to_jsonb(person),fact)->>'state')='matches-current'then state:=case when lower(case when req->>'kind'='location'then person.location else person.engagement end)=lower(req->>'name')then'satisfied'else'failed'end;why:='Current confirmed employment fact';proof_until:=least((fact->>'observed')::date+coalesce((req->>'recencyDays')::integer,120),(fact->>'endDate')::date);end if;
  elsif req->>'kind'in('notice','mode')then
   select to_jsonb(t)into fact from public."availabilityHistory"t where workspace_id=ws and "candidateId"=any(family)and verification='confirmed'and observed<=day and not exists(select 1 from public."availabilityHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by observed desc,"recordedAt"desc nulls last,id desc limit 1;
   if(fact->>'observed')::date>=cutoff and(ecod_access_private.confirmation_state('availability',to_jsonb(person),fact)->>'state')='matches-current'then
    if req->>'kind'='notice'and person.notice is not null then state:=case when person.notice<=(req->>'minimum')::numeric then'satisfied'else'failed'end;
    elsif req->>'kind'='mode'and person.mode<>''then state:=case when lower(person.mode)=lower(req->>'name')then'satisfied'else'failed'end;end if;why:='Current confirmed availability fact';proof_until:=(fact->>'observed')::date+coalesce((req->>'recencyDays')::integer,120);
   end if;
  elsif req->>'kind'='compensation'then
   if not p_financial then why:='Private compensation requires administrator review';else
    select to_jsonb(t)into fact from public."compensationHistory"t where workspace_id=ws and "candidateId"=any(family)and kind='expected'and verification='confirmed'and observed<=day and not exists(select 1 from public."compensationHistory"child where child.workspace_id=ws and child.supersedes=t.id)order by observed desc,"recordedAt"desc nulls last,id desc limit 1;
    if(fact->>'observed')::date>=cutoff and fact->>'amountUnit'='currency'and fact->>'currency'=req->>'currency'and fact->>'basis'=req->>'basis'and fact->'amount'<>'null'::jsonb then state:=case when(fact->>'amount')::numeric<=(req->>'minimum')::numeric then'satisfied'else'failed'end;why:='Confirmed expected pay in the declared currency and basis';proof_until:=(fact->>'observed')::date+coalesce((req->>'recencyDays')::integer,120);end if;
   end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',req->>'id','name',case when req->>'kind'='compensation'and not p_financial then'Private compensation review'else req->>'name'end,'kind',req->>'kind','status',state,'reason',why,'validUntil',proof_until));
 end loop;return items;
end$$;

create or replace function ecod_journey_private.state(ws uuid,d uuid,c uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare cfg jsonb:=ecod_journey_private.configuration(ws,d);inv jsonb;source text;decision ecod_journey_private.decisions;cycle ecod_journey_private.cycles;checks jsonb;status text:='Not validated';day date:=(statement_timestamp()at time zone'UTC')::date;begin
 inv:=ecod_journey_private.inventory(ws,d,c);source:=ecod_journey_private.token(ws,inv);checks:=ecod_journey_private.checks(ws,d,c,true);
 select *into decision from ecod_journey_private.decisions where workspace_id=ws and demand_id=d and candidate_id=c order by sequence desc limit 1;
 if found then
  status:=case when decision.decision='Revoked'then'Revoked'when decision.source<>source then'Needs review'when decision.valid_until<day then'Expired'when decision.decision='Ready'and exists(select 1 from jsonb_array_elements(checks)x where x->>'status'<>'satisfied')then'Needs review'else decision.decision end;
 end if;
 select *into cycle from ecod_journey_private.cycles where workspace_id=ws and demand_id=d and candidate_id=c order by sequence desc limit 1;
 return jsonb_build_object('state',status,'validatedReady',status='Ready','validUntil',decision.valid_until,'decisionId',decision.id,'cycleId',cycle.id,'configurationVersion',cfg->'version','source',source,'head',ecod_journey_private.token(ws,inv||jsonb_build_object('decision',to_jsonb(decision))));
end$$;

create or replace function ecod_journey_private.read_context(ws uuid,d uuid,c uuid,p_offset integer)returns jsonb language plpgsql security invoker set search_path=''as $$
declare cfg jsonb:=ecod_journey_private.configuration(ws,d);result jsonb;rows jsonb;family uuid[];cycle ecod_journey_private.cycles;evaluations jsonb;gap_rows jsonb;history jsonb;claims jsonb;cycle_history jsonb;begin
 if not exists(select 1 from public.demands where workspace_id=ws and id=d)then raise exception 'Demand not found in your workspace';end if;
 if c is null then return jsonb_build_object('configuration',case when public.is_admin()then cfg else cfg||jsonb_build_object('body',jsonb_set(cfg->'body','{requirements}',coalesce((select jsonb_agg(x)from jsonb_array_elements(cfg->'body'->'requirements')x where x->>'kind'<>'compensation'),'[]')))end,'head',ecod_journey_private.token(ws,ecod_journey_private.inventory(ws,d,null)));end if;
 family:=ecod_access_private.identity_family(ws,c);result:=ecod_journey_private.state(ws,d,c);
 if not exists(select 1 from public.candidates where workspace_id=ws and id=c and "mergedInto"is null)then raise exception 'Open the surviving candidate identity';end if;
 select *into cycle from ecod_journey_private.cycles where workspace_id=ws and demand_id=d and candidate_id=c order by sequence desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('passed',ecod_journey_private.scorecard_passes((select body from ecod_journey_private.configurations where id=cycle.configuration_id),to_jsonb(t)))order by at,id),'[]')into evaluations from ecod_journey_private.evaluations t where cycle_id=cycle.id;
 select coalesce(jsonb_agg(to_jsonb(t)order by sequence),'[]')into gap_rows from(select distinct on(plan_id)*from ecod_journey_private.gap_events where workspace_id=ws and demand_id=d and candidate_id=any(family) order by plan_id,sequence desc limit 26 offset p_offset)t;
 select coalesce(jsonb_agg(to_jsonb(t)-'source'order by sequence desc),'[]')into history from(select *from ecod_journey_private.decisions where workspace_id=ws and demand_id=d and candidate_id=any(family)order by sequence desc limit 26 offset p_offset)t;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('superseded',exists(select 1 from ecod_journey_private.claims child where child.workspace_id=ws and child.supersedes=t.id))order by at desc,id),'[]')into claims from(select *from ecod_journey_private.claims where workspace_id=ws and candidate_id=any(family)order by at desc,id limit 26 offset p_offset)t;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('configuration',(select jsonb_build_object('version',v.version,'kit',v.body->'kit','threshold',v.body->'threshold')from ecod_journey_private.configurations v where v.id=t.configuration_id),'evaluations',(select coalesce(jsonb_agg(to_jsonb(e)order by e.at,e.id),'[]')from ecod_journey_private.evaluations e where e.cycle_id=t.id),'debrief',(select to_jsonb(b)from ecod_journey_private.debriefs b where b.cycle_id=t.id))order by t.sequence desc),'[]')into cycle_history from(select *from ecod_journey_private.cycles where workspace_id=ws and demand_id=d and candidate_id=any(family)order by sequence desc limit 26 offset p_offset)t;
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',c,'server_read','Demand-specific ECOD journey',auth.uid()::text);
 return result||jsonb_build_object('configuration',case when public.is_admin()then cfg else cfg||jsonb_build_object('body',jsonb_set(cfg->'body','{requirements}',coalesce((select jsonb_agg(x)from jsonb_array_elements(cfg->'body'->'requirements')x where x->>'kind'<>'compensation'),'[]')))end,'checks',ecod_journey_private.checks(ws,d,c,public.is_admin()),'candidate',(select jsonb_build_object('id',id,'anthroId',"anthroId",'name',name,'title',title)from public.candidates where workspace_id=ws and id=c),'cycle',to_jsonb(cycle),'evaluations',evaluations,'debrief',(select to_jsonb(t)from ecod_journey_private.debriefs t where cycle_id=cycle.id),'gaps',case when jsonb_array_length(gap_rows)>25 then gap_rows-25 else gap_rows end,'gapsMore',jsonb_array_length(gap_rows)>25,'cycleHistory',case when jsonb_array_length(cycle_history)>25 then cycle_history-25 else cycle_history end,'cycleHistoryMore',jsonb_array_length(cycle_history)>25,'editors',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'label',u.email))from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=ws and m.role in('admin','recruiter')),'[]'),'evaluators',coalesce((select jsonb_agg(jsonb_build_object('member',a.member_id,'assignment',a.id,'label',u.email))from ecod_access_private.assignments a join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.member_id and m.role='assessor'join auth.users u on u.id=a.member_id where a.workspace_id=ws and a.target_id=c and a.kind='evaluation'and a.revoked_at is null and a.expires_at>clock_timestamp()),'[]'),'history',case when jsonb_array_length(history)>25 then history-25 else history end,'historyMore',jsonb_array_length(history)>25,'claims',case when jsonb_array_length(claims)>25 then claims-25 else claims end,'claimsMore',jsonb_array_length(claims)>25,'offset',p_offset);
end$$;
create or replace function ecod_journey_private.action(p_action text,p_demand uuid,p_candidate uuid,p_operation uuid,p_head text,p_payload jsonb,p_offset integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(p_action not in('context','shortlist','report'));cfg jsonb;context jsonb;fingerprint text;prior ecod_journey_private.receipts;result jsonb;version integer;family uuid[];x jsonb;parent ecod_journey_private.claims;cycle ecod_journey_private.cycles;gap ecod_journey_private.gap_events;debrief ecod_journey_private.debriefs;state jsonb;day date:=(statement_timestamp()at time zone'UTC')::date;expires date;members jsonb;rows jsonb;candidate_row record;item jsonb;last_gap timestamptz;cohorts jsonb;eligible_count integer:=0;ready_count integer:=0;total integer:=0;begin
 if p_action is null or p_action not in('context','configure','claim','start','debrief','gap_plan','gap_complete','gap_validate','decide','shortlist','report')or p_demand is null or p_offset is null or p_offset not between 0 and 1000000 or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>32000 then raise exception 'Invalid journey request';end if;
 if not exists(select 1 from public.demands where workspace_id=ws and id=p_demand)then raise exception 'Demand not found in your workspace';end if;
 if p_action='context'then return ecod_journey_private.read_context(ws,p_demand,p_candidate,p_offset);end if;
 if p_action in('shortlist','report')then
  if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['query','readyOnly','eligibleOnly']))or(p_payload?'query'and jsonb_typeof(p_payload->'query')is distinct from'string')or length(coalesce(p_payload->>'query',''))>200 or(p_payload?'readyOnly'and jsonb_typeof(p_payload->'readyOnly')<>'boolean')or(p_payload?'eligibleOnly'and jsonb_typeof(p_payload->'eligibleOnly')<>'boolean')then raise exception 'Invalid shortlist filters';end if;
  rows:='[]';
  for candidate_row in select id,name,"anthroId",title from public.candidates where workspace_id=ws and "mergedInto"is null and not "processingRestricted"and(coalesce(p_payload->>'query','')=''or strpos(lower(name||' '||"anthroId"),lower(p_payload->>'query'))>0)and(not coalesce((p_payload->>'readyOnly')::boolean,false)or(ecod_journey_private.state(ws,p_demand,id)->>'validatedReady')::boolean)and(not coalesce((p_payload->>'eligibleOnly')::boolean,false)or not exists(select 1 from jsonb_array_elements(ecod_journey_private.checks(ws,p_demand,id,public.is_admin()))finding(value)where finding.value->>'status'<>'satisfied'))order by id limit(case when p_action='report'then 1001 else 26 end)offset(case when p_action='report'then 0 else p_offset end)loop
   total:=total+1;if p_action='report'and total>1000 then exit;end if;
   item:=ecod_journey_private.state(ws,p_demand,candidate_row.id);context:=ecod_journey_private.checks(ws,p_demand,candidate_row.id,public.is_admin());
   if item->'validatedReady'='true'::jsonb then ready_count:=ready_count+1;end if;
   if not exists(select 1 from jsonb_array_elements(context)finding(value)where finding.value->>'status'<>'satisfied')then eligible_count:=eligible_count+1;end if;
   if p_action='shortlist'then rows:=rows||jsonb_build_array(to_jsonb(candidate_row)||jsonb_build_object('state',item->'state','validatedReady',item->'validatedReady','validUntil',item->'validUntil','checks',context,'eligible',not exists(select 1 from jsonb_array_elements(context)finding(value)where finding.value->>'status'<>'satisfied')));end if;
  end loop;
  if p_action='report'then
   select jsonb_build_object('periodDays',90,'startedAssessmentCycles',(select count(*)from ecod_journey_private.cycles t where t.workspace_id=ws and t.demand_id=p_demand and t.at>=statement_timestamp()-interval'90 days'),'sealedScorecards',(select count(*)from ecod_journey_private.evaluations e join ecod_journey_private.cycles t on t.id=e.cycle_id where t.workspace_id=ws and t.demand_id=p_demand and e.at>=statement_timestamp()-interval'90 days'),'validatedGapPlans',(select count(*)from ecod_journey_private.gap_events t where t.workspace_id=ws and t.demand_id=p_demand and t.action='Validated'and t.at>=statement_timestamp()-interval'90 days'),'reassessmentCycles',(select count(*)from ecod_journey_private.cycles t where t.workspace_id=ws and t.demand_id=p_demand and t.at>=statement_timestamp()-interval'90 days'and exists(select 1 from ecod_journey_private.cycles older where older.workspace_id=ws and older.demand_id=p_demand and older.candidate_id=any(ecod_access_private.identity_family(ws,t.candidate_id))and older.sequence<t.sequence)),'readyDecisionEvents',(select count(*)from ecod_journey_private.decisions t where t.workspace_id=ws and t.demand_id=p_demand and t.decision='Ready'and t.at>=statement_timestamp()-interval'90 days'),'coverage','Recorded demand journey events only; historical decisions are not current readiness')into cohorts;
   return jsonb_build_object('cohorts',cohorts,'reviewedPopulation',least(total,1000),'bounded',total>1000,'validatedReady',ready_count,'hardRequirementsSatisfied',eligible_count,'denominator','Active unheld candidates, up to 1000; readiness recomputed from current evidence','configurationVersion',ecod_journey_private.configuration(ws,p_demand)->'version');end if;
  perform ecod_access_private.audit_candidate_reads(ws,rows,'Demand journey shortlist');return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'offset',p_offset);
 end if;
 if p_operation is null or p_head is null then raise exception 'Operation and reviewed version are required';end if;
 if p_action in('configure','decide','gap_validate')and not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;
 if p_action in('configure','decide','gap_validate')then perform ecod_private.require_privileged_mfa(ws);end if;
 perform 1 from public.workspaces where id=ws for update;
 fingerprint:=ecod_journey_private.token(ws,jsonb_build_array(p_action,p_demand,p_candidate,p_head,p_payload));
 select *into prior from ecod_journey_private.receipts where workspace_id=ws and actor=auth.uid() and id=p_operation;
 if found then if prior.actor<>auth.uid()or prior.fingerprint<>fingerprint then raise exception 'Journey operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if p_candidate is not null then perform 1 from public.candidates where workspace_id=ws and id=p_candidate and "mergedInto"is null for update;if not found then raise exception 'Candidate not found or retired';end if;end if;
 context:=ecod_journey_private.read_context(ws,p_demand,p_candidate,0);
 if context->>'head'<>p_head then raise exception 'Journey evidence or configuration changed; refresh and review without discarding your draft';end if;
 cfg:=ecod_journey_private.configuration(ws,p_demand);
 if p_action='configure'then
  if p_candidate is not null then raise exception 'Configure the demand, not one candidate';end if;
  perform ecod_journey_private.validate_configuration(p_payload);version:=coalesce((cfg->>'version')::integer,0)+1;
  insert into ecod_journey_private.configurations(id,workspace_id,demand_id,version,body,actor)values(p_operation,ws,p_demand,version,p_payload,auth.uid());result:=jsonb_build_object('version',version);
 else
  if p_candidate is null or cfg is null then raise exception 'Configure requirements and select a candidate first';end if;
  if (select "processingRestricted"from public.candidates where workspace_id=ws and id=p_candidate)and p_action not in('claim','decide')then raise exception 'Candidate has an outbound recruiting hold';end if;
  family:=ecod_access_private.identity_family(ws,p_candidate);
  select *into cycle from ecod_journey_private.cycles where workspace_id=ws and demand_id=p_demand and candidate_id=p_candidate order by sequence desc limit 1;
  if p_action='claim'then
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['kind','name','value','source','observed','validUntil','confirmed','supersedes']))or coalesce(p_payload->>'kind','')not in('experience','language','certification','eligibility')or jsonb_typeof(p_payload->'name')is distinct from'string'or length(btrim(p_payload->>'name'))not between 1 and 160 or jsonb_typeof(p_payload->'source')is distinct from'string'or length(btrim(p_payload->>'source'))not between 3 and 2000 or jsonb_typeof(p_payload->'confirmed')is distinct from'boolean'then raise exception 'Invalid sourced candidate evidence';end if;
   expires:=ecod_access_private.fact_date(p_payload->'validUntil','evidence validity');
   if ecod_access_private.fact_date(p_payload->'observed','observation')is null or expires is null or ecod_access_private.fact_date(p_payload->'observed','observation')>day or expires<day or expires>day+366 or expires<ecod_access_private.fact_date(p_payload->'observed','observation')then raise exception 'Evidence dates must be current with validity up to 366 days';end if;
   if p_payload->>'kind'='experience'then if jsonb_typeof(p_payload->'value')is distinct from'number'or(p_payload->>'value')::numeric not between 0 and 60 then raise exception 'Experience must be 0 to 60 years';end if;
   elsif p_payload->>'kind'='language'then if jsonb_typeof(p_payload->'value')is distinct from'string'or p_payload->>'value'not in('Basic','Working','Fluent')then raise exception 'Invalid language proficiency';end if;
   elsif jsonb_typeof(p_payload->'value')is distinct from'boolean'then raise exception 'Eligibility/certification evidence must be true or false';end if;
   if nullif(p_payload->>'supersedes','')is not null then
    select *into parent from ecod_journey_private.claims where id=(p_payload->>'supersedes')::uuid and workspace_id=ws and candidate_id=any(family)for update;
    if not found or parent.kind<>p_payload->>'kind'or lower(parent.name)<>lower(btrim(p_payload->>'name'))then raise exception 'Correction must preserve the evidence kind and name';end if;
   end if;
   insert into ecod_journey_private.claims(id,workspace_id,candidate_id,kind,name,value,source,observed,valid_until,confirmed,actor,supersedes)values(p_operation,ws,p_candidate,p_payload->>'kind',btrim(p_payload->>'name'),p_payload->'value',btrim(p_payload->>'source'),ecod_access_private.fact_date(p_payload->'observed','observation'),expires,(p_payload->>'confirmed')::boolean,auth.uid(),parent.id);result:=jsonb_build_object('recordedId',p_operation);
  elsif p_action='start'then
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>'members')or jsonb_typeof(p_payload->'members')is distinct from'array'or jsonb_array_length(p_payload->'members')<>(cfg->'body'->>'reviewers')::integer then raise exception 'Assign the configured number of independent assessors';end if;
   if cycle.id is not null and not exists(select 1 from ecod_journey_private.debriefs where cycle_id=cycle.id)then raise exception 'Debrief or cancel the previous cycle before reassessment';end if;
   members:='[]';
   for x in select value from jsonb_array_elements(p_payload->'members')loop
    if jsonb_typeof(x)is distinct from'object'or exists(select 1 from jsonb_object_keys(x)keys(key_name)where key_name<>all(array['member','assignment']))then raise exception 'Invalid evaluator assignment';end if;
    if exists(select 1 from jsonb_array_elements(members)y where y->>'member'=x->>'member')then raise exception 'Use distinct assessors';end if;
    if not exists(select 1 from ecod_access_private.assignments a join public.memberships m on m.workspace_id=a.workspace_id and m.user_id=a.member_id and m.role='assessor'where a.workspace_id=ws and a.id=(x->>'assignment')::uuid and a.member_id=(x->>'member')::uuid and a.kind='evaluation'and a.target_id=p_candidate and a.revoked_at is null and a.expires_at>clock_timestamp())then raise exception 'Active matching assessor assignment required';end if;
    members:=members||jsonb_build_array(x);
   end loop;
   insert into ecod_journey_private.cycles(id,workspace_id,demand_id,candidate_id,configuration_id,members,actor)values(p_operation,ws,p_demand,p_candidate,(cfg->>'id')::uuid,members,auth.uid());result:=jsonb_build_object('cycleId',p_operation);
  elsif p_action='debrief'then
   if cycle.id is null or(cycle.configuration_id<>(cfg->>'id')::uuid and p_payload->>'decision' is distinct from'Cancelled')then raise exception 'Start an assessment for the current configuration, or cancel the obsolete cycle';end if;
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['decision','reason']))or coalesce(p_payload->>'decision','')not in('Pass','Gap','Not-ready','Cancelled')or length(btrim(coalesce(p_payload->>'reason','')))not between 10 and 4000 then raise exception 'Record a debrief decision and evidence';end if;
   if p_payload->>'decision'<>'Cancelled'and(select count(*)from ecod_journey_private.evaluations where cycle_id=cycle.id)<>jsonb_array_length(cycle.members)then raise exception 'Wait for every independent scorecard';end if;
   if p_payload->>'decision'='Pass'and exists(select 1 from ecod_journey_private.evaluations e where cycle_id=cycle.id and(not ecod_journey_private.scorecard_passes(cfg->'body',to_jsonb(e))or valid_until<day))then raise exception 'A failed or expired scorecard requires a gap or not-ready decision';end if;
   insert into ecod_journey_private.debriefs(id,workspace_id,cycle_id,candidate_id,decision,reason,actor)values(p_operation,ws,cycle.id,p_candidate,p_payload->>'decision',btrim(p_payload->>'reason'),auth.uid());result:=jsonb_build_object('debriefId',p_operation);
  elsif p_action='gap_plan'then
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['objective','evidenceRequired','owner','due','readyEstimate']))or length(btrim(coalesce(p_payload->>'objective','')))not between 10 and 2000 or length(btrim(coalesce(p_payload->>'evidenceRequired','')))not between 10 and 2000 then raise exception 'Specify gap objective and required completion evidence';end if;
   if not exists(select 1 from public.memberships where workspace_id=ws and user_id=(p_payload->>'owner')::uuid and role in('admin','recruiter'))then raise exception 'Gap owner must be an active editor';end if;
   expires:=ecod_access_private.fact_date(p_payload->'due','gap due date');if expires is null or ecod_access_private.fact_date(p_payload->'readyEstimate','ready estimate')is null or expires<day or expires>day+366 or ecod_access_private.fact_date(p_payload->'readyEstimate','ready estimate')<expires or ecod_access_private.fact_date(p_payload->'readyEstimate','ready estimate')>day+366 then raise exception 'Use future due/ready dates within 366 days';end if;
   insert into ecod_journey_private.gap_events(id,workspace_id,demand_id,candidate_id,plan_id,action,body,actor)values(p_operation,ws,p_demand,p_candidate,p_operation,'Planned',p_payload,auth.uid());result:=jsonb_build_object('planId',p_operation);
  elsif p_action in('gap_complete','gap_validate')then
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['plan','evidence']))or length(btrim(coalesce(p_payload->>'evidence','')))not between 10 and 4000 then raise exception 'Completion/validation requires sourced evidence';end if;
   select *into gap from ecod_journey_private.gap_events where workspace_id=ws and demand_id=p_demand and candidate_id=any(family) and plan_id=(p_payload->>'plan')::uuid order by sequence desc limit 1;
   if not found then raise exception 'Gap plan unavailable';end if;
   if p_action='gap_complete'and(gap.action<>'Planned'or(not public.is_admin()and gap.body->>'owner'<>auth.uid()::text))then raise exception 'Only the owner or administrator may complete an open plan';end if;
   if p_action='gap_validate'and(gap.action<>'Complete'or gap.actor=auth.uid())then raise exception 'An independent administrator must validate completion evidence';end if;
   insert into ecod_journey_private.gap_events(id,workspace_id,demand_id,candidate_id,plan_id,action,body,actor)values(p_operation,ws,p_demand,p_candidate,gap.plan_id,case when p_action='gap_complete'then'Complete'else'Validated'end,gap.body||jsonb_build_object(p_action,p_payload->>'evidence'),auth.uid());result:=jsonb_build_object('planId',gap.plan_id);
  elsif p_action='decide'then
   if exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['decision','reason','days']))or coalesce(p_payload->>'decision','')not in('Ready','Near-ready','Not-ready','Revoked')or length(btrim(coalesce(p_payload->>'reason','')))not between 10 and 4000 or jsonb_typeof(p_payload->'days')is distinct from'number'or(p_payload->>'days')::numeric not between 1 and 180 or(p_payload->>'days')::numeric<>trunc((p_payload->>'days')::numeric)then raise exception 'Record decision, 10-character evidence and 1 to 180 validity days';end if;
   expires:=day+(p_payload->>'days')::integer;
   if p_payload->>'decision'='Ready'then
    if cycle.id is null or cycle.configuration_id<>(cfg->>'id')::uuid then raise exception 'Current requirements need a new assessment';end if;
    if exists(select 1 from ecod_journey_private.evaluations where cycle_id=cycle.id and actor=auth.uid())then raise exception 'Validator must be independent of the assessors';end if;
    if exists(select 1 from jsonb_array_elements(ecod_journey_private.checks(ws,p_demand,p_candidate,true))finding(value)where finding.value->>'status'<>'satisfied')then raise exception 'Every hard requirement needs current confirmed passing evidence';end if;
    select *into debrief from ecod_journey_private.debriefs where cycle_id=cycle.id;if not found or debrief.decision<>'Pass'then raise exception 'A passing debrief is required';end if;
    if (select count(*)from ecod_journey_private.evaluations where cycle_id=cycle.id)<>jsonb_array_length(cycle.members)or exists(select 1 from ecod_journey_private.evaluations e where cycle_id=cycle.id and(not ecod_journey_private.scorecard_passes(cfg->'body',to_jsonb(e))or valid_until<day))then raise exception 'Current independent passing scorecards are required';end if;
    if exists(select 1 from(select distinct on(plan_id)action from ecod_journey_private.gap_events where workspace_id=ws and demand_id=p_demand and candidate_id=any(family) order by plan_id,sequence desc)t where action<>'Validated')then raise exception 'Complete and independently validate every gap plan';end if;
    select max(at)into last_gap from ecod_journey_private.gap_events where workspace_id=ws and demand_id=p_demand and candidate_id=any(family) and action='Validated';
    if last_gap is not null and cycle.at<=last_gap then raise exception 'Reassess after enrichment validation';end if;
    select least(expires,min(valid_until))into expires from ecod_journey_private.evaluations where cycle_id=cycle.id;
    select least(expires,min((value->>'validUntil')::date))into expires from jsonb_array_elements(ecod_journey_private.checks(ws,p_demand,p_candidate,true));
   end if;
   state:=ecod_journey_private.state(ws,p_demand,p_candidate);
   insert into ecod_journey_private.decisions(id,workspace_id,demand_id,candidate_id,cycle_id,decision,reason,source,valid_until,actor)values(p_operation,ws,p_demand,p_candidate,cycle.id,p_payload->>'decision',btrim(p_payload->>'reason'),state->>'source',expires,auth.uid());result:=jsonb_build_object('decisionId',p_operation,'validUntil',expires);
  end if;
 end if;
 result:=result||jsonb_build_object('replayed',false);
 insert into ecod_journey_private.receipts(workspace_id,actor,id,candidate_id,demand_id,fingerprint,result)values(ws,auth.uid(),p_operation,p_candidate,p_demand,fingerprint,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when p_candidate is null then'demands'else'candidates'end,coalesce(p_candidate,p_demand),'journey_'||p_action,p_operation::text,auth.uid()::text);return result;
end$$;
create or replace function ecod_journey_private.assigned(p_cycle uuid,p_operation uuid,p_head text,p_payload jsonb,p_offset integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.selected_workspace();cycle ecod_journey_private.cycles;cfg jsonb;assignment ecod_access_private.assignments;member jsonb;rows jsonb;request_hash text;head text;prior ecod_journey_private.evaluations;criterion jsonb;k text;total numeric:=0;points numeric;expires date;begin
 if ws is null or not exists(select 1 from public.memberships where workspace_id=ws and user_id=auth.uid()and role='assessor')then raise exception 'Assessor access required'using errcode='42501';end if;
 if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Invalid assigned journey page';end if;
 if p_cycle is null then
  select coalesce(jsonb_agg(to_jsonb(t)order by sequence desc),'[]')into rows from(select c.id,c.demand_id,c.candidate_id,c.sequence,d.title demand_title from ecod_journey_private.cycles c join public.demands d on d.workspace_id=c.workspace_id and d.id=c.demand_id where c.workspace_id=ws and exists(select 1 from jsonb_array_elements(c.members)x join ecod_access_private.assignments a on a.id=(x->>'assignment')::uuid and a.workspace_id=ws where x->>'member'=auth.uid()::text and a.member_id=auth.uid()and a.target_id=c.candidate_id and a.kind='evaluation'and a.revoked_at is null and a.expires_at>clock_timestamp())and not exists(select 1 from ecod_journey_private.cycles newer where newer.workspace_id=ws and newer.demand_id=c.demand_id and newer.candidate_id=c.candidate_id and newer.sequence>c.sequence)and not exists(select 1 from public.candidates p where p.workspace_id=ws and p.id=c.candidate_id and(p."mergedInto"is not null or p."processingRestricted"))order by c.sequence desc limit 26 offset p_offset)t;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 select *into cycle from ecod_journey_private.cycles where workspace_id=ws and id=p_cycle for share;if not found then raise exception 'Assessment cycle unavailable';end if;
 select x into member from jsonb_array_elements(cycle.members)x where x->>'member'=auth.uid()::text;
 if member is null then raise exception 'Assessment is not assigned to you'using errcode='42501';end if;
 assignment:=ecod_access_private.assigned_context((member->>'assignment')::uuid);
 if assignment.kind<>'evaluation'or assignment.target_id<>cycle.candidate_id then raise exception 'Assignment does not match assessment';end if;
 perform 1 from public.candidates where workspace_id=ws and id=cycle.candidate_id and "mergedInto"is null and not "processingRestricted"for share;if not found then raise exception 'Assigned candidate unavailable';end if;
 if exists(select 1 from ecod_journey_private.cycles newer where newer.workspace_id=ws and newer.demand_id=cycle.demand_id and newer.candidate_id=cycle.candidate_id and newer.sequence>cycle.sequence)then raise exception 'Use the current reassessment cycle';end if;
 select to_jsonb(t)into cfg from ecod_journey_private.configurations t where id=cycle.configuration_id;
 if (ecod_journey_private.configuration(ws,cycle.demand_id)->>'id')::uuid<>cycle.configuration_id then raise exception 'Requirements changed; request a new assessment cycle';end if;
 head:=ecod_journey_private.token(ws,to_jsonb(cycle)||jsonb_build_object('assignmentVersion',assignment.version));
 select *into prior from ecod_journey_private.evaluations where cycle_id=cycle.id and actor=auth.uid();
 if p_operation is null then
  insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',cycle.candidate_id,'server_read','Assigned blind demand scorecard',auth.uid()::text);
  return jsonb_build_object('head',head,'cycleId',cycle.id,'kit',cfg->'body'->'kit','configurationVersion',cfg->'version','candidate',(select jsonb_build_object('id',id,'anthroId',"anthroId",'name',name,'title',title)from public.candidates where workspace_id=ws and id=cycle.candidate_id),'ownEvaluation',case when prior.id is null then null else to_jsonb(prior)end,'closed',exists(select 1 from ecod_journey_private.debriefs where cycle_id=cycle.id));
 end if;
 if p_head is distinct from head then raise exception 'Assignment or assessment version changed; refresh';end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>48000 or exists(select 1 from jsonb_object_keys(p_payload)keys(key_name)where key_name<>all(array['scores','evidence']))or jsonb_typeof(p_payload->'scores')is distinct from'object'or jsonb_typeof(p_payload->'evidence')is distinct from'object'then raise exception 'Submit criterion scores and evidence only';end if;
 request_hash:=ecod_journey_private.token(ws,jsonb_build_array(cycle.id,auth.uid(),p_head,p_payload));
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||cycle.id::text||':'||auth.uid()::text,0));
 select *into prior from ecod_journey_private.evaluations where cycle_id=cycle.id and actor=auth.uid();
 if prior.id is not null then
  if prior.id<>p_operation or ecod_journey_private.token(ws,jsonb_build_array(cycle.id,auth.uid(),p_head,jsonb_build_object('scores',prior.scores,'evidence',prior.evidence)))<>request_hash then raise exception 'Sealed scorecard conflict; use reassessment';end if;
  return jsonb_build_object('recordedId',prior.id,'score',prior.score,'replayed',true);
 end if;
 if exists(select 1 from ecod_journey_private.debriefs where cycle_id=cycle.id)then raise exception 'Debrief closed this assessment';end if;
 if (select count(*)from jsonb_object_keys(p_payload->'scores'))<>jsonb_array_length(cfg->'body'->'kit')or (select count(*)from jsonb_object_keys(p_payload->'evidence'))<>jsonb_array_length(cfg->'body'->'kit')then raise exception 'Complete every frozen criterion';end if;
 for criterion in select value from jsonb_array_elements(cfg->'body'->'kit')loop
  k:=criterion->>'id';if jsonb_typeof(p_payload->'scores'->k)is distinct from'number'or(p_payload->'scores'->>k)::numeric not between 0 and 100 or jsonb_typeof(p_payload->'evidence'->k)is distinct from'string'or length(btrim(p_payload->'evidence'->>k))not between 10 and 2000 then raise exception 'Every criterion needs a 0 to 100 score and source evidence';end if;
  points:=(p_payload->'scores'->>k)::numeric;total:=total+points*(criterion->>'weight')::numeric/100;
 end loop;
 expires:=(statement_timestamp()at time zone'UTC')::date+(cfg->'body'->>'assessmentDays')::integer;
 insert into ecod_journey_private.evaluations(id,workspace_id,cycle_id,candidate_id,actor,scores,evidence,score,valid_until)values(p_operation,ws,cycle.id,cycle.candidate_id,auth.uid(),p_payload->'scores',p_payload->'evidence',round(total,2),expires);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'candidates',cycle.candidate_id,'demand_scorecard',p_operation::text,auth.uid()::text);
 return jsonb_build_object('recordedId',p_operation,'score',round(total,2),'replayed',false);
end$$;
create or replace function public.api_demand_journey(p_action text default'context',p_demand uuid default null,p_candidate uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_journey_private.action(p_action,p_demand,p_candidate,p_operation,p_head,p_payload,p_offset)$$;
create or replace function public.api_assigned_demand_journey(p_cycle uuid default null,p_operation uuid default null,p_head text default null,p_payload jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_journey_private.assigned(p_cycle,p_operation,p_head,p_payload,p_offset)$$;
revoke all on all functions in schema ecod_journey_private from public,anon,authenticated;
revoke all on function public.api_demand_journey(text,uuid,uuid,uuid,text,jsonb,integer),public.api_assigned_demand_journey(uuid,uuid,text,jsonb,integer)from public,anon,authenticated;
grant execute on function ecod_journey_private.action(text,uuid,uuid,uuid,text,jsonb,integer),ecod_journey_private.assigned(uuid,uuid,text,jsonb,integer),public.api_demand_journey(text,uuid,uuid,uuid,text,jsonb,integer),public.api_assigned_demand_journey(uuid,uuid,text,jsonb,integer)to authenticated;
commit;
