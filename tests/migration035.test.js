import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('server execution enforces tenants, atomic retries, event snapshots and API assignment', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(await readFile(new URL('035_server_execution.sql', path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`);
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
    );
  const worker = () =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','',false);set role service_role;`,
    );
  const insert = (n, owner = '') =>
    db.exec(
      `insert into candidates(id,name,email,status,skills,owner) values('${id(n)}','Candidate ${n}','c${n}@e.com','Ready',array['React','TypeScript'],'${owner}')`,
    );
  await act(1);
  assert.equal(
    (await db.query('select api_server_execution_status() as mode')).rows[0].mode,
    false,
  );
  await db.exec(`insert into "assignmentRules"(name,entity,field,op,value,"assignTo",priority) values('Skill desk','candidates','skills','any','python, react','Alice',1),('Fallback','candidates','status','eq','ready','Bob',2);
    insert into "workflowRules"(id,name,"triggerTable","triggerField",op,value,actions) values('${id(31)}','Ready follow-up','candidates','status','eq','Ready','[{"type":"task","title":"Call candidate","dueDays":2},{"type":"note","text":"Review CV"},{"type":"tag","tag":"ready-review"},{"type":"nextAction","text":"Call tomorrow"}]');`);
  await insert(21);
  assert.equal(
    (await db.query('select count(*)::int as count from "executionJobs"')).rows[0].count,
    0,
  );
  await db.exec('select api_set_server_execution(true)');
  await act(2);
  await assert.rejects(db.exec('select api_set_server_execution(false)'), /Administrator/);
  await assert.rejects(db.exec('select worker_run_execution_jobs(20)'), /permission denied/);
  await assert.rejects(db.exec('select api_execution_jobs()'), /Administrator/);
  await assert.rejects(
    db.exec(
      `insert into "executionJobs"(workspace_id,"entityType","entityId","ruleName",payload) values('${id(11)}','candidates','${id(21)}','Forged','{}')`,
    ),
    /permission denied/,
  );
  await insert(22);
  await insert(23, 'Existing owner');
  assert.equal(
    (await db.query(`select owner from candidates where id='${id(22)}'`)).rows[0].owner,
    'Alice',
  );
  assert.equal(
    (await db.query(`select owner from candidates where id='${id(23)}'`)).rows[0].owner,
    'Existing owner',
  );
  assert.equal((await db.query('select * from "executionJobs"')).rows.length, 0);
  await db.exec(`update candidates set title='Edited title',owner='' where id='${id(22)}'`);
  assert.equal(
    (await db.query(`select owner from candidates where id='${id(22)}'`)).rows[0].owner,
    '',
  );
  await act(1);
  assert.equal((await db.query('select * from "executionJobs"')).rows.length, 2);
  const listing = (await db.query('select api_execution_jobs() as result')).rows[0].result;
  assert.equal(listing.total, 2);
  assert.ok(!('payload' in listing.jobs[0]));
  await db.exec(`update "workflowRules" set actions='[]' where id='${id(31)}'`);
  await worker();
  const run = (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result;
  assert.equal(run.completed, 2);
  assert.equal(run.retriedOrFailed, 0);
  assert.equal(
    (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result.completed,
    0,
  );
  await act(1);
  assert.equal((await db.query('select * from tasks')).rows.length, 2);
  assert.equal((await db.query('select * from notes')).rows.length, 2);
  const c = (await db.query(`select tags,"nextAction",title from candidates where id='${id(22)}'`))
    .rows[0];
  assert.ok(c.tags.includes('ready-review'));
  assert.equal(c.nextAction, 'Call tomorrow');
  assert.equal(c.title, 'Edited title');
  await db.exec(`insert into "assignmentRules"(name,entity,field,op,value,"assignTo",priority) values('Client desk','demands','client','contains','acme','Demand desk',1);
    insert into "workflowRules"(name,"triggerTable","triggerField",op,value,actions) values
      ('Demand update','demands','status','neq','Closed','[{"type":"task","title":"Demand action"}]'),
      ('Pipeline change','considerations','stage','changed','','[{"type":"task","title":"Pipeline action"}]'),
      ('Offer update','offers','status','eq','Accepted','[{"type":"task","title":"Offer action"}]'),
      ('Interview update','interviews','recommendation','eq','Hire','[{"type":"task","title":"Interview action"}]');
    insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values('${id(41)}','Engineer','Acme',array['React'],0,30,100,'Delhi','Remote',1,'Medium',current_date,'{"skills":100,"experience":0,"readiness":0,"availability":0,"budget":0,"location":0}');`);
  assert.equal(
    (await db.query(`select owner from demands where id='${id(41)}'`)).rows[0].owner,
    'Demand desk',
  );
  await db.exec(`insert into considerations("candidateId","demandId",stage) values('${id(22)}','${id(41)}','Contacted');
    insert into offers(id,"candidateId","demandId",status) values('${id(51)}','${id(22)}','${id(41)}','Accepted');`);
  // Use a real interview row then set the supported recommendation trigger.
  await db.exec(`insert into interviews(id,"candidateId","demandId",round,"scheduledAt",mode,status) values('${id(61)}','${id(22)}','${id(41)}','Technical round',now(),'Video','Scheduled');
    update interviews set recommendation='Hire' where id='${id(61)}';`);
  await worker();
  assert.equal(
    (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result.completed,
    4,
  );
  await act(1);
  assert.equal(
    (
      await db.query(
        `select * from tasks where title in ('Demand action','Pipeline action','Offer action','Interview action')`,
      )
    ).rows.length,
    4,
  );
  await assert.rejects(
    db.exec(`select api_retry_execution_job('${listing.jobs[0].id}')`),
    /Failed job not found/,
  );

  await db.exec(`insert into "workflowRules"(id,name,"triggerTable","triggerField",op,value,actions) values('${id(32)}','Bad action','candidates','status','eq','Unavailable','[{"type":"note","text":"Must rollback"},{"type":"task","dueDays":"bad"}]');
    update candidates set status='Unavailable' where id='${id(22)}';`);
  const failedId = (await db.query(`select id from "executionJobs" where "ruleName"='Bad action'`))
    .rows[0].id;
  for (let attempt = 0; attempt < 5; attempt++) {
    await worker();
    assert.equal(
      (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result
        .retriedOrFailed,
      1,
    );
    await db.exec('reset role');
    const job = (await db.query(`select * from "executionJobs" where id=$1`, [failedId])).rows[0];
    assert.equal(job.attempts, attempt + 1);
    assert.ok(new Date(job.availableAt) > new Date(job.created));
    assert.ok(!job.lastError.includes('bad'));
    await db.query(`update "executionJobs" set "availableAt"=now() where id=$1`, [failedId]);
  }
  await act(1);
  assert.equal(
    (await db.query(`select status from "executionJobs" where id=$1`, [failedId])).rows[0].status,
    'failed',
  );
  assert.equal(
    (await db.query(`select * from notes where text like '%Must rollback%'`)).rows.length,
    0,
  );
  // Explicit admin replay takes the repaired rule's current actions.
  await db.exec(
    `update "workflowRules" set actions='[{"type":"task","title":"Recovered"}]' where id='${id(32)}'`,
  );
  await db.query('select api_retry_execution_job($1)', [failedId]);
  await db.exec('select api_set_server_execution(false)');
  await worker();
  assert.equal(
    (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result.completed,
    0,
  );
  await act(1);
  await db.exec('select api_set_server_execution(true)');
  await worker();
  assert.equal(
    (await db.query('select worker_run_execution_jobs(20) as result')).rows[0].result.completed,
    1,
  );
  await act(4);
  assert.equal((await db.query('select * from "executionJobs"')).rows.length, 0);
  await assert.rejects(
    db.query('select api_retry_execution_job($1)', [failedId]),
    /Failed job not found/,
  );
  await db.exec('select api_set_server_execution(true)');
  await insert(24);
  assert.equal(
    (await db.query(`select owner from candidates where id='${id(24)}'`)).rows[0].owner,
    '',
  );
  await act(3);
  assert.equal(
    (await db.query(`select snapshot from history where "entityType"='executionJobs'`)).rows.some(
      (row) => Object.hasOwn(row.snapshot, 'actions'),
    ),
    false,
  );
  assert.equal((await db.query('select * from "executionJobs"')).rows.length, 0);
  await assert.rejects(db.exec('select api_execution_jobs()'), /Administrator/);
  await assert.rejects(db.exec('select worker_run_execution_jobs(1)'), /permission denied/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.exec('select api_server_execution_status()'), /permission denied/);
});
