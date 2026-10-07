import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `93000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('freshness tasks honor consent/holds, avoid duplicate epochs, isolate failures and own private receipts', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const f of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261007072845_internal_freshness_reviews.sql', path), 'utf8'),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"auditedCandidateExports":true}');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,verified,status) values
    ('${id(50)}','${id(11)}','Eligible','a@example.com',current_date-150,'Assessing'),
    ('${id(51)}','${id(11)}','Fresh','b@example.com',current_date-10,'Assessing'),
    ('${id(52)}','${id(11)}','No consent','c@example.com',current_date-300,'Assessing'),
    ('${id(53)}','${id(11)}','Revoked','d@example.com',current_date-300,'Assessing'),
    ('${id(54)}','${id(11)}','Unavailable','e@example.com',current_date-300,'Unavailable'),
    ('${id(56)}','${id(11)}','Future','f@example.com',current_date+30,'Assessing'),
    ('${id(60)}','${id(12)}','Other tenant','other@example.com',current_date-150,'Assessing');
    insert into consents(workspace_id,"candidateId",purpose,status,date) select workspace_id,id,'recruiting-contact','granted',now()-interval '1 day' from candidates where id<>'${id(52)}';
    insert into consents(workspace_id,"candidateId",purpose,status,date) values('${id(11)}','${id(53)}','recruiting-contact','revoked',now());`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const owner = () => db.exec('reset role');
  const run = async (limit = 20) => {
    await act(0, 'service_role');
    return rpc('worker_run_freshness_reviews', [limit]);
  };
  await act(1);
  assert.equal((await rpc('api_freshness_reviews')).enabled, false);
  assert.equal((await run()).created, 0);
  await act(1);
  await rpc('api_set_freshness_reviews', [true, 121]);
  assert.equal((await run(1)).created, 1); // Non-consenting older profiles must not starve this one.
  assert.equal((await run()).created, 0);
  await owner();
  let task = (await db.query('select * from tasks where "candidateId"=$1', [id(50)])).rows[0];
  assert.match(task.title, /Review stale profile ANTHRO-\d{5}/);
  await db.query('update tasks set done=true where id=$1', [task.id]);
  assert.equal((await run()).created, 0);
  await act(4);
  assert.equal((await rpc('api_freshness_reviews')).total, 0);
  for (const n of [2, 3]) {
    await act(n);
    await assert.rejects(rpc('api_freshness_reviews'), /Administrator/);
    await assert.rejects(rpc('api_set_freshness_reviews', [true, 121]), /Administrator/);
  }
  await act(0, 'anon');
  await assert.rejects(rpc('api_freshness_reviews'), /permission denied/);
  await act(1);
  await assert.rejects(rpc('worker_run_freshness_reviews'), /permission denied/);
  await assert.rejects(
    db.query('select * from ecod_private.freshness_receipts'),
    /permission denied/,
  );
  await assert.rejects(rpc('api_set_freshness_reviews', [true, 29]), /30 to 365/);
  await rpc('api_set_freshness_reviews', [false, 121]);
  await owner();
  await db.query('update candidates set verified=current_date where id=$1', [id(50)]);
  assert.equal(
    (
      await db.query('select status from ecod_private.freshness_receipts where candidate_id=$1', [
        id(50),
      ])
    ).rows[0].status,
    'cancelled',
  );
  await db.query('update candidates set verified=current_date-151 where id=$1', [id(50)]);
  assert.equal((await run()).created, 0); // Pause prevents issuance, but not invalidation.
  await act(1);
  await rpc('api_set_freshness_reviews', [true, 121]);
  assert.equal((await run()).created, 1);
  await owner();
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status,date) values('${id(11)}','${id(50)}','recruiting-contact','revoked',now());`,
  );
  assert.equal(
    (
      await db.query('select count(*)::int n from tasks where "candidateId"=$1 and not done', [
        id(50),
      ])
    ).rows[0].n,
    0,
  );
  assert.equal((await run()).created, 0);
  await owner();
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status,date) values('${id(11)}','${id(50)}','recruiting-contact','granted',clock_timestamp());`,
  );
  assert.equal((await run()).created, 1);
  await act(1);
  await rpc('api_create_subject_request', [
    id(200),
    id(50),
    'restriction',
    'Candidate requests outbound processing hold',
    'email',
  ]);
  await rpc('api_update_subject_request', [
    id(201),
    id(200),
    1,
    'verify',
    'Verified through existing candidate contact',
  ]);
  await rpc('api_update_subject_request', [
    id(202),
    id(200),
    2,
    'start',
    'Restriction review started by administrator',
  ]);
  await rpc('api_set_subject_outbound_hold', [
    id(203),
    id(200),
    3,
    true,
    'Outbound recruiting hold approved',
  ]);
  await owner();
  assert.equal(
    (
      await db.query('select count(*)::int n from tasks where "candidateId"=$1 and not done', [
        id(50),
      ])
    ).rows[0].n,
    0,
  );
  assert.equal((await run()).created, 0);
  // One failed task rolls back locally; other candidates and workspaces still progress.
  await owner();
  await db.exec(`insert into candidates(id,workspace_id,name,email,verified) values('${id(57)}','${id(11)}','Failure','failed@example.com',current_date-160),('${id(58)}','${id(11)}','Healthy','healthy@example.com',current_date-160);
    insert into consents(workspace_id,"candidateId",purpose,status) values('${id(11)}','${id(57)}','recruiting-contact','granted'),('${id(11)}','${id(58)}','recruiting-contact','granted');
    create function public.test_freshness_failure() returns trigger language plpgsql as $$begin if new."candidateId"='${id(57)}' then raise exception 'secret candidate payload';end if;return new;end$$;
    create trigger test_freshness_failure before insert on public.tasks for each row execute function public.test_freshness_failure();`);
  await act(4);
  await rpc('api_set_freshness_reviews', [true, 121]);
  const batch = await run();
  assert.equal(batch.created, 2);
  assert.equal(batch.retriedOrFailed, 1);
  for (let attempt = 1; attempt < 5; attempt++) {
    await owner();
    await db.query(
      "update ecod_private.freshness_receipts set available_at=clock_timestamp()-interval '1 second' where candidate_id=$1",
      [id(57)],
    );
    assert.equal((await run()).retriedOrFailed, 1);
  }
  await act(1);
  let page = await rpc('api_freshness_reviews');
  const failed = page.rows.find((r) => r.candidateId === id(57));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 5);
  assert.doesNotMatch(failed.lastError, /secret candidate/);
  await act(4);
  await assert.rejects(rpc('api_retry_freshness_review', [failed.id]), /Eligible candidate/);
  await owner();
  assert.equal(
    (await db.query('select count(*)::int n from tasks where "candidateId"=$1', [id(57)])).rows[0]
      .n,
    0,
  );
  await db.exec(
    'drop trigger test_freshness_failure on public.tasks;drop function public.test_freshness_failure()',
  );
  await act(1);
  await rpc('api_retry_freshness_review', [failed.id]);
  assert.equal(await rpc('api_retry_freshness_review', [failed.id]), true);
  assert.equal((await run()).created, 1);
  await act(1);
  assert.equal(await rpc('api_retry_freshness_review', [failed.id]), true);
  await act(1);
  await rpc('api_set_freshness_reviews', [true, 365]);
  const reconciled = await run();
  assert.ok(reconciled.cancelled >= 2);
  assert.equal(reconciled.created, 0);
  await owner();
  await db.exec(
    `update settings set custom='{"auditedDocumentAccess":true,"auditedCandidateExports":true}' where workspace_id='${id(11)}';select set_config('request.jwt.claim.aal','aal2',false);`,
  );
  await act(1);
  await rpc('api_set_privileged_mfa', [true]);
  await db.exec("select set_config('request.jwt.claim.aal','aal1',false)");
  await assert.rejects(rpc('api_freshness_reviews'), /Verify your authenticator/);
  await owner();
  await db.exec("select set_config('request.jwt.claim.aal','aal2',false)");
  await act(1);
  await rpc('api_set_freshness_reviews', [true, 121]);
  assert.equal((await run()).created, 2);
  await owner();
  await db.exec(`with stamp as(select clock_timestamp()at) insert into consents(workspace_id,"candidateId",purpose,status,date)
    select '${id(11)}','${id(57)}','recruiting-contact',s,at from stamp cross join(values('granted'),('revoked'))v(s);
    insert into consents(workspace_id,"candidateId",purpose,status,date) values('${id(11)}','${id(58)}','recruiting-contact','granted',clock_timestamp()+interval '1 day');`);
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from tasks where "candidateId" in($1,$2) and not done',
        [id(57), id(58)],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await run()).created, 0);
  await owner();
  await db.exec(`insert into ecod_private.freshness_receipts(workspace_id,candidate_id,anthro_id,verified_on,status)
    select '${id(11)}','${id(50)}','ANTHRO-12345',current_date-150,'cancelled' from generate_series(1,51);`);
  await act(1);
  assert.equal((await rpc('api_freshness_reviews', [0])).rows.length, 50);
  assert.ok((await rpc('api_freshness_reviews', [50])).rows.length > 0);
  await assert.rejects(rpc('api_freshness_reviews', [10001]), /Invalid page/);
});
