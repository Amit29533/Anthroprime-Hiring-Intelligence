begin;
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check(role in ('admin','recruiter','viewer','assessor','sales'));
alter table public."workspaceInvites" drop constraint if exists "workspaceInvites_role_check";
alter table public."workspaceInvites" add constraint "workspaceInvites_role_check" check(role in ('admin','recruiter','viewer','assessor','sales'));
create or replace function ecod_access_private.selected_workspace()returns uuid language sql stable security definer set search_path=''as $$
 select coalesce((select p."activeWorkspaceId"from public."userWorkspacePreferences"p join public.memberships m on m.user_id=p.user_id and m.workspace_id=p."activeWorkspaceId"where p.user_id=auth.uid()),(select workspace_id from public.memberships where user_id=auth.uid()order by workspace_id limit 1));
$$;
create or replace function public.current_workspace()returns uuid language sql stable security invoker set search_path=''as $$
 select ecod_access_private.selected_workspace()where exists(select 1 from public.memberships where user_id=auth.uid()and workspace_id=ecod_access_private.selected_workspace()and role in('admin','recruiter','viewer'));
$$;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.api_my_workspaces()'::regprocedure);
 execute replace(definition,'public.current_workspace()','ecod_access_private.selected_workspace()');
end $$;
revoke all on function ecod_access_private.selected_workspace()from public,anon,authenticated;
grant execute on function ecod_access_private.selected_workspace()to authenticated;
-- Serialize administrative decisions before evaluating the existing last-admin guard.
do $$declare spec record;definition text;args text;calls text;name text;begin
 for spec in select p.*from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('api_invite_member','api_set_member_role','api_remove_member')loop
  name:=spec.proname||'_stage1_admin_core';args:=pg_get_function_arguments(spec.oid);
  select string_agg(quote_ident(x),','order by n)into calls from unnest(spec.proargnames)with ordinality t(x,n);
  if to_regprocedure(format('ecod_access_private.%I(%s)',name,oidvectortypes(spec.proargtypes)))is null then
   definition:=pg_get_functiondef(spec.oid);definition:=replace(definition,format('FUNCTION public.%I(',spec.proname),format('FUNCTION ecod_access_private.%I(',name));
   definition:=replace(definition,'''admin'', ''recruiter'', ''viewer''','''admin'', ''recruiter'', ''viewer'', ''assessor'', ''sales''');execute definition;
  end if;
  execute format('revoke all on function ecod_access_private.%I(%s)from public,anon,authenticated',name,pg_get_function_identity_arguments(spec.oid));
  execute format('create or replace function ecod_access_private.%I(%s)returns jsonb language plpgsql security definer set search_path=''''as $guard$declare ws uuid:=ecod_access_private.member_workspace(false);begin if not public.is_admin()then return jsonb_build_object(''error'',''administrator access required'');end if;perform 1 from public.workspaces where id=ws for update;return ecod_access_private.%I(%s);end $guard$',spec.proname||'_stage1_admin',args,name,calls);
  execute format('revoke all on function ecod_access_private.%I(%s)from public,anon,authenticated',spec.proname||'_stage1_admin',pg_get_function_identity_arguments(spec.oid));
  execute format('grant execute on function ecod_access_private.%I(%s)to authenticated',spec.proname||'_stage1_admin',pg_get_function_identity_arguments(spec.oid));
  execute format('create or replace function public.%I(%s)returns jsonb language sql security invoker set search_path=''''as $public$select ecod_access_private.%I(%s)$public$',spec.proname,args,spec.proname||'_stage1_admin',calls);
 end loop;
end $$;
create table if not exists ecod_access_private.assignments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),member_id uuid not null,kind text not null check(kind in('evaluation','client','demand')),target_id uuid not null,
 expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default clock_timestamp(),created_by uuid not null,version integer not null default 1);
create index if not exists stage1_assignments_member on ecod_access_private.assignments(workspace_id,member_id,kind,target_id);
create table if not exists ecod_access_private.assignment_receipts(workspace_id uuid not null,actor uuid not null,operation_id uuid not null,candidate_id uuid,request_hash text not null,result jsonb not null,at timestamptz not null default clock_timestamp(),primary key(workspace_id,actor,operation_id));
alter table ecod_access_private.assignments enable row level security;
alter table ecod_access_private.assignment_receipts enable row level security;
revoke all on ecod_access_private.assignments,ecod_access_private.assignment_receipts from public,anon,authenticated;
create or replace function ecod_access_private.assignments_admin(p_action text,p_operation uuid,p_details jsonb,p_offset integer)
returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.member_workspace(false);actor_id uuid:=auth.uid();item ecod_access_private.assignments;fingerprint text;prior ecod_access_private.assignment_receipts;member uuid;target uuid;kind_name text;expires timestamptz;role_name text;result jsonb;
begin
 if not public.is_admin()then raise exception 'Administrator access required'using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid assignment page';end if;
 if p_action='list'then
  select coalesce(jsonb_agg(to_jsonb(t)order by created_at desc,id),'[]')into result from(select *from ecod_access_private.assignments where workspace_id=ws order by created_at desc,id limit 26 offset p_offset)t;
  return jsonb_build_object('rows',case when jsonb_array_length(result)>25 then result-25 else result end,'more',jsonb_array_length(result)>25);
 end if;
 if p_action not in('grant','revoke')or p_action is null or p_operation is null or jsonb_typeof(p_details)is distinct from'object'or octet_length(p_details::text)>4000 then raise exception 'Invalid assignment action';end if;
 perform 1 from public.workspaces where id=ws for update;
 fingerprint:=md5(p_action||p_details::text);
 select *into prior from ecod_access_private.assignment_receipts where workspace_id=ws and actor=auth.uid()and operation_id=p_operation;
 if found then if prior.request_hash<>fingerprint then raise exception 'Assignment operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if p_action='grant'then
  if not p_details?&array['member','kind','target','expires']or exists(select 1 from jsonb_object_keys(p_details)k where k not in('member','kind','target','expires'))then raise exception 'Invalid assignment fields';end if;
  member:=(p_details->>'member')::uuid;target:=(p_details->>'target')::uuid;kind_name:=p_details->>'kind';expires:=(p_details->>'expires')::timestamptz;
  select role into role_name from public.memberships where workspace_id=ws and user_id=member for share;
  if (kind_name='evaluation'and role_name is distinct from'assessor')or(kind_name in('client','demand')and role_name is distinct from'sales')or kind_name not in('evaluation','client','demand')or kind_name is null then raise exception 'Assignment requires a matching limited role';end if;
  if expires is null or expires<=clock_timestamp()or expires>clock_timestamp()+interval'366 days'then raise exception 'Assignment expiry must be within the next 366 days';end if;
  if kind_name='evaluation'then perform 1 from public.candidates where workspace_id=ws and id=target and "mergedInto"is null and not "processingRestricted";
  elsif kind_name='client'then perform 1 from public.clients where workspace_id=ws and id=target;
  else perform 1 from public.demands where workspace_id=ws and id=target;end if;
  if not found then raise exception 'Assignment target not found in this workspace';end if;
  if exists(select 1 from ecod_access_private.assignments where workspace_id=ws and member_id=member and kind=kind_name and target_id=target and revoked_at is null and expires_at>clock_timestamp())then raise exception 'An active assignment already exists; revoke it before granting revised access';end if;
  insert into ecod_access_private.assignments(workspace_id,member_id,kind,target_id,expires_at,created_by)values(ws,member,kind_name,target,expires,actor_id)returning *into item;
 else
  if not p_details?&array['id','version']or exists(select 1 from jsonb_object_keys(p_details)k where k not in('id','version'))then raise exception 'Invalid revocation fields';end if;
  select *into item from ecod_access_private.assignments where workspace_id=ws and id=(p_details->>'id')::uuid for update;
  if not found or item.version is distinct from(p_details->>'version')::integer then raise exception 'Assignment changed. Reload before revoking.'using errcode='40001';end if;
  update ecod_access_private.assignments set revoked_at=coalesce(revoked_at,clock_timestamp()),version=version+1 where id=item.id returning *into item;
 end if;
 result:=jsonb_build_object('assignment',to_jsonb(item),'replayed',false);
 insert into ecod_access_private.assignment_receipts(workspace_id,actor,operation_id,candidate_id,request_hash,result)values(ws,actor_id,p_operation,case when item.kind='evaluation'then item.target_id end,fingerprint,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when item.kind='evaluation'then'candidates'else'assignments'end,item.target_id,'assignment_'||p_action,item.id::text,actor_id::text);
 return result;
end $$;
create or replace function ecod_access_private.revoke_member_assignments()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if TG_OP='DELETE'or new.role is distinct from old.role then update ecod_access_private.assignments set revoked_at=clock_timestamp(),version=version+1 where workspace_id=old.workspace_id and member_id=old.user_id and revoked_at is null;end if;
 if TG_OP='DELETE'then return old;end if;return new;
end $$;
revoke all on function ecod_access_private.revoke_member_assignments()from public,anon,authenticated;
drop trigger if exists stage1_revoke_assignments on public.memberships;
create trigger stage1_revoke_assignments before delete or update of role on public.memberships for each row execute function ecod_access_private.revoke_member_assignments();
create or replace function ecod_access_private.assigned_context(p_assignment uuid)
returns ecod_access_private.assignments language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.selected_workspace();role_name text;item ecod_access_private.assignments;
begin
 select role into role_name from public.memberships where workspace_id=ws and user_id=auth.uid()for share;
 if role_name not in('assessor','sales')or role_name is null then raise exception 'Limited workspace membership required'using errcode='42501';end if;
 select *into item from ecod_access_private.assignments where workspace_id=ws and member_id=auth.uid()and id=p_assignment and revoked_at is null and expires_at>clock_timestamp()for share;
 if not found or(item.kind='evaluation'and role_name<>'assessor')or(item.kind<>'evaluation'and role_name<>'sales')then raise exception 'Assignment unavailable'using errcode='42501';end if;
 return item;
end $$;
create or replace function ecod_access_private.assigned_read(p_assignment uuid,p_offset integer)
returns jsonb language plpgsql security definer set search_path=''as $$
declare ws uuid:=ecod_access_private.selected_workspace();role_name text;item ecod_access_private.assignments;result jsonb;person jsonb;rows jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid assigned page';end if;
 select role into role_name from public.memberships where workspace_id=ws and user_id=auth.uid()for share;
 if role_name not in('assessor','sales')or role_name is null then raise exception 'Limited workspace membership required'using errcode='42501';end if;
 if p_assignment is null then
  select coalesce(jsonb_agg(to_jsonb(t)order by expires_at,id),'[]')into rows from(select id,kind,target_id,expires_at,version from ecod_access_private.assignments where workspace_id=ws and member_id=auth.uid()and revoked_at is null and expires_at>clock_timestamp()and((role_name='assessor'and kind='evaluation')or(role_name='sales'and kind in('client','demand')))order by expires_at,id limit 26 offset p_offset)t;
  return jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 item:=ecod_access_private.assigned_context(p_assignment);
 if item.kind='evaluation'then
  select jsonb_build_object('id',id,'anthroId',"anthroId",'name',name,'title',title,'skills',skills)into person from public.candidates where workspace_id=ws and id=item.target_id and "mergedInto"is null and not "processingRestricted";
  if person is null then raise exception 'Assigned candidate unavailable'using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(t)order by date desc,id),'[]')into rows from(select id,title,score,date,evidence,gap from public.assessments where workspace_id=ws and "candidateId"=item.target_id and assessor=auth.uid()::text order by date desc,id limit 26 offset p_offset)t;
  result:=jsonb_build_object('candidate',person,'rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 else
  select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')into rows from(select d.id,d.title,d.client,d.status,d.positions,d.target,(select coalesce(jsonb_object_agg(stage,n),'{}')from(select stage,count(*)n from public.considerations where workspace_id=ws and "demandId"=d.id group by stage)s)progress from public.demands d where d.workspace_id=ws and(case when item.kind='demand'then d.id=item.target_id else d."clientId"=item.target_id end)order by d.id limit 26 offset p_offset)t;
  result:=jsonb_build_object('rows',case when jsonb_array_length(rows)>25 then rows-25 else rows end,'more',jsonb_array_length(rows)>25);
 end if;
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(ws,case when item.kind='evaluation'then'candidates'else'assignments'end,item.target_id,'assigned_read',item.id::text,auth.uid()::text);
 return result||jsonb_build_object('assignment',jsonb_build_object('id',item.id,'kind',item.kind,'version',item.version,'expires',item.expires_at));
end $$;
create or replace function ecod_access_private.assigned_assess(p_assignment uuid,p_version integer,p_operation uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=''as $$
declare item ecod_access_private.assignments:=ecod_access_private.assigned_context(p_assignment);prior ecod_access_private.assignment_receipts;fingerprint text;result jsonb;record_id uuid;
begin
 if item.kind<>'evaluation'or item.version is distinct from p_version then raise exception 'Evaluation assignment changed'using errcode='42501';end if;
 perform 1 from public.candidates where workspace_id=item.workspace_id and id=item.target_id and "mergedInto"is null and not "processingRestricted"for share;
 if not found then raise exception 'Assigned candidate unavailable'using errcode='42501';end if;
 if p_operation is null or jsonb_typeof(p_details)is distinct from'object'or octet_length(p_details::text)>12000 or not p_details?&array['title','score','evidence','gap']or exists(select 1 from jsonb_object_keys(p_details)k where k not in('title','score','evidence','gap'))then raise exception 'Invalid evaluation fields';end if;
 if jsonb_typeof(p_details->'title')<>'string'or length(btrim(p_details->>'title'))not between 1 and 300 or jsonb_typeof(p_details->'evidence')<>'string'or length(btrim(p_details->>'evidence'))not between 1 and 4000 or jsonb_typeof(p_details->'gap')<>'string'or length(p_details->>'gap')>4000 or jsonb_typeof(p_details->'score')<>'number'or(p_details->>'score')::numeric not between 0 and 100 then raise exception 'Invalid evaluation values';end if;
 fingerprint:=md5(p_assignment::text||p_details::text);
 perform pg_advisory_xact_lock(hashtextextended(item.workspace_id::text||auth.uid()::text||p_operation::text,0));
 select *into prior from ecod_access_private.assignment_receipts where workspace_id=item.workspace_id and actor=auth.uid()and operation_id=p_operation;
 if found then if prior.request_hash<>fingerprint then raise exception 'Evaluation operation conflict';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 insert into public.assessments(workspace_id,"candidateId",title,score,assessor,date,evidence,gap)values(item.workspace_id,item.target_id,btrim(p_details->>'title'),(p_details->>'score')::numeric,auth.uid()::text,(statement_timestamp()at time zone'UTC')::date,btrim(p_details->>'evidence'),p_details->>'gap')returning id into record_id;
 result:=jsonb_build_object('recordedId',record_id,'replayed',false);
 insert into ecod_access_private.assignment_receipts(workspace_id,actor,operation_id,candidate_id,request_hash,result)values(item.workspace_id,auth.uid(),p_operation,item.target_id,fingerprint,result);
 insert into public."auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values(item.workspace_id,'candidates',item.target_id,'assigned_evaluation',record_id::text,auth.uid()::text);return result;
end $$;
create or replace function public.api_assignments_admin(p_action text default'list',p_operation uuid default null,p_details jsonb default'{}',p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.assignments_admin(p_action,p_operation,p_details,p_offset)$$;
create or replace function public.api_assigned_work(p_assignment uuid default null,p_offset integer default 0)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.assigned_read(p_assignment,p_offset)$$;
create or replace function public.api_assigned_assessment(p_assignment uuid,p_version integer,p_operation uuid,p_details jsonb)returns jsonb language sql security invoker set search_path=''as $$select ecod_access_private.assigned_assess(p_assignment,p_version,p_operation,p_details)$$;
revoke all on function ecod_access_private.assignments_admin(text,uuid,jsonb,integer),ecod_access_private.assigned_context(uuid),ecod_access_private.assigned_read(uuid,integer),ecod_access_private.assigned_assess(uuid,integer,uuid,jsonb),public.api_assignments_admin(text,uuid,jsonb,integer),public.api_assigned_work(uuid,integer),public.api_assigned_assessment(uuid,integer,uuid,jsonb)from public,anon,authenticated;
grant execute on function ecod_access_private.assignments_admin(text,uuid,jsonb,integer),ecod_access_private.assigned_read(uuid,integer),ecod_access_private.assigned_assess(uuid,integer,uuid,jsonb),public.api_assignments_admin(text,uuid,jsonb,integer),public.api_assigned_work(uuid,integer),public.api_assigned_assessment(uuid,integer,uuid,jsonb)to authenticated;
commit;
