-- Record where each private original is stored. Existing rows remain readable from the
-- Supabase Storage bucket; new uploads use Cloudflare R2 through Netlify Functions.
begin;
alter table public."documents"
  add column if not exists "storageProvider" text not null default 'supabase'
  check ("storageProvider" in ('supabase','r2','inline'));

-- These flags have always existed in the client record. Persist them so PostgREST does not
-- reject cloud upserts, and infer the truthful state for rows created before this migration.
alter table public."documents" add column if not exists stored boolean;
alter table public."documents" add column if not exists "storageError" text not null default '';
update public."documents"
set stored = (coalesce("storagePath", '') <> '' or coalesce("dataUrl", '') <> '')
where stored is null;
alter table public."documents" alter column stored set default false;
alter table public."documents" alter column stored set not null;
commit;
