import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { legacyAnthroIdFor } from '../src/anthroId.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('compact migration allocates five-digit IDs without collisions, edits, upserts or reuse', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  const compactName = files.find((n) => n.endsWith('_compact_anthro_id.sql'));
  for (const file of files.filter((n) => n < compactName))
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@example.com'),('${id(2)}','other@example.com'),('${id(3)}','candidate@example.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(21)}','${id(11)}','Existing','candidate@example.com');`);
  const sql = await readFile(new URL(compactName, path), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false); set role ${role};`,
    );
  const rpc = async (name, values = []) =>
    (
      await db.query(
        `select ${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        values,
      )
    ).rows[0].result;
  await act(1);
  const existing = (await db.query('select * from candidates where id=$1', [id(21)])).rows[0];
  assert.equal(existing.anthroId, 'ANTHRO-00001');
  assert.equal(existing.anthroNumber, 1);
  for (let n = 0; n < 5; n++)
    await db.query(
      'insert into candidates(id,name,email) values($1,$2,$3) on conflict(id) do update set name=excluded.name,"anthroNumber"=excluded."anthroNumber"',
      [id(21), 'Edited', 'candidate@example.com'],
    );
  const created = (
    await db.query(
      'insert into candidates(id,name,email,"anthroNumber") values($1,$2,$3,$4) returning *',
      [id(22), 'Second', 'second@example.com', 88888],
    )
  ).rows[0];
  assert.equal(created.anthroId, 'ANTHRO-00002');
  await assert.rejects(
    db.query('update candidates set "anthroNumber"=500 where id=$1', [id(21)]),
    /cannot be changed/,
  );
  await assert.rejects(
    db.query('update candidates set "anthroId"=$1 where id=$2', ['ANTHRO-12345', id(21)]),
    /DEFAULT/,
  );
  const integrated = await rpc('api_integrate_candidate', [
    'training',
    'one',
    'compact-request-one',
    { name: 'Imported', email: 'imported@example.com' },
    null,
  ]);
  assert.equal(integrated.anthroId, 'ANTHRO-00003');
  assert.equal(
    (
      await rpc('api_integrate_candidate', [
        'training',
        'one',
        'compact-request-one',
        { name: 'Imported', email: 'imported@example.com' },
        null,
      ])
    ).anthroId,
    'ANTHRO-00003',
  );
  await db.query('update candidates set "mergedInto"=$1,email=$2 where id=$3', [
    id(21),
    '',
    id(22),
  ]);
  for (const value of [
    'anthro-00001',
    'ANTHRO-00002',
    legacyAnthroIdFor(id(21)),
    legacyAnthroIdFor(id(22)),
  ]) {
    const result = await rpc('api_candidate_by_anthro_id', [value]);
    assert.equal(result.candidateId, id(21));
    assert.equal(result.anthroId, 'ANTHRO-00001');
  }
  await act(3);
  assert.equal((await rpc('api_portal_overview')).profile.anthroId, 'ANTHRO-00001');
  await act(2);
  assert.equal(await rpc('api_candidate_by_anthro_id', ['ANTHRO-00001']), null);
  const other = (
    await db.query('insert into candidates(name,email) values($1,$2) returning "anthroId"', [
      'Other',
      'other-candidate@example.com',
    ])
  ).rows[0];
  assert.equal(other.anthroId, 'ANTHRO-00004', 'sequence is global across workspaces');
  await act(0, 'anon');
  await assert.rejects(rpc('api_candidate_by_anthro_id', ['ANTHRO-00001']), /permission denied/);
  await db.exec('reset role');
  await db.exec(sql);
  assert.equal(
    (await db.query('select "anthroId" from candidates where id=$1', [id(21)])).rows[0].anthroId,
    'ANTHRO-00001',
  );
  await db.exec("select setval('candidate_anthro_number_seq',99998,true)");
  await act(1);
  const last = (
    await db.query('insert into candidates(name,email) values($1,$2) returning "anthroId"', [
      'Last',
      'last@example.com',
    ])
  ).rows[0];
  assert.equal(last.anthroId, 'ANTHRO-99999');
  await assert.rejects(
    db.query('insert into candidates(name,email) values($1,$2)', [
      'Overflow',
      'overflow@example.com',
    ]),
    /maximum value/,
  );
  // Updates still work after capacity is exhausted, and retired numbers are never reused.
  await db.query(
    'insert into candidates(id,name,email) values($1,$2,$3) on conflict(id) do update set name=excluded.name,"anthroNumber"=excluded."anthroNumber"',
    [id(21), 'Still editable', 'candidate@example.com'],
  );
});
