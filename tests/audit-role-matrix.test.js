import test from 'node:test';
import assert from 'node:assert/strict';
import { stage1Database, id } from './stage1-harness.js';

test('final migration chain preserves administrator, recruiter, viewer, limited and external role boundaries', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(`insert into memberships values('${id(5)}','${id(11)}','assessor'),('${id(6)}','${id(11)}','sales');
    insert into auth.users values('${id(7)}','candidate@example.invalid'),('${id(8)}','client@example.invalid');`);
  for (const [n, role, canRead, canEdit] of [
    [1, 'administrator', true, true],
    [2, 'recruiter', true, true],
    [3, 'viewer', true, false],
    [5, 'assessor', false, false],
    [6, 'sales', false, false],
    [7, 'candidate', false, false],
    [8, 'client', false, false],
  ])
    await t.test(role, async () => {
      await act(n);
      assert.equal(await rpc('can_edit_workspace', [id(11)]), canEdit);
      assert.equal(await rpc('can_edit_workspace', [id(12)]), false);
      if (canRead) {
        const page = await rpc('api_repository_page', [{}, null, 25]);
        assert.deepEqual(
          page.rows.map((r) => r.id),
          [id(21)],
        );
        if (n !== 1) assert.equal(page.rows[0].expected, undefined);
      } else {
        assert.equal((await db.query('select id from candidates')).rows.length, 0);
        await assert.rejects(rpc('api_repository_page', [{}, null, 25]), /membership/);
      }
      for (const name of ['api_enterprise_operations', 'api_processing_recovery']) {
        if (n === 1) assert.ok(await rpc(name, ['context']));
        else await assert.rejects(rpc(name, ['context']), /Administrator|membership/);
      }
      if (canEdit) assert.ok(await rpc('api_controlled_workflows'));
      else await assert.rejects(rpc('api_controlled_workflows'), /Editor|membership/);
      await assert.rejects(
        db.query('select * from ecod_enterprise_private.receipts'),
        /permission/,
      );
      await assert.rejects(rpc('worker_controlled_workflows', ['claim', {}]), /permission/);
    });
  await t.test('anonymous visitor', async () => {
    await act(0, 'anon');
    await assert.rejects(rpc('api_enterprise_operations', ['context']), /permission/);
    await assert.rejects(rpc('api_repository_page', [{}, null, 25]), /permission/);
  });
});
