-- Phase 2 completion slice: admin-configurable fields on candidates, demands, clients and contacts.
-- Apply after 001-033. Fields are member-visible; restricted financial fields remain separate.
begin;
alter table public.clients add column if not exists custom jsonb not null default '{}'::jsonb;
alter table public."clientContacts" add column if not exists custom jsonb not null default '{}'::jsonb;

create or replace function public.validate_custom_field_definitions()
returns trigger language plpgsql set search_path = '' as $$
declare module record; field jsonb; names text[]; choices text[]; choice jsonb; old_field jsonb;
begin
  if new.custom->'customFields' is null then
    if tg_op='UPDATE' and old.custom ? 'customFields' then raise exception 'Existing fields cannot be removed; archive them instead'; end if;
    return new;
  end if;
  if jsonb_typeof(new.custom->'customFields') <> 'object' then raise exception 'customFields must be an object'; end if;
  for module in select * from jsonb_each(new.custom->'customFields') loop
    if module.key not in ('candidates','demands','clients','clientContacts') then raise exception 'Unsupported custom field module'; end if;
    if jsonb_typeof(module.value) <> 'array' then raise exception 'Field definitions must be an array'; end if;
    if jsonb_array_length(module.value)>40 then raise exception 'Each module supports up to 40 fields'; end if;
    names := array[]::text[];
    for field in select value from jsonb_array_elements(module.value) loop
      if jsonb_typeof(field)<>'object' or jsonb_typeof(field->'name') is distinct from 'string'
         or length(btrim(field->>'name')) not between 1 and 60
         or field->>'name' in ('__proto__','constructor','prototype')
         or coalesce(field->>'type','') not in ('text','number','date','select') then
        raise exception 'Invalid custom field definition';
      end if;
      if lower(field->>'name') = any(names) then raise exception 'Duplicate custom field name'; end if;
      names := array_append(names,lower(field->>'name'));
      if field ? 'archived' and jsonb_typeof(field->'archived') <> 'boolean' then raise exception 'Invalid archived flag'; end if;
      if field->>'type'='select' then
        if jsonb_typeof(field->'options') is distinct from 'array' then raise exception 'Select fields need choices'; end if;
        if jsonb_array_length(field->'options') not between 1 and 50 then raise exception 'Select fields need 1-50 choices'; end if;
        choices := array[]::text[];
        for choice in select value from jsonb_array_elements(field->'options') loop
          if jsonb_typeof(choice)<>'string' or length(btrim(choice#>>'{}')) not between 1 and 100 then raise exception 'Invalid field choice'; end if;
          if lower(choice#>>'{}')=any(choices) then raise exception 'Duplicate field choice'; end if;
          choices := array_append(choices,lower(choice#>>'{}'));
        end loop;
      end if;
    end loop;
  end loop;
  -- Rename/type changes would orphan or invalidate recorded values. Archive instead.
  if tg_op='UPDATE' and jsonb_typeof(old.custom->'customFields')='object' then
    for module in select * from jsonb_each(old.custom->'customFields') loop
      for old_field in select value from jsonb_array_elements(module.value) loop
        select value into field from jsonb_array_elements(coalesce(new.custom->'customFields'->module.key,'[]'::jsonb)) where value->>'name'=old_field->>'name';
        if field is null or field->>'type' is distinct from old_field->>'type'
           or field->'options' is distinct from old_field->'options' then
          raise exception 'Existing fields cannot be removed or retyped; archive them instead';
        end if;
      end loop;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists validate_custom_fields on public.settings;
create trigger validate_custom_fields before insert or update on public.settings
for each row execute function public.validate_custom_field_definitions();

create or replace function public.validate_custom_field_values()
returns trigger language plpgsql set search_path = '' as $$
declare definitions jsonb; field jsonb; value jsonb; text_value text;
begin
  if jsonb_typeof(new.custom) is distinct from 'object' then raise exception 'Custom fields must be an object'; end if;
  if octet_length(new.custom::text)>100000 then raise exception 'Custom fields exceed size limit'; end if;
  select s.custom->'customFields'->tg_table_name into definitions from public.settings s where s.workspace_id=new.workspace_id and s.id='workspace';
  if definitions is null then return new; end if;
  for field in select item from jsonb_array_elements(definitions) as fields(item) loop
    value := new.custom->(field->>'name');
    if field->>'archived'='true' or value is null or value='null'::jsonb or value='""'::jsonb then continue; end if;
    text_value := value#>>'{}';
    if field->>'type'='number' then
      if jsonb_typeof(value)<>'number' then raise exception 'Custom field % requires a number',field->>'name'; end if;
    else
      if jsonb_typeof(value)<>'string' or length(text_value)>2000 then raise exception 'Custom field % requires text up to 2000 characters',field->>'name'; end if;
      if field->>'type'='date' then
        if text_value !~ '^\d{4}-\d{2}-\d{2}$' or (text_value::date)::text<>text_value then raise exception 'Custom field % requires a valid date',field->>'name'; end if;
      elsif field->>'type'='select' and not (field->'options' @> jsonb_build_array(text_value)) then
        raise exception 'Custom field % requires a configured choice',field->>'name';
      end if;
    end if;
  end loop;
  return new;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['candidates','demands','clients','clientContacts'] loop
    execute format('drop trigger if exists validate_custom_values on public.%I',tbl);
    execute format('create trigger validate_custom_values before insert or update on public.%I for each row execute function public.validate_custom_field_values()',tbl);
  end loop;
end $$;
revoke all on function public.validate_custom_field_definitions(),public.validate_custom_field_values() from public,anon,authenticated;
-- Existing client/contact RLS, audit triggers and c.* incremental projections also cover custom.
commit;
