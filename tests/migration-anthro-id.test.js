import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { legacyAnthroIdFor as anthroIdFor } from '../src/anthroId.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Anthro-ID migration backfills, protects identity, resolves merges, and preserves API isolation', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  const migrationName = files.find((n) => n.endsWith('_anthro_id.sql'));
  for (const file of files.filter((n) => n < migrationName))
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@example.com'),('${id(2)}','other@example.com'),('${id(3)}','candidate@example.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,title,company,location) values('${id(21)}','${id(11)}','Existing','candidate@example.com','Engineer','Company','Pune');`);
  const migration = await readFile(new URL(migrationName, path), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Additive and repeatable; IDs must never be reallocated.
  assert.equal(
    (await db.query('select "anthroId" from candidates where id=$1', [id(21)])).rows[0].anthroId,
    anthroIdFor(id(21)),
  );
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
  await assert.rejects(
    db.query('update candidates set "anthroId"=$1 where id=$2', ['fake', id(21)]),
    /generated column|DEFAULT/,
  );
  await assert.rejects(
    db.query('update candidates set id=$1 where id=$2', [id(22), id(21)]),
    /identity.*cannot be changed/,
  );
  await db.query('update candidates set name=$1 where id=$2', ['Renamed', id(21)]);
  assert.equal(
    (await rpc('api_candidate_by_anthro_id', [anthroIdFor(id(21)).toLowerCase()])).candidateId,
    id(21),
  );
  const sub = (
    await rpc('api_webhook_admin', [
      'create',
      null,
      'Receiver',
      'https://example.com/webhook',
      'a'.repeat(40),
      true,
    ])
  ).subscriptions[0].id;
  assert.ok(sub);
  const integrated = await rpc('api_integrate_candidate', [
    'training',
    'one',
    'anthro-request-one',
    { name: 'Imported', email: 'imported@example.com' },
    null,
  ]);
  assert.equal(integrated.anthroId, anthroIdFor(integrated.candidateId));
  const replayed = await rpc('api_integrate_candidate', [
    'training',
    'one',
    'anthro-request-one',
    { name: 'Imported', email: 'imported@example.com' },
    null,
  ]);
  assert.equal(replayed.anthroId, integrated.anthroId);
  await db.query(
    'insert into enrichment("candidateId",title,description,due,owner,status) values($1,$2,$3,$4,$5,$6)',
    [id(21), 'Training', 'Skill training', '2026-10-20', 'Trainer', 'Planned'],
  );
  await db.query('update candidates set "mergedInto"=$1,email=$2,phone=$2 where id=$3', [
    id(21),
    '',
    integrated.candidateId,
  ]);
  const resolved = await rpc('api_candidate_by_anthro_id', [integrated.anthroId]);
  assert.equal(resolved.candidateId, id(21));
  assert.equal(resolved.anthroId, anthroIdFor(id(21)));
  await act(3);
  const portal = await rpc('api_portal_overview');
  assert.equal(portal.profile.anthroId, anthroIdFor(id(21)));
  assert.equal(portal.profile.email, undefined);
  await act(2);
  assert.equal(await rpc('api_candidate_by_anthro_id', [anthroIdFor(id(21))]), null);
  assert.equal(
    (await db.query('select id from candidates where "anthroId"=$1', [anthroIdFor(id(21))])).rows
      .length,
    0,
  );
  await act(0, 'anon');
  await assert.rejects(
    rpc('api_candidate_by_anthro_id', [anthroIdFor(id(21))]),
    /permission denied/,
  );
  await assert.rejects(rpc('guard_candidate_identity'), /permission denied/);
  await act(0, 'service_role');
  const events = await rpc('worker_claim_webhooks', [10]);
  const training = events.find((event) => event.event.type === 'enrichment.insert');
  assert.equal(training.event.data.anthroId, anthroIdFor(id(21)));
  assert.equal(training.event.data.candidateId, id(21));
  const merge = events.find((event) => event.event.data.mergedInto);
  assert.equal(merge.event.data.survivingAnthroId, anthroIdFor(id(21)));
});
