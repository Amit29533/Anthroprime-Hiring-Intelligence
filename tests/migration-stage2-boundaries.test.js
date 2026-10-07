import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { id } from './stage1-harness.js';
import { journeyFixture, config } from './stage2-harness.js';
import { reviewedMerge } from './stage1-api-helpers.js';
const payload = {
  scores: { technical: 90, communication: 90 },
  evidence: {
    technical: 'Reviewed technical exercise',
    communication: 'Reviewed communication exercise',
  },
};
async function makeReady(h, n = 300) {
  await h.act(2);
  const cycle = (await h.start(n)).cycleId;
  await h.evaluate(cycle, n + 1, 90);
  await h.act(2);
  await h.action('debrief', n + 2, { decision: 'Pass', reason: 'All independent criteria pass' });
  await h.act(1);
  await h.action('decide', n + 3, {
    decision: 'Ready',
    days: 90,
    reason: 'Independent validator reviewed evidence',
  });
  return cycle;
}
test('configuration versions, typed unknowns, corrections and authorization fail closed', async (t) => {
  const h = await journeyFixture(t);
  const { db, act, rpc, context, action, start, today, until, root, files } = h;
  await db.exec('reset role');
  for (const file of files.filter((f) => f.includes('_stage2_')))
    await db.exec(await readFile(new URL(file, root), 'utf8'));
  await act(3);
  await assert.rejects(action('claim', 200, { kind: 'eligibility' }), /Editor/);
  await act(4);
  await assert.rejects(context(), /Demand not found/);
  await act(0, 'anon');
  await assert.rejects(context(), /permission denied/);
  await act(1);
  await assert.rejects(
    db.query('select *from ecod_journey_private.evaluations'),
    /permission denied/,
  );
  await assert.rejects(
    rpc('ecod_journey_private.state', [id(11), id(51), id(21)]),
    /permission denied/,
  );
  for (const bad of [
    { ...config, kit: [{ id: 'technical', label: 'One', weight: 90 }] },
    { ...config, reviewers: 0 },
    { ...config, requirements: [{ id: 'bad', name: 'Unknown' }] },
    {
      ...config,
      requirements: [{ id: 'bad', kind: 'experience', name: 'Experience', minimum: '3' }],
    },
    {
      ...config,
      requirements: [
        {
          id: 'bad',
          kind: 'compensation',
          name: 'Budget',
          minimum: 20,
          currency: 'inr',
          basis: 'Annual',
        },
      ],
    },
    { ...config, requireReadyForSubmission: 'true' },
  ])
    await assert.rejects(action('configure', 201, bad, null));
  await act(2);
  const stale = await context();
  await action('claim', 202, {
    kind: 'eligibility',
    name: 'Work authorization',
    value: false,
    source: 'Corrected document review',
    observed: today,
    validUntil: until,
    confirmed: false,
    supersedes: id(102),
  });
  assert.equal((await context()).checks.find((c) => c.id === 'eligibility').status, 'unknown');
  await assert.rejects(
    rpc('api_demand_journey', [
      'claim',
      id(51),
      id(21),
      id(203),
      stale.head,
      { kind: 'eligibility' },
      0,
    ]),
    /changed/,
  );
  await action('claim', 204, {
    kind: 'eligibility',
    name: 'Work authorization',
    value: false,
    source: 'Reviewed negative eligibility',
    observed: today,
    validUntil: until,
    confirmed: true,
    supersedes: id(202),
  });
  assert.equal((await context()).checks.find((c) => c.id === 'eligibility').status, 'failed');
  const cycle = (await start(205)).cycleId;
  await act(1);
  await action('configure', 206, { ...config, threshold: 85 }, null);
  await act(5);
  await assert.rejects(rpc('api_assigned_demand_journey', [cycle]), /Requirements changed/);
  await act(2);
  await action('debrief', 207, {
    decision: 'Cancelled',
    reason: 'Requirements changed; new kit review needed',
  });
  assert.ok((await start(208)).cycleId);
});
test('blind scorecards require independent assigned actors, sealed evidence and current grants', async (t) => {
  const h = await journeyFixture(t);
  const { db, act, rpc, action, start, assignment } = h;
  await db.exec(
    `reset role;insert into auth.users values('${id(7)}','second@e.com');insert into memberships values('${id(7)}','${id(11)}','assessor');`,
  );
  await act(1);
  const second = (
    await rpc('api_assignments_admin', [
      'grant',
      id(220),
      {
        member: id(7),
        kind: 'evaluation',
        target: id(21),
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
      0,
    ])
  ).assignment;
  await action('configure', 221, { ...config, reviewers: 2 }, null);
  await act(2);
  const cycle = (
    await action('start', 222, {
      members: [
        { member: id(5), assignment: assignment.id },
        { member: id(7), assignment: second.id },
      ],
    })
  ).cycleId;
  await act(5);
  const c = await rpc('api_assigned_demand_journey', [cycle]);
  for (const p of [
    { ...payload, actor: id(1) },
    { ...payload, scores: { technical: 90 } },
    { ...payload, evidence: { technical: 'Short', communication: 'Reviewed evidence' } },
    { ...payload, scores: { technical: 101, communication: 90 } },
  ])
    await assert.rejects(rpc('api_assigned_demand_journey', [cycle, id(223), c.head, p]));
  await rpc('api_assigned_demand_journey', [cycle, id(223), c.head, payload]);
  assert.equal(
    (await rpc('api_assigned_demand_journey', [cycle, id(223), c.head, payload])).replayed,
    true,
  );
  await assert.rejects(
    rpc('api_assigned_demand_journey', [
      cycle,
      id(223),
      c.head,
      { ...payload, scores: { technical: 95, communication: 90 } },
    ]),
    /conflict/,
  );
  await act(7);
  const blind = await rpc('api_assigned_demand_journey', [cycle]);
  assert.equal(blind.ownEvaluation, null);
  assert.equal(blind.evaluations, undefined);
  assert.equal(blind.candidate.email, undefined);
  await act(2);
  await assert.rejects(
    action('debrief', 224, { decision: 'Pass', reason: 'Attempted premature debrief' }),
    /every independent/,
  );
  await act(1);
  await rpc('api_assignments_admin', ['revoke', id(225), { id: second.id, version: 1 }, 0]);
  await act(7);
  await assert.rejects(rpc('api_assigned_demand_journey', [cycle]), /unavailable/);
  assert.equal((await rpc('api_assigned_demand_journey')).rows.length, 0);
  await act(2);
  await action('debrief', 226, {
    decision: 'Cancelled',
    reason: 'Evaluator access revoked; restart assessment',
  });
  assert.ok(start);
});
test('currency constraints retain unknown/failure distinctions and hide private compensation from staff', async (t) => {
  const h = await journeyFixture(t);
  const { act, rpc, context, action, today } = h;
  await act(1);
  const pay = {
    id: 'budget',
    kind: 'compensation',
    name: 'Expected pay cap',
    minimum: 1500000,
    currency: 'INR',
    basis: 'Annual',
  };
  await action('configure', 240, { ...config, requirements: [...config.requirements, pay] }, null);
  assert.equal((await context()).checks.find((c) => c.id === 'budget').status, 'unknown');
  let facts = await rpc('api_candidate_facts', [id(21), 'compensation']);
  await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(241),
    facts.head,
    {
      kind: 'expected',
      amount: 1200000,
      currency: 'INR',
      basis: 'Annual',
      components: {},
      source: 'Pay statement reviewed',
      observed: today,
    },
    true,
    true,
    null,
  ]);
  assert.equal((await context()).checks.find((c) => c.id === 'budget').status, 'satisfied');
  await act(2);
  const staff = await context();
  assert.ok(!staff.configuration.body.requirements.some((r) => r.kind === 'compensation'));
  assert.equal(staff.checks.find((c) => c.id === 'budget').status, 'unknown');
  assert.equal(staff.checks.find((c) => c.id === 'budget').name, 'Private compensation review');
  await act(1);
  await action(
    'configure',
    242,
    { ...config, requirements: [...config.requirements, { ...pay, currency: 'USD' }] },
    null,
  );
  assert.equal((await context()).checks.find((c) => c.id === 'budget').status, 'unknown');
  await action(
    'configure',
    243,
    { ...config, requirements: [...config.requirements, { ...pay, minimum: 1000000 }] },
    null,
  );
  assert.equal((await context()).checks.find((c) => c.id === 'budget').status, 'failed');
});
test('expiry, invalidated sources, merge preservation, reports, privacy and submission gates use current validation', async (t) => {
  const h = await journeyFixture(t);
  const { db, act, rpc, context, action, until } = h;
  await act(2);
  await assert.rejects(
    db.query('insert into submissions(workspace_id,"candidateId","demandId")values($1,$2,$3)', [
      id(11),
      id(21),
      id(51),
    ]),
    /validated readiness/,
  );
  await makeReady(h);
  const ready = await context();
  assert.equal(ready.validUntil, until, 'fact expiry caps requested validity');
  await act(2);
  await db.query(
    'insert into submissions(id,workspace_id,"candidateId","demandId")values($1,$2,$3,$4)',
    [id(320), id(11), id(21), id(51)],
  );
  const rows = await rpc('api_demand_journey', [
    'shortlist',
    id(51),
    null,
    null,
    null,
    { readyOnly: true },
    0,
  ]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].validatedReady, true);
  const report = await rpc('api_demand_journey', ['report', id(51)]);
  assert.equal(report.validatedReady, 1);
  assert.equal(report.cohorts.readyDecisionEvents, 1);
  assert.equal(report.cohorts.sealedScorecards, 1);
  await db.exec('reset role');
  const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
  assert.equal(inv.counts.length, 57);
  assert.equal(inv.counts.find((r) => r.category === 'journeyClaims').count, 2);
  assert.equal(inv.counts.find((r) => r.category === 'journeyDecisions').count, 1);
  await db.query(
    'update ecod_journey_private.decisions set valid_until=current_date-1 where id=$1',
    [id(303)],
  );
  await act(2);
  assert.equal((await context()).state, 'Expired');
  await assert.rejects(
    db.query('insert into submissions(workspace_id,"candidateId","demandId")values($1,$2,$3)', [
      id(11),
      id(21),
      id(51),
    ]),
    /expired/,
  );
  await act(1);
  await action('decide', 321, {
    decision: 'Revoked',
    days: 1,
    reason: 'Validator revoked this decision',
  });
  assert.equal((await context()).state, 'Revoked');
  await db.exec(
    `reset role;insert into candidates(id,workspace_id,name,email)values('${id(23)}','${id(11)}','Old identity','old@e.com');`,
  );
  await act(2);
  await reviewedMerge(db, id(21), id(23), id(322));
  assert.equal((await context()).state, 'Revoked');
  assert.ok((await context()).history.some((r) => r.id === id(303)));
});

test('aggregate report export requires current reviewed counts, audited receipts, editor scope and bounded rate', async (t) => {
  const h = await journeyFixture(t);
  const { db, rpc, act } = h;
  await act(3);
  const preview = await rpc('api_demand_readiness_report', [id(51)]);
  await assert.rejects(
    rpc('api_export_demand_readiness_report', [id(51), id(400), preview.head]),
    /Editor/,
  );
  await act(2);
  const receipt = await rpc('api_export_demand_readiness_report', [id(51), id(400), preview.head]);
  assert.equal(receipt.snapshot.validatedReady, 0);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    (await rpc('api_export_demand_readiness_report', [id(51), id(400), preview.head])).replayed,
    true,
  );
  await assert.rejects(
    rpc('api_export_demand_readiness_report', [id(51), id(400), 'b'.repeat(32)]),
    /conflict/,
  );
  await makeReady(h, 410);
  await act(2);
  await assert.rejects(
    rpc('api_export_demand_readiness_report', [id(51), id(420), preview.head]),
    /counts changed/,
  );
  const fresh = await rpc('api_demand_readiness_report', [id(51)]);
  for (let n = 421; n <= 425; n++)
    await rpc('api_export_demand_readiness_report', [id(51), id(n), fresh.head]);
  await assert.rejects(
    rpc('api_export_demand_readiness_report', [id(51), id(426), fresh.head]),
    /limit reached/,
  );
  await act(4);
  await assert.rejects(rpc('api_demand_readiness_report', [id(51)]), /Demand not found/);
  await db.exec('reset role');
  const count = (
    await db.query(
      `select count(*)::integer n from "auditEvents" where action='server_export' and "entityType"='demands'`,
    )
  ).rows[0].n;
  assert.equal(count, 6);
});

test('client-approved demand readiness is withdrawn when validation expires without breaking the portal', async (t) => {
  const h = await journeyFixture(t);
  const { db, rpc, act } = h;
  await makeReady(h, 500);
  await db.exec('reset role');
  await db.exec(`insert into clients(id,workspace_id,name)values('${id(550)}','${id(11)}','Client');
    update demands set "clientId"='${id(550)}',"approvalStatus"='Approved' where id='${id(51)}';`);
  // Demand changes invalidate readiness; explicitly reassess the amended demand.
  await makeReady(h, 510);
  await act(2);
  await db.exec(`insert into submissions(id,workspace_id,"candidateId","demandId")values('${id(551)}','${id(11)}','${id(21)}','${id(51)}');
    insert into consents(id,workspace_id,"candidateId",purpose,status,date)values('${id(552)}','${id(11)}','${id(21)}','profile-sharing','granted',now());`);
  await act(1);
  const change = (kind, target, details, op) =>
    rpc('api_change_client_review', [id(550), id(op), kind, target, details]);
  await change('grant', null, { userId: id(6), demandId: id(51) }, 553);
  const pack = await change('prepare', id(551), {}, 554);
  await change('approve', pack.id, { reason: 'Reviewed current validated demand evidence' }, 555);
  await act(6);
  let portal = await rpc('api_client_portal', [id(550), 0, 0]);
  assert.equal(portal.packs.length, 1);
  assert.ok(JSON.stringify(portal.packs).includes('demandReadiness'));
  assert.ok(!JSON.stringify(portal.packs).includes('Independent validator reviewed evidence'));
  await db.exec('reset role');
  await db.exec(
    `update ecod_journey_private.decisions set valid_until=current_date-1 where id='${id(513)}';`,
  );
  await act(6);
  portal = await rpc('api_client_portal', [id(550), 0, 0]);
  assert.equal(portal.packs.length, 0);
  await assert.rejects(
    rpc('api_client_respond', [
      pack.id,
      id(556),
      'comment',
      null,
      null,
      'Attempt after expiry',
      null,
    ]),
    /changed or revoked/,
  );
});

test('criterion floors and dated language, certification and skill evidence distinguish failed from unknown', async (t) => {
  const h = await journeyFixture(t);
  const { db, act, action, context, start, rpc, today, until } = h;
  await act(1);
  await action(
    'configure',
    600,
    {
      ...config,
      requirements: [
        ...config.requirements,
        { id: 'language', kind: 'language', name: 'English', minimum: 'Fluent', recencyDays: 30 },
        { id: 'certificate', kind: 'certification', name: 'SQL certification' },
        { id: 'sql', kind: 'skill', name: 'SQL', minimum: 3, level: 'Advanced', recencyDays: 365 },
      ],
      kit: [
        { id: 'technical', label: 'Technical', weight: 70 },
        { id: 'communication', label: 'Communication', weight: 30, minScore: 80 },
      ],
    },
    null,
  );
  await act(2);
  await action('claim', 601, {
    kind: 'language',
    name: 'English',
    value: 'Working',
    source: 'Recorded candidate language review',
    observed: today,
    validUntil: until,
    confirmed: true,
  });
  await action('claim', 602, {
    kind: 'certification',
    name: 'SQL certification',
    value: true,
    source: 'Reviewed certification issuer evidence',
    observed: today,
    validUntil: until,
    confirmed: true,
  });
  for (const observed of [null, '2099-01-01'])
    await assert.rejects(
      action('claim', 603, {
        kind: 'language',
        name: 'English',
        value: 'Fluent',
        source: 'Recorded candidate language review',
        observed,
        validUntil: until,
        confirmed: true,
      }),
      /dates/,
    );
  let checks = (await context()).checks;
  assert.equal(checks.find((r) => r.id === 'language').status, 'failed');
  assert.equal(checks.find((r) => r.id === 'certificate').status, 'satisfied');
  assert.equal(checks.find((r) => r.id === 'sql').status, 'unknown');
  await db.exec('reset role');
  await db.exec(`insert into skills(id,workspace_id,name)values('${id(604)}','${id(11)}','SQL');
    insert into "personSkills"(id,workspace_id,"candidateId","skillId")values('${id(605)}','${id(11)}','${id(21)}','${id(604)}');
    insert into "skillEvidence"(id,workspace_id,"personSkillId","evidenceType",date,proficiency,years,"lastUsed")values('${id(606)}','${id(11)}','${id(605)}','Recruiter-verified',now()-interval '1 day','Advanced',5,current_date),('${id(607)}','${id(11)}','${id(605)}','Self-declared',now(),'Expert',10,current_date);`);
  await act(2);
  assert.equal((await context()).checks.find((r) => r.id === 'sql').status, 'satisfied');
  await db.exec('reset role');
  await db.exec(
    `insert into "skillEvidence"(id,workspace_id,"personSkillId","evidenceType",date,proficiency,years,"lastUsed")values('${id(608)}','${id(11)}','${id(605)}','Recruiter-verified',now(),'Working',1,current_date);`,
  );
  await act(2);
  assert.equal(
    (await context()).checks.find((r) => r.id === 'sql').status,
    'failed',
    'latest validated evidence wins over older passing evidence',
  );
  const cycle = (await start(609)).cycleId;
  await act(5);
  const assigned = await rpc('api_assigned_demand_journey', [cycle]);
  await rpc('api_assigned_demand_journey', [
    cycle,
    id(610),
    assigned.head,
    { scores: { technical: 100, communication: 60 }, evidence: payload.evidence },
  ]);
  await act(2);
  assert.equal(
    (await context()).evaluations[0].passed,
    false,
    'weighted 88 cannot hide a failed criterion',
  );
  await assert.rejects(
    action('debrief', 611, {
      decision: 'Pass',
      reason: 'Weighted score passes but one criterion fails',
    }),
    /failed|passing|pass|threshold/,
  );
});

test('reviewed merges retain open gap obligations and frozen assessment histories', async (t) => {
  const h = await journeyFixture(t);
  const { db, act, action, context } = h;
  await makeReady(h, 700);
  await db.exec('reset role');
  await db.exec(
    `insert into candidates(id,workspace_id,name,email)values('${id(23)}','${id(11)}','Old identity','old@e.com');`,
  );
  await act(2);
  await action(
    'gap_plan',
    710,
    {
      objective: 'Close the retained identity skill gap',
      evidenceRequired: 'Provide reviewed completion exercise',
      owner: id(2),
      due: h.until,
      readyEstimate: h.until,
    },
    id(23),
  );
  await reviewedMerge(db, id(21), id(23), id(711));
  let current = await context();
  assert.equal(current.state, 'Needs review');
  assert.equal(current.gaps[0].plan_id, id(710));
  assert.equal(current.cycleHistory[0].configuration.version, 1);
  assert.equal(current.cycleHistory[0].evaluations[0].score, 90);
  await act(1);
  await assert.rejects(
    action('decide', 712, {
      decision: 'Ready',
      days: 30,
      reason: 'Attempt to bypass old identity gap',
    }),
    /every gap/,
  );
  await act(2);
  await action('gap_complete', 713, {
    plan: id(710),
    evidence: 'Reviewed retained identity completion exercise',
  });
  await act(1);
  await action('gap_validate', 714, {
    plan: id(710),
    evidence: 'Independent completion evidence validation',
  });
  await assert.rejects(
    action('decide', 715, {
      decision: 'Ready',
      days: 30,
      reason: 'Attempt before independent reassessment',
    }),
    /Reassess/,
  );
  await makeReady(h, 720);
  current = await context();
  assert.equal(current.validatedReady, true);
  assert.equal(current.cycleHistory.length, 2);
  assert.equal(current.gaps[0].action, 'Validated');
});
