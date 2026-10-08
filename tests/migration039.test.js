import { reviewedMerge } from './stage1-api-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { localVector } from '../src/localVector.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('index maintenance recovers leases, rejects stale completion and isolates admin operations', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`,
  );
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    if (
      file !== '039_operations.sql' &&
      !file.endsWith('_stage5_operations_governance.sql') &&
      !file.endsWith('_foundation_milestone.sql') &&
      !file.endsWith('_dependent_stage1_delivery.sql') &&
      !file.endsWith('_dependent_stage2_processing_recovery.sql') &&
      !file.endsWith('_dependent_stage3_google_collaboration.sql') &&
      !file.endsWith('_dependent_stage4_controlled_workflows.sql') &&
      !file.endsWith('_dependent_stage5_enterprise_fulfillment.sql')
    )
      await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    `insert into auth.users values('${id(1)}','a@e.com'),('${id(2)}','b@e.com'),('${id(3)}','c@e.com'),('${id(4)}','d@e.com');insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`,
  );
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${n ? 'authenticated' : 'service_role'};`,
    );
  const rpc = async (name, values = []) =>
    (
      await db.query(
        `select ${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        values,
      )
    ).rows[0].result;
  await act(1);
  const first = await rpc('api_integrate_candidate', [
    'crm',
    'one',
    'request-one',
    { name: 'One', email: 'one@e.com', title: 'React engineer' },
    null,
  ]);
  const second = await rpc('api_integrate_candidate', [
    'crm',
    'two',
    'request-two',
    { name: 'Two', email: 'two@e.com', title: 'Python engineer' },
    null,
  ]);
  await db.exec('reset role');
  await db.exec(await readFile(new URL('039_operations.sql', path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261007190524_stage5_operations_governance.sql', path), 'utf8'),
  );
  await db.exec(await readFile(new URL('20261008035834_foundation_milestone.sql', path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261008050701_dependent_stage1_delivery.sql', path), 'utf8'),
  );
  await db.exec(
    await readFile(
      new URL('20261008055723_dependent_stage2_processing_recovery.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008080756_dependent_stage3_google_collaboration.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008092747_dependent_stage4_controlled_workflows.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008101818_dependent_stage5_enterprise_fulfillment.sql', path),
      'utf8',
    ),
  );
  await act(1);
  assert.equal((await rpc('api_index_health')).pending, 2);
  await act(0);
  let jobs = await rpc('worker_claim_index', [20]);
  assert.equal(jobs.length, 2);
  assert.equal((await rpc('worker_claim_index', [20])).length, 0);
  const old = jobs.find((j) => j.candidateId === first.candidateId);
  await act(2);
  await db.query('update candidates set skills=$1 where id=$2', [['AWS'], first.candidateId]);
  await act(0);
  assert.equal(
    await rpc('worker_finish_index', [
      old.workspaceId,
      old.candidateId,
      old.lease,
      localVector(old.text),
      false,
    ]),
    false,
  );
  const untouched = jobs.find((j) => j.candidateId === second.candidateId);
  await rpc('worker_finish_index', [
    untouched.workspaceId,
    untouched.candidateId,
    untouched.lease,
    localVector(untouched.text),
    false,
  ]);
  jobs = await rpc('worker_claim_index', [20]);
  assert.equal(jobs.length, 1);
  await rpc('worker_finish_index', [
    jobs[0].workspaceId,
    jobs[0].candidateId,
    jobs[0].lease,
    localVector(jobs[0].text),
    false,
  ]);
  await act(1);
  let health = await rpc('api_index_health');
  assert.equal(health.indexed, 2);
  assert.equal(health.pending, 0);
  await db.exec('reset role');
  await db.exec(
    await readFile(new URL('../supabase/optional/038_pgvector_index.sql', import.meta.url), 'utf8'),
  );
  await act(1);
  await db.query('update candidates set name=$1 where id=$2', ['Updated name', first.candidateId]);
  assert.equal((await rpc('api_index_health')).pending, 0);
  await db.query('update candidates set title=$1 where id=$2', [
    'Changed professional title',
    first.candidateId,
  ]);
  assert.equal((await rpc('api_index_health')).indexed, 1);
  await act(0);
  jobs = await rpc('worker_claim_index', [20]);
  await db.exec('reset role');
  await db.exec(`update "indexJobs" set leased_until=now()-interval '1 minute'`);
  await act(0);
  const reclaimed = (await rpc('worker_claim_index', [20]))[0];
  assert.notEqual(reclaimed.lease, jobs[0].lease);
  assert.equal(
    await rpc('worker_finish_index', [
      jobs[0].workspaceId,
      jobs[0].candidateId,
      jobs[0].lease,
      localVector(jobs[0].text),
      false,
    ]),
    false,
  );
  await rpc('worker_finish_index', [
    reclaimed.workspaceId,
    reclaimed.candidateId,
    reclaimed.lease,
    null,
    true,
  ]);
  await db.exec('reset role');
  await db.exec(
    `update "indexJobs" set attempts=5,status='processing',leased_until=now()-interval '1 minute',lease='${id(99)}'`,
  );
  await act(0);
  await rpc('worker_claim_index', [20]);
  await act(1);
  assert.equal((await rpc('api_index_health')).failed, 1);
  assert.equal((await rpc('api_index_health')).failedJobs[0].candidate_id, first.candidateId);
  assert.equal((await rpc('api_index_health', [true])).pending, 1);
  // Reapplying the migration must preserve an unchanged in-flight lease.
  await act(0);
  jobs = await rpc('worker_claim_index', [20]);
  await db.exec('reset role');
  await db.exec(await readFile(new URL('039_operations.sql', path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261007190524_stage5_operations_governance.sql', path), 'utf8'),
  );
  await db.exec(await readFile(new URL('20261008035834_foundation_milestone.sql', path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261008050701_dependent_stage1_delivery.sql', path), 'utf8'),
  );
  await db.exec(
    await readFile(
      new URL('20261008055723_dependent_stage2_processing_recovery.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008080756_dependent_stage3_google_collaboration.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008092747_dependent_stage4_controlled_workflows.sql', path),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('20261008101818_dependent_stage5_enterprise_fulfillment.sql', path),
      'utf8',
    ),
  );
  await act(0);
  assert.equal(
    await rpc('worker_finish_index', [
      jobs[0].workspaceId,
      jobs[0].candidateId,
      jobs[0].lease,
      localVector(jobs[0].text),
      false,
    ]),
    true,
  );
  await act(1);
  await assert.rejects(
    rpc('api_reconcile_mapping', ['crm', 'one', 2, second.candidateId]),
    /version conflict/,
  );
  let mappings = await rpc('api_mapping_page', ['crm', 0]);
  const mapping = mappings.rows.find((m) => m.externalId === 'one');
  await rpc('api_reconcile_mapping', ['crm', 'one', mapping.version, second.candidateId]);
  mappings = await rpc('api_mapping_page', ['crm', 0]);
  const moved = mappings.rows.find((m) => m.externalId === 'one');
  assert.equal(moved.candidateId, second.candidateId);
  assert.equal(moved.version, mapping.version + 1);
  await assert.rejects(
    rpc('api_integrate_candidate', [
      'crm',
      'one',
      'stale-import',
      { title: 'Wrong' },
      mapping.version,
    ]),
    /version conflict/,
  );
  const sub = (
    await rpc('api_webhook_admin', [
      'create',
      null,
      'Receiver',
      'https://example.com',
      'a'.repeat(40),
      false,
    ])
  ).subscriptions[0].id;
  await rpc('api_rotate_webhook', [sub, 'b'.repeat(40)]);
  await rpc('api_webhook_admin', ['toggle', sub, '', '', '', true]);
  await assert.rejects(rpc('api_rotate_webhook', [sub, 'c'.repeat(40)]), /Pause/);
  await db.query('update candidates set title=$1 where id=$2', [
    'Trigger webhook',
    second.candidateId,
  ]);
  await act(0);
  const delivery = (await rpc('worker_claim_webhooks', [2]))[0];
  assert.equal(delivery.secret, 'b'.repeat(40));
  await act(1);
  await rpc('api_webhook_admin', ['toggle', sub, '', '', '', false]);
  await assert.rejects(rpc('api_rotate_webhook', [sub, 'c'.repeat(40)]), /active deliveries/);
  await act(0);
  await rpc('worker_finish_webhook', [delivery.id, delivery.lease, true, '']);
  await act(1);
  await rpc('api_rotate_webhook', [sub, 'c'.repeat(40)]);
  await reviewedMerge(db, second.candidateId, first.candidateId);
  await db.exec('reset role');
  assert.equal(
    (
      await db.query('select count(*)::int as n from "candidateVectors" where candidate_id=$1', [
        first.candidateId,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query('select count(*)::int as n from "indexJobs" where candidate_id=$1', [
        first.candidateId,
      ])
    ).rows[0].n,
    0,
  );
  await act(1);
  await rpc('api_intelligence_settings', ['save', true, 20]);
  const stalled = await rpc('api_intelligence_reserve', ['draft', second.candidateId]);
  await db.exec('reset role');
  await db.query(
    'update "intelligenceRequests" set created=now()-interval \'11 minutes\' where id=$1',
    [stalled.id],
  );
  await act(0);
  await rpc('worker_claim_index', [20]);
  await act(1);
  assert.equal(
    (await rpc('api_intelligence_drafts', [second.candidateId])).find((r) => r.id === stalled.id)
      .status,
    'failed',
  );
  await act(2);
  await assert.rejects(rpc('api_index_health'), /Administrator/);
  await assert.rejects(rpc('api_rotate_webhook', [sub, 'd'.repeat(40)]), /Administrator/);
  await act(3);
  await assert.rejects(rpc('api_mapping_page'), /Editor/);
  await assert.rejects(rpc('worker_claim_index', [20]), /permission denied/);
  await act(4);
  assert.equal((await rpc('api_index_health')).indexed, 0);
  assert.equal((await rpc('api_mapping_page')).total, 0);
  await assert.rejects(
    rpc('api_reconcile_mapping', ['crm', 'one', moved.version, second.candidateId]),
    /this workspace/,
  );
});
