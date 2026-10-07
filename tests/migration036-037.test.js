import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { localVector } from '../src/intelligence.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('integrations, hosted retrieval and AI review enforce permissions, freshness and replay safety', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  // Reapplying migrations must preserve records and permissions.
  for (const name of ['036_integrations.sql', '037_intelligence.sql'])
    await db.exec(await readFile(new URL(name, path), 'utf8'));
  for (const name of (await readdir(path)).filter((n) => n.includes('_stage1_')).sort())
    await db.exec(await readFile(new URL(name, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`);
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
  const secret = 'a'.repeat(40);
  let admin = await rpc('api_webhook_admin', [
    'create',
    null,
    'Receiver',
    'https://example.com/hook',
    secret,
    false,
  ]);
  const subscription = admin.subscriptions[0].id;
  assert.ok(!JSON.stringify(admin).includes(secret));
  await rpc('api_webhook_admin', ['toggle', subscription, '', '', '', true]);
  const payload = {
    name: 'React engineer',
    email: 'react@example.com',
    title: 'React engineer',
    skills: ['React', 'TypeScript', 'AWS'],
    experience: 5,
    location: 'Delhi',
  };
  const first = await rpc('api_integrate_candidate', [
    'crm',
    'external-1',
    'request-0001',
    payload,
    null,
  ]);
  assert.equal(first.version, 1);
  assert.equal(
    (await rpc('api_integrate_candidate', ['crm', 'external-1', 'request-0001', payload, null]))
      .replayed,
    true,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', [
      'crm',
      'external-1',
      'request-0001',
      { ...payload, title: 'Other' },
      null,
    ]),
    /different request/,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', ['crm', 'external-1', 'request-0002', { title: 'Other' }, 0]),
    /version conflict/,
  );
  assert.equal(
    (
      await rpc('api_integrate_candidate', [
        'crm',
        'external-1',
        'request-0003',
        { title: 'React lead' },
        1,
      ])
    ).version,
    2,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', ['crm', 'bad', 'bad-0001', { name: 'Bad', email: 'bad' }, null]),
    /email/,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', ['crm', 'bad', 'bad-0002', { name: 'Bad', phone: 'abc' }, null]),
    /phone/,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', [
      'crm',
      'bad',
      'bad-0003',
      { ...payload, experience: 100 },
      null,
    ]),
    /limits/,
  );
  await assert.rejects(
    rpc('api_integrate_candidate', [
      'crm',
      'bad',
      'bad-0004',
      { ...payload, workspace_id: id(12) },
      null,
    ]),
    /Unsupported/,
  );
  await assert.rejects(db.query('select secret from "webhookSubscriptions"'), /permission denied/);
  await act(0);
  const jobs = await rpc('worker_claim_webhooks', [2]);
  assert.equal(jobs.length, 2);
  assert.ok(!JSON.stringify(jobs[0].event).includes('react@example.com'));
  assert.equal((await rpc('worker_claim_webhooks', [2])).length, 0);
  assert.equal(await rpc('worker_finish_webhook', [jobs[0].id, id(99), true, '']), false);
  assert.equal(await rpc('worker_finish_webhook', [jobs[0].id, jobs[0].lease, true, '']), true);
  await rpc('worker_finish_webhook', [jobs[1].id, jobs[1].lease, false, 'unavailable']);
  await act(1);
  admin = await rpc('api_webhook_admin', ['list']);
  assert.equal(admin.deliveries.filter((d) => d.status === 'delivered').length, 1);
  await assert.rejects(rpc('api_webhook_admin', ['retry', jobs[0].id]), /Failed delivery/);
  assert.equal((await rpc('api_intelligence_settings')).enabled, false);
  await assert.rejects(rpc('api_intelligence_reserve', ['draft', first.candidateId]), /disabled/);
  const rows = await rpc('api_index_candidates');
  assert.ok(!rows[0].text.includes('react@example.com'));
  await rpc('api_index_candidate', [rows[0].id, rows[0].fingerprint, localVector(rows[0].text)]);
  const query = localVector('React TypeScript AWS');
  assert.equal((await rpc('api_hosted_search', [query]))[0].id, first.candidateId);
  assert.equal((await rpc('api_hosted_search', [query, 'local-v1', 'Mumbai'])).length, 0);
  // Run the same tenant-scoped search with the actual pgvector extension and optional index.
  await db.exec('reset role');
  await db.exec(
    await readFile(new URL('../supabase/optional/038_pgvector_index.sql', import.meta.url), 'utf8'),
  );
  await act(1);
  assert.equal((await rpc('api_hosted_search', [query]))[0].id, first.candidateId);
  await rpc('api_intelligence_settings', ['save', true, 3]);
  const job = await rpc('api_intelligence_reserve', ['draft', first.candidateId]);
  await act(0);
  await rpc('worker_intelligence_complete', [
    job.id,
    'test-model',
    'Evidence-based draft',
    null,
    false,
  ]);
  await act(2);
  const draft = (await rpc('api_intelligence_drafts'))[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.current, true);
  assert.equal(draft.created_by, id(1));
  await rpc('api_review_intelligence', [job.id, true, 'Recruiter-reviewed draft']);
  assert.equal((await rpc('api_intelligence_drafts'))[0].status, 'approved');
  assert.equal((await rpc('api_intelligence_drafts'))[0].reviewed_by, id(2));
  assert.equal((await rpc('api_intelligence_drafts'))[0].provider, 'openai');
  const snapshots = (
    await db.query(
      `select snapshot from jsonb_to_recordset(api_legacy_rows('history')->'rows') as h("entityType" text,"entityId" uuid,action text,snapshot jsonb) where "entityType" in ('intelligenceRequests','webhookSubscriptions','webhookDeliveries')`,
    )
  ).rows;
  assert.ok(snapshots.length > 0);
  assert.ok(!JSON.stringify(snapshots).includes(secret));
  assert.ok(!JSON.stringify(snapshots).includes('Recruiter-reviewed draft'));
  assert.equal(
    (await db.query('select summary from candidates where id=$1', [first.candidateId])).rows[0]
      .summary,
    '',
  );
  await assert.rejects(
    rpc('api_review_intelligence', [job.id, true, 'Again']),
    /no longer available/,
  );
  const embeddingJob = await rpc('api_intelligence_reserve', ['embedding', first.candidateId]);
  await act(0);
  await rpc('worker_intelligence_complete', [
    embeddingJob.id,
    'embedding-model',
    '',
    localVector(rows[0].text),
    false,
  ]);
  await act(2);
  assert.equal(
    (await rpc('api_hosted_search', [query, 'openai:embedding-model:384:v1']))[0].id,
    first.candidateId,
  );
  assert.equal(
    (await rpc('api_hosted_search', [query, 'openai:different-model:384:v1'])).length,
    0,
  );
  const stale = await rpc('api_intelligence_reserve', ['draft', first.candidateId]);
  await act(0);
  await rpc('worker_intelligence_complete', [
    stale.id,
    'test-model',
    'Draft before changes',
    null,
    false,
  ]);
  await act(2);
  await db.query('update candidates set title=$1 where id=$2', [
    'Changed title',
    first.candidateId,
  ]);
  await assert.rejects(
    rpc('api_integrate_candidate', [
      'crm',
      'external-1',
      'stale-ui-edit',
      { title: 'Overwrite recent edit' },
      2,
    ]),
    /version conflict/,
  );
  assert.equal((await rpc('api_hosted_search', [query])).length, 0);
  await assert.rejects(
    rpc('api_review_intelligence', [stale.id, true, 'Approve stale']),
    /candidate changed/,
  );
  await assert.rejects(rpc('api_intelligence_reserve', ['query', null]), /limit reached/);
  await assert.rejects(rpc('api_intelligence_settings', ['save', false, 2]), /Administrator/);
  await assert.rejects(rpc('worker_claim_webhooks', [2]), /permission denied/);
  await act(3);
  await assert.rejects(rpc('api_index_candidates'), /Editor/);
  await assert.rejects(
    rpc('api_integrate_candidate', ['crm', 'v', 'viewer-0001', payload, null]),
    /Editor/,
  );
  await act(4);
  assert.equal((await rpc('api_hosted_search', [query])).length, 0);
  assert.equal((await rpc('api_external_mappings')).length, 0);
  assert.equal((await rpc('api_intelligence_drafts')).length, 0);
  await assert.rejects(
    rpc('api_index_candidate', [rows[0].id, rows[0].fingerprint, query]),
    /Candidate changed/,
  );
});
