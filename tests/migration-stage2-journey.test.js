import test from 'node:test';
import assert from 'node:assert/strict';
import { id } from './stage1-harness.js';
import { journeyFixture } from './stage2-harness.js';
test('demand-specific assess, gap, enrich, reassess and independently validate preserve sealed evidence', async (t) => {
  const { db, act, rpc, context, action, start, evaluate } = await journeyFixture(t);
  assert.equal(
    (await context()).checks.every((c) => c.status === 'satisfied'),
    true,
  );
  const first = (await start(103)).cycleId;
  const failed = await evaluate(first, 104, 60);
  assert.equal(failed.score, 60);
  await act(2);
  await action('debrief', 105, { decision: 'Gap', reason: 'Technical evidence needs enrichment' });
  await action('gap_plan', 106, {
    objective: 'Improve SQL window functions',
    evidenceRequired: 'Reviewed SQL exercise completion',
    owner: id(2),
    due: (await db.query("select ((statement_timestamp()at time zone'UTC')::date+1)::text d"))
      .rows[0].d,
    readyEstimate: (
      await db.query("select ((statement_timestamp()at time zone'UTC')::date+2)::text d")
    ).rows[0].d,
  });
  await action('gap_complete', 107, {
    plan: id(106),
    evidence: 'Completed SQL training and reviewed practice',
  });
  await act(1);
  await action('gap_validate', 108, {
    plan: id(106),
    evidence: 'Independent review of completion evidence',
  });
  await assert.rejects(
    action('decide', 109, {
      decision: 'Ready',
      days: 30,
      reason: 'Candidate ready for this demand',
    }),
    /debrief|scorecard|Reassess/,
  );
  await act(2);
  const second = (await start(110)).cycleId;
  await evaluate(second, 111, 90);
  await act(2);
  await action('debrief', 112, { decision: 'Pass', reason: 'All independent scorecards pass' });
  await assert.rejects(
    action('decide', 113, {
      decision: 'Ready',
      days: 30,
      reason: 'Candidate ready for this demand',
    }),
    /Administrator/,
  );
  await act(1);
  const c = await context();
  const args = [
    'decide',
    id(51),
    id(21),
    id(113),
    c.head,
    { decision: 'Ready', days: 30, reason: 'Independent validator reviewed all evidence' },
    0,
  ];
  const decision = await rpc('api_demand_journey', args);
  assert.equal(decision.decisionId, id(113));
  assert.equal((await rpc('api_demand_journey', args)).replayed, true);
  const ready = await context();
  assert.equal(ready.validatedReady, true);
  assert.equal(ready.state, 'Ready');
  assert.equal(ready.history.length, 1);
  await act(5);
  const own = await rpc('api_assigned_demand_journey', [second]);
  assert.equal(own.ownEvaluation.score, 90);
  assert.equal(own.evaluations, undefined);
  assert.equal(own.candidate.email, undefined);
  await assert.rejects(rpc('api_demand_journey', ['context', id(51), id(21)]), /membership/);
  await act(2);
  await db.query('update candidates set title=$1 where id=$2', ['Changed profile', id(21)]);
  assert.equal((await context()).state, 'Needs review');
  await db.exec('reset role');
  assert.equal(
    (await db.query('select score from ecod_journey_private.evaluations order by at')).rows.length,
    2,
  );
});
