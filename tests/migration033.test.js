import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('migration 033 isolates agreements and filters candidates without leaking compensation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((name) => /^\d+.*\.sql$/.test(name)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(await readFile(new URL('033_client_documents_filters.sql', path), 'utf8'));
  await db.exec(
    `insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','outside@e.com');insert into public.workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');insert into public.memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`,
  );
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
    );
  const rpc = async (args = "'' , '',null,1000,0") =>
    (await db.query(`select public.api_filter_candidates(${args}) as result`)).rows[0].result;
  await act(1);
  await db.exec(
    `insert into public.clients(id,name) values('${id(31)}','Orion');insert into public.candidates(id,name,email,company,engagement,expected) values('${id(21)}','A','a@e.com','Deloitte','Contract',30),('${id(22)}','B','b@e.com','Deloitte','Permanent',45),('${id(23)}','C','c@e.com','Other','Contract',null),('${id(24)}','Retired','r@e.com','Deloitte','Contract',10);update public.candidates set "mergedInto"='${id(21)}' where id='${id(24)}';`,
  );
  assert.deepEqual((await rpc()).ids, [id(21), id(22), id(23)]);
  assert.deepEqual((await rpc("'DELO', 'Contract',35,1000,0")).ids, [id(21)]);
  assert.deepEqual(
    (await rpc("'%', '',null,1000,0")).ids,
    [],
    'employer input is literal, not a SQL wildcard',
  );
  assert.deepEqual((await rpc("'', '',null,1,1")).ids, [id(22)]);
  assert.deepEqual(
    (await rpc("'', '',0,1000,0")).ids,
    [],
    'unknown compensation does not match a ceiling',
  );
  await assert.rejects(rpc("'', '',-1,1000,0"), /zero or greater/);
  await assert.rejects(rpc("'', '',null,1001,0"), /pagination/);
  await db.exec(
    `insert into public.documents(id,"clientId",kind,name,"storageProvider","storagePath",stored) values('${id(41)}','${id(31)}','Agreement','Terms.pdf','r2','${id(11)}/clients/${id(31)}/object/Terms.pdf',true);insert into public.documents(id,"candidateId",name) values('${id(42)}','${id(21)}','CV.pdf');`,
  );
  await assert.rejects(
    db.exec(
      `insert into public.documents("clientId","candidateId",name) values('${id(31)}','${id(21)}','Bad')`,
    ),
    /single_owner/,
  );
  await assert.rejects(
    db.exec(
      `insert into public.documents("clientId",name,"storageProvider","storagePath") values('${id(31)}','Bad','r2','other/path')`,
    ),
    /storage path/,
  );
  await assert.rejects(
    db.exec(`update public.documents set "clientId"=null where id='${id(41)}'`),
    /ownership/,
  );
  const feed = async (paged) =>
    (
      await db.query(
        `select public.${paged ? 'api_changes_page(current_date,0,1000)' : 'api_changes_since(current_date)'} as result`,
      )
    ).rows[0].result;
  for (const paged of [false, true])
    assert.equal((await feed(paged)).documents.find((d) => d.id === id(41)).clientId, id(31));
  for (const block of [0, 1]) {
    const page = (
      await db.query(`select public.api_changes_page(current_date,${block},1) as result`)
    ).rows[0].result;
    assert.deepEqual(
      page.documents.map((document) => document.id),
      [id(41 + block)],
    );
    assert.equal(
      page.candidates[0].id,
      id(21 + block),
      'existing candidate pagination is preserved',
    );
  }
  await db.exec(`update public.documents set removed=true where id='${id(41)}'`);
  assert.equal((await feed(true)).documents.find((d) => d.id === id(41)).removed, true);
  await db.exec(`update public.documents set removed=false where id='${id(41)}'`);
  await act(2);
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from public.history where snapshot->>'clientId' is not null`,
      )
    ).rows[0].n,
    0,
    'document history cannot expose agreement snapshots',
  );
  assert.deepEqual((await rpc("'delo','Contract',null,1000,0")).ids, [id(21)]);
  await assert.rejects(rpc("'', '',100,1000,0"), /administrator/);
  assert.equal((await db.query('select count(*)::int as n from public.documents')).rows[0].n, 1);
  for (const paged of [false, true])
    assert.equal(
      (await feed(paged)).documents.some((d) => d.id === id(41)),
      false,
    );
  await assert.rejects(
    db.exec(`insert into public.documents("clientId",name) values('${id(31)}','Forbidden')`),
    /row-level/,
  );
  await act(3);
  assert.deepEqual((await rpc()).ids, [id(21), id(22), id(23)]);
  await assert.rejects(
    db.exec(`insert into public.documents("candidateId",name) values('${id(21)}','Forbidden')`),
    /row-level/,
  );
  await act(4);
  assert.deepEqual((await rpc()).ids, []);
  await assert.rejects(
    db.exec(`insert into public.documents("clientId",name) values('${id(31)}','Cross tenant')`),
    /foreign key/,
  );
  await db.exec('reset role;set role anon;');
  await assert.rejects(rpc(), /permission denied/);
});
