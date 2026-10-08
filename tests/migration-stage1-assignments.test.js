import test from 'node:test';
import assert from 'node:assert/strict';
import { id, stage1Database } from './stage1-harness.js';
test('limited roles require expiring assignments and never inherit workspace-wide access', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(
    `insert into memberships values('${id(5)}','${id(11)}','assessor'),('${id(6)}','${id(11)}','sales');insert into clients(id,workspace_id,name)values('${id(51)}','${id(11)}','Account');insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(52)}','${id(11)}','Role','Account','${id(51)}',array['SQL'],1,30,20,'Pune','Remote',1,'High',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}');`,
  );
  await act(1);
  const grant = async (member, kind, target, op) =>
    rpc('api_assignments_admin', [
      'grant',
      id(op),
      {
        member: id(member),
        kind,
        target: id(target),
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
      0,
    ]);
  const evaluation = (await grant(5, 'evaluation', 21, 61)).assignment;
  const sales = (await grant(6, 'client', 51, 62)).assignment;
  await assert.rejects(grant(5, 'evaluation', 21, 69), /already|existing|active/i);
  await assert.rejects(grant(5, 'evaluation', 22, 63), /not found/);
  await assert.rejects(grant(6, 'evaluation', 21, 64), /matching limited role/);
  await act(5);
  assert.equal(await rpc('current_workspace'), null);
  const workspaces = await rpc('api_my_workspaces');
  assert.equal(workspaces.activeWorkspace, id(11));
  assert.equal(workspaces.workspaces[0].role, 'assessor');
  assert.equal((await db.query('select id,name,email from candidates')).rows.length, 0);
  assert.equal((await db.query('select * from assessments')).rows.length, 0);
  await assert.rejects(rpc('api_candidate_facts', [id(21), 'employment']), /membership/);
  await assert.rejects(rpc('api_legacy_rows', ['candidates']), /membership/);
  await assert.rejects(rpc('api_assignments_admin'), /membership/);
  assert.equal((await rpc('api_assigned_work')).rows.length, 1);
  const context = await rpc('api_assigned_work', [evaluation.id]);
  assert.deepEqual(Object.keys(context.candidate).sort(), [
    'anthroId',
    'id',
    'name',
    'skills',
    'title',
  ]);
  await assert.rejects(rpc('api_assigned_work', [sales.id]), /unavailable/);
  const payload = {
    title: 'SQL evaluation',
    score: 80,
    evidence: 'Reviewed SQL exercise',
    gap: 'Window functions',
  };
  const record = await rpc('api_assigned_assessment', [evaluation.id, 1, id(65), payload]);
  assert.equal(
    (await rpc('api_assigned_assessment', [evaluation.id, 1, id(65), payload])).replayed,
    true,
  );
  assert.equal((await rpc('api_assigned_work', [evaluation.id])).rows.length, 1);
  await assert.rejects(
    rpc('api_assigned_assessment', [evaluation.id, 1, id(65), { ...payload, score: 90 }]),
    /conflict/,
  );
  await assert.rejects(
    rpc('api_assigned_assessment', [evaluation.id, 1, id(66), { ...payload, email: 'leak' }]),
    /fields/,
  );
  await act(6);
  const progress = await rpc('api_assigned_work', [sales.id]);
  assert.equal(progress.rows[0].title, 'Role');
  assert.deepEqual(Object.keys(progress.rows[0]).sort(), [
    'client',
    'id',
    'positions',
    'progress',
    'status',
    'target',
    'title',
  ]);
  await assert.rejects(
    rpc('api_assigned_assessment', [sales.id, 1, id(66), payload]),
    /Evaluation/,
  );
  await act(1);
  await rpc('api_assignments_admin', ['revoke', id(67), { id: evaluation.id, version: 1 }]);
  await act(5);
  assert.equal((await rpc('api_assigned_work')).rows.length, 0);
  await assert.rejects(rpc('api_assigned_work', [evaluation.id]), /unavailable/);
  await assert.rejects(
    rpc('api_assigned_assessment', [evaluation.id, 1, id(65), payload]),
    /unavailable/,
  );
  await act(1);
  const expired = (await grant(5, 'evaluation', 21, 68)).assignment;
  await db.exec('reset role');
  await db.query(
    "update ecod_access_private.assignments set expires_at=now()-interval'1 second'where id=$1",
    [expired.id],
  );
  await act(5);
  await assert.rejects(rpc('api_assigned_work', [expired.id]), /unavailable/);
  await act(1);
  const activeBeforeRoleChange = (await grant(5, 'evaluation', 21, 70)).assignment;
  assert.equal((await rpc('api_set_member_role', [id(5), 'sales'])).ok, true);
  assert.equal((await rpc('api_set_member_role', [id(5), 'assessor'])).ok, true);
  await act(5);
  await assert.rejects(rpc('api_assigned_work', [activeBeforeRoleChange.id]), /unavailable/);
  await act(1);
  assert.match(
    (await rpc('api_set_member_role', [id(1), 'viewer'])).error,
    /without an administrator/,
  );
  await act(0, 'anon');
  await assert.rejects(rpc('api_assigned_work'), /permission denied/);
  assert.ok(record.recordedId);
});
