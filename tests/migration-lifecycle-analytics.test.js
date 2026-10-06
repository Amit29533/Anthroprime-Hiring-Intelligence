import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('historical cohorts are atomic, append-only, tenant scoped and do not invent missing stages', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  const name = files.find((n) => n.endsWith('_lifecycle_analytics.sql'));
  for (const file of files.filter((n) => n < name))
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@example.com'),('${id(2)}','viewer@example.com'),('${id(3)}','other@example.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,status) values('${id(20)}','${id(11)}','Existing','existing@example.com','Ready');`);
  const sql = await readFile(new URL(name, path), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const metrics = async (days = 90) =>
    (await db.query('select api_lifecycle_analytics($1) as result', [days])).rows[0].result;
  await act(1);
  assert.equal((await metrics()).baselineRecords, 1);
  assert.equal((await metrics()).candidates, 0);
  await db.query('insert into candidates(id,name,email,source,created) values($1,$2,$3,$4,$5)', [
    id(21),
    'New',
    'new@example.com',
    'Referral',
    '2000-01-01',
  ]);
  await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)
    values('${id(30)}','Engineer','Client',array['React'],0,30,20,'India','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');
    insert into considerations(id,"candidateId","demandId",stage) values('${id(40)}','${id(21)}','${id(30)}','Identified');
    update considerations set stage='Submitted' where id='${id(40)}';
    update considerations set stage='Interview' where id='${id(40)}';
    update considerations set stage='Submitted' where id='${id(40)}';
    update considerations set stage='Deployed' where id='${id(40)}';
    update candidates set status='Ready' where id='${id(21)}';
    update candidates set status='Near-ready',source='Changed' where id='${id(21)}';
    update candidates set status='Ready' where id='${id(21)}';`);
  const before = (await db.query('select count(*) as n from "lifecycleEvents"')).rows[0].n;
  await db.exec(
    `update candidates set title='Edited' where id='${id(21)}';update considerations set stage='Deployed' where id='${id(40)}';`,
  );
  assert.equal((await db.query('select count(*) as n from "lifecycleEvents"')).rows[0].n, before);
  await db.exec(`begin;update considerations set stage='Interview' where id='${id(40)}';rollback;`);
  assert.equal((await db.query('select count(*) as n from "lifecycleEvents"')).rows[0].n, before);
  // Simulated clock fixtures; only the test's database owner may alter event timestamps.
  await db.exec(`reset role;
    update "lifecycleEvents" set occurred_at=now()-interval '7 days' where entity_type='candidate' and entity_id='${id(21)}' and kind='created';
    update "lifecycleEvents" set occurred_at=now()-interval '1 day' where id=(select min(id) from "lifecycleEvents" where entity_type='candidate' and entity_id='${id(21)}' and to_state='Ready');`);
  await act(1);
  const result = await metrics();
  assert.equal(result.considerations, 1);
  assert.equal(result.openJourneys, 0);
  assert.equal(result.candidates, 1, 'client-supplied created date is not the observed event date');
  assert.equal(result.readyCandidates, 1);
  assert.equal(result.averageDaysToReady, 6);
  assert.deepEqual(result.sources, [{ source: 'Referral', total: 1, ready: 1 }]);
  assert.deepEqual(
    result.stages.map((s) => s.reached),
    [1, 1, 0, 1],
  );
  assert.equal(result.progression[0].pct, 100);
  assert.equal(result.progression[1].pct, 0);
  assert.equal(result.progression[2].pct, null, 'no Offer stage was observed');
  await assert.rejects(db.query('delete from "lifecycleEvents"'), /permission denied/);
  await assert.rejects(
    db.query('update "lifecycleEvents" set source=$1', ['Fake']),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      'insert into "lifecycleEvents"(workspace_id,entity_type,entity_id,candidate_id,kind,to_state) values($1,$2,$3,$3,$4,$5)',
      [id(11), 'candidate', id(21), 'created', 'Ready'],
    ),
    /permission denied/,
  );
  await assert.rejects(metrics(10), /Choose 30/);
  await act(2);
  assert.equal((await metrics()).considerations, 1, 'viewer can read aggregates');
  await act(3);
  assert.equal((await metrics()).candidates, 0);
  assert.equal((await db.query('select count(*) as n from "lifecycleEvents"')).rows[0].n, 0);
  await act(0, 'anon');
  await assert.rejects(metrics(), /permission denied/);
  await act(1);
  await db.query('update considerations set "candidateId"=$1 where id=$2', [id(20), id(40)]);
  assert.equal(
    (await metrics()).considerations,
    0,
    'relinked history cannot be attributed to its new candidate',
  );
  await db.query('update candidates set "mergedInto"=$1,email=$2 where id=$3', [
    id(20),
    '',
    id(21),
  ]);
  assert.equal((await metrics()).candidates, 0, 'merged tombstones are excluded');
  await db.exec('reset role');
  await db.exec(sql);
  await act(1);
  assert.equal(
    (await metrics()).baselineRecords,
    1,
    'migration rerun does not invent baselines for new cohorts',
  );
  await db.exec(`insert into candidates(id,name,email) values('${id(22)}','Reentry','reentry@example.com');
    insert into considerations(id,"candidateId","demandId",stage) values('${id(41)}','${id(22)}','${id(30)}','Interview');
    update considerations set stage='Submitted' where id='${id(41)}';
    update considerations set stage='Interview' where id='${id(41)}';`);
  assert.equal(
    (await metrics()).progression[0].pct,
    100,
    'a later re-entry counts after the source stage even when the destination was visited earlier',
  );
});
