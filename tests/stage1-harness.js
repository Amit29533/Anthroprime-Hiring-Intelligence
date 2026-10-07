import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
export const id = (n) => `79000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export async function stage1Database(t) {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon,service_role;`);
  const root = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(root)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const name of files) await db.exec(await readFile(new URL(name, root), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','staff@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com'),('${id(5)}','assessor@e.com'),('${id(6)}','sales@e.com');
 insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
 insert into candidates(id,workspace_id,name,email,current,expected,verified)values('${id(21)}','${id(11)}','Person','one@e.com',10,12,'2026-01-01'),('${id(22)}','${id(12)}','Other','other@e.com',100,120,'2026-01-01');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))
      .rows[0].value;
  const today = (
    await db.query("select (statement_timestamp()at time zone'UTC')::date::text today_utc")
  ).rows[0].today_utc;
  return { db, act, rpc, today, root, files };
}
