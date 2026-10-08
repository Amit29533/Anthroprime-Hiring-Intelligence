import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stage1Database, id } from './stage1-harness.js';

test('Stage 5 enterprise access and human fulfillment enforce exact current authority', async (t) => {
  const { db, rpc, act, root } = await stage1Database(t);
  await db.exec(`create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt()to authenticated,anon,service_role;
    alter table auth.users add column is_sso_user boolean default false;create table auth.identities(user_id uuid,provider text);create table auth.sso_providers(id uuid);insert into auth.sso_providers values('${id(501)}');
    insert into auth.users(id,email)values('${id(7)}','independent@example.invalid');insert into memberships values('${id(7)}','${id(11)}','admin');`);
  let seq = 51000;
  const api = (a, p = {}, h = null, op = null, off = 0) =>
    rpc('api_enterprise_operations', [a, op, h, p, off]);
  const ctx = () => api('context');
  const current = async (k) => (await ctx()).policies.find((p) => p.kind === k);
  const configure = async (kind) => {
    await act(1);
    const c = await ctx();
    const q = c.policies.find((p) => p.kind === kind);
    const p = {
      kind,
      owner: id(1),
      purpose: 'Fictional independently reviewed enterprise workflow',
      rights: 'Fictional permitted scope and explicit authority reference',
      entitlement: 'Fictional sandbox entitlement; hosted acceptance pending',
      recovery: 'Fictional isolated backup and restore drill reference',
      basis: 'Fictional approved retention and workspace access policy',
      ...(kind === 'sso' ? { provider: id(501) } : { retentionDays: '730' }),
    };
    await api('configure', p, q?.head || c.defaultHead, id(++seq));
  };
  const enable = async (kind) => {
    await act(1);
    await api('accept', { kind }, (await current(kind)).head, id(++seq));
    await api('enable', { kind }, (await current(kind)).head, id(++seq));
  };
  await t.test(
    'administrator, tenant, MFA, private grants and strict configuration boundaries',
    async () => {
      await act(2);
      await assert.rejects(ctx(), /Administrator/);
      await act(3);
      await assert.rejects(ctx(), /Administrator/);
      await act(0, 'anon');
      await assert.rejects(ctx(), /permission/);
      await act(1);
      await assert.rejects(
        api(
          'configure',
          { kind: 'sso', owner: id(1), purpose: null },
          (await ctx()).defaultHead,
          id(++seq),
        ),
        /evidence/,
      );
      await configure('sso');
      await assert.rejects(
        api('accept', { kind: 'sso' }, (await current('sso')).head, id(++seq)),
        /recovery/,
      );
      await act(0, 'postgres');
      await db.exec(
        `insert into ecod_processing_private.policies values('${id(11)}','recovery',1,'enabled','{}',clock_timestamp());insert into ecod_processing_private.evidence(id,workspace_id,kind,generation,component,status,body)values('${id(510)}','${id(11)}','recovery',1,'backup','passed','{}'),('${id(511)}','${id(11)}','recovery',1,'restore','passed','{}');`,
      );
      await enable('sso');
      await configure('fulfillment');
      await enable('fulfillment');
      await act(0, 'postgres');
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('authenticated','ecod_enterprise_private.plans','SELECT') p",
          )
        ).rows[0].p,
        false,
      );
      await db.exec(
        `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"privilegedMfa":true,"auditedDocumentAccess":true,"auditedCandidateExports":true}')on conflict(workspace_id,id)do update set custom=excluded.custom;`,
      );
      await act(1);
      await assert.rejects(ctx(), /authenticator/);
      await act(0, 'postgres');
      await db.exec(`update settings set custom='{}'where workspace_id='${id(11)}'`);
      await act(1);
    },
  );
  await t.test(
    'SSO never inherits email invitations and grants only a verified exact identity',
    async () => {
      await act(0, 'postgres');
      await db.exec(
        `insert into "workspaceInvites"(workspace_id,email,role)values('${id(11)}','sso@example.invalid','admin');insert into auth.users(id,email,is_sso_user)values('${id(8)}','sso@example.invalid',true),('${id(9)}','imposter@example.invalid',true);insert into auth.identities values('${id(8)}','sso:${id(501)}');`,
      );
      assert.equal(
        (await db.query(`select count(*)n from memberships where user_id='${id(8)}'`)).rows[0].n,
        0,
      );
      await act(1);
      const p = {
        user: id(8),
        role: 'recruiter',
        reason: 'Reviewed explicit verified SAML UUID and scope',
      };
      const h = await rpc('api_enterprise_member_head', [id(8)]);
      const op = id(++seq);
      const r = await api('grant', p, h, op);
      assert.deepEqual(await api('grant', p, h, op), r);
      await assert.rejects(api('grant', { ...p, role: 'admin' }, h, op), /conflict/);
      await assert.rejects(
        api(
          'grant',
          { ...p, user: id(9) },
          await rpc('api_enterprise_member_head', [id(9)]),
          id(++seq),
        ),
        /verified SAML/,
      );
      await act(8);
      assert.equal(await rpc('current_workspace'), null);
      assert.equal(await rpc('can_edit_workspace', [id(11)]), false);
      await db.exec(
        `select set_config('request.jwt.claims','{"amr":[{"method":"totp"},{"method":"sso/saml","provider":"${id(501)}"}]}',false)`,
      );
      assert.equal(await rpc('current_workspace'), id(11));
      assert.equal(await rpc('can_edit_workspace', [id(11)]), true);
      await act(0, 'postgres');
      await db.exec(`delete from auth.sso_providers where id='${id(501)}'`);
      await act(8);
      assert.equal(await rpc('current_workspace'), null);
      assert.equal(await rpc('can_edit_workspace', [id(11)]), false);
      await act(0, 'postgres');
      await db.exec(`insert into auth.sso_providers values('${id(501)}')`);
      await act(8);
      await db.exec(
        `select set_config('request.jwt.claims','{"amr":[{"method":"sso/saml","provider":"${id(502)}"}],"user_metadata":{"provider":"${id(501)}"}}',false)`,
      );
      assert.equal(await rpc('current_workspace'), null);
      await db.exec(`select set_config('request.jwt.claims','{}',false)`);
    },
  );
  await t.test(
    'offboarding removes workspace authority and prevents old-token and implicit rejoin access',
    async () => {
      await act(1);
      const p = {
        user: id(8),
        reason: 'Reviewed offboarding and pending IdP session reconciliation',
      };
      const h = await rpc('api_enterprise_member_head', [id(8)]);
      await api('offboard', p, h, id(++seq));
      await api(
        'offboard-report',
        { ...p, idp: 'unresolved', sessions: 'reported_revoked', downloads: 'retained' },
        await rpc('api_enterprise_member_head', [id(8)]),
        id(++seq),
      );
      assert.ok((await api('access-history')).rows.some((r) => r.action === 'offboard-report'));
      await act(8);
      await db.exec(
        `select set_config('request.jwt.claims','{"amr":[{"method":"sso/saml","provider":"${id(501)}"}]}',false)`,
      );
      assert.equal(await rpc('current_workspace'), null);
      assert.equal((await db.query('select count(*)n from candidates')).rows[0].n, 0);
      await act(0, 'postgres');
      await assert.rejects(
        db.exec(`insert into memberships values('${id(8)}','${id(11)}','admin')`),
        /Offboarded/,
      );
      await db.exec(`select set_config('request.jwt.claims','{}',false)`);
      await act(1);
      await assert.rejects(
        api(
          'offboard',
          { user: id(1), reason: p.reason },
          await rpc('api_enterprise_member_head', [id(1)]),
          id(++seq),
        ),
        /Other exact/,
      );
    },
  );
  const caseId = id(550);
  let plan;
  const prepare = async () => {
    await act(1);
    const s = await api('preview', { case: caseId });
    const op = id(++seq);
    await api('prepare', { case: caseId }, s.head, op);
    return op;
  };
  const detail = (id) => api('detail', { id });
  await t.test(
    'verified-case scope is frozen, replayable and independently approved without deletion',
    async () => {
      await act(1);
      await rpc('api_create_subject_request', [
        caseId,
        id(21),
        'retention_review',
        'Fictional verified retention review request',
        'email',
        null,
        null,
      ]);
      await assert.rejects(api('preview', { case: caseId }), /verified/);
      await rpc('api_update_subject_request', [
        id(++seq),
        caseId,
        1,
        'verify',
        'Fictional independent identity verification',
        null,
        null,
      ]);
      plan = await prepare();
      let d = await detail(plan);
      assert.equal(d.plan.source.destructiveExecution, false);
      assert.equal(d.plan.source.inventory.counts.length, 78);
      await assert.rejects(
        api(
          'approve',
          { id: plan, evidence: 'Independent exact inventory review completed' },
          d.head,
          id(++seq),
        ),
        /Independent/,
      );
      await act(7);
      const p = { id: plan, evidence: 'Independent exact inventory review completed' };
      const op = id(++seq);
      const r = await api('approve', p, d.head, op);
      assert.deepEqual(await api('approve', p, d.head, op), r);
      d = await detail(plan);
      assert.equal(d.plan.status, 'Approved');
      assert.equal(d.approval.actor, id(7));
      assert.equal(d.approval.evidence, p.evidence);
      assert.equal((await db.query('select count(*)n from candidates')).rows[0].n, 1);
      await act(4);
      await assert.rejects(detail(plan), /unavailable/);
      await act(7);
    },
  );
  await t.test(
    'local records, held originals and backups cannot be represented as erased',
    async () => {
      let d = await detail(plan);
      await assert.rejects(
        api(
          'record',
          {
            id: plan,
            area: 'candidates',
            outcome: 'reported_removed',
            evidence: 'Fictional human external deletion statement',
          },
          d.head,
          id(++seq),
        ),
        /Held\/local/,
      );
      await assert.rejects(
        api(
          'record',
          {
            id: plan,
            area: 'backups',
            outcome: 'reported_removed',
            evidence: 'Fictional human external deletion statement',
          },
          d.head,
          id(++seq),
        ),
        /Held\/local/,
      );
      await assert.rejects(
        api(
          'record',
          {
            id: plan,
            area: 'candidates',
            outcome: 'not_applicable',
            evidence: 'Fictional known local record is still retained',
          },
          d.head,
          id(++seq),
        ),
        /Existing local/,
      );
      await assert.rejects(api('complete', { id: plan }, d.head, id(++seq)), /every populated/);
      const areas = [
        ...d.plan.source.inventory.counts.filter((x) => x.count > 0).map((x) => x.category),
        'objects',
        'external',
        'backups',
        'unlinked',
      ];
      for (const area of areas) {
        d = await detail(plan);
        await api(
          'record',
          {
            id: plan,
            area,
            outcome: 'retained',
            evidence: 'Fictional local review; retained copy and limitation recorded',
          },
          d.head,
          id(++seq),
        );
      }
      d = await detail(plan);
      await api('complete', { id: plan }, d.head, id(++seq));
      assert.equal((await detail(plan)).plan.status, 'Reconciled with limitations');
    },
  );
  await t.test(
    'source changes invalidate approval; stale plans can be cancelled and replaced',
    async () => {
      const op = await prepare();
      let d = await detail(op);
      await act(0, 'postgres');
      await db.exec(`update candidates set title='Changed title'where id='${id(21)}'`);
      await act(7);
      await assert.rejects(
        api(
          'approve',
          { id: op, evidence: 'Independent exact inventory review completed' },
          d.head,
          id(++seq),
        ),
        /Source scope changed/,
      );
      await api('cancel', { id: op }, d.head, id(++seq));
      await act(1);
      assert.notEqual(await prepare(), op);
    },
  );
  await t.test(
    'dashboard is aggregate and journals are inventoried, replay safe and frozen during recovery',
    async () => {
      await act(1);
      const d = await api('dashboard');
      assert.ok(d.plans);
      assert.ok(!JSON.stringify(d).includes('one@e.com'));
      assert.equal((await api('browse')).rows.length, 3);
      await act(0, 'postgres');
      const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
      assert.equal(inv.counts.length, 81);
      assert.ok(inv.counts.find((x) => x.category === 'enterprisePlans').count > 0);
      await db.exec(
        await readFile(
          new URL('20261008101818_dependent_stage5_enterprise_fulfillment.sql', root),
          'utf8',
        ),
      );
      const audit = await readFile(
        new URL('20261008105844_milestone_integrity_audit.sql', root),
        'utf8',
      );
      await db.exec(audit);
      await db.exec(audit);
      await act(1);
      assert.equal((await detail(plan)).approval.actor, id(7));
      await act(0, 'postgres');
      await rpc('worker_processing_recovery', [
        'lockdown',
        { reason: 'Fictional isolated enterprise restore rehearsal' },
      ]);
      await assert.rejects(
        db.exec('truncate ecod_enterprise_private.decisions'),
        /Recovery lockdown/,
      );
      await rpc('worker_processing_recovery', [
        'unlock',
        { reason: 'Fictional isolated enterprise restore completed' },
      ]);
      await act(1);
      assert.ok((await ctx()).policies.every((p) => p.state === 'paused'));
    },
  );
});
