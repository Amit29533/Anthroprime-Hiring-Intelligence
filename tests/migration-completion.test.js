import test from 'node:test';
import assert from 'node:assert/strict';
import { stage1Database, id } from './stage1-harness.js';

test('completion migration applies and internal history/health permissions are enforced', async (t) => {
  const { db, act, rpc, today } = await stage1Database(t);
  await act(3);
  const history = await rpc('api_completion_workflows', [
    'history',
    null,
    null,
    { source: 'lifecycle', group: 'state', from: today, to: today },
    0,
  ]);
  assert.ok(history.head);
  assert.ok(Array.isArray(history.rows));
  await assert.rejects(rpc('api_completion_workflows', ['health']), /Admin|admin|privileged/i);
  await assert.rejects(
    rpc('api_completion_workflows', [
      'definition',
      id(70),
      'x',
      { kind: 'report', name: 'Test', body: {} },
      0,
    ]),
    /editor|write|permission/i,
  );
  await act(1);
  const health = await rpc('api_completion_workflows', ['health']);
  assert.ok(Array.isArray(health.queues));
  await act(4);
  const other = await rpc('api_completion_workflows', [
    'history',
    null,
    null,
    { source: 'lifecycle', group: 'state', from: today, to: today },
    0,
  ]);
  assert.notEqual(history.head, other.head);
  await act(null, 'anon');
  await assert.rejects(rpc('api_completion_workflows'), /permission denied/i);
  await db.exec('reset role');
});

async function campaignFixture(t) {
  const h = await stage1Database(t);
  const { db, act, rpc } = h;
  const api = (action, payload = {}, head = null, operation = null, offset = 0) =>
    rpc('api_completion_workflows', [action, operation, head, payload, offset]);
  const comm = (action, candidate = null, operation = null, payload = {}, head = null) =>
    rpc('api_test_communications', [action, candidate, operation, head, payload, 0]);
  await act(1);
  await comm('template', null, id(100), {
    key: 'reengage',
    version: 0,
    kind: 'freshness-check',
    purpose: 'recruiting-contact',
    subject: 'Hello {{candidateName}}',
    text: 'Are you available? Your identifier is {{anthroId}}.',
    enabled: true,
  });
  await comm(
    'policy',
    null,
    id(101),
    { enabled: true, outcome: 'success', dailyLimit: 3 },
    (await comm('context')).policyHead,
  );
  await act(2);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(102),
    'add',
    id(103),
    0,
    { kind: 'email', value: 'one@e.com', source: 'Candidate supplied email' },
  ]);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(104),
    'verify',
    id(103),
    1,
    { reason: 'Candidate confirmed ownership' },
  ]);
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status)values('${id(11)}','${id(21)}','recruiting-contact','granted');`,
  );
  await act(1);
  const body = {
    enabled: true,
    steps: [
      { template: id(100), day: 0 },
      { template: id(100), day: 3 },
      { template: id(100), day: 7 },
    ],
  };
  await api(
    'definition',
    { kind: 'campaign', name: 'Availability follow-up', body },
    (await api('context')).emptyHead,
    id(110),
  );
  await act(2);
  const payload = { definition: id(110), candidate: id(21), startAt: new Date().toISOString() };
  const preview = () => api('campaign-preview', payload);
  const enroll = async (operation) =>
    api('campaign-enroll', payload, (await preview()).head, id(operation));
  const run = async () => {
    await act(null, 'service_role');
    return rpc('worker_run_test_communications', [20]);
  };
  return { ...h, api, comm, body, payload, preview, enroll, run };
}

test('reviewed multi-step campaigns enforce atomic enrollment, replay, cancellation and source gates', async (t) => {
  const h = await campaignFixture(t);
  const { db, api, act, preview, enroll, run, payload } = h;
  await t.test(
    'whole sequence preview, frozen replay and duplicate active enrollment',
    async () => {
      const p = await preview();
      assert.equal(p.eligible, true);
      assert.equal(p.steps.length, 3);
      assert.equal(p.steps[2].source.preview.subject, 'Hello Person');
      await assert.rejects(api('campaign-enroll', payload, 'stale', id(120)), /source changed/);
      const first = await enroll(120);
      assert.equal(first.intents.length, 3);
      assert.equal(first.transport, 'test-only');
      assert.equal((await api('campaign-enroll', payload, p.head, id(120))).replayed, true);
      await assert.rejects(
        api(
          'campaign-enroll',
          { ...payload, startAt: new Date(Date.now() + 60000).toISOString() },
          p.head,
          id(120),
        ),
        /conflict/,
      );
      await assert.rejects(enroll(121), /active campaign/);
      const runResult = await run();
      assert.equal(runResult.testRecorded, 1);
      await act(2);
      const context = await api('context');
      assert.equal(context.enrollments[0].steps.filter((s) => s.status === 'Queued').length, 2);
      await api(
        'campaign-stop',
        { enrollment: id(120), reason: 'Candidate requested stop by telephone' },
        context.enrollments[0].head,
        id(122),
      );
      const stopped = (await api('context')).enrollments[0];
      assert.equal(stopped.steps.filter((s) => s.status === 'Cancelled').length, 2);
    },
  );
  await t.test(
    'candidate preference suppresses new enrollment without partial intents',
    async () => {
      await h.comm(
        'preference',
        id(21),
        id(125),
        {
          purpose: 'recruiting-contact',
          optOut: true,
          startHour: 0,
          endHour: 24,
          source: 'Candidate requested contact preference',
        },
        (await h.comm('context', id(21))).preferenceHead,
      );
      assert.equal((await preview()).eligible, false);
      await assert.rejects(enroll(126), /suppressed/);
      await h.comm(
        'preference',
        id(21),
        id(127),
        {
          purpose: 'recruiting-contact',
          optOut: false,
          startHour: 0,
          endHour: 24,
          source: 'Candidate requested contact preference',
        },
        (await h.comm('context', id(21))).preferenceHead,
      );
    },
  );
  await t.test('definition changes stop every pending old-version step', async () => {
    await enroll(130);
    await act(1);
    const d = (await api('context')).definitions.find((d) => d.kind === 'campaign');
    await api(
      'definition',
      { kind: 'campaign', name: d.name, body: { ...d.body, enabled: false } },
      d.head,
      id(131),
    );
    assert.ok(
      (await api('context')).enrollments
        .find((e) => e.id === id(130))
        .steps.every((s) => s.status === 'Cancelled'),
    );
    await assert.rejects(preview(), /enabled campaign/);
    const paused = (await api('context')).definitions.find((d) => d.kind === 'campaign');
    await api(
      'definition',
      { kind: 'campaign', name: d.name, body: { ...paused.body, enabled: true } },
      paused.head,
      id(132),
    );
    payload.definition = id(132);
    await act(2);
  });
  await t.test(
    'only current candidate sender messages received after enrollment stop the campaign',
    async () => {
      const e = await enroll(140);
      await db.exec('reset role');
      const message = id(141),
        insert = async (body) =>
          db.query(
            `insert into ecod_collaboration_private.messages(id,workspace_id,generation,provider_id,thread_id,candidate_id,body)values($1,$2,1,'reply','thread',$3,$4)on conflict(id)do update set body=excluded.body`,
            [message, id(11), id(21), body],
          );
      const allowed = async () =>
        (
          await db.query('select ecod_completion_private.campaign_allowed($1,$2)ok', [
            id(11),
            e.intents[0],
          ])
        ).rows[0].ok;
      const recent = { receivedMs: Date.now(), senderEmail: 'one@e.com', labels: ['INBOX'] };
      await insert({ ...recent, receivedMs: Date.now() - 86400000 });
      assert.equal(await allowed(), true);
      await insert({ ...recent, senderEmail: 'employee@e.com' });
      assert.equal(await allowed(), true);
      await insert({ ...recent, labels: ['SENT'] });
      assert.equal(await allowed(), true);
      await insert({ ...recent, bounce: { action: 'failed' } });
      assert.equal(await allowed(), true);
      await insert(recent);
      assert.equal(await allowed(), false);
      const outcome = await run();
      assert.equal(outcome.testRecorded, 0);
      assert.ok(outcome.suppressed >= 1);
      await act(2);
      assert.equal(
        (await api('context')).enrollments.find((x) => x.id === id(140)).steps[0].status,
        'Suppressed',
      );
      await api(
        'campaign-stop',
        { enrollment: id(140), reason: 'Close remaining steps after linked reply' },
        (await api('context')).enrollments.find((x) => x.id === id(140)).head,
        id(142),
      );
    },
  );
  await t.test('role and recovery boundaries cover new definitions and journals', async () => {
    await act(3);
    await assert.rejects(enroll(150), /Editor/);
    await assert.rejects(
      db.query('select *from ecod_completion_private.definitions'),
      /permission/,
    );
    await act(4);
    await assert.rejects(preview(), /current enabled/);
    await act(1);
    await db.exec('reset role;update ecod_processing_private.lockdown set paused=true');
    const d = (
      await db.query(
        `select to_jsonb(d)body from ecod_completion_private.definitions d where id='${id(132)}'`,
      )
    ).rows[0].body;
    await assert.rejects(
      db.exec('truncate ecod_completion_private.definitions'),
      /lockdown|paused/i,
    );
    await assert.rejects(
      db.query('update ecod_completion_private.definitions set name=$1 where id=$2', [
        'Changed',
        d.id,
      ]),
      /lockdown|paused/i,
    );
    await db.exec('update ecod_processing_private.lockdown set paused=false');
    await act(2);
    await enroll(151);
    await act(1);
    await h.rpc('api_enterprise_operations', [
      'offboard',
      id(152),
      await h.rpc('api_enterprise_member_head', [id(2)]),
      { user: id(2), reason: 'Reviewed departure and workspace access revocation' },
      0,
    ]);
    assert.ok(
      (await api('context')).enrollments
        .find((e) => e.id === id(151))
        .steps.every((step) => step.status === 'Suppressed'),
    );
    await enroll(153);
    await act(null, 'service_role');
    await h.rpc('worker_processing_recovery', [
      'lockdown',
      { reason: 'Isolated recovery fixture blocks future campaign work' },
    ]);
    await h.rpc('worker_processing_recovery', [
      'unlock',
      { reason: 'Isolated recovery checks completed for this fixture' },
    ]);
    await act(1);
    assert.ok(
      (await api('context')).enrollments
        .find((e) => e.id === id(153))
        .steps.every((step) => step.status === 'Suppressed'),
    );
    assert.equal((await h.comm('context')).policy.enabled, false);
    assert.equal((await run()).testRecorded, 0);
  });
});

test('historical builder counts server-observed events and persists/export audits without raw candidate data', async (t) => {
  const { db, act, rpc, today } = await stage1Database(t);
  const api = (a, p = {}, h = null, op = null) => rpc('api_completion_workflows', [a, op, h, p, 0]);
  await db.exec(`update public.candidates set status='Ready'where id='${id(21)}';`);
  await act(1);
  const p = { source: 'lifecycle', group: 'state', from: today, to: today, targetState: 'Ready' };
  const r = await api('history', p);
  assert.ok(r.rows.some((row) => row.label === 'Ready' && row.events === 1));
  assert.equal(r.cohort.newCandidates, 1);
  assert.equal(r.cohort.convertedCandidates, 1);
  assert.ok(!JSON.stringify(r).includes('one@e.com'));
  assert.ok(!JSON.stringify(r).includes('79000000'));
  await api(
    'definition',
    { kind: 'report', name: 'Observed readiness', body: p },
    (await api('context')).emptyHead,
    id(170),
  );
  const saved = (await api('context')).definitions.find((d) => d.kind === 'report');
  assert.equal(saved.version, 1);
  await api(
    'definition',
    { kind: 'report', name: saved.name, body: { ...p, group: 'month' } },
    saved.head,
    id(171),
  );
  assert.equal((await api('context')).definitions.filter((d) => d.kind === 'report').length, 1);
  await assert.rejects(
    api('definition', { kind: 'report', name: saved.name, body: p }, saved.head, id(172)),
    /changed/,
  );
  const exported = await api('history-export', p, r.head, id(173));
  assert.equal(exported.operation, id(173));
  assert.equal((await api('history-export', p, r.head, id(173))).replayed, true);
  await db.exec(`update public.candidates set status='Near-ready'where id='${id(21)}';`);
  await assert.rejects(api('history-export', p, r.head, id(174)), /History changed/);
  for (const bad of [
    { ...p, group: 'current' },
    { ...p, to: '2099-01-01' },
    { ...p, from: '2026-02-30' },
    { ...p, email: true },
  ])
    await assert.rejects(api('history', bad));
  await act(3);
  await assert.rejects(api('history-export', p, r.head, id(175)), /Editor/);
});

test('administration searches before pagination and bounds invalid searches', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(
    `insert into auth.users select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'member'||n||'@e.com'from generate_series(500,530)n;insert into memberships select id,'${id(11)}','recruiter'from auth.users where email like'member%';`,
  );
  await act(1);
  const api = (a, p = {}, off = 0) => rpc('api_enterprise_operations', [a, null, null, p, off]);
  const all = await api('members');
  assert.equal(all.rows.length, 25);
  assert.equal(all.more, true);
  const found = await api('members', { query: 'member530', status: 'recruiter' });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].email, 'member530@e.com');
  assert.equal(found.more, false);
  assert.equal((await api('members', { query: 'member530', status: 'viewer' })).rows.length, 0);
  for (const action of ['members', 'cases', 'browse', 'access-history']) {
    await assert.rejects(api(action, { query: 'x'.repeat(201) }), /Bounded/);
    await assert.rejects(api(action, { query: null }), /Bounded/);
    assert.ok(Array.isArray((await api(action, { query: 'no match' })).rows));
  }
  await act(2);
  await assert.rejects(api('members', { query: 'member530' }), /Admin/i);
});

test('expanded custom modules enforce typed values, preserve sealed records and expose fields to subject access', async (t) => {
  const { db, act, today } = await stage1Database(t);
  await act(1);
  const modules = ['interviews', 'assessments', 'enrichment', 'placements'];
  const customFields = Object.fromEntries(
    modules.map((m) => [
      m,
      [
        { name: 'Review code', type: 'number' },
        { name: 'Review date', type: 'date' },
      ],
    ]),
  );
  await db.query(`insert into public.settings(id,workspace_id,custom)values('workspace',$1,$2)`, [
    id(11),
    { customFields },
  ]);
  const triggers = (
    await db.query(
      `select event_object_table from information_schema.triggers where trigger_name='validate_custom_values'and trigger_schema='public'`,
    )
  ).rows.map((r) => r.event_object_table);
  for (const module of modules) assert.ok(triggers.includes(module));
  const custom = { 'Review code': 12.5, 'Review date': today };
  await act(2);
  await db.query(
    `insert into public.assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence,custom)values($1,$2,$3,'Review',80,'Assessor',$4,'Observed test evidence',$5)`,
    [id(200), id(11), id(21), today, custom],
  );
  await db.query(
    `insert into public.enrichment(id,workspace_id,"candidateId",title,description,due,owner,status,custom)values($1,$2,$3,'Plan','Observed evidence',$4,'Owner','Planned',$5)`,
    [id(201), id(11), id(21), today, custom],
  );
  await db.query(
    `insert into public.interviews(id,workspace_id,"candidateId",round,"scheduledAt",custom)values($1,$2,$3,'Round 1',clock_timestamp()+interval'1 day',$4)`,
    [id(202), id(11), id(21), custom],
  );
  for (const [table, row] of [
    ['assessments', 200],
    ['enrichment', 201],
    ['interviews', 202],
  ]) {
    for (const bad of [{ 'Review code': '12' }, { 'Review date': '2026-02-30' }, []])
      await assert.rejects(
        db.query(`update public."${table}"set custom=$1 where id=$2`, [bad, id(row)]),
      );
  }
  await act(1);
  await assert.rejects(
    db.query(`update settings set custom=$1 where id='workspace'`, [
      { customFields: { ...customFields, assessments: [] } },
    ]),
    /archive|cannot be removed/i,
  );
  await db.exec('reset role');
  const inventory = (
    await db.query('select category,projection from ecod_private.subject_access_inventory($1,$2)', [
      id(11),
      id(21),
    ])
  ).rows;
  assert.ok(
    inventory.some(
      (r) => r.category === 'assessments' && r.projection.custom?.['Review code'] === 12.5,
    ),
  );
  assert.ok(
    inventory.some(
      (r) =>
        r.category === 'interviews' &&
        r.projection.round === 'Round 1' &&
        r.projection.durationMins === 45,
    ),
  );
  await act(3);
  const denied = await db.query(`update public.interviews set custom=$1 where id=$2 returning id`, [
    { 'Review code': 999 },
    id(202),
  ]);
  assert.equal(denied.rows.length, 0);
  assert.equal(
    (await db.query(`select custom from public.interviews where id=$1`, [id(202)])).rows[0].custom[
      'Review code'
    ],
    12.5,
  );
});

test('structured CV envelope requires cited records and explicit review at persistence', async (t) => {
  const { db, act } = await stage1Database(t);
  await act(1);
  const base = {
    version: 1,
    truncated: false,
    items: [
      {
        section: 'employment',
        label: 'Engineer',
        period: '2020-2024',
        evidence: 'Engineer 2020-2024',
        sourceLine: 2,
        reviewed: true,
      },
    ],
    records: [
      {
        section: 'employment',
        label: 'Engineer',
        organization: 'Example',
        start: '2020',
        end: '2024',
        ongoing: false,
        sourceLines: [2],
        reviewed: true,
      },
    ],
  };
  const put = (value) =>
    db.query(`update candidates set "cvEvidence"=$1 where id=$2`, [value, id(21)]);
  await put(base);
  for (const record of [
    { ...base.records[0], sourceLines: [3] },
    { ...base.records[0], sourceLines: [2, 2] },
    { ...base.records[0], section: 'education' },
    { ...base.records[0], start: '2026-02-30' },
    { ...base.records[0], end: '2019' },
    { ...base.records[0], reviewed: false },
    { ...base.records[0], secret: 'unexpected' },
    null,
  ])
    await assert.rejects(put({ ...base, records: [record] }), /review|bounded/i);
  await put({ ...base, records: [{ ...base.records[0], start: '2020-01', end: '2020-01-31' }] });
});

test('operational health reports actual queue ages, sync gates and policy-specific acceptance windows', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(`insert into ecod_collaboration_private.connections(workspace_id,kind,body,state,accepted_at,due_at)values('${id(11)}','mailbox','{}','enabled',clock_timestamp()-interval'6 days',clock_timestamp()-interval'11 minutes');
 insert into ecod_external_private.policies(workspace_id,kind,body,state,accepted_at)values('${id(11)}','ai','{}','enabled',clock_timestamp()-interval'20 days');
 insert into ecod_collaboration_private.work(id,workspace_id,candidate_id,kind,generation,actor,source_head,body,status,created_at,available_at,expires_at)values('${id(220)}','${id(11)}','${id(21)}','send',1,'${id(2)}','head','{}','Deferred',clock_timestamp()-interval'3 days',clock_timestamp()-interval'2 hours',clock_timestamp()+interval'2 hours'),('${id(221)}','${id(11)}','${id(21)}','send',1,'${id(2)}','other-head','{}','Ambiguous',clock_timestamp()-interval'2 days',clock_timestamp(),clock_timestamp()+interval'1 day');
 insert into ecod_collaboration_private.attempts(id,workspace_id,candidate_id,work_id,number,body)values('${id(222)}','${id(11)}','${id(21)}','${id(220)}',1,'{"outcome":"permanent failure"}');`);
  await act(1);
  const health = await rpc('api_completion_workflows', ['health']);
  const queue = health.queues.find((q) => q.area === 'google');
  assert.equal(queue.pending, 2);
  assert.equal(queue.overdue, 1);
  assert.equal(queue.needs_review, 1);
  assert.equal(health.sync[0].overdue, true);
  const external = health.evidence.find((e) => e.kind === 'controlled/ai');
  assert.equal(external.renewalDue, false);
  assert.ok(new Date(external.acceptanceExpiresAt) > new Date());
  assert.equal(health.evidence.find((e) => e.kind === 'google/mailbox').renewalDue, true);
  assert.equal(health.trend.find((e) => e.area === 'google').failure_signals, 1);
  await act(4);
  const isolated = await rpc('api_completion_workflows', ['health']);
  assert.equal(isolated.queues.length, 0);
  assert.equal(isolated.sync.length, 0);
});
