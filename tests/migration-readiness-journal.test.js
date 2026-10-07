import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('readiness decisions require current evidence and administrator authority, expire, replay safely and preserve merged history', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url),
    files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_candidate_readiness_journal.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,verified,status) values
    ('${id(101)}','${id(11)}','One','one@e.com',current_date,'Assessing'),('${id(102)}','${id(11)}','Survivor','two@e.com',current_date,'Assessing'),('${id(103)}','${id(12)}','Other','other@e.com',current_date,'Assessing');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const read = (person = 101, offset = 0) => rpc('api_candidate_readiness', [id(person), offset]);
  const decide = (
    page,
    decision = 'Ready',
    op = 201,
    days = 180,
    reason = 'Reviewed assessment and candidate evidence',
  ) =>
    rpc('api_decide_candidate_readiness', [
      page.candidateId,
      id(op),
      page.headId,
      page.fingerprint,
      decision,
      days,
      reason,
    ]);
  const assessment = (n, score = 90, days = 0, skill = null, expiry = null) =>
    db.query(
      `insert into assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence,skill,"validUntil") values($1,$2,$3,'General review',$4,'Reviewer',current_date+$5::integer,'Observed technical and communication evidence',$6,case when $7::integer is null then null else current_date+$7::integer end)`,
      [id(n), id(11), id(101), score, days, skill, expiry],
    );
  await act(1);
  let page = await read();
  assert.equal(page.state, 'Not reviewed');
  assert.equal(page.eligible, false);
  await assert.rejects(decide(page), /blockers/);
  await assessment(301, 100, 0, 'Python');
  assert.equal(
    (await read()).eligible,
    false,
    'skill-only assessment cannot imply general readiness',
  );
  await assessment(302, 90, 0, null, 5);
  page = await read();
  assert.equal(page.eligible, true);
  const first = await decide(page);
  assert.equal((await decide(page)).replayed, true);
  await assert.rejects(decide(page, 'Not-ready'), /operation conflict/);
  let reviewed = await read();
  assert.equal(reviewed.state, 'Ready');
  assert.equal(reviewed.rows.length, 1);
  assert.equal(
    reviewed.profileStatus,
    'Assessing',
    'validation never rewrites editable profile status',
  );
  assert.equal(reviewed.rows[0].actor, id(1));
  const today = (
    await db.query('select current_date::text as day, (current_date+5)::text as expires')
  ).rows[0];
  assert.equal(reviewed.rows[0].expires, today.expires, 'expiry capped by source evidence');
  await assert.rejects(decide(page, 'Near-ready', 202), /evidence changed/);
  await assert.rejects(decide(reviewed, 'Near-ready', 202, 0), /Invalid/);
  await assert.rejects(decide(reviewed, 'Near-ready', 202, 30, 'short'), /Invalid/);
  await assert.rejects(
    db.exec(`update "readinessDecisions" set decision='Ready'`),
    /permission denied/,
  );
  await assert.rejects(db.exec(`delete from "readinessDecisions"`), /permission denied/);
  await assert.rejects(
    db.exec(
      `insert into "readinessDecisions" overriding system value select * from "readinessDecisions"`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query('select ecod_readiness_private.context($1,$2)', [id(11), id(101)]),
    /permission denied/,
  );
  await act(2);
  assert.equal((await read()).state, 'Ready');
  await assert.rejects(decide(reviewed, 'Near-ready', 203), /Administrator/);
  await db.exec(`update candidates set summary='Changed source evidence' where id='${id(101)}'`);
  assert.equal((await read()).state, 'Needs review');
  await act(1);
  await assert.rejects(decide(reviewed, 'Ready', 203), /evidence changed/);
  page = await read();
  await decide(page, 'Near-ready', 204);
  reviewed = await read();
  assert.equal(reviewed.rows[0].previous_id, first.id);
  assert.ok(reviewed.rows[0].sequence > reviewed.rows[1].sequence);
  await decide(reviewed, 'Revoked', 205);
  assert.equal((await read()).state, 'Revoked');
  await act(3);
  assert.equal((await read()).rows.length, 3);
  await assert.rejects(decide(await read(), 'Near-ready', 206), /Administrator/);
  await act(4);
  assert.equal((await db.query('select * from "readinessDecisions"')).rows.length, 0);
  await assert.rejects(read(), /not found/);
  await assert.rejects(decide(reviewed, 'Ready', 206), /not found/);
  await act(1);
  await db.exec(
    `insert into enrichment(id,workspace_id,"candidateId",title,description,due,owner,status) values('${id(401)}','${id(11)}','${id(101)}','Gap plan','Needs reassessment',current_date,'Reviewer','Complete');`,
  );
  page = await read();
  assert.equal(page.eligible, false);
  await assert.rejects(decide(page, 'Ready', 207), /blockers/);
  await db.exec(`update enrichment set status='Validated' where id='${id(401)}'`);
  page = await read();
  assert.equal(page.eligible, true);
  await decide(page, 'Ready', 208);
  await db.exec('reset role');
  const scope = (
    await db.query(`select ecod_private.erasure_inventory('${id(11)}','${id(101)}') as scope`)
  ).rows[0].scope;
  assert.equal(scope.counts.find((c) => c.category === 'readinessDecisions').count, 4);
  assert.ok(!JSON.stringify(scope).includes('Reviewed assessment'));
  await db.exec(
    `update "readinessDecisions" set expires=current_date-1 where operation_id='${id(208)}'`,
  );
  await db.exec(
    `update "readinessDecisions" set at=now()-interval '1 day' where operation_id='${id(208)}'`,
  );
  await act(1);
  assert.equal((await read()).state, 'Expired');
  await assessment(303, 30, 0);
  page = await read();
  assert.equal(page.eligible, false);
  assert.ok(page.blockers.some((s) => s.includes('80/100')));
  assert.equal(
    page.assessment.id,
    id(303),
    'server order identifies the later same-day assessment',
  );
  await assessment(304, 100, 1);
  page = await read();
  assert.ok(page.blockers.some((s) => s.includes('future')));
  await db.exec(`update candidates set verified=current_date+1 where id='${id(101)}'`);
  assert.ok((await read()).blockers.some((s) => s.includes('verification date is in the future')));
  await db.exec(`update candidates set verified=current_date-121 where id='${id(101)}'`);
  assert.ok((await read()).blockers.some((s) => s.includes('older than 120')));
  await db.exec(`update candidates set "mergedInto"='${id(102)}',email='' where id='${id(101)}'`);
  page = await read();
  assert.equal(page.candidateId, id(102));
  assert.equal(page.state, 'Not reviewed');
  assert.equal(page.rows.length, 4);
  await assert.rejects(decide(reviewed, 'Ready', 209), /not found/);
  await assert.rejects(read(102, -1), /page/);
  await db.exec(`insert into assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence)
    select gen_random_uuid(),'${id(11)}','${id(102)}','Historical assessment',90,'Reviewer',current_date,'Historical review evidence' from generate_series(1,201)`);
  await assert.rejects(read(102), /source limit/);
  await act(0, 'anon');
  await assert.rejects(read(102), /permission denied/);
  await act(0);
  await assert.rejects(read(102), /membership/);
});
