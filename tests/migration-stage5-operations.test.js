import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { stage1Database, id } from './stage1-harness.js';
const reason = 'Reviewed operational scope for this selection';
const policy = {
  enabled: true,
  subjectDays: 30,
  feedbackHours: 48,
  taskGraceHours: 24,
  retentionMonths: 12,
  retentionReference: 'Approved review schedule reference POLICY-01',
};
async function setup(t) {
  const h = await stage1Database(t);
  await h.act(1);
  const anthro = (
    await h.db.query('select "anthroId" from public.candidates where id=$1', [id(21)])
  ).rows[0].anthroId;
  const call = (action, op = null, job = null, version = null, payload = {}, offset = 0) =>
    h.rpc('api_operations', [action, op, job, version, payload, offset]);
  return { ...h, anthro, call };
}
test('operations policy, RLS and role boundaries survive migration replay', async (t) => {
  const h = await setup(t);
  const { call, db, act } = h;
  const context = await call('context');
  assert.equal(context.policy.enabled, false);
  assert.equal(context.health.destructiveExecution, false);
  await call('policy', id(101), null, 0, policy);
  assert.deepEqual(await call('policy', id(101), null, 0, policy), { policyVersion: 1 });
  await assert.rejects(call('policy', id(101), null, 0, { ...policy, enabled: false }), /conflict/);
  await assert.rejects(call('policy', id(102), null, 0, policy), /changed/);
  await assert.rejects(call('policy', id(102), null, 1, { ...policy, subjectDays: 0 }), /Invalid/);
  for (const actor of [2, 3]) {
    await act(actor);
    await assert.rejects(call('context'), /Administrator/);
  }
  await act(4);
  assert.equal((await call('context')).policy.enabled, false);
  await act(0, 'anon');
  await assert.rejects(call('context'), /permission denied/);
  await act(1);
  await assert.rejects(db.query('select * from ecod_ops_private.items'), /permission denied/);
  await assert.rejects(
    h.rpc('ecod_ops_private.source_inventory', [id(11), id(21)]),
    /permission denied/,
  );
  await db.exec('reset role');
  await db.exec(
    await readFile(new URL('20261007190524_stage5_operations_governance.sql', h.root), 'utf8'),
  );
  await act(1);
  assert.equal((await call('context')).policyVersion, 1);
});
test('bounded report batches, frozen retries, redacted exports and stale sources', async (t) => {
  const h = await setup(t);
  const { call, db, act, anthro } = h;
  const body = { kind: 'report', anthroIds: [anthro], reason };
  await call('start', id(110), id(111), null, body);
  assert.equal((await call('step', id(112), id(111), 1)).status, 'Completed');
  assert.deepEqual(await call('step', id(112), id(111), 1), {
    id: id(111),
    version: 2,
    status: 'Completed',
  });
  const report = await call('export', id(113), id(111), 2);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].anthroId, anthro);
  for (const key of ['email', 'phone', 'current', 'expected', 'name', 'source_head'])
    assert.equal(key in report.rows[0], false);
  await db.exec(`reset role;update public.candidates set title='Changed'where id='${id(21)}'`);
  await act(1);
  await assert.rejects(call('export', id(114), id(111), 2), /Snapshot changed/);
  assert.deepEqual(await call('export', id(113), id(111), 2), report);
  await act(4);
  await assert.rejects(call('detail', null, id(111)), /unavailable/);
  await act(1);
  await assert.rejects(
    call('start', id(115), id(116), null, { ...body, anthroIds: [anthro, anthro] }),
    /duplicate/,
  );
  await assert.rejects(
    call('start', id(115), id(116), null, { ...body, anthroIds: Array(251).fill(anthro) }),
    /1–250/,
  );
});
test('bulk preview requires confirmation, rejects changed/held sources and preserves verified facts', async (t) => {
  const { call, db, act, anthro } = await setup(t);
  const payload = {
    kind: 'bulk',
    anthroIds: [anthro],
    reason,
    owner: 'Team A',
    nextAction: 'Review verified facts',
  };
  await call('start', id(120), id(121), null, payload);
  await call('step', id(122), id(121), 1);
  assert.equal((await call('detail', null, id(121))).job.status, 'Review');
  await assert.rejects(call('step', id(123), id(121), 2), /not runnable/);
  await call('confirm', id(123), id(121), 2);
  await call('step', id(124), id(121), 3);
  await db.exec('reset role');
  const c = (await db.query('select owner,verified::text from candidates where id=$1', [id(21)]))
    .rows[0];
  assert.equal(c.owner, 'Team A');
  assert.equal(c.verified, '2026-01-01');
  await act(1);
  await call('start', id(125), id(126), null, { ...payload, owner: 'Team B' });
  await call('step', id(127), id(126), 1);
  await db.exec(`reset role;update candidates set title='Source changed'where id='${id(21)}'`);
  await act(1);
  await assert.rejects(call('confirm', id(128), id(126), 2), /source changed/);
  await call('cancel', id(129), id(126), 2);
  await assert.rejects(call('step', id(130), id(126), 3), /not runnable/);
});
test('dry-run inventories cover operations metadata and never delete source records', async (t) => {
  const { call, db, act, anthro } = await setup(t);
  await call('start', id(140), id(141), null, { kind: 'erasure', anthroIds: [anthro], reason });
  await call('step', id(142), id(141), 1);
  const page = await call('detail', null, id(141));
  assert.equal(page.rows[0].result.inventory.counts.length, 57);
  assert.equal(page.rows[0].result.destructiveExecution, false);
  await call('export', id(143), id(141), 2);
  await db.exec('reset role');
  const inv = await (async () =>
    (await db.query('select ecod_private.erasure_inventory($1,$2) value', [id(11), id(21)])).rows[0]
      .value)();
  assert.equal(inv.counts.length, 60);
  assert.equal(inv.counts.find((x) => x.category === 'operationsItems').count, 1);
  assert.equal((await db.query('select count(*) n from candidates')).rows[0].n, 2);
  await db.exec(`update candidates set summary='New evidence'where id='${id(21)}'`);
  await act(1);
  await assert.rejects(call('export', id(144), id(141), 2), /Snapshot changed/);
});
test('internal SLA notices honor UTC quiet hours and current roles without changing deadlines', async (t) => {
  const { call, rpc, db, act } = await setup(t);
  await call('policy', id(150), null, 0, policy);
  await db.exec(
    `reset role;insert into tasks(id,workspace_id,"candidateId",title,due,done)values('${id(151)}','${id(11)}','${id(21)}','Private candidate task',current_date-3,false)`,
  );
  await act(2);
  const page = await rpc('api_sla_worklist');
  assert.equal(page.counts.task, 1);
  assert.equal(page.noticeEnabled, false);
  assert.equal(page.rows[0].title, undefined);
  const prefs = { enabled: true, quietStart: 0, quietEnd: 0 };
  assert.equal((await rpc('api_sla_worklist', [true, prefs, 0])).noticeEnabled, true);
  await assert.rejects(rpc('api_sla_worklist', [true, { ...prefs, quietStart: 25 }, 0]), /Invalid/);
  await act(3);
  assert.equal((await rpc('api_sla_worklist')).preferences.enabled, false);
  await act(4);
  assert.deepEqual((await rpc('api_sla_worklist')).counts, {});
  await act(0, 'anon');
  await assert.rejects(rpc('api_sla_worklist'), /permission denied/);
});

test('representative 250-identity workload stays bounded, completes exactly once and pages results', async (t) => {
  const { call, db, act } = await setup(t);
  await db.exec(
    `reset role;insert into candidates(id,workspace_id,name,email,verified,owner,"nextAction")select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(11)}','Load '||n,'load'||n||'@example.test',current_date-500,'Team',repeat('x',1000)from generate_series(1000,1249)n`,
  );
  const ids = (
    await db.query(
      `select "anthroId"from candidates where workspace_id=$1 and name like 'Load %'order by id`,
      [id(11)],
    )
  ).rows.map((r) => r.anthroId);
  await act(1);
  await call('start', id(160), id(161), null, { kind: 'report', anthroIds: ids, reason });
  let version = 1;
  for (let batch = 0; batch < 25; batch++) {
    const op = id(2000 + batch);
    const receipt = await call('step', op, id(161), version);
    assert.equal(receipt.status, batch === 24 ? 'Completed' : 'Pending');
    assert.deepEqual(await call('step', op, id(161), version), receipt);
    version = receipt.version;
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from ecod_ops_private.items where job_id=$1 and state=$2',
          [id(161), 'Completed'],
        )
      ).rows[0].n,
      (batch + 1) * 10,
    );
    await act(1);
  }
  for (let offset = 0; offset < 250; offset += 25) {
    const page = await call('detail', null, id(161), null, {}, offset);
    assert.equal(page.rows.length, 25);
    assert.equal(page.more, offset < 225);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 50000);
  }
  const report = await call('export', id(162), id(161), version);
  assert.equal(report.rows.length, 250);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 400000);
  await db.exec('reset role');
  assert.equal(
    (
      await db.query('select max(attempts)::int n from ecod_ops_private.items where job_id=$1', [
        id(161),
      ])
    ).rows[0].n,
    1,
  );
});

test('embedded database snapshot restores private jobs, receipts, grants and identity sequence for safe continuation', async (t) => {
  const { call, db, anthro } = await setup(t);
  await call('start', id(170), id(171), null, { kind: 'report', anthroIds: [anthro], reason });
  const step = await call('step', id(172), id(171), 1);
  await db.exec('reset role');
  const sequence = (await db.query('select last_value from public.candidate_anthro_number_seq'))
    .rows[0].last_value;
  const restored = new PGlite({ loadDataDir: await db.dumpDataDir(), extensions: { vector } });
  t.after(() => restored.close());
  await restored.exec(
    `select set_config('request.jwt.claim.sub','${id(1)}',false);set role authenticated`,
  );
  const replay = (
    await restored.query('select api_operations($1,$2,$3,$4,$5,$6) value', [
      'step',
      id(172),
      id(171),
      1,
      {},
      0,
    ])
  ).rows[0].value;
  assert.deepEqual(replay, step);
  await assert.rejects(restored.query('select *from ecod_ops_private.items'), /permission denied/);
  await restored.exec(
    `reset role;insert into candidates(id,workspace_id,name,email)values('${id(173)}','${id(11)}','Restored allocation','restore@example.test')`,
  );
  assert.ok(
    Number(
      (await restored.query('select last_value from public.candidate_anthro_number_seq')).rows[0]
        .last_value,
    ) > Number(sequence),
  );
  assert.equal(
    (
      await restored.query(
        'select count(*)::int n from ecod_ops_private.receipts where job_id=$1',
        [id(171)],
      )
    ).rows[0].n,
    2,
  );
});

test('bulk failure isolation, recovery and cancelled partial application keep existing source evidence intact', async (t) => {
  const { call, db, act, anthro, rpc } = await setup(t);
  await db.exec(
    `reset role;insert into candidates(id,workspace_id,name,email)select('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(11)}','Partial '||n,'partial'||n||'@example.test'from generate_series(3000,3010)n`,
  );
  const ids = (
    await db.query(
      `select "anthroId"from candidates where workspace_id=$1 and name like 'Partial %'order by id`,
      [id(11)],
    )
  ).rows.map((r) => r.anthroId);
  await act(1);
  const payload = {
    kind: 'bulk',
    anthroIds: ids,
    reason,
    owner: 'Applied team',
    nextAction: 'Reviewed action',
  };
  await call('start', id(180), id(181), null, payload);
  await call('step', id(182), id(181), 1);
  await call('step', id(183), id(181), 2);
  await call('confirm', id(184), id(181), 3);
  await call('step', id(185), id(181), 4);
  await call('cancel', id(186), id(181), 5);
  await db.exec('reset role');
  assert.equal(
    (await db.query("select count(*)::int n from candidates where owner='Applied team'")).rows[0].n,
    10,
  );
  assert.equal(
    (await db.query('select owner from candidates where id=$1', [id(3010)])).rows[0].owner,
    '',
  );
  await db.exec(
    `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"auditedCandidateExports":true}')`,
  );
  await act(1);
  await rpc('api_create_subject_request', [
    id(187),
    id(21),
    'restriction',
    'Reviewed candidate hold request',
    'portal',
  ]);
  await rpc('api_update_subject_request', [id(188), id(187), 1, 'verify', reason]);
  await rpc('api_update_subject_request', [id(189), id(187), 2, 'start', reason]);
  await rpc('api_set_subject_outbound_hold', [id(190), id(187), 3, true, reason]);
  await call('start', id(191), id(192), null, { ...payload, anthroIds: [anthro] });
  await call('step', id(193), id(192), 1);
  const held = await call('detail', null, id(192));
  assert.equal(held.rows[0].state, 'Stale');
  assert.equal(held.rows[0].code, 'SOURCE_CHANGED');
  await assert.rejects(call('confirm', id(194), id(192), 2), /successful preview/);
  await call('retry', id(195), id(192), 2);
  await call('step', id(196), id(192), 3);
  assert.equal((await call('detail', null, id(192))).rows[0].attempts, 2);
});

test('failed items expose SQLSTATE only, isolate other work and recover with actor-bound receipts', async (t) => {
  const { call, db, act, anthro } = await setup(t);
  await db.exec(
    `reset role;insert into candidates(id,workspace_id,name,email)values('${id(4000)}','${id(11)}','Other selected','selected@example.test')`,
  );
  const other = (await db.query('select "anthroId"from candidates where id=$1', [id(4000)])).rows[0]
    .anthroId;
  await act(1);
  await call('start', id(4001), id(4002), null, {
    kind: 'report',
    anthroIds: [anthro, other],
    reason,
  });
  await db.exec(
    `reset role;create function public.ops_test_failure()returns trigger language plpgsql as $$begin if new.state='Completed'and new.candidate_id='${id(21)}'then raise exception 'Private email and payload';end if;return new;end$$;create trigger ops_test_failure before update on ecod_ops_private.items for each row execute function public.ops_test_failure()`,
  );
  await act(1);
  await call('step', id(4003), id(4002), 1);
  const page = await call('detail', null, id(4002));
  assert.equal(page.counts.Failed, 1);
  assert.equal(page.counts.Completed, 1);
  assert.equal(page.rows[0].code, 'INVENTORY_OR_WRITE_FAILED:P0001');
  assert.equal(JSON.stringify(page).includes('Private email'), false);
  await assert.rejects(call('export', id(4004), id(4002), 2), /fully successful/);
  await db.exec('reset role;drop trigger ops_test_failure on ecod_ops_private.items');
  await act(1);
  await call('retry', id(4005), id(4002), 2);
  await call('step', id(4006), id(4002), 3);
  assert.equal((await call('detail', null, id(4002))).counts.Completed, 2);
  await db.exec(`reset role;update memberships set role='viewer'where user_id='${id(1)}'`);
  await act(1);
  await assert.rejects(call('step', id(4006), id(4002), 3), /Administrator/);
});

test('retention selector uses versioned policy and export quotas retain exact retry receipts', async (t) => {
  const { call, anthro, db, act, today } = await setup(t);
  await call('policy', id(4100), null, 0, { ...policy, retentionMonths: 1 });
  await db.exec(`reset role;update candidates set verified=current_date-45 where id='${id(21)}'`);
  await act(1);
  const selected = await call('search', null, null, null, { query: anthro, filter: 'retention' });
  assert.equal(selected.rows.length, 1);
  await call('start', id(4101), id(4102), null, { kind: 'retention', anthroIds: [anthro], reason });
  await call('step', id(4103), id(4102), 1);
  assert.equal((await call('detail', null, id(4102))).rows[0].result.retentionDue, true);
  for (let n = 0; n < 6; n++) await call('export', id(4110 + n), id(4102), 2);
  await assert.rejects(call('export', id(4116), id(4102), 2), /quota/);
  assert.equal((await call('export', id(4110), id(4102), 2)).rows.length, 1);
  for (let n = 0; n < 6; n++) await call('health-export', id(4120 + n));
  await assert.rejects(call('health-export', id(4126)), /quota/);
  await db.exec('reset role');
  await db.query('update candidates set verified=$1 where id=$2', [today, id(21)]);
  await act(1);
  assert.equal((await call('search', null, null, null, { filter: 'retention' })).rows.length, 0);
});

test('new or updated family subject cases invalidate current coverage exports without changing a candidate profile', async (t) => {
  const { call, rpc, anthro } = await setup(t);
  await call('start', id(4200), id(4201), null, { kind: 'retention', anthroIds: [anthro], reason });
  await call('step', id(4202), id(4201), 1);
  const before = await call('export', id(4203), id(4201), 2);
  assert.equal(before.rows[0].activeSubjectRequests, 0);
  await rpc('api_create_subject_request', [id(4204), id(21), 'retention_review', reason, 'other']);
  await assert.rejects(call('export', id(4205), id(4201), 2), /Snapshot changed/);
  assert.deepEqual(await call('export', id(4203), id(4201), 2), before);
  await call('start', id(4206), id(4207), null, { kind: 'retention', anthroIds: [anthro], reason });
  await call('step', id(4208), id(4207), 1);
  assert.equal((await call('detail', null, id(4207))).rows[0].result.activeSubjectRequests, 1);
  await rpc('api_update_subject_request', [id(4209), id(4204), 1, 'verify', reason]);
  await assert.rejects(call('export', id(4210), id(4207), 2), /Snapshot changed/);
});
