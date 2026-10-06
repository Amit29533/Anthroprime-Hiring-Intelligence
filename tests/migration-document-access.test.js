import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('audited signing enforces tenant quotas, service receipts, stale access and restrictive Storage reads', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
    create schema storage;create table storage.objects(name text,bucket_id text);alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;grant select on storage.objects to authenticated,anon;
    create policy existing_read on storage.objects for select to authenticated,anon using(true);`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_audited_document_access.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','viewer@e.com'),('${id(3)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Existing','existing@example.com');
    insert into documents(id,workspace_id,"candidateId",name,size,hash,"storagePath","storageProvider",stored) values
    ('${id(40)}','${id(11)}','${id(50)}','old.pdf',10,'${'a'.repeat(64)}','${id(11)}/candidates/${id(50)}/old.pdf','supabase',true),
    ('${id(41)}','${id(11)}','${id(50)}','legacy.pdf',10,'${'b'.repeat(64)}','legacy/key','supabase',true);
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');
    insert into storage.objects values('${id(11)}/candidates/${id(50)}/old.pdf','documents'),('legacy/key','documents'),('unrelated/key','documents'),('image','avatars');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  assert.equal(await rpc('api_document_access_mode'), false);
  assert.deepEqual(await rpc('api_begin_document_access', [id(40)]), { enforced: false });
  assert.equal((await db.query('select * from storage.objects')).rows.length, 4);
  await db.exec(
    `reset role;update settings set custom='{"auditedDocumentAccess":true}' where workspace_id='${id(11)}';`,
  );
  await act(1);
  assert.equal(await rpc('api_document_access_mode'), true);
  assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: 'image' }]);
  const first = await rpc('api_begin_document_access', [id(40)]);
  assert.equal(first.allowed, true);
  await assert.rejects(
    rpc('worker_finish_document_access', [first.requestId, 'issued']),
    /permission denied/,
  );
  await assert.rejects(
    db.query('select * from ecod_private.document_access_events'),
    /permission denied/,
  );
  await act(0, 'service_role');
  assert.equal(await rpc('worker_finish_document_access', [first.requestId, 'issued']), true);
  await act(1);
  const page = await rpc('api_document_access_page');
  assert.equal(page.counts.issued, 1);
  assert.equal(JSON.stringify(page).includes('storagePath'), false);
  assert.equal(JSON.stringify(page).includes('legacy/key'), false);
  for (let n = 1; n < 60; n++)
    assert.equal((await rpc('api_begin_document_access', [id(40)])).allowed, true);
  for (let n = 0; n < 3; n++) {
    const denied = await rpc('api_begin_document_access', [id(40)]);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfter >= 1 && denied.retryAfter <= 60);
  }
  assert.equal((await rpc('api_document_access_page')).counts.throttled, 1);
  await act(2);
  const viewer = await rpc('api_begin_document_access', [id(40)]);
  assert.equal(viewer.allowed, true);
  await assert.rejects(rpc('api_document_access_page'), /Administrator/);
  await act(3);
  await assert.rejects(rpc('api_begin_document_access', [id(40)]), /Document not found/);
  assert.deepEqual((await db.query('select name from storage.objects order by name')).rows, [
    { name: 'image' },
    { name: 'unrelated/key' },
  ]);
  await act(0, 'anon');
  assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: 'image' }]);
  await db.exec(`reset role;delete from memberships where user_id='${id(2)}';`);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_finish_document_access', [viewer.requestId, 'issued']), false);
  await db.exec(
    `reset role;update ecod_private.document_access_limits set started_at=now()-interval '2 minutes';`,
  );
  await act(1);
  const changed = await rpc('api_begin_document_access', [id(40)]);
  assert.equal(changed.allowed, true);
  await db.exec(`reset role;update documents set size=11 where id='${id(40)}';`);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_finish_document_access', [changed.requestId, 'issued']), false);
  await act(1);
  const abandoned = await rpc('api_begin_document_access', [id(40)]);
  await db.exec(
    `reset role;update ecod_private.document_access_events set expires_at=now()-interval '1 minute' where id='${abandoned.requestId}';`,
  );
  await act(1);
  const final = await rpc('api_document_access_page');
  assert.equal(final.counts.failed, 2);
  assert.equal(final.counts.abandoned, 1);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_finish_document_access', [abandoned.requestId, 'issued']), false);
  await db.exec(`reset role;
    insert into memberships values('${id(2)}','${id(11)}','viewer');
    insert into clients(id,workspace_id,name) values('${id(60)}','${id(11)}','Client');
    insert into documents(id,workspace_id,"candidateId","clientId",name,size,hash,"storagePath","storageProvider",stored) values
    ('${id(42)}','${id(11)}','${id(50)}',null,'old.pdf',10,'${'c'.repeat(64)}','${id(11)}/candidates/${id(50)}/old.pdf','r2',true),
    ('${id(43)}','${id(11)}',null,'${id(60)}','agreement.pdf',10,'${'d'.repeat(64)}','${id(11)}/clients/${id(60)}/agreement.pdf','r2',true);
    update settings set custom=custom||'{"privateDocuments":true}'::jsonb;`);
  await act(2);
  await assert.rejects(rpc('api_begin_document_access', [id(43)]), /Document not found/);
  await act(1);
  await rpc('api_adopt_legacy_document', [id(42)]);
  const quarantined = await rpc('api_begin_document_access', [id(42)]);
  await act(0, 'service_role');
  assert.equal(
    await rpc('worker_finish_document_access', [quarantined.requestId, 'issued']),
    false,
  );
  await act(1);
  const archived = await rpc('api_begin_document_access', [id(43)]);
  await db.exec(`reset role;update documents set removed=true where id='${id(43)}';`);
  await act(0, 'service_role');
  assert.equal(await rpc('worker_finish_document_access', [archived.requestId, 'issued']), false);
});
