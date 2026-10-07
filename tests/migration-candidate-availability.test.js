import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `77000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('sourced availability enforces observation scope, provenance, chronology, conflicts and durable retries', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const name of files) await db.exec(await readFile(new URL(name, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_sourced_candidate_availability.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com'),('${id(5)}','external@e.com');
  insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');
  insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
  insert into candidates(id,workspace_id,name,email,notice,current,verified)values('${id(21)}','${id(11)}','Person','secret@e.com',30,12345,'2026-01-01'),('${id(22)}','${id(12)}','Other','other@e.com',null,null,'2026-01-01'),('${id(23)}','${id(11)}','Merged','merged@e.com',null,null,'2026-01-01');
  update candidates set "mergedInto"='${id(21)}' where id='${id(23)}';`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args))
      .rows[0].value;
  const read = (offset = 0) => rpc('api_candidate_availability', [id(21), offset]);
  const today = (
    await db.query(
      "select (statement_timestamp() at time zone 'UTC')::date::text as observation_day",
    )
  ).rows[0].observation_day;
  const observation = {
    notice: 0,
    earliestStart: null,
    activeStatus: 'Active',
    mode: 'Remote',
    source: 'Candidate phone call',
    observed: today,
  };
  await act(3);
  const viewer = await read();
  assert.equal(viewer.current.notice, 30);
  assert.equal(viewer.current.current, undefined);
  assert.equal(viewer.current.email, undefined);
  await assert.rejects(
    rpc('api_record_candidate_availability', [id(21), id(31), viewer.current.token, observation]),
    /Editor/,
  );
  await assert.rejects(rpc('api_candidate_availability', [id(22)]), /not found/);
  await assert.rejects(read(-1), /Invalid/);
  await act(2);
  const before = await read();
  const first = await rpc('api_record_candidate_availability', [
    id(21),
    id(31),
    before.current.token,
    observation,
  ]);
  assert.equal(first.current.notice, 0);
  assert.equal(first.rows[0].source, observation.source);
  assert.equal(first.rows[0].recordedBy, id(2));
  assert.ok(first.rows[0].recordedAt);
  assert.equal(first.rows[0].observed, today);
  assert.equal(first.replayed, false);
  const repeat = await rpc('api_record_candidate_availability', [
    id(21),
    id(31),
    before.current.token,
    observation,
  ]);
  assert.equal(repeat.replayed, true);
  assert.equal(repeat.rows.length, 1);
  await assert.rejects(
    rpc('api_record_candidate_availability', [
      id(21),
      id(31),
      first.current.token,
      { ...observation, source: 'Changed source' },
    ]),
    /operation conflict/,
  );
  await assert.rejects(
    rpc('api_record_candidate_availability', [
      id(21),
      id(32),
      before.current.token,
      { ...observation, notice: 10 },
    ]),
    /changed/,
  );
  for (const bad of [
    { ...observation, verified: today },
    { ...observation, source: ' ' },
    { ...observation, source: null },
    { ...observation, notice: -1 },
    { ...observation, notice: 1.5 },
    { ...observation, notice: '0' },
    { ...observation, notice: 3651 },
    { ...observation, mode: 'Teleport' },
    { ...observation, activeStatus: 'Ready' },
    { ...observation, observed: 'tomorrow' },
    { ...observation, observed: '2099-01-01' },
    { ...observation, earliestStart: '' },
    { ...observation, earliestStart: '2026-02-30' },
  ])
    await assert.rejects(
      rpc('api_record_candidate_availability', [id(21), id(32), first.current.token, bad]),
    );
  await assert.rejects(
    rpc('api_record_candidate_availability', [
      id(21),
      id(32),
      first.current.token,
      { ...observation, observed: '2020-01-01' },
    ]),
    /newer observation/,
  );
  const second = await rpc('api_record_candidate_availability', [
    id(21),
    id(32),
    first.current.token,
    { ...observation, notice: null, activeStatus: 'Passive' },
  ]);
  assert.equal(second.current.notice, null);
  assert.equal(second.current.activeStatus, 'Passive');
  const lateRetry = await rpc('api_record_candidate_availability', [
    id(21),
    id(31),
    before.current.token,
    observation,
  ]);
  assert.equal(lateRetry.current.notice, null);
  assert.equal(lateRetry.rows.length, 2);
  await assert.rejects(
    rpc('api_record_candidate_availability', [id(23), id(33), second.current.token, observation]),
    /not found/,
  );
  await act(1);
  await assert.rejects(
    rpc('api_record_candidate_availability', [id(21), id(31), second.current.token, observation]),
    /operation conflict/,
  );
  await act(2);
  await db.query(
    'insert into "availabilityHistory"(id,workspace_id,"candidateId",source,observed,"recordedBy","recordedAt")values($1,$2,$3,$4,$5,$6,$7)',
    [id(34), id(11), id(21), 'Manual legacy insert', today, id(1), '2000-01-01'],
  );
  const stamped = (await read()).rows.find((r) => r.id === id(34));
  assert.equal(stamped.recordedBy, id(2));
  assert.notEqual(stamped.recordedAt, '2000-01-01T00:00:00+00:00');
  await assert.rejects(
    db.query(
      'insert into "availabilityHistory"(id,workspace_id,"candidateId","operationApplied")values($1,$2,$3,true)',
      [id(37), id(11), id(21)],
    ),
    /permission denied/,
  );
  await assert.rejects(
    rpc('api_record_candidate_availability', [
      id(21),
      id(34),
      second.current.token,
      {
        notice: null,
        earliestStart: null,
        activeStatus: 'Active',
        mode: '',
        source: 'Manual legacy insert',
        observed: today,
      },
    ]),
    /operation conflict/,
  );
  await assert.rejects(
    db.query('update "availabilityHistory" set source=$1 where id=$2', ['Forgery', id(31)]),
    /permission denied/,
  );
  await db.exec('reset role');
  const person = (
    await db.query('select to_jsonb(c) person from candidates c where id=$1', [id(21)])
  ).rows[0].person;
  assert.equal(person.verified, '2026-01-01');
  assert.equal(person.current, 12345);
  const snapshots = (
    await db.query('select snapshot from history where "entityId"=$1 and action=$2', [
      id(21),
      'Profile updated',
    ])
  ).rows;
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots.some((h) => h.snapshot.notice === 30));
  const disclosure = (
    await db.query('select * from ecod_private.subject_access_inventory($1,$2) where category=$3', [
      id(11),
      id(21),
      'availabilityHistory',
    ])
  ).rows.find((r) => r.record_id === id(31));
  assert.equal(disclosure.projection.source, observation.source);
  assert.equal(disclosure.projection.observed, today);
  assert.equal(disclosure.projection.recordedBy, undefined);
  await db.exec(
    `insert into "availabilityHistory"(workspace_id,"candidateId",notice,observed,source,"recordedAt") select '${id(11)}','${id(23)}',n,null,'Retained history',null from generate_series(1,30)n;`,
  );
  await act(3);
  await act(2);
  const newest = await read();
  assert.ok(newest.rows.every((row) => row.observed == null));
  await assert.rejects(
    rpc('api_record_candidate_availability', [
      id(21),
      id(35),
      newest.current.token,
      { ...observation, observed: '2020-01-01' },
    ]),
    /newer observation/,
  );
  await act(3);
  await assert.rejects(
    rpc('ecod_repository_private.record_candidate_availability', [
      id(21),
      id(38),
      second.current.token,
      observation,
    ]),
    /Editor/,
  );
  const page1 = await read();
  const page2 = await read(25);
  assert.equal(page1.rows.length, 25);
  assert.equal(page1.more, true);
  assert.equal(page2.rows.length, 8);
  assert.equal(page2.more, false);
  assert.equal(new Set([...page1.rows, ...page2.rows].map((r) => r.id)).size, 33);
  assert.ok(page1.rows.some((r) => r.candidateId === id(23)));
  assert.equal((await rpc('api_candidate_availability', [id(23)])).candidateId, id(21));
  await act(4);
  await assert.rejects(read(), /not found/);
  await act(5);
  await assert.rejects(read(), /membership/);
  await db.exec(`reset role;delete from memberships where user_id='${id(2)}';`);
  await act(2);
  await assert.rejects(read(), /membership/);
  await assert.rejects(
    rpc('api_record_candidate_availability', [id(21), id(36), second.current.token, observation]),
    /membership|Editor/,
  );
  await act(0, 'anon');
  await assert.rejects(read(), /permission denied/);
});
