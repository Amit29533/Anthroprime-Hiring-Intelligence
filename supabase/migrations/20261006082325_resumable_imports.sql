-- Phase B1: durable reviewed spreadsheet imports, executed atomically in bounded DB batches.
begin;
-- Serialize LinkedIn identity checks for every writer, including concurrent UI/API imports.
-- Existing duplicate records are left for reviewed merging; unchanged links remain editable.
create or replace function ecod_private.guard_candidate_linkedin()
returns trigger language plpgsql security definer set search_path='' as $$
declare link text:=lower(rtrim(btrim(new.linkedin),'/'));
begin
 if link='' or new."mergedInto" is not null then return new; end if;
 if tg_op='UPDATE' and old.workspace_id=new.workspace_id and lower(rtrim(btrim(old.linkedin),'/'))=link and old."mergedInto" is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':'||link,0));
 if exists(select 1 from public.candidates c where c.workspace_id=new.workspace_id and c.id<>new.id
  and c."mergedInto" is null and lower(rtrim(btrim(c.linkedin),'/'))=link) then
  raise exception 'Duplicate LinkedIn profile' using errcode='23505';
 end if;
 return new;
end $$;
revoke all on function ecod_private.guard_candidate_linkedin() from public,anon,authenticated;
drop trigger if exists candidate_linkedin_uniqueness on public.candidates;
create trigger candidate_linkedin_uniqueness before insert or update on public.candidates for each row execute function ecod_private.guard_candidate_linkedin();
create table if not exists public."importBatches" (
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(name) between 1 and 160),
 total integer not null check(total between 1 and 5000),
 mapping jsonb not null default '{}' check(jsonb_typeof(mapping)='object'),
 status text not null default 'draft' check(status in ('draft','queued','completed','cancelled','paused')),
 version integer not null default 1,created_by uuid not null,approved_by uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id)
);
create table if not exists public."importRows" (
 workspace_id uuid not null,batch_id uuid not null,row_no integer not null check(row_no between 1 and 5000),
 source_line integer not null check(source_line between 1 and 1000000),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=20000),
 status text not null default 'draft' check(status in ('draft','excluded','pending','completed','duplicate','failed')),
 candidate_id uuid not null default gen_random_uuid(),error text not null default '',attempts integer not null default 0,
 primary key(batch_id,row_no),foreign key(workspace_id,batch_id) references public."importBatches"(workspace_id,id) on delete cascade
);
create index if not exists import_batches_queue on public."importBatches"(created_at,id) where status='queued';
create index if not exists import_batches_workspace on public."importBatches"(workspace_id,created_at desc,id);
create index if not exists import_rows_pending on public."importRows"(batch_id,row_no) where status='pending';
alter table public."importBatches" enable row level security;
alter table public."importRows" enable row level security;
revoke all on public."importBatches",public."importRows" from public,anon,authenticated;
grant select on public."importBatches",public."importRows" to authenticated;
drop policy if exists import_editor_read on public."importBatches";
create policy import_editor_read on public."importBatches" for select to authenticated
 using(workspace_id=(select public.current_workspace()) and public.can_edit_workspace(workspace_id));
drop policy if exists import_editor_read on public."importRows";
create policy import_editor_read on public."importRows" for select to authenticated
 using(workspace_id=(select public.current_workspace()) and public.can_edit_workspace(workspace_id));

create or replace function public.api_create_import(p_id uuid,p_name text,p_total integer,p_mapping jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_id is null or p_total is null or p_total not between 1 and 5000 or length(coalesce(p_name,'')) not between 1 and 160 or jsonb_typeof(p_mapping) is distinct from 'object' or octet_length(p_mapping::text)>5000 then raise exception 'Invalid import manifest'; end if;
 insert into public."importBatches"(id,workspace_id,name,total,mapping,created_by) values(p_id,ws,p_name,p_total,p_mapping,auth.uid()) on conflict(id) do nothing;
 select * into b from public."importBatches" where id=p_id and workspace_id=ws;
 if not found or b.name<>p_name or b.total<>p_total or b.mapping<>p_mapping then raise exception 'Import manifest conflict'; end if;
 return jsonb_build_object('id',b.id,'version',b.version,'status',b.status);
end $$;

create or replace function public.api_stage_import(p_batch uuid,p_version integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches"; r jsonb; n integer; draft jsonb; msg text;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into b from public."importBatches" where id=p_batch and workspace_id=ws for update;
 if not found then raise exception 'Import not found'; end if;
 if b.status<>'draft' or p_version is distinct from b.version then raise exception 'Import changed; refresh before editing'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Stage 1 to 50 rows at a time'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=(r->>'row')::integer; draft:=r->'candidate'; msg:=left(coalesce(r->>'error',''),200);
  if n is null or n not between 1 and b.total or jsonb_typeof(draft) is distinct from 'object' or octet_length(draft::text)>20000 then raise exception 'Invalid draft row'; end if;
  -- Ignore arbitrary IDs, identity allocations, workspace and extra fields from clients.
  select coalesce(jsonb_object_agg(key,value),'{}') into draft from jsonb_each(draft)
   where key=any(array['name','email','phone','linkedin','title','company','location','experience','relevantExperience','notice','current','expected','skills','mode','status','source','engagement','summary']);
  insert into public."importRows"(workspace_id,batch_id,row_no,source_line,payload,status,error)
   values(ws,b.id,n,coalesce((r->>'sourceLine')::integer,n),draft,case when msg='' then 'draft' else 'excluded' end,msg)
   on conflict(batch_id,row_no) do update set payload=excluded.payload,status=excluded.status,error=excluded.error
    where "importRows".status in ('draft','excluded','failed');
 end loop;
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id returning * into b;
 return jsonb_build_object('id',b.id,'version',b.version,'status',b.status);
end $$;

create or replace function public.api_import_action(p_batch uuid,p_version integer,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches";
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 select * into b from public."importBatches" where id=p_batch and workspace_id=ws for update;
 if not found then raise exception 'Import not found'; end if;
 if p_version is distinct from b.version then raise exception 'Import changed; refresh before approving'; end if;
 if p_action='approve' then
  if b.status<>'draft' or (select count(*) from public."importRows" where batch_id=b.id)<>b.total then raise exception 'Save and review all rows before approving'; end if;
  update public."importRows" set status='pending' where batch_id=b.id and status='draft';
  update public."importBatches" set status='queued',approved_by=auth.uid(),version=version+1,updated_at=now() where id=b.id;
 elsif p_action='cancel' then
  if b.status='completed' then raise exception 'Completed imports cannot be cancelled'; end if;
  update public."importBatches" set status='cancelled',version=version+1,updated_at=now() where id=b.id;
 elsif p_action='reopen' then
  if b.status not in ('completed','paused') then raise exception 'Wait for the batch to stop before reopening'; end if;
  update public."importRows" set status='draft',error='' where batch_id=b.id and status in ('failed','pending');
  update public."importBatches" set status='draft',approved_by=null,version=version+1,updated_at=now() where id=b.id;
 else raise exception 'Invalid import action'; end if;
 insert into public.history(workspace_id,"entityType","entityId",action,actor,snapshot)
 values(ws,'importBatches',b.id,'Import '||p_action,auth.uid()::text,jsonb_build_object('rows',b.total,'version',b.version));
 return jsonb_build_object('id',b.id);
end $$;

create or replace function public.api_import_page(p_batch uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=public.current_workspace(); b public."importBatches"; result jsonb;
begin
 if ws is null or not public.can_edit_workspace(ws) then raise exception 'Editor access required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Invalid page'; end if;
 if p_batch is null then
  select coalesce(jsonb_agg(to_jsonb(v)),'[]') into result from
   (select id,name,total,status,version,created_at from public."importBatches" where workspace_id=ws order by created_at desc,id limit 10 offset p_offset) v;
  return jsonb_build_object('batches',result,'total',(select count(*) from public."importBatches" where workspace_id=ws));
 end if;
 select * into b from public."importBatches" where id=p_batch and workspace_id=ws;
 if not found then raise exception 'Import not found'; end if;
 select coalesce(jsonb_agg(to_jsonb(v)),'[]') into result from
  (select row_no as row,source_line as "sourceLine",payload as candidate,status,error,candidate_id as "candidateId",attempts
   from public."importRows" where batch_id=b.id and workspace_id=ws order by row_no limit 50 offset p_offset) v;
 return jsonb_build_object('batch',to_jsonb(b),'rows',result,'saved',(select count(*) from public."importRows" where batch_id=b.id),
  'counts',(select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*) n from public."importRows" where batch_id=b.id group by status) v));
end $$;

create or replace function public.worker_run_imports(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public."importBatches"; r public."importRows"; d jsonb; completed integer:=0; skipped integer:=0; failed integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid worker batch size'; end if;
 select * into b from public."importBatches" where status='queued' order by created_at,id limit 1 for update skip locked;
 if not found then return jsonb_build_object('completed',0,'skipped',0,'failed',0); end if;
 if not exists(select 1 from public.memberships where user_id=b.approved_by and workspace_id=b.workspace_id and role in ('admin','recruiter')) then
  update public."importBatches" set status='paused',version=version+1,updated_at=now() where id=b.id;
  return jsonb_build_object('paused',true);
 end if;
 for r in select * from public."importRows" where batch_id=b.id and status='pending' order by row_no limit p_limit for update loop
  d:=r.payload;
  begin
   -- LinkedIn is checked as well as database-enforced email/phone uniqueness.
   if coalesce(d->>'linkedin','')<>'' and exists(select 1 from public.candidates c where c.workspace_id=b.workspace_id
    and lower(rtrim(c.linkedin,'/'))=lower(rtrim(d->>'linkedin','/'))) then
    update public."importRows" set status='duplicate',error='Duplicate LinkedIn profile; skipped.',attempts=attempts+1 where batch_id=b.id and row_no=r.row_no;
    skipped:=skipped+1; continue;
   end if;
   if jsonb_typeof(d->'name') is distinct from 'string' or coalesce(d->>'name','')='' or (coalesce(d->>'email','')='' and coalesce(d->>'phone','')='')
    or (coalesce(d->>'email','')<>'' and d->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or coalesce((d->>'experience')::numeric,0)>60 or coalesce((d->>'notice')::integer,0)>365
    or jsonb_typeof(d->'skills') is distinct from 'array' then raise check_violation; end if;
   if exists(select 1 from jsonb_array_elements(d->'skills') s where jsonb_typeof(s.value)<>'string' or length(s.value#>>'{}')>120) then raise check_violation; end if;
   insert into public.candidates(id,workspace_id,name,email,phone,linkedin,title,company,location,experience,"relevantExperience",notice,current,expected,skills,status,mode,source,summary,engagement,owner)
    values(r.candidate_id,b.workspace_id,btrim(d->>'name'),lower(btrim(coalesce(d->>'email',''))),coalesce(d->>'phone',''),coalesce(d->>'linkedin',''),coalesce(d->>'title',''),coalesce(d->>'company',''),coalesce(d->>'location',''),
     (d->>'experience')::numeric,(d->>'relevantExperience')::numeric,(d->>'notice')::integer,(d->>'current')::numeric,(d->>'expected')::numeric,
     array(select jsonb_array_elements_text(d->'skills')),coalesce(nullif(d->>'status',''),'Assessing'),coalesce(nullif(d->>'mode',''),'Flexible'),coalesce(nullif(d->>'source',''),'CSV import'),coalesce(d->>'summary',''),coalesce(d->>'engagement',''),'Recruiter');
   update public."importRows" set status='completed',error='',attempts=attempts+1 where batch_id=b.id and row_no=r.row_no;
   completed:=completed+1;
  exception
   when unique_violation then
    update public."importRows" set status='duplicate',error='Duplicate candidate contact; skipped.',attempts=attempts+1 where batch_id=b.id and row_no=r.row_no;
    skipped:=skipped+1;
   when serialization_failure or deadlock_detected then raise;
   when others then
    update public."importRows" set status='failed',error='Invalid candidate data. Review fields before retrying.',attempts=attempts+1 where batch_id=b.id and row_no=r.row_no;
    failed:=failed+1;
  end;
 end loop;
 if not exists(select 1 from public."importRows" where batch_id=b.id and status='pending') then
  update public."importBatches" set status='completed',version=version+1,updated_at=now() where id=b.id;
 end if;
 return jsonb_build_object('completed',completed,'skipped',skipped,'failed',failed);
end $$;
revoke all on function public.api_create_import(uuid,text,integer,jsonb),public.api_stage_import(uuid,integer,jsonb),public.api_import_action(uuid,integer,text),public.api_import_page(uuid,integer) from public,anon;
grant execute on function public.api_create_import(uuid,text,integer,jsonb),public.api_stage_import(uuid,integer,jsonb),public.api_import_action(uuid,integer,text),public.api_import_page(uuid,integer) to authenticated;
revoke all on function public.worker_run_imports(integer) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.worker_run_imports(integer) to service_role; end if; end $$;
commit;
