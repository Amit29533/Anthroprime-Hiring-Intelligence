import test from 'node:test';
import assert from 'node:assert/strict';
import { id, stage1Database } from './stage1-harness.js';
test('Stage 1 privacy inventories include decisions, assignments, receipts and factual provenance without disclosing other actors', async (t) => {
  const { db, act, rpc, today } = await stage1Database(t);
  await act(1);
  const head = (await rpc('api_candidate_facts', [id(21), 'compensation'])).head;
  await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(81),
    head,
    {
      kind: 'current',
      amount: 0,
      currency: 'INR',
      basis: 'Annual',
      components: { fixed: 0 },
      source: 'Confirmed statement',
      observed: today,
    },
    true,
    false,
    null,
  ]);
  await db.exec(
    `reset role;insert into candidates(id,workspace_id,name,email)values('${id(23)}','${id(11)}','Comparison','comparison@e.com');insert into ecod_access_private.duplicate_events(id,workspace_id,candidate_a,candidate_b,actor,status,reason,profile_head,request_hash,result)values('${id(82)}','${id(11)}','${id(21)}','${id(23)}','${id(1)}','distinct','Private review','head','request','{}');insert into ecod_access_private.assignments(id,workspace_id,member_id,kind,target_id,expires_at,created_by)values('${id(83)}','${id(11)}','${id(5)}','evaluation','${id(21)}',now()+interval'1 day','${id(1)}');insert into ecod_access_private.assignment_receipts(workspace_id,actor,operation_id,candidate_id,request_hash,result)values('${id(11)}','${id(1)}','${id(84)}','${id(21)}','request','{}');insert into "auditEvents"(workspace_id,"entityType","entityId",action,detail,actor)values('${id(11)}','candidate','${id(21)}','read','Legacy event','legacy');`,
  );
  const inventory = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
  const count = (category) => inventory.counts.find((row) => row.category === category)?.count;
  assert.equal(count('duplicateDecisions'), 1);
  assert.equal(count('evaluationAssignments'), 1);
  assert.equal(count('assignmentReceipts'), 1);
  assert.ok(count('auditEvents') >= 2);
  const rows = (
    await db.query('select *from ecod_private.subject_access_inventory($1,$2)', [id(11), id(21)])
  ).rows;
  const fact = rows.find((row) => row.category === 'compensationHistory');
  assert.equal(fact.projection.amount, 0);
  assert.equal(fact.projection.amountUnit, 'currency');
  assert.equal(fact.projection.verification, 'confirmed');
  assert.ok(fact.projection.verifiedAt);
  assert.deepEqual(fact.projection.components, { fixed: 0 });
  assert.equal(fact.projection.recordedBy, undefined);
  assert.equal(fact.projection.verifiedBy, undefined);
  assert.ok(!rows.some((row) => row.category === 'duplicateDecisions'));
  await db.query(
    'update ecod_access_private.assignments set revoked_at=now(),version=version+1 where id=$1',
    [id(83)],
  );
  const changed = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
  assert.notEqual(changed.fingerprint, inventory.fingerprint);
  await act(2);
  await assert.rejects(
    rpc('ecod_private.erasure_inventory', [id(11), id(21)]),
    /permission denied/,
  );
  await assert.rejects(
    rpc('ecod_private.subject_access_inventory', [id(11), id(21)]),
    /permission denied/,
  );
});
