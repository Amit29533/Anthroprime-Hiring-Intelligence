import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { id, stage1Database } from './stage1-harness.js';
import { reviewedMerge } from './stage1-api-helpers.js';
const reason = 'Reviewed candidate assertion and account ownership';
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
async function fixture(t) {
  const h = await stage1Database(t),
    { db, act, rpc } = h;
  await db.exec(`insert into auth.users values('${id(7)}','one@e.com'),('${id(8)}','client@e.com'),('${id(9)}','unrelated@e.com');
 insert into clients(id,workspace_id,name)values('${id(31)}','${id(11)}','Client');
 insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values
 ('${id(41)}','${id(11)}','Engineer','Client','${id(31)}',array['Java'],0,90,100,'Remote','Remote',1,'Medium',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}'),
 ('${id(42)}','${id(11)}','Other role','Client','${id(31)}',array['Java'],0,90,100,'Remote','Remote',1,'Medium',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}');
 insert into consents(workspace_id,"candidateId",purpose,status)values('${id(11)}','${id(21)}','recruiting-contact','granted');`);
  const staff = (
    action,
    operation = null,
    payload = {},
    head = null,
    entity = null,
    candidate = id(21),
    client = null,
    offset = 0,
  ) =>
    rpc('api_feedback_staff', [
      action,
      candidate,
      client,
      entity,
      operation,
      head,
      payload,
      offset,
    ]);
  const portal = (
    action,
    operation = null,
    payload = {},
    head = null,
    entity = null,
    candidate = id(21),
    client = null,
    offset = 0,
  ) =>
    rpc('api_feedback_portal', [
      action,
      candidate,
      client,
      entity,
      operation,
      head,
      payload,
      offset,
    ]);
  await act(1);
  await staff('grant', id(101), { user: id(7), expiresAt: days(29), reason });
  const propose = async (fields = { title: 'New title' }, operation = id(110)) => {
    await act(7);
    const c = await portal('context');
    return portal('propose', operation, { fields, reason }, c.head);
  };
  const review = async (operation = id(111), decision = 'Accepted', proposalId = id(110)) => {
    await act(2);
    const c = await staff('context');
    const p = c.proposals.find((p) => p.id === proposalId);
    return staff('review', operation, { decision, reason }, p.reviewHead, proposalId);
  };
  const invite = async (kind = 'freshness', operation = id(120), extra = {}) => {
    await act(2);
    const payload = {
      recipient: id(7),
      kind,
      question: 'Please review your next career preferences.',
      expiresAt: days(7),
      reason,
      ...extra,
    };
    const p = await staff('preview', null, payload);
    return staff('invite', operation, payload, p.head);
  };
  return { ...h, staff, portal, propose, review, invite };
}
test('explicit candidate grants replace ambiguous email matching and expire or revoke immediately', async (t) => {
  const { db, act, rpc, staff, portal } = await fixture(t);
  await act(7);
  const accounts = await portal('accounts');
  assert.equal(accounts.candidates[0].id, id(21));
  const overview = await rpc('api_portal_overview');
  assert.equal(overview.profile.anthroId, accounts.candidates[0].anthroId);
  const c = await portal('context');
  for (const k of ['current', 'expected', 'email', 'phone', 'verified', 'owner', 'notes'])
    assert.equal(k in c.fields, false);
  await assert.rejects(rpc('api_portal_update', [{ notice: 1 }]), /reviewed profile proposal/);
  await act(9);
  assert.equal((await portal('accounts')).candidates.length, 0);
  await assert.rejects(portal('context'), /access unavailable/);
  await act(4);
  await assert.rejects(staff('context'), /Candidate unavailable/);
  await act(3);
  await assert.rejects(
    staff('grant', id(112), { user: id(9), expiresAt: days(3), reason }),
    /Editor/,
  );
  await act(2);
  await assert.rejects(
    staff('grant', id(112), { user: id(9), expiresAt: days(3), reason }),
    /Administrator/,
  );
  await assert.rejects(db.query('select *from ecod_feedback_private.proposals'), /permission/);
  await assert.rejects(rpc('ecod_feedback_private.fields', [id(11), id(21)]), /permission/);
  await act(1);
  await staff('revoke', id(113), { reason }, null, id(101));
  await act(7);
  await assert.rejects(portal('context'), /access unavailable/);
  await act(1);
  await staff('grant', id(114), { user: id(7), expiresAt: days(3), reason });
  await db.exec('reset role');
  await db.exec(
    `update ecod_feedback_private.grants set expires_at=now()-interval'1 minute'where id='${id(114)}';`,
  );
  await act(7);
  await assert.rejects(portal('context'), /access unavailable/);
  await act(0, 'anon');
  await assert.rejects(portal('accounts'), /permission/);
});
test('candidate assertions stay pending, accept independently with exact replay and preserve verification', async (t) => {
  const { db, act, staff, portal, propose, review, rpc } = await fixture(t);
  const result = await propose({
    title: 'New title',
    notice: 0,
    earliestStart: null,
    summary: 'Candidate authored summary',
  });
  assert.equal(result.status, 'Pending');
  await db.exec('reset role');
  let row = (await db.query(`select title,notice,verified from candidates where id='${id(21)}'`))
    .rows[0];
  assert.notEqual(row.title, 'New title');
  const verified = row.verified;
  await act(7);
  const c = await portal('context');
  assert.equal(c.proposals[0].status, 'Pending');
  await act(2);
  const ctx = await staff('context');
  const args = [
    'review',
    id(111),
    { decision: 'Accepted', reason },
    ctx.proposals[0].reviewHead,
    id(110),
  ];
  const accepted = await staff(...args);
  assert.equal(accepted.status, 'Accepted');
  assert.equal((await staff(...args)).replayed, true);
  await assert.rejects(
    staff(
      'review',
      id(111),
      { decision: 'Rejected', reason },
      ctx.proposals[0].reviewHead,
      id(110),
    ),
    /operation conflict/,
  );
  await db.exec('reset role');
  row = (await db.query(`select title,notice,verified from candidates where id='${id(21)}'`))
    .rows[0];
  assert.equal(row.title, 'New title');
  assert.equal(row.notice, 0);
  assert.deepEqual(row.verified, verified);
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from "availabilityHistory"where "candidateId"='${id(21)}'`,
      )
    ).rows[0].n,
    1,
  );
  await propose({ location: 'City' }, id(115));
  await db.exec('reset role');
  await db.exec(`update candidates set title='Concurrent change'where id='${id(21)}'`);
  await assert.rejects(review(id(116), 'Accepted', id(115)), /Profile changed/);
  await review(id(117), 'Rejected', id(115));
  await act(7);
  const ownContext = await portal('context');
  const payload = { fields: { name: 'Candidate' }, reason };
  const op = id(118);
  await portal('propose', op, payload, ownContext.head);
  assert.equal((await portal('propose', op, payload, ownContext.head)).replayed, true);
  await assert.rejects(
    portal('propose', op, { fields: { name: 'Other' }, reason }, ownContext.head),
    /operation conflict/,
  );
  await portal('withdraw', id(119), {}, null, op);
  assert.equal((await portal('context')).proposals.find((p) => p.id === op).status, 'Withdrawn');
  await act(2);
  assert.ok(
    (await rpc('api_feedback_queue', ['proposals', 0])).rows.some(
      (r) => r.candidateId === id(21),
    ) === false,
  );
});
test('proposals reject forbidden, malformed, stale, oversized and excessive inputs at the database', async (t) => {
  const { db, act, portal, staff } = await fixture(t);
  await act(7);
  const ctx = await portal('context');
  for (const fields of [
    { current: 100 },
    { email: 'someone@e.com' },
    { verified: '2026-10-07' },
    { notice: 1.5 },
    { notice: 366 },
    { experience: -1 },
    { earliestStart: '2026-02-30' },
    { mode: 'Unknown' },
    { name: '' },
    { summary: 'x'.repeat(10001) },
    { experience: '10' },
    { relevantExperience: 99, experience: 1 },
  ])
    await assert.rejects(portal('propose', crypto.randomUUID(), { fields, reason }, ctx.head));
  await assert.rejects(
    portal('propose', id(151), { fields: { title: 'Title' }, reason }, 'bad'),
    /Profile changed/,
  );
  for (let i = 0; i < 5; i++)
    await portal('propose', id(160 + i), { fields: { title: `Title ${i}` }, reason }, ctx.head);
  await assert.rejects(
    portal('propose', id(165), { fields: { title: 'Sixth' }, reason }, ctx.head),
    /limit/,
  );
  await db.exec('reset role');
  await db.exec(`insert into memberships values('${id(7)}','${id(11)}','recruiter');`);
  await act(7);
  const p = (await staff('context')).proposals[0];
  await assert.rejects(
    staff('review', id(166), { decision: 'Accepted', reason }, p.reviewHead, p.id),
    /Independent/,
  );
});
test('scoped invitations freeze source, return authenticated manual links, replay and record one response', async (t) => {
  const { db, act, rpc, staff, portal, invite } = await fixture(t);
  const invitation = await invite();
  assert.equal(invitation.path, `/portal.html#request=${id(120)}`);
  await act(7);
  const page = await portal('context'),
    p = page.prompts[0];
  assert.equal(p.state, 'Open');
  assert.equal(p.question, 'Please review your next career preferences.');
  await act(9);
  await assert.rejects(
    portal('respond', id(121), { answer: 'Interested', comment: 'Ready to discuss' }, p.head, p.id),
    /access unavailable/,
  );
  await act(7);
  const args = [
    'respond',
    id(121),
    { answer: 'Interested', comment: 'Ready to discuss' },
    p.head,
    p.id,
  ];
  await portal(...args);
  assert.equal((await portal(...args)).replayed, true);
  await assert.rejects(
    portal('respond', id(122), { answer: 'Interested', comment: 'Again' }, p.head, p.id),
    /Open invitation/,
  );
  await act(2);
  const context = await staff('context');
  assert.equal(context.responses[0].disposition, 'Pending');
  const queue = await rpc('api_feedback_queue', ['responses', 0]);
  assert.equal(queue.rows[0].candidateId, id(21));
  assert.equal('body' in queue.rows[0], false);
  const response = context.responses[0];
  await staff(
    'triage',
    id(123),
    { decision: 'Actioned', reason },
    response.reviewHead,
    response.id,
  );
  assert.equal((await staff('context')).responses[0].disposition, 'Actioned');
  await invite('survey', id(124));
  await act(7);
  const survey = (await portal('context')).prompts.find((x) => x.id === id(124));
  await assert.rejects(
    portal('respond', id(125), { rating: 6, comment: 'Invalid rating' }, survey.head, survey.id),
    /rating/,
  );
  await portal(
    'respond',
    id(126),
    { rating: 5, comment: '  Helpful recruitment experience  ' },
    survey.head,
    survey.id,
  );
  await act(2);
  assert.equal((await staff('context')).surveySummary.averageRating, 5);
  assert.equal(
    (await staff('context')).responses.find((r) => r.prompt_id === id(124)).body.comment,
    'Helpful recruitment experience',
  );
  await invite('freshness', id(127));
  await db.exec(`update candidates set location='Changed context'where id='${id(21)}'`);
  await act(7);
  const stale = (await portal('context')).prompts.find((x) => x.id === id(127));
  await assert.rejects(
    portal('respond', id(128), { answer: 'No change', comment: 'Unchanged' }, stale.head, stale.id),
    /source changed/,
  );
  await act(2);
  await staff('cancel', id(129), { reason }, null, id(127));
  await db.exec('reset role');
  await db.exec(
    `update ecod_feedback_private.prompts set expires_at=now()-interval'1 minute',status='Open'where id='${id(127)}';`,
  );
  await act(7);
  assert.equal((await portal('context')).prompts.find((x) => x.id === id(127)).state, 'Expired');
  await act(2);
  const frozen = {
    recipient: id(7),
    kind: 'freshness',
    question: 'Review the next profile update.',
    expiresAt: days(3),
    reason,
  };
  const preview = await staff('preview', null, frozen);
  await staff('invite', id(130), frozen, preview.head);
  await db.exec(`update candidates set title='Later source'where id='${id(21)}'`);
  assert.equal(
    (await staff('invite', id(130), frozen, preview.head)).replayed,
    true,
    'original issuance replays even after later source changes',
  );
  await staff('cancel', id(131), { reason }, null, id(130));
  await invite('freshness', id(132));
  await db.exec('reset role');
  await db.exec(`delete from memberships where user_id='${id(2)}'`);
  await act(7);
  const removed = (await portal('context')).prompts.find((p) => p.id === id(132));
  assert.equal(removed.state, 'Suppressed or stale');
  await assert.rejects(
    portal(
      'respond',
      id(133),
      { answer: 'No change', comment: 'Response after issuer lost access' },
      removed.head,
      removed.id,
    ),
    /issuing reviewer changed/,
  );
});
test('candidate opt-outs take effect in the Stage 3 test source without silently granting consent', async (t) => {
  const { db, act, portal, staff, rpc } = await fixture(t);
  await act(1);
  await rpc('api_test_communications', [
    'template',
    null,
    id(180),
    null,
    {
      key: 'survey',
      version: 0,
      kind: 'custom',
      purpose: 'recruiting-contact',
      subject: 'Feedback',
      text: 'Please reply',
      enabled: true,
    },
    0,
  ]);
  await act(2);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(181),
    'add',
    id(182),
    0,
    { kind: 'email', value: 'one@e.com', source: 'Candidate supplied email' },
  ]);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(183),
    'verify',
    id(182),
    1,
    { reason: 'Candidate confirmed ownership' },
  ]);
  const source = () =>
    rpc('api_test_communications', [
      'preview',
      id(21),
      null,
      null,
      { template: id(180), context: {} },
      0,
    ]);
  assert.equal((await source()).eligible, true);
  await act(7);
  const args = [
    'preference',
    id(184),
    { purpose: 'recruiting-contact', optOut: true, windowStart: 9, windowEnd: 18 },
  ];
  assert.equal((await portal(...args)).consentGranted, false);
  assert.equal((await portal(...args)).replayed, true);
  await act(2);
  assert.equal((await source()).eligible, false);
  await assert.rejects(
    staff('preview', null, {
      recipient: id(7),
      kind: 'freshness',
      question: 'Check your profile preferences.',
      expiresAt: days(3),
      reason,
    }),
    /suppress/,
  );
  await act(7);
  await assert.rejects(
    portal('preference', id(185), {
      purpose: 'recruiting-contact',
      optOut: false,
      windowStart: 1.2,
      windowEnd: 12,
    }),
    /Invalid/,
  );
  await portal('preference', id(186), {
    purpose: 'recruiting-contact',
    optOut: false,
    windowStart: 0,
    windowEnd: 24,
  });
  await db.exec('reset role');
  await db.exec(`update consents set status='revoked'where "candidateId"='${id(21)}'`);
  await act(2);
  assert.equal((await source()).eligible, false);
});
test('client surveys preserve demand-scoped memberships and do not expose candidate profiles', async (t) => {
  const { act, staff, portal, rpc } = await fixture(t);
  await act(1);
  await rpc('api_change_client_review', [
    id(31),
    id(200),
    'grant',
    null,
    { userId: id(8), demandId: id(41) },
  ]);
  const payload = {
    recipient: id(8),
    kind: 'survey',
    question: 'How was your recruitment experience?',
    demand: id(41),
    expiresAt: days(7),
    reason,
  };
  const scoped = (action, op = null, data = {}, head = null, entity = null) =>
    staff(action, op, data, head, entity, null, id(31));
  const respond = (action, op = null, data = {}, head = null, entity = null) =>
    portal(action, op, data, head, entity, null, id(31));
  await act(2);
  const preview = await scoped('preview', null, payload);
  await scoped('invite', id(201), payload, preview.head);
  await assert.rejects(
    scoped('preview', null, { ...payload, demand: id(42) }),
    /scoped client access/,
  );
  await assert.rejects(
    scoped('preview', null, { ...payload, demand: null }),
    /scoped client access/,
  );
  await act(8);
  const page = await respond('context');
  assert.equal(page.fields, null);
  assert.equal(page.prompts.length, 1);
  assert.equal('candidateName' in page.prompts[0], false);
  await respond(
    'respond',
    id(202),
    { rating: 4, comment: 'Good demand handling' },
    page.prompts[0].head,
    id(201),
  );
  await act(2);
  assert.equal((await scoped('context')).surveySummary.responses, 1);
  await act(8);
  assert.equal((await respond('open', null, {}, null, id(201))).clientId, id(31));
  await act(1);
  const members = (await rpc('api_client_review', [id(31), 0])).members;
  await rpc('api_change_client_review', [id(31), id(203), 'remove', members[0].id, {}]);
  await act(8);
  await assert.rejects(respond('context'), /access unavailable/);
  await assert.rejects(respond('open', null, {}, null, id(201)), /access unavailable/);
});
test('redeployment needs a scoped ending placement, and held or retired proposals fail closed', async (t) => {
  const { db, act, rpc, staff, portal, invite, propose, review } = await fixture(t);
  await assert.rejects(invite('redeployment', id(220), { demand: id(41) }), /placement ending/);
  await db.exec(
    `insert into placements(id,workspace_id,"candidateId","demandId","clientId",status,"startDate","endDate")values('${id(221)}','${id(11)}','${id(21)}','${id(41)}','${id(31)}','Active',current_date-60,current_date+20);`,
  );
  await invite('redeployment', id(220), { demand: id(41) });
  assert.equal((await rpc('api_feedback_queue', ['redeployment', 0])).rows[0].candidateId, id(21));
  await propose({ title: 'Held assertion' }, id(222));
  await db.exec('reset role');
  await db.exec(
    `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"auditedCandidateExports":true}');`,
  );
  await act(1);
  await rpc('api_create_subject_request', [
    id(223),
    id(21),
    'restriction',
    'Candidate requested a recruiting processing hold',
    'portal',
  ]);
  await rpc('api_update_subject_request', [
    id(231),
    id(223),
    1,
    'verify',
    'Verified account and candidate ownership evidence',
  ]);
  await rpc('api_update_subject_request', [id(232), id(223), 2, 'start', reason]);
  await rpc('api_set_subject_outbound_hold', [
    id(233),
    id(223),
    3,
    true,
    'Reviewed candidate request to hold processing',
  ]);
  await assert.rejects(review(id(224), 'Accepted', id(222)), /held/);
  await act(7);
  await assert.rejects(
    portal(
      'propose',
      id(225),
      { fields: { title: 'Held' }, reason },
      (await portal('context')).head,
    ),
    /paused/,
  );
  await portal('preference', id(226), {
    purpose: 'marketing',
    optOut: true,
    windowStart: 0,
    windowEnd: 24,
  });
  await act(1);
  await rpc('api_set_subject_outbound_hold', [
    id(234),
    id(223),
    4,
    false,
    'Reviewed candidate request to release processing hold',
  ]);
  await db.exec(
    `insert into candidates(id,workspace_id,name,email)values('${id(227)}','${id(11)}','Survivor','new@e.com')`,
  );
  await reviewedMerge(db, id(227), id(21), id(228));
  await act(7);
  await assert.rejects(portal('context'), /access unavailable/);
  await act(2);
  await assert.rejects(
    staff('review', id(229), { decision: 'Accepted', reason }, 'bad', id(222), id(227)),
    /review changed/,
  );
  const context = await staff('context', null, {}, null, null, id(227));
  assert.ok(context.proposals.some((p) => p.id === id(222)));
  await assert.rejects(
    staff(
      'review',
      id(230),
      { decision: 'Accepted', reason },
      context.proposals.find((p) => p.id === id(222)).reviewHead,
      id(222),
      id(227),
    ),
    /Retired/,
  );
});
test('feedback pages, queues and privacy inventory remain bounded and migrations reapply', async (t) => {
  const { db, act, rpc, staff, portal, root, files } = await fixture(t);
  await db.exec('reset role');
  for (const name of files.filter((n) => n.includes('stage4_')))
    await db.exec(await readFile(new URL(name, root), 'utf8'));
  for (let n = 0; n < 26; n++)
    await db.query(
      `insert into ecod_feedback_private.proposals(id,workspace_id,candidate_id,actor,base,head,fields,reason)values($1,$2,$3,$4,'{}','test','{"title":"Proposed"}',$5)`,
      [id(250 + n), id(11), id(21), id(7), reason],
    );
  await act(7);
  assert.equal((await portal('context')).proposals.length, 25);
  assert.equal(
    (await portal('context', null, {}, null, null, id(21), null, 25)).proposals.length,
    1,
  );
  assert.equal((await portal('context')).more, true);
  await act(2);
  const page = await staff('context');
  assert.equal(page.proposals.length, 25);
  assert.equal((await rpc('api_feedback_queue', ['proposals', 0])).rows.length, 25);
  assert.equal((await rpc('api_feedback_queue', ['proposals', 25])).rows.length, 1);
  await db.exec('reset role');
  const inventory = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
  assert.equal(inventory.counts.length, 68);
  assert.equal(inventory.counts.find((x) => x.category === 'feedbackProposals').count, 26);
  assert.equal(inventory.counts.find((x) => x.category === 'feedbackGrants').count, 1);
  await act(3);
  assert.equal((await staff('context')).proposals.length, 25);
  await act(4);
  assert.equal((await rpc('api_feedback_queue', ['proposals', 0])).rows.length, 0);
});

test('reviewed alternate contacts remain unverified and never silently replace primary identity or destination', async (t) => {
  const { db, act, rpc, propose, review, portal } = await fixture(t);
  await propose(
    { contactEmail: 'new-address@example.com', contactPhone: '+919876543210' },
    id(280),
  );
  await review(id(281), 'Accepted', id(280));
  const contacts = await rpc('api_candidate_contacts', [id(21), 0]);
  assert.equal(contacts.rows.length, 2);
  assert.ok(contacts.rows.every((c) => !c.verified_at && !c.preferred));
  await db.exec('reset role');
  assert.equal(
    (await db.query(`select email from candidates where id='${id(21)}'`)).rows[0].email,
    'one@e.com',
  );
  await act(7);
  const head = (await portal('context')).head;
  await assert.rejects(
    portal('propose', id(282), { fields: { contactEmail: 'bad email' }, reason }, head),
    /email/i,
  );
  const proposal = await propose(
    { contactEmail: 'new-address@example.com', title: 'Must roll back' },
    id(283),
  );
  assert.equal(proposal.status, 'Pending');
  await assert.rejects(review(id(284), 'Accepted', id(283)), /already linked/);
  await db.exec('reset role');
  assert.notEqual(
    (await db.query(`select title from candidates where id='${id(21)}'`)).rows[0].title,
    'Must roll back',
  );
});

test('authenticated candidate links resolve only their recipient and read exact invitations beyond page one', async (t) => {
  const { db, act, portal, invite } = await fixture(t);
  await invite();
  await act(7);
  assert.equal((await portal('open', null, {}, null, id(120))).candidateId, id(21));
  await act(9);
  await assert.rejects(portal('open', null, {}, null, id(120)), /Invitation access/);
  await db.exec('reset role');
  for (let n = 0; n < 26; n++)
    await db.query(
      `insert into ecod_feedback_private.prompts(id,workspace_id,candidate_id,recipient,kind,question,source,source_head,expires_at,actor,reason,at)
 select $1,workspace_id,candidate_id,recipient,kind,question,source,source_head,expires_at,actor,reason,clock_timestamp()+interval'1 minute'from ecod_feedback_private.prompts where id=$2`,
      [id(300 + n), id(120)],
    );
  await act(7);
  assert.equal((await portal('context')).prompts.length, 25);
  assert.ok(!(await portal('context')).prompts.some((p) => p.id === id(120)));
  const exact = await portal('context', null, { request: id(120) });
  assert.equal(exact.prompts.length, 1);
  assert.equal(exact.prompts[0].id, id(120));
});
