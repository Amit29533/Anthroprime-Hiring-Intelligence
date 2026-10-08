import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('scoped machine API isolates tenants, versions writes, binds replays, revokes keys and publishes only approved roles', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  const path = new URL('../supabase/migrations/', import.meta.url),
    files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_scoped_machine_api.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(
    `insert into auth.users values('${id(1)}','one@e.com'),('${id(2)}','two@e.com'),('${id(3)}','recruiter@e.com');insert into workspaces(id,name)values('${id(11)}','One'),('${id(12)}','Two');insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(1)}','${id(12)}','admin'),('${id(2)}','${id(12)}','admin'),('${id(3)}','${id(11)}','recruiter');insert into clients(id,workspace_id,name)values('${id(21)}','${id(11)}','Client'),('${id(22)}','${id(12)}','Other client');insert into "userWorkspacePreferences"(user_id,"activeWorkspaceId")values('${id(1)}','${id(11)}');`,
  );
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args))
      .rows[0].value;
  const issue = (
    n,
    scopes = ['candidate:write', 'demand:write', 'events:read', 'jobs:read'],
    days = 30,
  ) => rpc('api_machine_credentials', ['create', id(n), 'HR import', 'Internal HR', scopes, days]);
  await act(3);
  await assert.rejects(issue(31), /Administrator/);
  await act(1);
  const key = await issue(31);
  assert.match(key.token, /^anthro_m_[a-f0-9]{64}$/);
  const hash = createHash('sha256').update(key.token).digest('hex');
  assert.equal((await issue(31)).token, null);
  await assert.rejects(issue(31, undefined, 31), /conflict/);
  assert.ok(
    !JSON.stringify((await rpc('api_machine_credentials', ['list'])).credentials).includes(hash),
  );
  await assert.rejects(rpc('api_machine_dispatch', [hash, 'events', {}]), /permission denied/);
  await act(0, 'service_role');
  const dispatch = (action, request) => rpc('api_machine_dispatch', [hash, action, request]);
  const request = {
    operationId: id(51),
    externalId: 'person-1',
    body: { name: 'Person One', email: 'person-one@e.com', experience: 2, notice: 30 },
  };
  const candidate = await dispatch('candidate', request);
  assert.equal(candidate.version, 1);
  assert.equal((await dispatch('candidate', request)).replayed, true);
  await assert.rejects(
    dispatch('candidate', { ...request, body: { ...request.body, name: 'Different' } }),
    /conflict/,
  );
  await assert.rejects(
    dispatch('candidate', { ...request, operationId: id(52), version: 0 }),
    /version conflict/,
  );
  const updated = await dispatch('candidate', {
    ...request,
    operationId: id(52),
    version: 1,
    body: { title: 'Developer' },
  });
  assert.equal(updated.version, 2);
  await assert.rejects(
    dispatch('candidate', {
      ...request,
      operationId: id(53),
      version: 2,
      body: { processingRestricted: false },
    }),
    /Unsupported/,
  );
  await act(1);
  await rpc('api_switch_workspace', [id(12)]);
  await act(0, 'service_role');
  const second = await dispatch('candidate', {
    operationId: id(54),
    externalId: 'person-2',
    body: { name: 'Fixed workspace', email: 'fixed@e.com' },
  });
  await act(0, 'postgres');
  assert.equal(
    (await db.query('select workspace_id from candidates where id=$1', [second.candidateId]))
      .rows[0].workspace_id,
    id(11),
  );
  const stored = (
    await db.query('select token_hash from ecod_machine_private.credentials where id=$1', [id(31)])
  ).rows[0].token_hash;
  assert.equal(stored, hash);
  await act(0, 'service_role');
  const demandBody = {
    title: 'Approved feed role',
    clientId: id(21),
    skills: ['Python'],
    minExperience: 1,
    maxNotice: 30,
    budget: 100,
    location: 'Delhi',
    mode: 'Remote',
    positions: 1,
    priority: 'High',
    target: '2026-12-01',
    description: 'Work on platform development',
    status: 'Open',
  };
  const dreq = { operationId: id(61), externalId: 'role-1', body: demandBody };
  const d = await dispatch('demand', dreq);
  assert.equal(d.version, 1);
  assert.equal((await dispatch('demand', dreq)).replayed, true);
  await assert.rejects(
    dispatch('demand', {
      ...dreq,
      operationId: id(62),
      externalId: 'wrong-client',
      body: { ...demandBody, clientId: id(22) },
    }),
    /this workspace/,
  );
  await act(0, 'anon');
  assert.equal((await rpc('api_approved_job_feed', [id(11), 0])).jobs.length, 0);
  await act(1);
  await rpc('api_switch_workspace', [id(11)]);
  await act(1, 'postgres');
  await db.query(
    'update demands set "careersVisible"=true,"approvalStatus"=\'Approved\' where id=$1',
    [d.demandId],
  );
  await act(0, 'anon');
  const feed = await rpc('api_approved_job_feed', [id(11), 0]);
  assert.equal(feed.jobs.length, 1);
  assert.ok(!JSON.stringify(feed).includes('budget'));
  await act(1, 'postgres');
  await db.query(
    "update demands set description='Edited public description',\"jobFeedApprovedHash\"='spoofed' where id=$1",
    [d.demandId],
  );
  assert.equal(
    (
      await db.query('select "approvalStatus","jobFeedApprovedHash" from demands where id=$1', [
        d.demandId,
      ])
    ).rows[0].approvalStatus,
    'Approved',
    'legacy requisition approval remains separate',
  );
  await act(0, 'anon');
  assert.equal(
    (await rpc('api_approved_job_feed', [id(11), 0])).jobs.length,
    0,
    'edited public content cannot reuse publication approval',
  );
  await act(3, 'postgres');
  await db.query('update demands set "careersVisible"=false where id=$1', [d.demandId]);
  await db.query(
    'update demands set "careersVisible"=true,"jobFeedApprovedHash"=\'spoofed\' where id=$1',
    [d.demandId],
  );
  await act(0, 'anon');
  assert.equal(
    (await rpc('api_approved_job_feed', [id(11), 0])).jobs.length,
    0,
    'recruiters cannot author public-feed approval',
  );
  await act(1, 'postgres');
  await db.query('update demands set "careersVisible"=false where id=$1', [d.demandId]);
  await db.query('update demands set "careersVisible"=true where id=$1', [d.demandId]);
  await act(0, 'anon');
  assert.equal((await rpc('api_approved_job_feed', [id(11), 0])).jobs.length, 1);
  const apply = await rpc('api_public_apply', [
    id(11),
    {
      name: 'Applicant',
      email: 'applicant@e.com',
      demandId: d.demandId,
      consentContact: true,
      source: 'Community board',
    },
  ]);
  assert.ok(apply.statusToken);
  await assert.rejects(
    rpc('api_public_apply', [
      id(11),
      {
        name: 'Applicant',
        email: 'x@e.com',
        demandId: d.demandId,
        consentContact: true,
        source: '<script>',
      },
    ]),
    /Invalid/,
  );
  await act(0, 'postgres');
  assert.equal(
    (await db.query('select source from "publicApplications" where id=$1', [apply.applicationId]))
      .rows[0].source,
    'Community board',
  );
  const version = (
    await db.query('select version from ecod_machine_private.demand_mappings where demand_id=$1', [
      d.demandId,
    ])
  ).rows[0].version;
  await act(0, 'service_role');
  await dispatch('demand', {
    ...dreq,
    operationId: id(63),
    version,
    body: { title: 'Changed terms' },
  });
  await act(0, 'anon');
  assert.equal(
    (await rpc('api_approved_job_feed', [id(11), 0])).jobs.length,
    0,
    'material changes unpublish stale approval',
  );
  await act(0, 'service_role');
  const events = await dispatch('events', { after: '0' });
  const mappings = await dispatch('mappings', { offset: 0 });
  assert.equal(mappings.mappings.length, 3);
  assert.equal(mappings.mappings.find((m) => m.external_id === 'person-1').version, 2);
  assert.ok(!JSON.stringify(mappings).includes('person-one@e.com'));
  assert.ok(events.events.length >= 5);
  assert.ok(events.events.every((e) => typeof e.cursor === 'string' && !('seq' in e)));
  assert.ok(!JSON.stringify(events).includes('person-one@e.com'));
  assert.equal((await dispatch('events', { after: events.events.at(-1).cursor })).events.length, 0);
  await act(1);
  const limited = await issue(32, ['events:read']);
  const lh = createHash('sha256').update(limited.token).digest('hex');
  await act(0, 'service_role');
  await assert.rejects(rpc('api_machine_dispatch', [lh, 'candidate', request]), /scope/);
  await act(0, 'postgres');
  await db.exec(
    `update ecod_machine_private.credentials set minute_started=now(),minute_count=60 where id='${id(32)}'`,
  );
  await act(0, 'service_role');
  await assert.rejects(rpc('api_machine_dispatch', [lh, 'events', {}]), /rate limit/);
  await act(1, 'postgres');
  await db.exec(
    `insert into "webhookSubscriptions"(id,workspace_id,name,url,secret,enabled)values('${id(81)}','${id(11)}','Receiver','https://example.com/events',repeat('x',32),true);insert into "webhookDeliveries"(id,workspace_id,subscription_id,event,status)values('${id(82)}','${id(11)}','${id(81)}','{}','failed');`,
  );
  await act(1);
  assert.equal(
    (await rpc('api_reconcile_webhook', [id(82), 'Receiver checked: event absent; safe to retry']))
      .reviewed,
    true,
  );
  await act(2);
  await assert.rejects(
    rpc('api_reconcile_webhook', [id(82), 'Wrong tenant cannot reconcile this delivery']),
    /Failed delivery/,
  );
  await act(2);
  await assert.rejects(rpc('api_machine_credentials', ['revoke', id(31)]), /not found/);
  await act(1);
  await rpc('api_machine_credentials', ['revoke', id(31)]);
  await act(0, 'service_role');
  await assert.rejects(dispatch('events', {}), /unavailable/);
  await act(0, 'postgres');
  await db.exec(
    `update ecod_machine_private.credentials set expires=now()-interval '1 day' where id='${id(32)}'`,
  );
  await act(0, 'service_role');
  await assert.rejects(rpc('api_machine_dispatch', [lh, 'events', {}]), /unavailable/);
  await act(1);
  const ownerKey = await issue(33, ['events:read']);
  const oh = createHash('sha256').update(ownerKey.token).digest('hex');
  await act(0, 'postgres');
  await db.exec(`delete from memberships where user_id='${id(1)}' and workspace_id='${id(11)}'`);
  await act(0, 'service_role');
  await assert.rejects(rpc('api_machine_dispatch', [oh, 'events', {}]), /unavailable/);
});
