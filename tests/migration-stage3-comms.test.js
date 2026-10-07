import test from 'node:test';
import assert from 'node:assert/strict';
import { id, stage1Database } from './stage1-harness.js';
async function fixture(t) {
  const h = await stage1Database(t);
  const { db, act, rpc } = h;
  await act(1);
  const api = (action, candidate = null, operation = null, payload = {}, head = null) =>
    rpc('api_test_communications', [action, candidate, operation, head, payload, 0]);
  assert.equal((await api('context')).policy.enabled, false);
  await api('template', null, id(100), {
    key: 'welcome',
    version: 0,
    kind: 'custom',
    purpose: 'recruiting-contact',
    subject: 'Hello {{candidateName}}',
    text: 'Your identifier is {{anthroId}}.',
    enabled: true,
  });
  await api(
    'policy',
    null,
    id(101),
    { enabled: true, outcome: 'success', dailyLimit: 3 },
    (await api('context')).policyHead,
  );
  await act(2);
  const contact = id(102);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(103),
    'add',
    contact,
    0,
    { kind: 'email', value: 'one@e.com', source: 'Candidate supplied email' },
  ]);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(104),
    'verify',
    contact,
    1,
    { reason: 'Candidate confirmed ownership' },
  ]);
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status)values('${id(11)}','${id(21)}','recruiting-contact','granted');`,
  );
  const preview = () => api('preview', id(21), null, { template: id(100), context: {} });
  const queue = async (n = 110) => {
    const p = await preview();
    return api(
      'queue',
      id(21),
      id(n),
      { template: id(100), context: {}, availableAt: new Date().toISOString() },
      p.head,
    );
  };
  const run = async () => {
    await act(0, 'service_role');
    return rpc('worker_run_test_communications', [20]);
  };
  return { ...h, api, preview, queue, run };
}
test('communication previews, immutable templates and test receipts never represent live delivery', async (t) => {
  const h = await fixture(t);
  const { api, preview, queue, run, act } = h;
  const p = await preview();
  assert.equal(p.eligible, true);
  assert.equal(p.preview.subject, 'Hello Person');
  const queued = await queue();
  assert.equal(queued.transport, 'test-only');
  const batch = await run();
  assert.equal(batch.testRecorded, 1);
  assert.equal((await run()).testRecorded, 0);
  await act(2);
  const context = await api('context', id(21));
  assert.equal(context.rows[0].status, 'Test recorded');
  assert.equal(context.rows[0].receipts.length, 1);
  assert.match(context.rows[0].receipts[0].checksum, /^[a-f0-9]{64}$/);
  await assert.rejects(queue(111), /already/);
});

test('templates and operations enforce roles, tenant scope, valid placeholders and exact durable replay', async (t) => {
  const h = await fixture(t);
  const { db, act, rpc, api, preview } = h;
  await act(3);
  await assert.rejects(api('queue', id(21), id(200), {}), /Editor/);
  await assert.rejects(rpc('worker_run_test_communications', [20]), /permission/);
  await act(4);
  await assert.rejects(api('context', id(21)), /workspace/);
  await act(2);
  await assert.rejects(api('policy', null, id(201), {}), /Administrator/);
  await assert.rejects(db.query('select *from ecod_comms_private.intents'), /permission/);
  await assert.rejects(
    rpc('ecod_comms_private.source', [id(11), id(21), id(100), {}]),
    /permission/,
  );
  const p = await preview();
  const details = { template: id(100), context: {}, availableAt: new Date().toISOString() };
  const args = ['queue', id(21), id(202), details, p.head];
  await api(...args);
  assert.equal((await api(...args)).replayed, true);
  await assert.rejects(
    api('queue', id(21), id(202), { ...details, availableAt: '2099-01-01' }, p.head),
    /operation conflict/,
  );
  await act(1);
  const template = {
    key: 'bad',
    version: 0,
    kind: 'custom',
    purpose: 'recruiting-contact',
    subject: 'Hello',
    text: 'Hello',
    enabled: true,
  };
  for (const patch of [
    { text: '{{salary}}' },
    { text: '<script>alert(1)</script>' },
    { subject: 'Hello\r\nBCC: other@e.com' },
    { enabled: 'true' },
    { version: 1 },
  ])
    await assert.rejects(
      api('template', null, id(210), { ...template, ...patch }),
      /template|Template|placeholder|subject/,
    );
  const old = (await api('context')).policyHead;
  await api('policy', null, id(211), { enabled: false, outcome: 'success', dailyLimit: 3 }, old);
  await assert.rejects(
    api('policy', null, id(212), { enabled: true, outcome: 'success', dailyLimit: 3 }, old),
    /changed/,
  );
  await act(0, 'anon');
  await assert.rejects(api('context'), /permission/);
});

test('queued previews fail closed on consent, contacts, preferences, holds, access and source changes', async (t) => {
  const h = await fixture(t);
  const { db, act, api, queue, run, preview } = h;
  await queue(220);
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status,date)values('${id(11)}','${id(21)}','recruiting-contact','revoked',now()+interval '1 second');`,
  );
  assert.equal((await run()).suppressed, 1);
  await act(2);
  assert.equal((await preview()).eligible, false);
  await db.exec('reset role');
  await db.exec(
    `update consents set date=now()-interval '1 day';insert into consents(workspace_id,"candidateId",purpose,status,date)values('${id(11)}','${id(21)}','recruiting-contact','granted',now());`,
  );
  await act(2);
  await queue(221);
  await api('preference', id(21), id(222), {
    purpose: 'recruiting-contact',
    optOut: true,
    startHour: 0,
    endHour: 24,
    source: 'Candidate requested email opt out',
  });
  assert.equal((await run()).suppressed, 1);
  await act(2);
  assert.match((await preview()).reason, /opted out/);
  await api('preference', id(21), id(223), {
    purpose: 'recruiting-contact',
    optOut: false,
    startHour: 0,
    endHour: 24,
    source: 'Candidate confirmed email preference',
  });
  await queue(224);
  await db.exec('reset role');
  await db.exec(
    `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"auditedCandidateExports":true}');`,
  );
  await act(1);
  await h.rpc('api_create_subject_request', [
    id(280),
    id(21),
    'restriction',
    'Candidate requested outbound restriction',
    'email',
  ]);
  await h.rpc('api_update_subject_request', [
    id(281),
    id(280),
    1,
    'verify',
    'Verified requester through confirmed email',
  ]);
  await h.rpc('api_update_subject_request', [
    id(282),
    id(280),
    2,
    'start',
    'Reviewed restriction by administrator',
  ]);
  await h.rpc('api_set_subject_outbound_hold', [
    id(283),
    id(280),
    3,
    true,
    'Reviewed candidate restriction evidence',
  ]);
  assert.equal((await run()).suppressed, 1);
  await db.exec('reset role');
  await act(1);
  await h.rpc('api_set_subject_outbound_hold', [
    id(284),
    id(280),
    4,
    false,
    'Reviewed candidate request to release hold',
  ]);
  await act(2);
  await queue(225);
  await db.exec(`update candidates set name='Changed name' where id='${id(21)}'`);
  assert.equal((await run()).suppressed, 1);
  await act(2);
  await queue(226);
  await db.exec('reset role');
  await db.exec(`delete from memberships where user_id='${id(2)}'and workspace_id='${id(11)}'`);
  assert.equal((await run()).suppressed, 1);
  await act(1);
  const inv = await h.rpc('ecod_private.erasure_inventory', [id(11), id(21)]).catch(() => null);
  assert.equal(inv, null, 'private inventory helper remains ungranted');
  await db.exec('reset role');
  const inventory = await h.rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
  assert.equal(inventory.counts.length, 57);
  assert.equal(inventory.counts.find((x) => x.category === 'communicationIntents').count, 5);
});

test('test failures retry transactionally, cancellation is durable and quiet windows defer without attempts', async (t) => {
  const h = await fixture(t);
  const { db, act, api, queue, run } = h;
  const policy = async (n, outcome, enabled = true) => {
    await act(1);
    return api(
      'policy',
      null,
      id(n),
      { enabled, outcome, dailyLimit: 3 },
      (await api('context')).policyHead,
    );
  };
  await policy(230, 'transient');
  await act(2);
  await queue(231);
  assert.equal((await run()).testRecorded, 0);
  await act(2);
  let current = (await api('context', id(21))).rows[0];
  assert.equal(current.status, 'Retrying');
  assert.equal(current.attempts, 1);
  await db.exec('reset role');
  await db.exec(
    `update ecod_comms_private.intents set available_at=now()-interval'1 minute'where id='${id(231)}'`,
  );
  assert.equal((await run()).testRecorded, 1);
  await policy(232, 'permanent');
  await act(2);
  await api('preference', id(21), id(233), {
    purpose: 'recruiting-contact',
    optOut: false,
    startHour: 0,
    endHour: 24,
    source: 'Candidate reconfirmed email preference',
  });
  await queue(234);
  assert.equal((await run()).failed, 1);
  await act(2);
  await assert.rejects(
    api('retry', id(21), id(235), {
      intent: id(234),
      reason: 'Reviewed transient recovery request',
    }),
    /Administrator/,
  );
  await policy(236, 'success');
  await api('retry', id(21), id(237), {
    intent: id(234),
    reason: 'Reviewed test recovery with successful simulation',
  });
  assert.equal((await run()).testRecorded, 1);
  await act(2);
  await api('preference', id(21), id(238), {
    purpose: 'recruiting-contact',
    optOut: false,
    startHour: 0,
    endHour: 24,
    source: 'Candidate confirmed revised preference',
  });
  await queue(239);
  const cancelArgs = [
    'cancel',
    id(21),
    id(240),
    { intent: id(239), reason: 'Recruiter cancelled the reviewed test' },
  ];
  await api(...cancelArgs);
  assert.equal((await api(...cancelArgs)).replayed, true);
  assert.equal((await run()).testRecorded, 0);
  await act(2);
  const hour = (
    await db.query("select extract(hour from clock_timestamp()at time zone'UTC')::integer h")
  ).rows[0].h;
  await api('preference', id(21), id(241), {
    purpose: 'recruiting-contact',
    optOut: false,
    startHour: hour < 23 ? hour + 1 : 0,
    endHour: hour < 23 ? 24 : 1,
    source: 'Candidate supplied UTC contact window',
  });
  await queue(242);
  await run();
  await act(2);
  current = (await api('context', id(21))).rows.find((x) => x.id === id(242));
  assert.equal(current.status, 'Queued');
  assert.equal(current.attempts, 0);
  assert.match(current.reason, /window/);
});

test('old template versions, expired intents and retired contacts suppress without simulated delivery', async (t) => {
  const h = await fixture(t);
  const { db, act, api, queue, run, preview, root, files } = h;
  await db.exec('reset role');
  for (const file of files.filter((f) => f.includes('_stage3_'))) {
    await db.exec(await (await import('node:fs/promises')).readFile(new URL(file, root), 'utf8'));
  }
  await act(2);
  await queue(300);
  await act(1);
  await api('template', null, id(301), {
    key: 'welcome',
    version: 1,
    kind: 'custom',
    purpose: 'recruiting-contact',
    subject: 'Revised {{candidateName}}',
    text: 'Revised test message',
    enabled: true,
  });
  assert.equal((await run()).suppressed, 1);
  await act(2);
  assert.equal((await preview()).eligible, false);
  const p = await api('preview', id(21), null, { template: id(301), context: {} });
  await api(
    'queue',
    id(21),
    id(302),
    { template: id(301), context: {}, availableAt: new Date().toISOString() },
    p.head,
  );
  await db.exec('reset role');
  await db.exec(
    `update ecod_comms_private.intents set expires_at=now()-interval'1 second'where id='${id(302)}'`,
  );
  assert.equal((await run()).suppressed, 1);
  await act(2);
  const p2 = await api('preview', id(21), null, { template: id(301), context: {} });
  await api(
    'queue',
    id(21),
    id(303),
    { template: id(301), context: {}, availableAt: new Date().toISOString() },
    p2.head,
  );
  await h.rpc('api_change_candidate_contact', [
    id(21),
    id(304),
    'retire',
    id(102),
    2,
    { reason: 'Candidate retired this email contact' },
  ]);
  assert.equal((await run()).suppressed, 1);
  await act(2);
  assert.match(
    (await api('preview', id(21), null, { template: id(301), context: {} })).reason,
    /confirmed/,
  );
});

test('application and interview templates require scoped recorded context and invalidate changed schedules', async (t) => {
  const h = await fixture(t);
  const { db, act, api, run } = h;
  await db.exec('reset role');
  await db.exec(
    `insert into demands(id,workspace_id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(400)}','${id(11)}','Engineer','Client',array['SQL'],0,30,100,'Pune','Remote',1,'High',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}');`,
  );
  await act(1);
  const template = {
    key: 'ack',
    version: 0,
    kind: 'application-acknowledgement',
    purpose: 'recruiting-contact',
    subject: 'Application {{demandTitle}}',
    text: 'Thank you {{candidateName}}',
    enabled: true,
  };
  await api('template', null, id(401), template);
  await act(2);
  const choice = await rpcChoice();
  async function rpcChoice() {
    return h.rpc('api_test_communications', [
      'context',
      id(21),
      null,
      null,
      { contextQuery: 'Engineer' },
      0,
    ]);
  }
  assert.equal(choice.demands.length, 1);
  assert.equal(
    (
      await h.rpc('api_test_communications', [
        'context',
        id(21),
        null,
        null,
        { contextQuery: 'Missing title' },
        0,
      ])
    ).demands.length,
    0,
  );
  const ctx = { demand: id(400) };
  assert.equal(
    (await api('preview', id(21), null, { template: id(401), context: ctx })).eligible,
    false,
  );
  await db.exec(
    `insert into considerations(workspace_id,"candidateId","demandId",stage)values('${id(11)}','${id(21)}','${id(400)}','Identified');`,
  );
  const p = await api('preview', id(21), null, { template: id(401), context: ctx });
  assert.equal(p.eligible, true);
  await api(
    'queue',
    id(21),
    id(402),
    { template: id(401), context: ctx, availableAt: new Date().toISOString() },
    p.head,
  );
  assert.equal((await run()).testRecorded, 1);
  await act(1);
  await api('template', null, id(403), {
    ...template,
    key: 'invite',
    kind: 'interview-invite',
    subject: 'Interview {{demandTitle}}',
    text: 'Scheduled {{scheduledAt}}',
  });
  await act(2);
  await db.exec(
    `insert into interviews(id,workspace_id,"candidateId","demandId","scheduledAt")values('${id(404)}','${id(11)}','${id(21)}','${id(400)}',now()+interval'1 day');`,
  );
  const ivCtx = { ...ctx, interview: id(404) };
  const iv = await api('preview', id(21), null, { template: id(403), context: ivCtx });
  assert.equal(iv.eligible, true);
  await api(
    'queue',
    id(21),
    id(405),
    { template: id(403), context: ivCtx, availableAt: new Date().toISOString() },
    iv.head,
  );
  await db.exec(`update interviews set "scheduledAt"=now()+interval'2 days'where id='${id(404)}'`);
  assert.equal((await run()).suppressed, 1);
  await act(2);
  await assert.rejects(
    api('preview', id(21), null, {
      template: id(403),
      context: { demand: id(22), interview: id(404) },
    }),
    /unavailable/,
  );
  await db.exec(`update interviews set status='No-show'where id='${id(404)}'`);
  assert.equal(
    (await api('preview', id(21), null, { template: id(403), context: ivCtx })).eligible,
    false,
  );
});

test('merged opt-outs remain effective and all outbox, segmentation and history pages stay bounded', async (t) => {
  const h = await fixture(t);
  const { db, act, api, preview, rpc } = h;
  await db.exec('reset role');
  await db.exec(
    `insert into candidates(id,workspace_id,name,email)values('${id(23)}','${id(11)}','Retired name','old@e.com');`,
  );
  await act(2);
  await api('preference', id(23), id(420), {
    purpose: 'recruiting-contact',
    optOut: true,
    startHour: 0,
    endHour: 24,
    source: 'Candidate previously opted out of email',
  });
  await (await import('./stage1-api-helpers.js')).reviewedMerge(db, id(21), id(23), id(421));
  assert.match((await preview()).reason, /opted out/);
  await api('preference', id(21), id(422), {
    purpose: 'recruiting-contact',
    optOut: false,
    startHour: 0,
    endHour: 24,
    source: 'Candidate explicitly reconfirmed after identity review',
  });
  assert.equal((await preview()).eligible, true);
  await db.exec('reset role');
  await db.exec(
    `insert into ecod_comms_private.intents(id,workspace_id,candidate_id,template_id,context,source_head,preview,actor,status,available_at,expires_at)select gen_random_uuid(),'${id(11)}','${id(21)}','${id(100)}','{}','old','{}','${id(2)}','Cancelled',now(),now()from generate_series(1,26);insert into candidates(workspace_id,name,email,tags)select '${id(11)}','Segment '||n,'segment'||n||'@e.com',array['stage3']from generate_series(1,26)n;`,
  );
  await act(3);
  const first = await api('context', id(21));
  assert.equal(first.rows.length, 25);
  assert.equal(first.more, true);
  const second = await rpc('api_test_communications', ['context', id(21), null, null, {}, 25]);
  assert.equal(second.rows.length, 1);
  assert.ok(!first.rows.some((r) => r.id === second.rows[0].id));
  const segment = await api('browse', null, null, { tag: 'stage3' });
  assert.equal(segment.rows.length, 25);
  assert.equal(segment.more, true);
  const rest = await rpc('api_test_communications', [
    'browse',
    null,
    null,
    null,
    { tag: 'stage3' },
    25,
  ]);
  assert.equal(rest.rows.length, 1);
  assert.ok(!JSON.stringify(segment).includes('segment1@e.com'));
});
