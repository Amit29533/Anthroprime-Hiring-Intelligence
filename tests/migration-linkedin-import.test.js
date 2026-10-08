import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('LinkedIn lookup reservations require workspace activation, protect daily shared quotas and honor admin MFA', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_linkedin_candidate_enrichment.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','other@e.com'),('${id(4)}','viewer@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(12)}','admin'),('${id(4)}','${id(11)}','viewer');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}'),('workspace','${id(12)}','{}');`);
  const act = async (n, aal = 'aal1', role = 'authenticated') => {
    await db.exec('reset role');
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [n ? id(n) : '', JSON.stringify({ aal })],
    );
    await db.exec(`set role ${role}`);
  };
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(2);
  assert.deepEqual(await rpc('api_reserve_linkedin_lookup'), { enabled: false, allowed: false });
  await assert.rejects(rpc('api_set_linkedin_import', [true]), /Administrator/);
  await act(1);
  await rpc('api_set_linkedin_import', [true]);
  assert.equal((await rpc('api_linkedin_import_status')).enabled, true);
  for (let n = 0; n < 20; n++) {
    await act(n % 2 ? 2 : 1);
    assert.equal((await rpc('api_reserve_linkedin_lookup')).allowed, true);
  }
  assert.equal((await rpc('api_reserve_linkedin_lookup')).allowed, false);
  await assert.rejects(
    db.query('select * from ecod_private.linkedin_lookup_limits'),
    /permission denied/,
  );
  await act(3);
  assert.equal((await rpc('api_linkedin_import_status')).enabled, false);
  await rpc('api_set_linkedin_import', [true]);
  assert.equal((await rpc('api_reserve_linkedin_lookup')).allowed, true);
  await act(4);
  await assert.rejects(rpc('api_reserve_linkedin_lookup'), /permission/);
  await act(1, 'aal2');
  await db.query('update settings set custom=custom||$1::jsonb where workspace_id=$2', [
    JSON.stringify({
      privilegedMfa: true,
      auditedDocumentAccess: true,
      auditedCandidateExports: true,
    }),
    id(11),
  ]);
  await act(1);
  await assert.rejects(rpc('api_set_linkedin_import', [false]), /Verify/);
  await assert.rejects(rpc('api_reserve_linkedin_lookup'), /Verify/);
  await act(1, 'aal2');
  await rpc('api_set_linkedin_import', [false]);
  assert.equal((await rpc('api_reserve_linkedin_lookup')).enabled, false);
  await db.query('insert into candidates(id,name,email,linkedin,custom) values($1,$2,$3,$4,$5)', [
    id(50),
    'Priya Sharma',
    'priya@example.com',
    'https://www.linkedin.com/in/priya-sharma',
    { linkedinImport: { provider: 'Pasted LinkedIn text' } },
  ]);
  assert.match(
    (await db.query('select "anthroId" from candidates where id=$1', [id(50)])).rows[0].anthroId,
    /^ANTHRO-\d{5}$/,
  );
  await act(null, 'aal1', 'anon');
  await assert.rejects(rpc('api_reserve_linkedin_lookup'), /permission denied/);
});
