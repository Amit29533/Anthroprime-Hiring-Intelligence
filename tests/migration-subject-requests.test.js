import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('subject request cases isolate administrators and preserve idempotent versioned review history', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_data_subject_request_cases.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com'),('${id(5)}','second-admin@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin'),('${id(5)}','${id(11)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Existing','a@example.com'),('${id(51)}','${id(12)}','Other','b@example.com');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const create = [
    id(100),
    id(50),
    'erasure',
    'Email request to review stored records',
    'email',
    '2026-01-01',
    id(5),
  ];
  await act(1);
  assert.deepEqual(await rpc('api_create_subject_request', create), {
    id: id(100),
    version: 1,
    status: 'opened',
  });
  await rpc('api_create_subject_request', create);
  assert.equal((await rpc('api_subject_request_page')).total, 1);
  assert.equal((await rpc('api_subject_request_page')).overdue, 1);
  assert.equal((await rpc('api_subject_request_detail', [id(100)])).total, 1);
  await assert.rejects(
    rpc('api_create_subject_request', [id(100), id(50), 'access', ...create.slice(3)]),
    /identifier conflict/,
  );
  await assert.rejects(
    rpc('api_create_subject_request', [id(101), id(51), ...create.slice(2)]),
    /Candidate not available/,
  );
  await assert.rejects(
    rpc('api_create_subject_request', [id(101), id(50), ...create.slice(2, 6), id(2)]),
    /Assignee/,
  );
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(102),
      id(100),
      1,
      'close',
      'External action evidence reviewed',
    ]),
    /case state/,
  );
  for (const n of [2, 3]) {
    await act(n);
    await assert.rejects(rpc('api_subject_request_page'), /Administrator/);
    await assert.rejects(
      rpc('api_create_subject_request', [id(110), ...create.slice(1)]),
      /Administrator/,
    );
    await assert.rejects(rpc('api_subject_request_detail', [id(100)]), /Administrator/);
  }
  await act(4);
  assert.equal((await rpc('api_subject_request_page')).total, 0);
  await assert.rejects(rpc('api_subject_request_detail', [id(100)]), /not found/);
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(103),
      id(100),
      1,
      'verify',
      'Verified identity reference',
    ]),
    /not found/,
  );
  await act(0, 'anon');
  await assert.rejects(rpc('api_subject_request_page'), /permission denied/);
  await act(1);
  await assert.rejects(
    db.query('select * from ecod_private.subject_requests'),
    /permission denied/,
  );
  await assert.rejects(
    db.query('delete from ecod_private.subject_request_events'),
    /permission denied/,
  );
  const verify = [id(104), id(100), 1, 'verify', 'Verified response via existing email'];
  assert.equal((await rpc('api_update_subject_request', verify)).version, 2);
  await rpc('api_update_subject_request', verify);
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(104),
      id(100),
      1,
      'verify',
      'Different identity reference',
    ]),
    /identifier conflict/,
  );
  await assert.rejects(
    rpc('api_update_subject_request', [id(105), id(100), 1, 'start', 'Request review started']),
    /Case changed/,
  );
  await act(5);
  await assert.rejects(rpc('api_update_subject_request', verify), /identifier conflict/);
  await act(1);
  await rpc('api_update_subject_request', [id(106), id(100), 2, 'start', 'Request review started']);
  await rpc('api_update_subject_request', [
    id(107),
    id(100),
    3,
    'wait',
    'Awaiting original storage review',
  ]);
  await rpc('api_update_subject_request', [
    id(108),
    id(100),
    4,
    'plan',
    'Scheduled manual review with owner',
    null,
    null,
  ]);
  await rpc('api_update_subject_request', [
    id(109),
    id(100),
    5,
    'close',
    'Manual closure recorded with reference CASE-42',
  ]);
  assert.equal((await rpc('api_subject_request_page')).total, 0);
  const closed = await rpc('api_subject_request_detail', [id(100)]);
  assert.equal(closed.case.version, 6);
  assert.ok(closed.case.verifiedAt);
  assert.ok(closed.case.closedAt);
  assert.equal(closed.case.assignee, null);
  assert.equal(closed.total, 6);
  assert.deepEqual(
    closed.events.map((e) => e.version),
    [6, 5, 4, 3, 2, 1],
  );
  assert.equal(JSON.stringify(closed).includes('fingerprint'), false);
  await rpc('api_update_subject_request', [
    id(111),
    id(100),
    6,
    'reopen',
    'New information requires another review',
  ]);
  const reopened = await rpc('api_subject_request_detail', [id(100)]);
  assert.equal(reopened.case.status, 'opened');
  assert.equal(reopened.case.verifiedAt, null);
  assert.equal(reopened.case.closedAt, null);
  assert.equal(
    (await db.query('select name,email from candidates where id=$1', [id(50)])).rows[0].name,
    'Existing',
  );
  await rpc('api_create_subject_request', create);
  assert.equal((await rpc('api_subject_request_detail', [id(100)])).total, 7);
  await assert.rejects(rpc('api_subject_request_page', [null, 'invalid']), /Invalid request page/);
});
