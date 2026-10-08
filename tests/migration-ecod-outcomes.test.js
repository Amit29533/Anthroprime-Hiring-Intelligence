import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('ECOD outcomes capture real placements, scoped reassessment, server timing and audited exports', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  const name = files.find((n) => n.endsWith('_ecod_outcome_analytics.sql'));
  for (const file of files.filter((n) => n < name))
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@example.com'),('${id(2)}','viewer@example.com'),('${id(3)}','other@example.com'),('${id(4)}','recruiter@example.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','viewer'),('${id(3)}','${id(12)}','admin'),('${id(4)}','${id(11)}','recruiter');
    insert into candidates(id,workspace_id,name,email,status) values('${id(20)}','${id(11)}','Legacy','legacy@example.com','Ready');
    insert into enrichment(id,workspace_id,"candidateId",title,description,due,owner,status) values('${id(80)}','${id(11)}','${id(20)}','Legacy plan','Old',current_date,'Admin','Complete');`);
  const sql = await readFile(new URL(name, path), 'utf8');
  await db.exec(sql);
  const coverage = (
    await db.query('select started_at from "ecodAnalyticsCoverage" where workspace_id=$1', [id(11)])
  ).rows[0].started_at;
  await db.exec(sql);
  assert.deepEqual(
    (
      await db.query('select started_at from "ecodAnalyticsCoverage" where workspace_id=$1', [
        id(11),
      ])
    ).rows[0].started_at,
    coverage,
  );
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, days = 90) =>
    (await db.query(`select ${name}($1) result`, [days])).rows[0].result;
  const metrics = () => rpc('api_ecod_outcome_analytics');
  await act(1);
  assert.equal(
    (await metrics()).candidates,
    0,
    'pre-coverage candidates are not new outcome cohorts',
  );
  assert.equal((await metrics()).enrichment.plans, 0);
  await db.exec(`insert into candidates(id,name,email,source,created) values('${id(21)}','New','new@example.com','Referral','2000-01-01'),('${id(22)}','Open','open@example.com','Referral','2000-01-01');
    insert into clients(id,name) values('${id(60)}','Client');
    insert into demands(id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)
     values('${id(30)}','Engineer','Client','${id(60)}',array['React'],0,30,20,'India','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');
    insert into considerations(id,"candidateId","demandId",stage) values('${id(40)}','${id(21)}','${id(30)}','Identified'),('${id(41)}','${id(22)}','${id(30)}','Identified');
    update considerations set stage='Submitted' where id='${id(40)}';
    insert into assessments(id,"candidateId","demandId",title,score,assessor,date,evidence,skill)
     values('${id(70)}','${id(21)}','${id(30)}','Initial',50,'Assessor',current_date,'Evidence','React');
    insert into enrichment(id,"candidateId","demandId","gapSkill",title,description,due,owner,status)
     values('${id(81)}','${id(21)}','${id(30)}','React','Plan','React labs',current_date,'Admin','Planned');
    update enrichment set status='Complete' where id='${id(81)}';
    insert into assessments(id,"candidateId","demandId",title,score,assessor,date,evidence,skill)
     values('${id(71)}','${id(21)}','${id(30)}','Wrong skill',90,'Assessor',current_date,'Evidence','Python'),
      ('${id(72)}','${id(21)}','${id(30)}','Reassessment',80,'Assessor',current_date,'Evidence','React');
    update candidates set status='Ready',source='Changed' where id='${id(21)}';
    insert into placements(id,"candidateId","demandId","clientId","considerationId",status,"startDate")
     values('${id(90)}','${id(21)}','${id(30)}','${id(60)}','${id(40)}','Planned',current_date);`);
  assert.equal((await metrics()).placedCandidates, 0, 'Planned is not an actual placement');
  await db.exec(
    `update placements set status='Active' where id='${id(90)}';update considerations set stage='Deployed' where id='${id(41)}';`,
  );
  const count = () => db.query('select count(*)::int n from "lifecycleEvents"');
  const before = (await count()).rows[0].n;
  await db.exec(`update placements set notes='Edit' where id='${id(90)}';update enrichment set owner='Recruiter' where id='${id(81)}';
    begin;update placements set status='Completed' where id='${id(90)}';rollback;`);
  assert.equal(
    (await count()).rows[0].n,
    before,
    'irrelevant edits and rollbacks do not add events',
  );
  // Only the fixture owner changes server timestamps to create a deterministic measured journey.
  await db.exec(`reset role;
    update "ecodAnalyticsCoverage" set started_at=now()-interval '11 days';
    update "lifecycleEvents" set occurred_at=now()-interval '12 days' where candidate_id='${id(20)}';
    update "lifecycleEvents" set occurred_at=now()-interval '10 days' where entity_type='candidate' and kind='created' and candidate_id in ('${id(21)}','${id(22)}');
    update "lifecycleEvents" set occurred_at=now()-interval '9 days' where entity_type='demand' and kind='created';
    update "lifecycleEvents" set occurred_at=now()-interval '7 days' where entity_type='consideration' and kind='created';
    update "lifecycleEvents" set occurred_at=now()-interval '5 days' where entity_type='consideration' and to_state='Submitted';
    update "lifecycleEvents" set occurred_at=now()-interval '8 days' where entity_type='assessment' and entity_id='${id(70)}';
    update "lifecycleEvents" set occurred_at=now()-interval '8 days' where entity_type='enrichment' and kind='created';
    update "lifecycleEvents" set occurred_at=now()-interval '4 days' where entity_type='enrichment' and to_state='Complete';
    update "lifecycleEvents" set occurred_at=now()-interval '3.5 days' where entity_type='assessment' and entity_id='${id(71)}';
    update "lifecycleEvents" set occurred_at=now()-interval '3 days' where entity_type='assessment' and entity_id='${id(72)}';
    update "lifecycleEvents" set occurred_at=now()-interval '2 days' where entity_type='candidate' and to_state='Ready' and candidate_id='${id(21)}';
    update "lifecycleEvents" set occurred_at=now()-interval '1 day' where entity_type='placement' and to_state='Active';`);
  await act(1);
  const m = await metrics();
  assert.equal(m.candidates, 2);
  assert.equal(m.assessedCandidates, 1);
  assert.equal(m.placedCandidates, 1, 'Deployed without an Active placement cannot count');
  assert.deepEqual(m.sources, [
    { source: 'Referral', total: 2, assessed: 1, placed: 1, placementPct: 50 },
  ]);
  assert.deepEqual(m.enrichment, {
    plans: 1,
    completed: 1,
    reassessed: 1,
    readyAfterReassessment: 1,
  });
  assert.deepEqual(
    m.timings.map((r) => [r.metric, r.tracked, r.completed, r.averageDays]),
    [
      ['shortlist', 1, 1, 2],
      ['submission', 2, 1, 2],
      ['placement', 2, 1, 9],
      ['reassessment', 1, 1, 1],
    ],
  );
  assert.equal(m.timings[1].unobserved, 1);
  assert.equal(m.timings[3].medianDays, 1, 'wrong-skill reassessment is excluded');
  assert.equal(m.timings[3].p90Days, 1);
  await assert.rejects(rpc('api_ecod_outcome_analytics', 10), /Choose 30/);
  await assert.rejects(db.query('delete from "lifecycleEvents"'), /permission denied/);
  await assert.rejects(
    db.query('update "ecodAnalyticsCoverage" set started_at=now()'),
    /permission denied/,
  );
  const exported = await rpc('api_prepare_ecod_analytics_export');
  assert.equal(exported.metrics.sources[0].source, 'Referral');
  assert.equal(exported.workspaceId, id(11));
  assert.equal(exported.actor, id(1));
  assert.ok(exported.receiptId);
  const receipt = (
    await db.query('select summary from "ecodAnalyticsExports" where id=$1', [exported.receiptId])
  ).rows[0];
  assert.deepEqual(receipt.summary, exported.metrics);
  await assert.rejects(db.query('update "ecodAnalyticsExports" set days=30'), /permission denied/);
  for (let i = 0; i < 4; i++) await rpc('api_prepare_ecod_analytics_export');
  await assert.rejects(rpc('api_prepare_ecod_analytics_export'), /limit reached/);
  await act(2);
  assert.equal((await metrics()).placedCandidates, 1);
  await assert.rejects(rpc('api_prepare_ecod_analytics_export'), /Editor access/);
  assert.equal((await db.query('select count(*)::int n from "ecodAnalyticsExports"')).rows[0].n, 0);
  await act(4);
  assert.ok((await rpc('api_prepare_ecod_analytics_export')).receiptId);
  await act(3);
  assert.equal((await metrics()).candidates, 0);
  assert.equal(
    (await metrics()).timings[0].averageDays,
    null,
    'no invented averages in an empty workspace',
  );
  assert.equal((await db.query('select count(*)::int n from "ecodAnalyticsExports"')).rows[0].n, 0);
  await act(0, 'anon');
  await assert.rejects(metrics(), /permission denied/);
  await act(1);
  await db.exec(`update enrichment set "gapSkill"='Python' where id='${id(81)}';`);
  assert.equal((await metrics()).enrichment.plans, 0, 'relinked enrichment is excluded');
  await db.exec(`update candidates set "mergedInto"='${id(20)}',email='' where id='${id(21)}';`);
  assert.equal((await metrics()).placedCandidates, 0, 'merged tombstone outcomes are excluded');
  await db.exec(`reset role;insert into workspaces(id,name) values('${id(13)}','New team');`);
  assert.equal(
    (
      await db.query('select count(*)::int n from "ecodAnalyticsCoverage" where workspace_id=$1', [
        id(13),
      ])
    ).rows[0].n,
    1,
  );
});
