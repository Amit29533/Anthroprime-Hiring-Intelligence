begin;
create schema if not exists ecod_foundation_private;
revoke all on schema ecod_foundation_private from public,anon,authenticated;
create table if not exists ecod_foundation_private.views(id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor uuid not null references auth.users(id),name text not null,body jsonb not null,at timestamptz not null default clock_timestamp());
create unique index if not exists foundation_view_name on ecod_foundation_private.views(workspace_id,actor,lower(name));
create table if not exists ecod_foundation_private.quality_events(id uuid primary key,workspace_id uuid not null references public.workspaces(id),candidate_id uuid references public.candidates(id),kind text not null,target text not null,source text not null,status text not null,assignee uuid references auth.users(id),reason text not null,actor uuid not null,sequence bigint generated always as identity,at timestamptz not null default clock_timestamp());
create index if not exists foundation_quality_target on ecod_foundation_private.quality_events(workspace_id,kind,target,sequence desc);
create index if not exists foundation_quality_candidate on ecod_foundation_private.quality_events(workspace_id,candidate_id);
create table if not exists ecod_foundation_private.task_events(id uuid primary key,workspace_id uuid not null references public.workspaces(id),candidate_id uuid references public.candidates(id),task_id uuid not null references public.tasks(id),assignee uuid references auth.users(id),before_state jsonb not null,after_state jsonb not null,reason text not null,actor uuid not null,sequence bigint generated always as identity,at timestamptz not null default clock_timestamp());
create index if not exists foundation_task_target on ecod_foundation_private.task_events(workspace_id,task_id,sequence desc);
create index if not exists foundation_task_candidate on ecod_foundation_private.task_events(workspace_id,candidate_id);
create table if not exists ecod_foundation_private.receipts(workspace_id uuid not null,actor uuid not null,id uuid not null,candidate_id uuid references public.candidates(id),action text not null,request jsonb not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,id));
create index if not exists foundation_receipt_candidate on ecod_foundation_private.receipts(workspace_id,candidate_id);
create index if not exists foundation_receipt_quota on ecod_foundation_private.receipts(workspace_id,actor,action,at);
do $$declare t text;begin foreach t in array array['views','quality_events','task_events','receipts']loop execute format('alter table ecod_foundation_private.%I enable row level security',t);end loop;end$$;
revoke all on all tables in schema ecod_foundation_private from public,anon,authenticated;
create index if not exists foundation_task_owner on public.tasks(workspace_id,owner,done,due,id);

create or replace function ecod_foundation_private.hash(v jsonb)returns text language sql stable security invoker set search_path=''as $$select md5(secret||v::text)from ecod_access_private.token_secret where id$$;
create or replace function ecod_foundation_private.fields(ws uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',md5('candidates:'||(f->>'name')),'version',md5(f::text),'name',f->>'name','type',f->>'type','options',coalesce(f->'options','[]'),'archived',coalesce((f->>'archived')::boolean,false))order by f->>'name'),'[]')from jsonb_array_elements(coalesce((select custom->'customFields'->'candidates'from public.settings where workspace_id=ws and id='workspace'),'[]'))f
$$;
create or replace function ecod_foundation_private.validate(ws uuid,p jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare x jsonb;f jsonb;b jsonb;n numeric;begin
 if jsonb_typeof(p)is distinct from'object'or octet_length(p::text)>4000 then raise exception 'Invalid filter document';end if;
 if p?'version'then
  if p->'version'is distinct from'1'::jsonb or exists(select 1 from jsonb_object_keys(p)k where k<>all(array['version','base','custom']))or jsonb_typeof(p->'base')is distinct from'object'or jsonb_typeof(p->'custom')is distinct from'array'or jsonb_array_length(p->'custom')>8 then raise exception 'Unsupported filter version or criteria';end if;b:=p->'base';
 else b:=p;end if;
 perform public.repository_validate_filters(b-'payCurrency'-'payBasis');
 if b?'payCurrency'and(jsonb_typeof(b->'payCurrency')<>'string'or coalesce(b->>'payCurrency','')!~'^[A-Z]{3}$')or b?'payBasis'and coalesce(b->>'payBasis','')not in('Annual','Monthly','Hourly','Daily')then raise exception 'Declare pay currency and basis';end if;
 if nullif(b->>'maxExpected','')is not null then perform ecod_private.require_privileged_mfa(ws);end if;
 if nullif(b->>'maxExpected','')is not null and (not(b?'payCurrency')or not(b?'payBasis'))then raise exception 'Compensation requires declared currency and basis';end if;
 if coalesce(b->>'sort','name')not in('name','verified','experience','notice')then raise exception 'Invalid sort';end if;
 if nullif(b->>'minExperience','')is not null and coalesce(b->>'minExperience','')in('NaN','Infinity','-Infinity')or nullif(b->>'maxExperience','')is not null and coalesce(b->>'maxExperience','')in('NaN','Infinity','-Infinity')then raise exception 'Finite experience required';end if;
 for x in select value from jsonb_array_elements(coalesce(p->'custom','[]'))loop
  if jsonb_typeof(x)<>'object'or exists(select 1 from jsonb_object_keys(x)k where k<>all(array['id','version','op','value']))then raise exception 'Invalid custom predicate';end if;
  select value into f from jsonb_array_elements(ecod_foundation_private.fields(ws))where value->>'id'=x->>'id';
  if f is null or (f->>'archived')::boolean or f->>'version'is distinct from x->>'version'then raise exception 'Custom definition changed or archived; correct this view'using errcode='40001';end if;
  if x->>'op'in('missing','exists')then if x?'value'then raise exception 'Existence predicate has no value';end if;continue;end if;
  if x->>'op'is null or x->>'op'not in('eq','contains','gte','lte')or not(x?'value')then raise exception 'Invalid custom operator';end if;
  if f->>'type'='number'then
   if jsonb_typeof(x->'value')<>'number'or x->>'op'='contains'then raise exception 'Numeric predicate requires finite number';end if;n:=(x->>'value')::numeric;
   if n::text in('NaN','Infinity','-Infinity')or abs(n)>1000000000000000 then raise exception 'Numeric predicate out of bounds';end if;
  elsif f->>'type'='date'then
   if jsonb_typeof(x->'value')<>'string'or x->>'op'='contains'or x->>'value'!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'Date predicate requires ISO date';end if;perform(x->>'value')::date;
  else
   if jsonb_typeof(x->'value')<>'string'or length(x->>'value')not between 1 and 500 or x->>'op'not in('eq','contains')or(f->>'type'='select'and(x->>'op'<>'eq'or not(f->'options'?(x->>'value'))))then raise exception 'Invalid text or choice predicate';end if;
  end if;
 end loop;
end$$;
create or replace function ecod_foundation_private.matches(ws uuid,c public.candidates,p jsonb)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare b jsonb:=case when p?'version'then p->'base'else p end;x jsonb;f jsonb;v jsonb;fv jsonb;begin
 if c."mergedInto"is not null then return false;end if;
 if nullif(b->>'query','')is not null and position(lower(btrim(b->>'query'))in lower(c.name||' '||coalesce(c."anthroId",'')||' '||coalesce(array_to_string(c.skills,' '),'')))=0 then return false;end if;
 if nullif(b->>'status','')is not null and c.status<>b->>'status'or nullif(b->>'engagement','')is not null and c.engagement is distinct from(b->>'engagement')or nullif(b->>'mode','')is not null and c.mode<>b->>'mode'then return false;end if;
 if nullif(b->>'location','')is not null and position(lower(b->>'location')in lower(c.location))=0 or nullif(b->>'employer','')is not null and position(lower(btrim(b->>'employer'))in lower(c.company))=0 then return false;end if;
 if nullif(b->>'skill','')is not null and not exists(select 1 from unnest(c.skills)s where lower(s)=lower(b->>'skill'))then return false;end if;
 if nullif(b->>'tag','')is not null and not((b->>'tag')=any(c.tags))then return false;end if;
 if nullif(b->>'minExperience','')is not null and(c.experience is null or c.experience<(b->>'minExperience')::numeric)or nullif(b->>'maxExperience','')is not null and(c.experience is null or c.experience>(b->>'maxExperience')::numeric)or nullif(b->>'maxNotice','')is not null and(c.notice is null or c.notice>(b->>'maxNotice')::integer)then return false;end if;
 if nullif(b->>'maxExpected','')is not null then
  select to_jsonb(h)into fv from public."compensationHistory"h where h.workspace_id=ws and h."candidateId"=any(ecod_access_private.identity_family(ws,c.id))and h.kind='expected'and h.observed<=(statement_timestamp()at time zone'UTC')::date and not exists(select 1 from public."compensationHistory"child where child.workspace_id=ws and child.supersedes=h.id)order by h.observed desc,h."recordedAt"desc,h.id desc limit 1;
  if not coalesce(fv->>'verification'='confirmed'and fv->>'currency'=b->>'payCurrency'and fv->>'basis'=b->>'payBasis'and fv->>'amountUnit'='currency'and(fv->>'amount')::numeric<=(b->>'maxExpected')::numeric and(fv->>'observed')::date>=(statement_timestamp()at time zone'UTC')::date-120,false)then return false;end if;
 end if;
 for x in select value from jsonb_array_elements(coalesce(p->'custom','[]'))loop
  select value into f from jsonb_array_elements(ecod_foundation_private.fields(ws))where value->>'id'=x->>'id';v:=c.custom->(f->>'name');
  if x->>'op'='missing'then if v is not null and v<>'null'::jsonb and v<>'""'::jsonb then return false;end if;continue;end if;
  if x->>'op'='exists'then if v is null or v='null'::jsonb or v='""'::jsonb then return false;end if;continue;end if;
  if v is null or v='null'::jsonb or v='""'::jsonb then return false;end if;fv:=x->'value';
  if x->>'op'='eq'and v<>fv then return false;elsif x->>'op'='contains'and position(lower(fv#>>'{}')in lower(v#>>'{}'))=0 then return false;
  elsif x->>'op'in('gte','lte')then
   if f->>'type'='number'then if(x->>'op'='gte'and(v#>>'{}')::numeric<(fv#>>'{}')::numeric)or(x->>'op'='lte'and(v#>>'{}')::numeric>(fv#>>'{}')::numeric)then return false;end if;
   elsif f->>'type'='date'then if(x->>'op'='gte'and(v#>>'{}')::date<(fv#>>'{}')::date)or(x->>'op'='lte'and(v#>>'{}')::date>(fv#>>'{}')::date)then return false;end if;end if;
  end if;
 end loop;return true;
end$$;
create or replace function ecod_foundation_private.filtered(ws uuid,p jsonb,cursor jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare b jsonb:=case when p?'version'then p->'base'else p end;sort text:=coalesce(b->>'sort','name');rows jsonb;stamp text:=ecod_foundation_private.hash(jsonb_build_array(ws,p));last jsonb;begin
 perform ecod_foundation_private.validate(ws,p);
 if cursor is not null and (jsonb_typeof(cursor)<>'object'or cursor->>'head'is distinct from stamp or not(cursor?'id')or not(cursor?'name')or not(cursor?'rank'))then raise exception 'Filters changed; restart paging'using errcode='40001';end if;
 select coalesce(jsonb_agg(to_jsonb(t)order by rank,name collate "C",id),'[]')into rows from(select c.id,c.name,c."anthroId",c.title,c.company,c.location,c.status,c.skills,c."processingRestricted"held,public.repository_sort_number(sort,c.verified,c.experience,c.notice)rank from public.candidates c where c.workspace_id=ws and ecod_foundation_private.matches(ws,c,p)and(cursor is null or(public.repository_sort_number(sort,c.verified,c.experience,c.notice),c.name collate "C",c.id)>((cursor->>'rank')::numeric,(cursor->>'name')collate "C",(cursor->>'id')::uuid))order by rank,c.name collate "C",c.id limit 26)t;
 if jsonb_array_length(rows)>25 then rows:=rows-25;last:=rows->24;end if;
 perform ecod_access_private.audit_candidate_reads(ws,rows,'Foundation filtered repository');
 return jsonb_build_object('rows',rows,'next',case when last is not null then jsonb_build_object('head',stamp,'id',last->'id','name',last->'name','rank',last->'rank')else null end,'more',last is not null,'count',(select count(*)from public.candidates c where c.workspace_id=ws and ecod_foundation_private.matches(ws,c,p)),'coverage','Current workspace identities; criteria use recorded values, not readiness certification');
end$$;

create or replace function ecod_foundation_private.findings(ws uuid)returns table(kind text,target text,candidate_id uuid,label text,source text,status text,assignee uuid,head text)language sql stable security invoker set search_path=''as $$
 with raw as(
 select 'import'::text kind,r.batch_id::text||':'||r.row_no target,(select c.id from public.candidates c where c.workspace_id=ws and c.id=r.candidate_id)candidate_id,'Import row '||r.row_no||' ('||r.status||')'label,ecod_foundation_private.hash(to_jsonb(r))source from public."importRows"r where r.workspace_id=ws and r.status in('failed','duplicate')
 union all select 'taxonomy',t.id||':'||a.key,null::uuid,'Alias '||left(a.key,100),ecod_foundation_private.hash(jsonb_build_array(to_jsonb(t),a.key,a.value))from public.taxonomy t cross join lateral jsonb_each_text(coalesce(t.custom->'aliases','{}'))a where t.workspace_id=ws and(btrim(a.value)=''or lower(btrim(a.key))=lower(btrim(a.value)))
 )select r.*,case when e.source is distinct from r.source and e.id is not null then'Needs review'else coalesce(e.status,'Pending')end,e.assignee,ecod_foundation_private.hash(jsonb_build_array(r.source,e.sequence))from raw r left join lateral(select *from ecod_foundation_private.quality_events e where e.workspace_id=ws and e.kind=r.kind and e.target=r.target order by sequence desc limit 1)e on true
$$;
create or replace function ecod_foundation_private.quality(ws uuid,p jsonb,off integer)returns jsonb language plpgsql security invoker set search_path=''as $$
declare rows jsonb;begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>all(array['kind','status','scope']))or coalesce(p->>'kind','all')not in('all','import','taxonomy')or coalesce(p->>'status','all')not in('all','Pending','Needs review','Reviewed','Deferred','Reopened','Corrected')or coalesce(p->>'scope','all')not in('all','mine','unassigned')then raise exception 'Invalid quality filters';end if;
 select coalesce(jsonb_agg(to_jsonb(t)order by kind,target),'[]')into rows from(select *from(
 select *from ecod_foundation_private.findings(ws)
 union all select e.kind,e.target,e.candidate_id,'Corrected source awaiting resolution',null::text,'Corrected',e.assignee,ecod_foundation_private.hash(jsonb_build_array('corrected',e.sequence))from(select distinct on(kind,target)*from ecod_foundation_private.quality_events where workspace_id=ws order by kind,target,sequence desc)e where e.status<>'Resolved'and not exists(select 1 from ecod_foundation_private.findings(ws)r where r.kind=e.kind and r.target=e.target)
 )r where(coalesce(p->>'kind','all')='all'or r.kind=p->>'kind')and(coalesce(p->>'status','all')='all'or r.status=p->>'status')and(coalesce(p->>'scope','all')='all'or(p->>'scope'='mine'and r.assignee=auth.uid())or(p->>'scope'='unassigned'and r.assignee is null))order by kind,target limit 26 offset off)t;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'coverage','Failed/duplicate import rows and demonstrably blank/self taxonomy aliases. Decisions do not correct source data.');
end$$;
create or replace function ecod_foundation_private.quality_write(ws uuid,op uuid,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r record;e ecod_foundation_private.quality_events;present boolean;head text;assignee uuid:=(p->>'assignee')::uuid;begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>all(array['kind','target','head','status','assignee','reason']))or coalesce(p->>'kind','')not in('import','taxonomy')or length(coalesce(p->>'target',''))not between 1 and 250 or coalesce(p->>'status','')not in('Reviewed','Deferred','Reopened','Resolved')or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 then raise exception 'Invalid quality decision';end if;
 if assignee is not null then perform 1 from public.memberships where workspace_id=ws and user_id=assignee and role in('admin','recruiter')for share;if not found then raise exception 'Assignee must be a current editor';end if;end if;
 if p->>'kind'='import'then perform 1 from public."importRows"where workspace_id=ws and batch_id=split_part(p->>'target',':',1)::uuid and row_no=split_part(p->>'target',':',2)::integer for share;else perform 1 from public.taxonomy where workspace_id=ws and id=split_part(p->>'target',':',1)for share;end if;
 select *into r from ecod_foundation_private.findings(ws)where kind=p->>'kind'and target=p->>'target';present:=found;
 select *into e from ecod_foundation_private.quality_events where workspace_id=ws and kind=p->>'kind'and target=p->>'target'order by sequence desc limit 1;
 head:=case when present then r.head else ecod_foundation_private.hash(jsonb_build_array('corrected',e.sequence))end;
 if not present and e.id is null then raise exception 'Finding unavailable';end if;
 if head is distinct from p->>'head'then raise exception 'Finding changed; refresh review'using errcode='40001';end if;
 if p->>'status'='Resolved'and present then raise exception 'Correct the source before marking resolved';end if;
 if not present and e.status='Resolved'then raise exception 'Finding already resolved';end if;
 if not present and p->>'status'<>'Resolved'then raise exception 'Source corrected; record resolution';end if;
 if p->>'status'='Reopened'and coalesce(r.status,'Pending')='Pending'then raise exception 'Finding has not been reviewed';end if;
 insert into ecod_foundation_private.quality_events(id,workspace_id,candidate_id,kind,target,source,status,assignee,reason,actor)values(op,ws,case when present then r.candidate_id else e.candidate_id end,p->>'kind',p->>'target',case when present then r.source else 'corrected'end,p->>'status',assignee,btrim(p->>'reason'),auth.uid());
 return jsonb_build_object('id',op,'status',p->>'status','candidateId',case when present then r.candidate_id else e.candidate_id end);
end$$;
create or replace function ecod_foundation_private.task_owner(ws uuid,t public.tasks)returns uuid language sql stable security invoker set search_path=''as $$
 with last_event as(select e.assignee,e.after_state from ecod_foundation_private.task_events e where e.workspace_id=ws and e.task_id=t.id order by e.sequence desc limit 1), recorded as(select m.user_id from last_event e join public.memberships m on m.user_id=e.assignee and m.workspace_id=ws and m.role in('admin','recruiter')where e.after_state->>'owner'=t.owner)select user_id from recorded union all select m.user_id from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=ws and m.role in('admin','recruiter')and lower(u.email)=lower(nullif(btrim(t.owner),''))and not exists(select 1 from last_event e where e.after_state->>'owner'=t.owner)limit 1
$$;
create or replace function ecod_foundation_private.tasks(ws uuid,p jsonb,off integer)returns jsonb language plpgsql security invoker set search_path=''as $$
declare rows jsonb;q text:=coalesce(p->>'query','');begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>all(array['scope','state','due','query']))or coalesce(p->>'scope','all')not in('all','mine','unassigned')or coalesce(p->>'state','pending')not in('pending','completed','all')or coalesce(p->>'due','all')not in('all','overdue','next30','undated')or length(q)>200 then raise exception 'Invalid task filters';end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by due nulls last,id),'[]')into rows from(select t.id,t."candidateId",t."demandId",left(t.title,200)title,t.due,t.done,t.owner,ecod_foundation_private.task_owner(ws,t)assignee,ecod_foundation_private.hash(to_jsonb(t))head from public.tasks t where t.workspace_id=ws and position(lower(q)in lower(t.title))>0 and(coalesce(p->>'state','pending')='all'or t.done=(coalesce(p->>'state','pending')='completed'))and(coalesce(p->>'scope','all')='all'or(p->>'scope'='mine'and ecod_foundation_private.task_owner(ws,t)=auth.uid())or(p->>'scope'='unassigned'and btrim(t.owner)=''))and(coalesce(p->>'due','all')='all'or(p->>'due'='overdue'and t.due<(statement_timestamp()at time zone'UTC')::date)or(p->>'due'='next30'and t.due between(statement_timestamp()at time zone'UTC')::date and(statement_timestamp()at time zone'UTC')::date+30)or(p->>'due'='undated'and t.due is null))order by t.due nulls last,t.id limit 26 offset off)x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'coverage','Internal tasks; unrecognized legacy owner labels require administrator reconciliation. UTC due dates.');
end$$;
-- Existing task writers must obey the same ownership boundary as the workbench.
create or replace function ecod_foundation_private.guard_task_owner()returns trigger language plpgsql security definer set search_path=''as $$
declare ws uuid;owner_id uuid;next_id uuid;begin
 if auth.uid()is null or(old.owner,old.done)is not distinct from(new.owner,new.done)then return new;end if;
 ws:=ecod_access_private.member_workspace(true);
 if ws<>new.workspace_id then raise exception 'Task workspace mismatch'using errcode='42501';end if;
 owner_id:=ecod_foundation_private.task_owner(ws,old);next_id:=ecod_foundation_private.task_owner(ws,new);
 if public.is_admin()then perform ecod_private.require_privileged_mfa(ws);
 elsif not coalesce(owner_id=auth.uid()or(btrim(old.owner)=''and(new.owner=old.owner or next_id=auth.uid())),false)then raise exception 'Only current owner or administrator may change this task'using errcode='42501';end if;
 if new.owner is distinct from old.owner and btrim(new.owner)<>''and next_id is null then raise exception 'Select a current editor as task owner';end if;
 return new;
end$$;
drop trigger if exists foundation_task_owner_guard on public.tasks;
create trigger foundation_task_owner_guard before update on public.tasks for each row execute function ecod_foundation_private.guard_task_owner();
create or replace function ecod_foundation_private.task_write(ws uuid,op uuid,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare t public.tasks;before_state jsonb;owner_id uuid;next_id uuid;next_email text;person uuid;begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>all(array['id','head','assignee','done','reason']))or length(btrim(coalesce(p->>'reason','')))not between 10 and 1000 or not(p?'assignee')or jsonb_typeof(p->'done')is distinct from'boolean'then raise exception 'Invalid task handoff';end if;
 select "candidateId"into person from public.tasks where workspace_id=ws and id=(p->>'id')::uuid;
 if person is not null then perform 1 from public.candidates where workspace_id=ws and id=person and "mergedInto"is null for share;if not found then raise exception 'Task identity retired; reconcile before handoff';end if;end if;
 select *into t from public.tasks where workspace_id=ws and id=(p->>'id')::uuid for update;
 if not found then raise exception 'Task unavailable';end if;
 if t."candidateId"is distinct from person then raise exception 'Task identity changed'using errcode='40001';end if;
 if ecod_foundation_private.hash(to_jsonb(t))is distinct from p->>'head'then raise exception 'Task changed; refresh handoff'using errcode='40001';end if;
 owner_id:=ecod_foundation_private.task_owner(ws,t);next_id:=(p->>'assignee')::uuid;
 if not public.is_admin()and not coalesce(owner_id=auth.uid()or(btrim(t.owner)=''and next_id=auth.uid()),false)then raise exception 'Only current owner or administrator can hand off this task'using errcode='42501';end if;
 if next_id is not null then
  select u.email into next_email from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=ws and m.user_id=next_id and m.role in('admin','recruiter')for share of m;
  if next_email is null or length(next_email)>120 then raise exception 'Current editor with usable email required';end if;
 else next_email:='';end if;
 before_state:=jsonb_build_object('owner',t.owner,'assignee',owner_id,'done',t.done);
 update public.tasks set owner=next_email,done=(p->>'done')::boolean where workspace_id=ws and id=t.id;
 insert into ecod_foundation_private.task_events(id,workspace_id,candidate_id,task_id,assignee,before_state,after_state,reason,actor)values(op,ws,person,t.id,next_id,before_state,jsonb_build_object('owner',next_email,'assignee',next_id,'done',p->'done'),btrim(p->>'reason'),auth.uid());
 return jsonb_build_object('id',t.id,'status','Saved','candidateId',person);
end$$;

create or replace function ecod_foundation_private.population(ws uuid,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
#variable_conflict use_column
declare d public.demands;c public.candidates;flt jsonb:=coalesce(p->'filters','{}');rows jsonb:='[]';checks jsonb;state jsonb;matched integer;score numeric;eligible text;family uuid[];uses integer;denom numeric;total integer;stamp jsonb:='[]';begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>all(array['filters','demandId','group','eligibleOnly','readyOnly','head']))or(p?'eligibleOnly'and jsonb_typeof(p->'eligibleOnly')<>'boolean')or(p?'readyOnly'and jsonb_typeof(p->'readyOnly')<>'boolean')then raise exception 'Invalid discovery/report criteria';end if;
 perform ecod_foundation_private.validate(ws,flt);
 if nullif(p->>'demandId','')is not null then select *into d from public.demands where workspace_id=ws and id=(p->>'demandId')::uuid;if not found then raise exception 'Demand unavailable';end if;end if;
 if d.id is null and(coalesce((p->>'eligibleOnly')::boolean,false)or coalesce((p->>'readyOnly')::boolean,false))then raise exception 'Select a demand for eligibility or readiness';end if;
 select count(*)into total from public.candidates c where c.workspace_id=ws and c."mergedInto"is null and not c."processingRestricted"and ecod_foundation_private.matches(ws,c,flt);
 for c in select *from public.candidates c where c.workspace_id=ws and not c."processingRestricted"and ecod_foundation_private.matches(ws,c,flt)order by c.id limit 1000 loop
  checks:='[]';state:='{"state":"Not demand-scoped","validatedReady":false}';score:=0;matched:=0;eligible:='unknown';
  if d.id is not null then
   checks:=ecod_journey_private.checks(ws,d.id,c.id,public.is_admin());state:=ecod_journey_private.state(ws,d.id,c.id);
   eligible:=case when exists(select 1 from jsonb_array_elements(checks)x where x->>'status'='failed')then'failed'when jsonb_array_length(checks)=0 or exists(select 1 from jsonb_array_elements(checks)x where x->>'status'='unknown')then'unknown'else'satisfied'end;
   select count(*)into matched from unnest(d.skills)s where exists(select 1 from unnest(c.skills)k where lower(k)=lower(s));
   denom:=100-coalesce((d.weights->>'budget')::numeric,0);
   score:=case when denom>0 then round(100*(coalesce((d.weights->>'skills')::numeric,0)*matched/greatest(cardinality(d.skills),1)+coalesce((d.weights->>'experience')::numeric,0)*case when c.experience is null then 0 when d."minExperience"=0 then 1 else least(c.experience/d."minExperience",1)end+coalesce((d.weights->>'availability')::numeric,0)*case when c.notice<=d."maxNotice"then 1 else 0 end+coalesce((d.weights->>'location')::numeric,0)*case when lower(c.location)=lower(d.location)then 1 else 0 end+coalesce((d.weights->>'readiness')::numeric,0)*case when(state->>'validatedReady')::boolean then 1 else 0 end)/denom,1)else 0 end;
  end if;
  family:=ecod_access_private.identity_family(ws,c.id);
  select count(distinct "demandId")into uses from public.placements where workspace_id=ws and "candidateId"=any(family)and status in('Active','Completed','Terminated');
  stamp:=stamp||jsonb_build_array(ecod_access_private.redact_financial(to_jsonb(c)),checks,jsonb_build_object('state',state->'state','validUntil',state->'validUntil'),uses);
  if octet_length(stamp::text)>2000000 then raise exception 'Population evidence exceeds safe limit; narrow filters';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',c.id,'name',left(c.name,200),'anthroId',c."anthroId",'score',score,'matchedSkills',matched,'skillTotal',coalesce(cardinality(d.skills),0),'eligibility',eligible,'readiness',state->>'state','validatedReady',state->'validatedReady','checks',checks,'custom',c.custom,'skills',c.skills,'reuseDemands',uses));
 end loop;
 return jsonb_build_object('rows',rows,'total',total,'evaluated',jsonb_array_length(rows),'bounded',total>1000,'head',ecod_foundation_private.hash(jsonb_build_array(ws,public.is_admin(),total,p-'head',(statement_timestamp()at time zone'UTC')::date,stamp,ecod_access_private.redact_financial(to_jsonb(d)),ecod_foundation_private.fields(ws))), 'coverage','First 1000 matching active unheld identities by UUID; current observations; financial similarity excluded; empty hard requirements mean unknown. Reuse counts distinct non-cancelled deployed demands across the identity family.');
end$$;
create or replace function ecod_foundation_private.discovery(ws uuid,p jsonb,off integer)returns jsonb language plpgsql security invoker set search_path=''as $$
declare population jsonb;rows jsonb;begin
 population:=ecod_foundation_private.population(ws,p);
 if off>0 and p->>'head'is distinct from population->>'head'then raise exception 'Discovery source changed; restart paging'using errcode='40001';end if;
 select coalesce(jsonb_agg(x.r order by(x.r->>'score')::numeric desc,x.r->>'name'collate "C",x.r->>'id'),'[]')into rows from(select value-'custom'-'skills'-'reuseDemands'r from jsonb_array_elements(population->'rows')where(not coalesce((p->>'eligibleOnly')::boolean,false)or value->>'eligibility'='satisfied')and(not coalesce((p->>'readyOnly')::boolean,false)or(value->>'validatedReady')::boolean)order by(value->>'score')::numeric desc,value->>'name'collate "C",value->>'id'limit 26 offset off)x;
 perform ecod_access_private.audit_candidate_reads(ws,rows,'Foundation demand discovery');
 return(population-'rows')||jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
end$$;
create or replace function ecod_foundation_private.report(ws uuid,p jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare pop jsonb:=ecod_foundation_private.population(ws,p);groups jsonb:='[]';heat jsonb:='[]';field jsonb;rows jsonb:=pop->'rows';group_name text;d public.demands;cohorts jsonb;begin
 if p?'eligibleOnly'or p?'readyOnly'then raise exception 'Report denominator cannot silently exclude eligibility states';end if;
 if nullif(p->>'group','')is not null then
  select value into field from jsonb_array_elements(ecod_foundation_private.fields(ws))where value->>'id'=p->>'group';
  if field is null or(field->>'archived')::boolean then raise exception 'Report group definition unavailable';end if;group_name:=field->>'name';
  select coalesce(jsonb_agg(to_jsonb(g)order by count desc,id),'[]')into groups from(select md5(key::text)id,left(coalesce(key->>'value','Unknown'),120)value,(key->>'unknown')::boolean unknown,count(*)count from(select jsonb_build_object('value',nullif(value->'custom'->>group_name,''),'unknown',nullif(value->'custom'->>group_name,'')is null)key from jsonb_array_elements(rows))v group by key order by count desc,id limit 40)g;
 end if;
 if nullif(p->>'demandId','')is not null then
  select *into d from public.demands where workspace_id=ws and id=(p->>'demandId')::uuid;
  select coalesce(jsonb_agg(to_jsonb(g)order by skill),'[]')into heat from(select skill,count(*)filter(where exists(select 1 from jsonb_array_elements_text(r->'skills')s where lower(s)=lower(skill)))observed,count(*)filter(where not exists(select 1 from jsonb_array_elements_text(r->'skills')s where lower(s)=lower(skill)))missing,(d.weights->>'skills')::numeric/greatest(cardinality(d.skills),1)weight from unnest(d.skills)skill cross join jsonb_array_elements(rows)r group by skill limit 50)g;
 end if;
 select jsonb_build_object('noDeployment',count(*)filter(where(value->>'reuseDemands')::integer=0),'oneDemand',count(*)filter(where(value->>'reuseDemands')::integer=1),'reusedAcrossDemands',count(*)filter(where(value->>'reuseDemands')::integer>=2),'validatedReady',count(*)filter(where(value->>'validatedReady')::boolean),'satisfied',count(*)filter(where value->>'eligibility'='satisfied'),'failed',count(*)filter(where value->>'eligibility'='failed'),'unknown',count(*)filter(where value->>'eligibility'='unknown'))into cohorts from jsonb_array_elements(rows);
 return(pop-'rows')||jsonb_build_object('groups',groups,'groupsOmitted',case when group_name is not null then greatest(0,(select count(distinct jsonb_build_object('value',nullif(value->'custom'->>group_name,''),'unknown',nullif(value->'custom'->>group_name,'')is null))from jsonb_array_elements(rows))-40)else 0 end,'heatmap',heat,'skillsOmitted',greatest(0,coalesce(cardinality(d.skills),0)-50),'cohorts',cohorts,'definition','Current evaluated identity denominator; observed skill gaps are not independently validated gaps. Reuse is at least two distinct deployed demands, not a conversion rate.');
end$$;
create or replace function ecod_foundation_private.search(ws uuid,p jsonb,off integer)returns jsonb language plpgsql security invoker set search_path=''as $$
declare rows jsonb;q text:=btrim(coalesce(p->>'query',''));begin
 if exists(select 1 from jsonb_object_keys(p)k where k<>'query')or jsonb_typeof(p->'query')is distinct from'string'or length(q)not between 2 and 200 then raise exception 'Search needs 2-200 literal characters';end if;
 with found as(
 select 'candidate'::text kind,c.id,left(c.name,200)label,c."anthroId"from public.candidates c where c.workspace_id=ws and c."mergedInto"is null and position(lower(q)in lower(c.name||' '||c."anthroId"||' '||c.title||' '||c.company||' '||coalesce(array_to_string(c.skills,' '),'')))>0
 union all select 'demand',id,left(title,200),null from public.demands where workspace_id=ws and position(lower(q)in lower(title||' '||client||' '||location))>0
 union all select 'client',id,left(name,200),null from public.clients where workspace_id=ws and position(lower(q)in lower(name||' '||industry||' '||location))>0
 )select coalesce(jsonb_agg(to_jsonb(x)order by kind,label collate "C",id),'[]')into rows from(select *from found order by kind,label collate "C",id limit 26 offset off)x;
 perform ecod_access_private.audit_candidate_reads(ws,coalesce((select jsonb_agg(x)from jsonb_array_elements(rows)x where x->>'kind'='candidate'),'[]'),'Foundation cross-entity search');
 return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'coverage','Professional candidate, demand and client labels only; no contacts, compensation, documents or assessment text. Literal search.');
end$$;

create or replace function ecod_foundation_private.console(p_action text,p_payload jsonb,p_offset integer,p_operation uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid;actor_id uuid:=auth.uid();write boolean;result jsonb;prior ecod_foundation_private.receipts;req jsonb;rows jsonb;e ecod_foundation_private.quality_events;r record;person uuid;begin
 if p_action is null or p_action not in('context','filter','save-view','delete-view','quality','quality-history','quality-decide','discovery','search','report','export-report','tasks','task-history','task-act')or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>12000 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid foundation request';end if;
 write:=p_action in('save-view','delete-view','quality-decide','task-act','export-report');
 ws:=ecod_access_private.member_workspace(p_action in('quality-decide','task-act','export-report'));
 if p_action='export-report'or(p_action in('task-act','quality-decide')and public.is_admin())then perform ecod_private.require_privileged_mfa(ws);end if;
 if write then
  if p_operation is null then raise exception 'Operation UUID required';end if;
  perform pg_advisory_xact_lock(hashtextextended('foundation:'||ws::text,0));
  req:=jsonb_build_array(p_action,p_payload,p_offset,public.is_admin());
  select *into prior from ecod_foundation_private.receipts where workspace_id=ws and actor=actor_id and id=p_operation;
  if found then if prior.request<>req then raise exception 'Foundation operation conflict'using errcode='40001';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 end if;
 if p_action='context'then
  select coalesce(jsonb_agg(to_jsonb(x)order by name,id),'[]')into rows from(
   select id,name,case when public.is_admin()then body when body?'version'then jsonb_set(body,'{base}',(body->'base')-'maxExpected'-'payCurrency'-'payBasis')else body-'maxExpected'-'payCurrency'-'payBasis'end filters,false legacy,not public.is_admin()and nullif(coalesce(body->'base'->>'maxExpected',body->>'maxExpected'),'')is not null restricted from ecod_foundation_private.views where workspace_id=ws and actor=auth.uid()
   union all select id,name,case when public.is_admin()then filters else filters-'maxExpected'end,true,not public.is_admin()and nullif(filters->>'maxExpected','')is not null from ecod_repository_private.repository_views where workspace_id=ws and user_id=auth.uid()
  )x;
  return jsonb_build_object('fields',ecod_foundation_private.fields(ws),'views',rows,'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'label',left(u.email,120)))from(select m.user_id,u.email from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=ws and m.role in('admin','recruiter')order by u.email,m.user_id limit 200)m join auth.users u on u.id=m.user_id),'[]'),'memberSelectionLimit',200,'demands',coalesce((select jsonb_agg(to_jsonb(x))from(select id,left(title,200)title from public.demands where workspace_id=ws order by title,id limit 100)x),'[]'),'demandSelectionLimit',100);
 elsif p_action='filter'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['filters','cursor']))then raise exception 'Invalid filter request';end if;
  return ecod_foundation_private.filtered(ws,coalesce(p_payload->'filters','{}'),nullif(p_payload->'cursor','null'::jsonb));
 elsif p_action='save-view'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['name','filters']))or length(btrim(coalesce(p_payload->>'name','')))not between 1 and 80 then raise exception 'Name must contain 1-80 characters';end if;
  perform ecod_foundation_private.validate(ws,p_payload->'filters');
  if(select count(*)from ecod_foundation_private.views where workspace_id=ws and actor=auth.uid())>=50 then raise exception 'Keep at most 50 foundation views';end if;
  insert into ecod_foundation_private.views values(p_operation,ws,auth.uid(),btrim(p_payload->>'name'),p_payload->'filters',clock_timestamp());result:=jsonb_build_object('id',p_operation,'status','Saved');
 elsif p_action='delete-view'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>'id')then raise exception 'Invalid view deletion';end if;
  delete from ecod_foundation_private.views where workspace_id=ws and actor=auth.uid()and id=(p_payload->>'id')::uuid;
  if not found then raise exception 'Only your foundation view can be removed';end if;result:=jsonb_build_object('status','Removed');
 elsif p_action='quality'then return ecod_foundation_private.quality(ws,p_payload,p_offset);
 elsif p_action='quality-decide'then result:=ecod_foundation_private.quality_write(ws,p_operation,p_payload);person:=(result->>'candidateId')::uuid;
 elsif p_action='quality-history'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>all(array['kind','target']))then raise exception 'Invalid quality history';end if;
  select *into e from ecod_foundation_private.quality_events where workspace_id=ws and kind=p_payload->>'kind'and target=p_payload->>'target'order by sequence desc limit 1;
  select *into r from ecod_foundation_private.findings(ws)where kind=p_payload->>'kind'and target=p_payload->>'target';
  select coalesce(jsonb_agg(to_jsonb(x)-'source'order by sequence desc),'[]')into rows from(select *from ecod_foundation_private.quality_events where workspace_id=ws and kind=p_payload->>'kind'and target=p_payload->>'target'order by sequence desc limit 26 offset p_offset)x;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25,'canResolve',r.kind is null and e.id is not null,'head',case when r.kind is not null then r.head else ecod_foundation_private.hash(jsonb_build_array('corrected',e.sequence))end);
 elsif p_action='discovery'then return ecod_foundation_private.discovery(ws,p_payload,p_offset);
 elsif p_action='search'then return ecod_foundation_private.search(ws,p_payload,p_offset);
 elsif p_action='report'then return ecod_foundation_private.report(ws,p_payload);
 elsif p_action='export-report'then
  result:=ecod_foundation_private.report(ws,p_payload);
  if result->>'head'is distinct from p_payload->>'head'then raise exception 'Report changed; refresh before export'using errcode='40001';end if;
  if(select count(*)from ecod_foundation_private.receipts where workspace_id=ws and actor=auth.uid()and action='export-report'and at>clock_timestamp()-interval'1 minute')>=6 then raise exception 'Report export quota exceeded';end if;
  result:=result||jsonb_build_object('id',p_operation,'snapshotAt',clock_timestamp(),'status','Export prepared','scope','Bounded aggregate report; no candidate rows');
 elsif p_action='tasks'then return ecod_foundation_private.tasks(ws,p_payload,p_offset);
 elsif p_action='task-act'then result:=ecod_foundation_private.task_write(ws,p_operation,p_payload);person:=(result->>'candidateId')::uuid;
 elsif p_action='task-history'then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>'id')then raise exception 'Invalid task history';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by sequence desc),'[]')into rows from(select *from ecod_foundation_private.task_events where workspace_id=ws and task_id=(p_payload->>'id')::uuid order by sequence desc limit 26 offset p_offset)x;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 if octet_length(result::text)>2000000 then raise exception 'Response exceeds safe size';end if;
 insert into ecod_foundation_private.receipts(workspace_id,actor,id,candidate_id,action,request,result)values(ws,auth.uid(),p_operation,person,p_action,req,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,'foundation',coalesce(person,p_operation),'server_write','Foundation '||p_action,auth.uid()::text);
 return result;
end$$;
create or replace function public.api_foundation(p_action text default'context',p_payload jsonb default'{}',p_offset integer default 0,p_operation uuid default null)returns jsonb language sql security invoker set search_path=''as $$select ecod_foundation_private.console(p_action,p_payload,p_offset,p_operation)$$;
revoke all on all functions in schema ecod_foundation_private from public,anon,authenticated;
revoke all on function public.api_foundation(text,jsonb,integer,uuid)from public,anon,authenticated;
grant usage on schema ecod_foundation_private to authenticated;
grant execute on function ecod_foundation_private.console(text,jsonb,integer,uuid),public.api_foundation(text,jsonb,integer,uuid)to authenticated;
-- Extend both the formal D7 registry and the pre-operations source registry.
do $$declare fn text;definition text;begin
 foreach fn in array array['ecod_private.erasure_inventory','ecod_ops_private.source_inventory']loop
  definition:=pg_get_functiondef((fn||'(uuid,uuid)')::regprocedure);
  if strpos(definition,'foundationQuality')=0 then
   definition:=replace(definition,'(''feedbackReceipts'',''integrations'')','(''feedbackReceipts'',''integrations''),(''foundationQuality'',''history''),(''foundationTasks'',''history''),(''foundationReceipts'',''integrations'')');
   definition:=replace(definition,'predicate:=case d.name','predicate:=case d.name when ''foundationQuality''then''t.candidate_id=any($1)''when ''foundationTasks''then''t.candidate_id=any($1)''when ''foundationReceipts''then''t.candidate_id=any($1)''');
   definition:=replace(definition,'case when d.name','case when d.name in(''foundationQuality'',''foundationTasks'',''foundationReceipts'')then''ecod_foundation_private''when d.name');
   definition:=replace(definition,'end,case d.name when','end,case d.name when''foundationQuality''then''quality_events''when''foundationTasks''then''task_events''when''foundationReceipts''then''receipts''when');execute definition;
  end if;
 end loop;
 definition:=pg_get_functiondef('ecod_private.subject_access_content(uuid)'::regprocedure);
 if strpos(definition,'foundation quality')=0 then definition:=replace(definition,'operations job metadata','foundation quality decisions, task handoffs and linked operation receipts, operations job metadata');execute definition;end if;
end$$;
commit;
