-- Compact, centrally allocated identity. Keep UUID foreign keys unchanged.
begin;
lock table public.candidates in access exclusive mode;
do $$ begin
  if (select count(*) from public.candidates)>99999 then
    raise exception 'Five-digit Anthro-ID capacity is limited to 99,999 candidate records';
  end if;
end $$;
create sequence if not exists public.candidate_anthro_number_seq as integer
  minvalue 1 maxvalue 99999 start with 1 no cycle cache 1;
revoke all on sequence public.candidate_anthro_number_seq from public,anon;
grant usage on sequence public.candidate_anthro_number_seq to authenticated;
alter table public.candidates add column if not exists "anthroNumber" integer;
-- Guard from the preceding migration permits this initial backfill.
do $$ declare row_id uuid; maximum integer; allocated bigint; called boolean; begin
  select max("anthroNumber") into maximum from public.candidates;
  select last_value,is_called into allocated,called from public.candidate_anthro_number_seq;
  if maximum is not null and (maximum>allocated or (maximum=allocated and not called)) then
    perform setval('public.candidate_anthro_number_seq',maximum,true);
  end if;
  for row_id in select id from public.candidates where "anthroNumber" is null order by created,id loop
    update public.candidates set "anthroNumber"=nextval('public.candidate_anthro_number_seq') where id=row_id;
  end loop;
end $$;
alter table public.candidates alter column "anthroNumber" set not null;
create unique index if not exists candidates_anthro_number_unique on public.candidates("anthroNumber");
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.candidates'::regclass and conname='candidates_anthro_number_range') then
    alter table public.candidates add constraint candidates_anthro_number_range check("anthroNumber" between 1 and 99999);
  end if;
  if exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where d.adrelid='public.candidates'::regclass and a.attname='anthroId' and pg_get_expr(d.adbin,d.adrelid) not like '%anthroNumber%') then
    alter table public.candidates drop column "anthroId";
  end if;
end $$;
alter table public.candidates add column if not exists "anthroId" text
  generated always as ('ANTHRO-' || lpad("anthroNumber"::text,5,'0')) stored not null;
create unique index if not exists candidates_anthro_id_unique on public.candidates("anthroId");

-- Existing upserts reuse the allocated number without consuming a sequence value.
-- New inserts ignore caller-supplied allocations; PostgreSQL is the only allocator.
create or replace function public.allocate_candidate_anthro_number()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  select c."anthroNumber" into new."anthroNumber" from public.candidates c
    where c.id=new.id and c.workspace_id=new.workspace_id;
  if new."anthroNumber" is null then
    new."anthroNumber":=nextval('public.candidate_anthro_number_seq');
  end if;
  return new;
end $$;
revoke all on function public.allocate_candidate_anthro_number() from public,anon,authenticated;
drop trigger if exists allocate_candidate_anthro_number on public.candidates;
create trigger allocate_candidate_anthro_number before insert on public.candidates
for each row execute function public.allocate_candidate_anthro_number();
create or replace function public.guard_candidate_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new."anthroNumber" is distinct from old."anthroNumber" then
    raise exception 'Candidate identity and Anthro-ID cannot be changed' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_candidate_identity() from public,anon,authenticated;

-- Old UUID-format references remain resolvable, as do retired compact IDs.
create or replace function public.api_candidate_by_anthro_id(p_anthro_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  with recursive chain as (
    select c.id,c."anthroId",c."mergedInto",array[c.id] as visited
    from public.candidates c where c.workspace_id=public.current_workspace()
      and (c."anthroId"=upper(btrim(p_anthro_id)) or
        'ANTHRO-'||upper(c.id::text)=upper(btrim(p_anthro_id)))
    union all
    select c.id,c."anthroId",c."mergedInto",chain.visited||c.id
    from chain join public.candidates c on c.id=chain."mergedInto"
    where c.workspace_id=public.current_workspace() and not c.id=any(chain.visited)
  )
  select jsonb_build_object('candidateId',id,'anthroId',"anthroId",'matchedAnthroId',upper(btrim(p_anthro_id)))
  from chain where "mergedInto" is null limit 1
$$;
revoke all on function public.api_candidate_by_anthro_id(text) from public,anon;
grant execute on function public.api_candidate_by_anthro_id(text) to authenticated;
update public."integrationReceipts" r set response=r.response||jsonb_build_object('anthroId',c."anthroId")
from public.candidates c where r.workspace_id=c.workspace_id and r.response->>'candidateId'=c.id::text
  and r.response->>'anthroId' is distinct from c."anthroId";
commit;
