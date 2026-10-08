import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('internal reminders are atomic, tenant/admin scoped, replay safe and invalidated by interview changes', async (t) => {
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
        files.find((n) => n.endsWith('_internal_interview_reminders.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Candidate','a@example.com'),('${id(51)}','${id(12)}','Other','b@example.com');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');
    insert into interviews(id,workspace_id,"candidateId","scheduledAt") values
    ('${id(90)}','${id(11)}','${id(50)}',now()+interval '30 minutes'),
    ('${id(91)}','${id(11)}','${id(50)}',now()+interval '3 hours'),
    ('${id(92)}','${id(11)}','${id(50)}',now()-interval '1 minute'),
    ('${id(93)}','${id(12)}','${id(51)}',now()+interval '30 minutes');`);
  const act = async (n, role = 'authenticated', aal = 'aal1') => {
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
  const run = async (limit = 20) => {
    await act(null, 'service_role');
    return rpc('worker_run_interview_reminders', [limit]);
  };
  assert.equal((await run()).created, 0);
  await act(2);
  await assert.rejects(rpc('api_set_interview_reminders', [true]), /Administrator/);
  await assert.rejects(rpc('worker_run_interview_reminders'), /permission denied/);
  await act(1);
  assert.equal((await rpc('api_interview_reminders')).enabled, false);
  await rpc('api_set_interview_reminders', [true]);
  assert.equal((await run()).created, 1);
  assert.equal((await run()).created, 0);
  await act(1);
  const page = await rpc('api_interview_reminders');
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].interviewId, id(90));
  assert.equal(page.rows[0].status, 'delivered');
  await db.query('update tasks set done=true where id=$1', [page.rows[0].taskId]);
  assert.equal((await run()).created, 0);
  await act(1);
  await db.query('update interviews set "scheduledAt"=now()+interval \'40 minutes\' where id=$1', [
    id(90),
  ]);
  assert.equal((await rpc('api_interview_reminders')).rows[0].status, 'cancelled');
  assert.equal((await run()).created, 1);
  await act(1);
  const active = (await rpc('api_interview_reminders')).rows.find((r) => r.status === 'delivered');
  await db.query("update interviews set status='Cancelled' where id=$1", [id(90)]);
  assert.equal(
    (await db.query('select done from tasks where id=$1', [active.taskId])).rows[0].done,
    true,
  );
  assert.equal((await run()).created, 0);
  await act(3);
  assert.equal((await rpc('api_interview_reminders')).total, 0);
  await rpc('api_set_interview_reminders', [true]);
  assert.equal((await run()).created, 1);
  await act(1);
  await rpc('api_set_interview_reminders', [false]);
  await db.query("update interviews set status='Scheduled' where id=$1", [id(90)]);
  assert.equal((await run()).created, 0);
  await act(1);
  await rpc('api_set_interview_reminders', [true]);
  // Inject a task failure to prove no partial effects, bounded retry and continued batches.
  await db.exec(`reset role;create function public.test_reject_task() returns trigger language plpgsql as $$begin if new."candidateId"='${id(50)}' then raise exception 'private failure text';end if;return new;end$$;
    create trigger test_reject before insert on tasks for each row execute function public.test_reject_task();`);
  await db.exec(
    `insert into interviews(id,workspace_id,"candidateId","scheduledAt") values('${id(95)}','${id(12)}','${id(51)}',now()+interval '25 minutes');`,
  );
  assert.deepEqual(await run(2), { created: 1, retriedOrFailed: 1 });
  for (let n = 1; n < 5; n++) {
    await db.exec(
      "reset role;update ecod_private.interview_reminders set available_at=now()-interval '1 minute' where status='retrying';",
    );
    assert.equal((await run()).retriedOrFailed, 1);
  }
  await act(1);
  const failed = (await rpc('api_interview_reminders')).rows.find((r) => r.status === 'failed');
  assert.equal(failed.attempts, 5);
  assert.ok(!failed.lastError.includes('private'));
  assert.equal((await run()).retriedOrFailed, 0);
  await db.exec('reset role;drop trigger test_reject on tasks;');
  await act(3);
  await assert.rejects(rpc('api_retry_interview_reminder', [failed.id]), /Future scheduled/);
  await act(1);
  await rpc('api_retry_interview_reminder', [failed.id]);
  assert.equal((await run()).created, 1);
  await act(1);
  await db
    .query('update settings set custom=$1', [
      JSON.stringify({
        privilegedMfa: true,
        auditedCandidateExports: true,
        auditedDocumentAccess: true,
      }),
    ])
    .catch((err) => assert.match(err.message, /Verify/));
  await act(1, 'authenticated', 'aal2');
  await db.query('update settings set custom=$1', [
    JSON.stringify({
      privilegedMfa: true,
      auditedCandidateExports: true,
      auditedDocumentAccess: true,
    }),
  ]);
  await act(1);
  await assert.rejects(rpc('api_set_interview_reminders', [false]), /Verify your authenticator/);
  await assert.rejects(
    db.query('select * from ecod_private.interview_reminders'),
    /permission denied/,
  );
  await act(null, 'anon');
  await assert.rejects(rpc('api_interview_reminders'), /permission denied/);
});
