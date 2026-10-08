import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `75000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('recruiter queues bound pages, isolate preferences and authorize conflict-safe decisions', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(name, path), 'utf8'));
  await db.exec(await readFile(new URL('20261007114511_recruiter_worklist.sql', path), 'utf8'));
  for (let n = 1; n <= 5; n++)
    await db.query('insert into auth.users values($1,$2)', [id(n), `user${n}@e.com`]);
  await db.exec(`insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,current)values('${id(101)}','${id(11)}','One','private@e.com',999),('${id(102)}','${id(12)}','Other','other@e.com',888);
    insert into tasks(id,workspace_id,title,"candidateId",due) select ('75000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(11)}','Task '||n,'${id(101)}',(clock_timestamp() at time zone $$UTC$$)::date-1 from generate_series(1001,1030)n;
    insert into tasks(id,workspace_id,title,"candidateId",due,done)values('${id(1031)}','${id(11)}','Undated','${id(101)}',null,false),('${id(1032)}','${id(11)}','Later','${id(101)}',(clock_timestamp() at time zone $$UTC$$)::date+20,false),('${id(1033)}','${id(11)}','Done','${id(101)}',(clock_timestamp() at time zone $$UTC$$)::date,true),('${id(1034)}','${id(12)}','Other','${id(102)}',(clock_timestamp() at time zone $$UTC$$)::date,false);
    insert into notes(id,workspace_id,"candidateId",text,"followUp")values('${id(1101)}','${id(11)}','${id(101)}','Call candidate',(clock_timestamp() at time zone $$UTC$$)::date);
    insert into interviews(id,workspace_id,"candidateId","scheduledAt")values('${id(1201)}','${id(11)}','${id(101)}',now());`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args))
      .rows[0].value;
  const read = (kind = 'tasks', offset = 0, days = 7, done = false) =>
    rpc('api_recruiter_worklist', [kind, offset, days, done]);
  await act(3);
  let page = await read();
  assert.equal(page.rows.length, 25);
  assert.equal(page.more, true);
  assert.equal(page.counts.tasks.pending, 31);
  assert.equal(page.counts.tasks.overdue, 30);
  assert.equal(page.counts.tasks.completed, 1);
  assert.equal((await read('tasks', 25)).rows.length, 6);
  assert.equal((await read('tasks', 0, 30)).counts.tasks.pending, 32);
  assert.equal((await read('followups')).rows[0].title, 'Call candidate');
  assert.equal((await read('interviews')).rows.length, 1);
  assert.ok(!JSON.stringify(page).includes('private@e.com'));
  assert.ok(page.rows.every((r) => !('current' in r) && !('email' in r)));
  await assert.rejects(read('invalid'), /Invalid worklist/);
  await assert.rejects(read('tasks', -1), /Invalid worklist/);
  await assert.rejects(read('tasks', 0, 31), /Invalid worklist/);
  assert.deepEqual(await rpc('api_worklist_preferences', [true, 'followups', 14]), {
    bucket: 'followups',
    horizon: 14,
  });
  await act(2);
  assert.deepEqual(await rpc('api_worklist_preferences'), { bucket: 'tasks', horizon: 7 });
  const row = page.rows[0];
  const change = (op = 2001, version = row.version, state = true) =>
    rpc('api_worklist_action', [id(op), 'tasks', row.id, version, state]);
  await act(3);
  await assert.rejects(change(), /Editor access/);
  await assert.rejects(
    db.query('select * from ecod_worklist_private.receipts'),
    /permission denied/,
  );
  await assert.rejects(rpc('ecod_worklist_private.rows', [id(11), 7]), /permission denied/);
  await act(4);
  await assert.rejects(change(), /Task unavailable/);
  assert.equal((await read()).rows.length, 1);
  await act(1, 'postgres');
  await db.query('update tasks set title=$1 where id=$2', ['Changed task', row.id]);
  await act(2);
  await assert.rejects(change(), /Work changed/);
  page = await read();
  const current = page.rows.find((r) => r.id === row.id);
  assert.equal((await change(2002, current.version)).replayed, false);
  assert.equal((await change(2002, current.version)).replayed, true);
  await assert.rejects(change(2002, current.version, false), /operation conflict/);
  assert.equal((await read()).counts.tasks.pending, 30);
  assert.equal((await read('tasks', 0, 7, true)).rows.length, 2);
  await act(1, 'postgres');
  assert.equal(
    (await db.query('select count(*)::int n from ecod_worklist_private.receipts')).rows[0].n,
    1,
  );
  await db.exec(`insert into clients(id,workspace_id,name)values('${id(21)}','${id(11)}','Client');
    insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(201)}','${id(11)}','Role','Client','${id(21)}','{Python}',1,30,12345,'Delhi','Remote',1,'High',(clock_timestamp() at time zone $$UTC$$)::date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');
    insert into submissions(id,workspace_id,"candidateId","demandId")values('${id(301)}','${id(11)}','${id(101)}','${id(201)}');
    insert into ecod_client_private.packs(id,workspace_id,client_id,candidate_id,demand_id,submission_id,version,content,source_hash,created_by)values('${id(401)}','${id(11)}','${id(21)}','${id(101)}','${id(201)}','${id(301)}',1,'{"name":"One"}',repeat('a',64),'${id(1)}');
    insert into ecod_client_private.feedback(id,workspace_id,candidate_id,pack_id,actor,kind,comment)values('${id(501)}','${id(11)}','${id(101)}','${id(401)}','${id(5)}','comment','Client original feedback');`);
  const original = (await db.query('select to_jsonb(f) value from ecod_client_private.feedback f'))
    .rows[0].value;
  await act(2);
  const feedback = (await read('client-feedback')).rows[0];
  const handle = (op, version, state) =>
    rpc('api_worklist_action', [id(op), 'client-feedback', feedback.id, version, state]);
  assert.equal((await handle(2003, feedback.version, true)).replayed, false);
  assert.equal((await handle(2003, feedback.version, true)).replayed, true);
  assert.equal((await read('client-feedback')).rows.length, 0);
  await act(1);
  await assert.rejects(handle(2004, feedback.version, true), /Work changed/);
  const handled = (await read('client-feedback', 0, 7, true)).rows[0];
  await handle(2005, handled.version, false);
  assert.equal((await read('client-feedback')).rows.length, 1);
  await act(1, 'postgres');
  assert.deepEqual(
    (await db.query('select to_jsonb(f) value from ecod_client_private.feedback f')).rows[0].value,
    original,
  );
  const inventory = await rpc('ecod_private.erasure_inventory', [id(11), id(101)]);
  assert.equal(inventory.counts.length, 38);
  assert.equal(inventory.counts.find((c) => c.category === 'worklistReceipts').count, 3);
  await db.exec(`delete from memberships where user_id='${id(2)}'`);
  await act(2);
  await assert.rejects(change(2002, current.version), /Editor access/);
  await act(5);
  await assert.rejects(read(), /membership/);
  await act(null, 'anon');
  await assert.rejects(read(), /permission denied/);
});
