import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('paged reads bound payloads, enforce tenant/role access and resolve retired identities', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_paged_repository.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
 insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
 insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
 insert into candidates(id,workspace_id,name,email,skills,experience,notice,company,expected) select ('20000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'${id(11)}',case when i<=55 then 'Same name' else 'Zed '||i end,'person'||i||'@e.com',array['React','SQL'],5,30,'Employer',20 from generate_series(1,120) i;
 insert into candidates(id,workspace_id,name,email,skills) values('${id(500)}','${id(12)}','Hidden candidate','hidden@e.com',array['Secret']);
 insert into documents(id,workspace_id,"candidateId",name,extracted,"storagePath","storageProvider") values('${id(600)}','${id(11)}','${id(101)}','cv.txt','Angular private text','${id(11)}/candidates/${id(101)}/cv','r2');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(3);
  const overview = await rpc('api_repository_overview');
  assert.equal(overview.candidates, 120);
  let cursor = null;
  const found = [];
  do {
    const page = await rpc('api_repository_page', [{}, cursor, 50]);
    assert.ok(page.rows.length <= 50);
    found.push(...page.rows.map((c) => c.id));
    cursor = page.next;
  } while (cursor);
  assert.equal(found.length, 120);
  assert.equal(new Set(found).size, 120, 'ties never repeat across cursors');
  let page = await rpc('api_repository_page', [{}, null, 50]);
  assert.equal(page.rows[0].expected, undefined);
  assert.equal(page.rows[0].email, undefined);
  assert.equal(page.rows[0].summary, undefined);
  await assert.rejects(rpc('api_repository_page', [{}, null, 51]), /Invalid repository/);
  await assert.rejects(rpc('api_repository_page', [{ status: 'Ready' }, page.next, 50]), /Cursor/);
  await assert.rejects(rpc('api_repository_page', [{ maxExpected: 25 }]), /administrator/);
  await assert.rejects(rpc('api_repository_page', [{ minExperience: 100 }]), /numeric/);
  await assert.rejects(rpc('api_repository_page', [{ unsupported: 'injected' }]), /Unsupported/);
  assert.equal(
    (await rpc('api_repository_page', [{ query: 'React Angular' }])).rows[0].id,
    id(101),
    'search spans profile and CV',
  );
  assert.ok(
    !(await rpc('api_repository_page', [{ query: 'React -Angular' }])).rows.some(
      (c) => c.id === id(101),
    ),
    'CV negative terms cannot be bypassed',
  );
  assert.equal((await rpc('api_repository_page', [{ query: 'Hidden' }])).rows.length, 0);
  assert.equal(
    (
      await rpc('api_repository_page', [
        { skill: 'SQL', employer: 'ployer', location: '', maxNotice: 30, minExperience: 5 },
      ])
    ).rows.length,
    50,
  );
  const doc = (await rpc('api_candidate_section', [id(101), 'documents'])).rows[0];
  assert.equal(doc.extracted, undefined);
  assert.equal(doc.dataUrl, undefined);
  assert.ok(doc.storagePath);
  for (const section of [
    'notes',
    'assessments',
    'considerations',
    'enrichment',
    'employmentHistory',
    'compensationHistory',
    'availabilityHistory',
    'interviews',
    'offers',
    'placements',
    'consents',
    'personSkills',
    'skillEvidence',
    'history',
  ])
    assert.ok(
      Array.isArray((await rpc('api_candidate_section', [id(101), section])).rows),
      section,
    );
  await assert.rejects(rpc('api_candidate_section', [id(500)]), /not found/);
  await assert.rejects(
    rpc('api_candidate_section', [id(101), 'documents;drop table candidates']),
    /Unsupported/,
  );
  await act(1);
  assert.equal((await rpc('api_repository_page', [{ maxExpected: 21 }])).rows.length, 50);
  const old = (await rpc('api_candidate_section', [id(102)])).candidate;
  await db.exec(`reset role;update candidates set "mergedInto"='${id(101)}',email='',phone='' where id='${id(102)}';
 insert into notes(id,workspace_id,"candidateId",text) select ('20000000-0000-4000-8000-'||lpad((700+i)::text,12,'0'))::uuid,'${id(11)}','${id(102)}','Historical note '||i from generate_series(1,51) i;`);
  await act(2);
  await db.exec(
    `reset role;insert into documents(id,workspace_id,"candidateId",name,extracted) values('${id(601)}','${id(11)}','${id(102)}','retired.txt','RetiredOriginalText');`,
  );
  await act(2);
  assert.equal(
    (await rpc('api_repository_page', [{ query: 'RetiredOriginalText' }])).rows[0].id,
    id(101),
  );
  const alias = await rpc('api_repository_page', [{ query: old.anthroId }]);
  assert.equal(alias.rows.length, 1);
  assert.equal(alias.rows[0].id, id(101));
  const retired = await rpc('api_candidate_section', [id(102), 'notes']);
  assert.equal(retired.rows.length, 50);
  assert.equal(retired.more, true);
  assert.equal(retired.candidateId, id(101));
  assert.equal((await rpc('api_candidate_section', [id(101), 'notes', 50])).rows.length, 1);
  await act(4);
  assert.equal((await rpc('api_repository_overview')).candidates, 1);
  assert.equal((await rpc('api_repository_page', [{ query: old.anthroId }])).rows.length, 0);
  await act(0, 'anon');
  await assert.rejects(rpc('api_repository_page'), /permission denied/);
  await act(0);
  await assert.rejects(rpc('api_repository_overview'), /membership/);
});
