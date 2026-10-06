-- Phase C4: bounded, explicitly reviewed CV section evidence; no inferred credentials.
begin;
alter table public.candidates add column if not exists "cvEvidence" jsonb not null default '{}';
create or replace function ecod_private.valid_cv_evidence(v jsonb,require_review boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if v='{}'::jsonb then return true; end if;
 if v is null or jsonb_typeof(v)<>'object' or v->'version' is distinct from '1'::jsonb
  or jsonb_typeof(v->'items') is distinct from 'array' or jsonb_typeof(v->'truncated') is distinct from 'boolean'
  or octet_length(v::text)>14000 or exists(select 1 from jsonb_object_keys(v) k where k not in ('version','items','truncated')) then return false; end if;
 if jsonb_array_length(v->'items')>16 then return false; end if;
 for item in select value from jsonb_array_elements(v->'items') loop
  if jsonb_typeof(item)<>'object' then return false; end if;
  if item->>'section' is null or item->>'section' not in ('employment','education','certifications','projects')
   or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label') not between 1 and 160
   or jsonb_typeof(item->'period') is distinct from 'string' or length(item->>'period')>80
   or jsonb_typeof(item->'evidence') is distinct from 'string' or length(item->>'evidence') not between 1 and 400
   or jsonb_typeof(item->'sourceLine') is distinct from 'number' or (item->>'sourceLine') !~ '^[1-9][0-9]{0,4}$'
   or jsonb_typeof(item->'reviewed') is distinct from 'boolean'
   or (require_review and item->'reviewed' is distinct from 'true'::jsonb)
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('section','label','period','evidence','sourceLine','reviewed')) then return false; end if;
  if (item->>'sourceLine')::integer>40000 then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function ecod_private.valid_cv_evidence(jsonb,boolean) from public,anon,authenticated;

create or replace function ecod_private.cv_evidence_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare original text; item jsonb;
begin
 if tg_table_name='candidates' then
  if not ecod_private.valid_cv_evidence(new."cvEvidence",true) then raise exception 'CV excerpts require valid bounded data and explicit review'; end if;
 else
  if new.payload ? 'cvEvidence' and not ecod_private.valid_cv_evidence(new.payload->'cvEvidence',new.status in ('draft','pending','completed')) then
   raise exception 'Confirm or remove every CV excerpt before including this row';
  end if;
  if new.payload ? 'cvEvidence' and new.payload->'cvEvidence'<>'{}'::jsonb then
   select f.extracted into original from public."importFiles" f where f.workspace_id=new.workspace_id and f.batch_id=new.batch_id and f.row_no=new.row_no;
   if found then
    for item in select value from jsonb_array_elements(new.payload->'cvEvidence'->'items') loop
     if strpos(btrim(split_part(replace(original,E'\r',''),E'\n',(item->>'sourceLine')::integer),E' \t'),item->>'evidence')<>1 then
      raise exception 'CV citation does not match the original extracted line';
     end if;
    end loop;
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function ecod_private.cv_evidence_guard() from public,anon,authenticated;
drop trigger if exists cv_evidence_guard on public.candidates;
create trigger cv_evidence_guard before insert or update on public.candidates for each row execute function ecod_private.cv_evidence_guard();
drop trigger if exists cv_evidence_guard on public."importRows";
create trigger cv_evidence_guard before insert or update on public."importRows" for each row execute function ecod_private.cv_evidence_guard();

create or replace function public.worker_finish_cv(p_file uuid,p_lease uuid,p_state text,p_text text,p_draft jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare f public."importFiles"; b public."importBatches"; draft jsonb;
begin
 select ib.* into b from public."importBatches" ib join public."importFiles" x on x.batch_id=ib.id where x.id=p_file for update of ib;
 if not found or b.status<>'draft' or not ecod_private.cv_staging_enabled(b.workspace_id) then return false; end if;
 select * into f from public."importFiles" where id=p_file for update;
 if f.state<>'extracting' or f.lease is distinct from p_lease or f.lease_until<now() then return false; end if;
 if p_state not in ('ready','manual','failed') or p_state is null or p_text is null or length(p_text)>40000 or jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>20000 then raise exception 'Invalid extraction result'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into draft from jsonb_each(p_draft)
  where key=any(array['name','email','phone','linkedin','title','skills','experience','summary','cvEvidence']);
 draft:=draft||'{"source":"CV upload","status":"Assessing","mode":"Flexible"}';
 update public."importFiles" set state=p_state,extracted=p_text,lease=null,lease_until=null,
  warning=case p_state when 'failed' then 'Original could not be verified or read. Retry upload/processing.' when 'manual' then 'No usable text extracted. Enter candidate details manually.' else '' end where id=f.id;
 -- A later extraction result must not overwrite a recruiter's edits. Waiting rows only.
 update public."importRows" set payload=draft,status='excluded',error=case when p_state='failed' then 'Original file verification failed.' else 'Review CV name and contact, then save this row to include it.' end
  where batch_id=b.id and row_no=f.row_no and payload='{}';
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id;
 return true;
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
   insert into public.candidates(id,workspace_id,name,email,phone,linkedin,title,company,location,experience,"relevantExperience",notice,current,expected,skills,status,mode,source,summary,engagement,owner,"cvEvidence")
    values(r.candidate_id,b.workspace_id,btrim(d->>'name'),lower(btrim(coalesce(d->>'email',''))),coalesce(d->>'phone',''),coalesce(d->>'linkedin',''),coalesce(d->>'title',''),coalesce(d->>'company',''),coalesce(d->>'location',''),
     (d->>'experience')::numeric,(d->>'relevantExperience')::numeric,(d->>'notice')::integer,(d->>'current')::numeric,(d->>'expected')::numeric,
     array(select jsonb_array_elements_text(d->'skills')),coalesce(nullif(d->>'status',''),'Assessing'),coalesce(nullif(d->>'mode',''),'Flexible'),coalesce(nullif(d->>'source',''),'CSV import'),coalesce(d->>'summary',''),coalesce(d->>'engagement',''),'Recruiter',coalesce(d->'cvEvidence','{}'::jsonb));
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
   where key=any(array['name','email','phone','linkedin','title','company','location','experience','relevantExperience','notice','current','expected','skills','mode','status','source','engagement','summary','cvEvidence']);
  insert into public."importRows"(workspace_id,batch_id,row_no,source_line,payload,status,error)
   values(ws,b.id,n,coalesce((r->>'sourceLine')::integer,n),draft,case when msg='' then 'draft' else 'excluded' end,msg)
   on conflict(batch_id,row_no) do update set payload=excluded.payload,status=excluded.status,error=excluded.error
    where "importRows".status in ('draft','excluded','failed');
 end loop;
 update public."importBatches" set version=version+1,updated_at=now() where id=b.id returning * into b;
 return jsonb_build_object('id',b.id,'version',b.version,'status',b.status);
end $$;
commit;
