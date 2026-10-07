import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const db = new PGlite({ extensions: { vector } });
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const root = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(root)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(name, root), 'utf8'));
  const result =
    await db.query(`select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,p.prosecdef privileged
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema')
    and (p.prosrc like '%public.candidates%' or p.prosrc like '%public.history%' or p.prosrc like '%compensationHistory%') order by n.nspname,p.proname`);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await db.close();
}
