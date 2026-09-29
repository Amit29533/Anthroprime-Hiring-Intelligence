import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 030 preserves legacy documents and constrains storage providers', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of ['001_ecod.sql', '002_blueprint_r1.sql', '003_documents_taxonomy.sql'])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.exec(`insert into auth.users values('00000000-0000-4000-8000-000000000001','a@e.com');
    insert into workspaces(id,name) values('00000000-0000-4000-8000-000000000011','A');
    insert into memberships values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','admin');
    select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
    set role authenticated;
    insert into candidates(id,name,email) values('00000000-0000-4000-8000-000000000021','Ada','ada@example.com');
    insert into documents(id,"candidateId",name,"storagePath") values('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','cv.pdf','legacy/cv.pdf');
    reset role;`);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/030_document_storage_provider.sql', import.meta.url),
      'utf8',
    ),
  );
  const legacy = (
    await db.query(`select "storageProvider",stored,"storageError" from documents`)
  ).rows[0];
  assert.equal(legacy.storageProvider, 'supabase');
  assert.equal(legacy.stored, true, 'a legacy row with a storage path remains marked as stored');
  assert.equal(legacy.storageError, '');
  await db.exec(`update documents set "storageProvider"='r2';`);
  await assert.rejects(
    () => db.exec(`update documents set "storageProvider"='unknown';`),
    /check constraint/i,
  );
  await db.close();
});
