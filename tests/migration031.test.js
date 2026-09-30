import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const USER = '00000000-0000-4000-8000-000000000001';
const FIRST = '00000000-0000-4000-8000-000000000011';
const SECOND = '00000000-0000-4000-8000-000000000012';
const OUTSIDE = '00000000-0000-4000-8000-000000000013';

async function migration(name) {
  return readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

test('migration 031 supports isolated workspace creation and switching', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of [
    '001_ecod.sql',
    '002_blueprint_r1.sql',
    '003_documents_taxonomy.sql',
    '004_admin_settings.sql',
    '021_user_administration.sql',
  ])
    await db.exec(await migration(file));

  await db.exec(`insert into auth.users values('${USER}','owner@example.com');
    insert into public.workspaces(id,name) values
      ('${FIRST}','AnthroPrime'),('${SECOND}','Client Desk'),('${OUTSIDE}','Outside');
    insert into public.memberships values('${USER}','${FIRST}','admin');`);
  await db.exec(await migration('031_multi_workspace.sql'));
  await db.exec(await migration('031_multi_workspace.sql'));
  await db.exec(`insert into public.memberships values('${USER}','${SECOND}','viewer');
    select set_config('request.jwt.claim.sub','${USER}',false);
    set role authenticated;`);

  const initial = (await db.query('select public.api_my_workspaces() as payload')).rows[0].payload;
  assert.equal(initial.activeWorkspace, FIRST, 'the legacy membership stays selected');
  assert.deepEqual(
    initial.workspaces.map((workspace) => workspace.name),
    ['AnthroPrime', 'Client Desk'],
  );
  assert.equal((await db.query('select public.is_admin() as value')).rows[0].value, true);

  const switched = (await db.query(`select public.api_switch_workspace('${SECOND}') as payload`))
    .rows[0].payload;
  assert.equal(switched.ok, true);
  assert.equal((await db.query('select public.current_workspace() as id')).rows[0].id, SECOND);
  assert.equal(
    (await db.query('select public.is_admin() as value')).rows[0].value,
    false,
    'admin rights do not leak from another workspace',
  );

  await db.exec(`reset role;
    insert into public.candidates(workspace_id,name,email)
    values('${SECOND}','Second candidate','second@example.com');
    set role authenticated;`);
  await db.query(`select public.api_switch_workspace('${FIRST}')`);
  assert.equal(
    (await db.query('select count(*)::int as count from public.candidates')).rows[0].count,
    0,
    'RLS follows the active workspace',
  );

  const created = (await db.query(`select public.api_create_workspace('New Practice') as payload`))
    .rows[0].payload;
  assert.equal(created.ok, true);
  assert.equal(created.role, 'admin');
  assert.equal((await db.query('select public.current_workspace() as id')).rows[0].id, created.id);
  assert.equal((await db.query('select public.is_admin() as value')).rows[0].value, true);

  const denied = (await db.query(`select public.api_switch_workspace('${OUTSIDE}') as payload`))
    .rows[0].payload;
  assert.match(denied.error, /access required/i);
  await db.close();
});
