import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stage1Database, id } from './stage1-harness.js';
import { baselineSql, emptyTargetSql } from '../scripts/recovery/runner.mjs';
test('Stage 2 Dependent Milestone operational gates and recovery lockdown', async (t) => {
  const { db, act, rpc, root } = await stage1Database(t);
  await db.exec(
    `create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt()to authenticated,anon,service_role;insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"privateDocuments":true,"auditedDocumentAccess":true,"auditedCandidateExports":true}')`,
  );
  const api = (a, p = {}, op = null, head = null, off = 0) =>
    rpc('api_processing_recovery', [a, op, head, p, off]);
  const worker = async (a, p = {}) => {
    await act(0, 'service_role');
    return rpc('worker_processing_recovery', [a, p]);
  };
  let seq = 10000;
  const config = async (kind = 'processing', requireOcr = false) => {
    await act(1);
    const ctx = await api('context');
    const cfg = ctx.policies.find((x) => x.kind === kind);
    return api(
      'configure',
      {
        kind,
        owner: id(1),
        account: 'Native fixture',
        purpose: 'Private acceptance fixture',
        costDecision: 'Existing host reviewed quota',
        evidence: 'Fictional controlled evidence',
        requireOcr,
        keyRef: 'custody:test',
        destinationRef: 'offsite:test',
        rpoHours: 24,
        rtoMinutes: 120,
      },
      id(++seq),
      cfg?.head || ctx.defaultHead,
    );
  };
  const evidence = async (component, status = 'passed', body) => {
    await act(1);
    const cfg = (await api('context')).policies.find(
      (x) => x.kind === (['scan', 'ocr'].includes(component) ? 'processing' : 'recovery'),
    );
    return worker('evidence', {
      id: id(++seq),
      workspace: id(11),
      kind: cfg.kind,
      generation: cfg.generation,
      component,
      status,
      body: body || {
        engine: 'Fictional native fixture',
        ...(component === 'scan' ? { clean: true, blocked: true } : { fixture: true }),
      },
    });
  };
  const decision = async (a, kind = 'processing') => {
    await act(1);
    const cfg = (await api('context')).policies.find((x) => x.kind === kind);
    return api(a, { kind, reason: 'Reviewed acceptance decision' }, id(++seq), cfg.head);
  };
  await t.test(
    'raw/private service grants, current admin/MFA and exact reviewed receipts',
    async () => {
      await act(2);
      await assert.rejects(api('context'), /Administrator/);
      await assert.rejects(
        rpc('worker_processing_recovery', ['lockdown', { reason: 'Unauthorised global change' }]),
        /permission/,
      );
      await assert.rejects(db.query('select *from ecod_processing_private.evidence'), /permission/);
      await act(4);
      assert.deepEqual((await api('context')).policies, []);
      await act(0, 'anon');
      await assert.rejects(api('context'), /permission/);
      await config();
      await assert.rejects(decision('accept'), /Fresh/);
      await act(1);
      const cfg = (await api('context')).policies[0];
      const op = id(++seq),
        p = { kind: 'processing', reason: 'Explicit pause review decision' };
      await api('pause', p, op, cfg.head);
      assert.equal((await api('pause', p, op, cfg.head)).replayed, true);
      await assert.rejects(
        api('pause', { ...p, reason: 'Different decision payload' }, op, cfg.head),
        /conflict/,
      );
      await act(0, 'postgres');
      await db.exec(
        `update settings set custom=custom||'{"privilegedMfa":true}'where workspace_id='${id(11)}'`,
      );
      await act(1);
      await assert.rejects(api('context'), /authenticator/);
      await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
      assert.equal((await api('context')).policies.length, 1);
      await act(0, 'postgres');
      await db.exec(
        `update settings set custom=custom||'{"privilegedMfa":false}'where workspace_id='${id(11)}'`,
      );
      await db.exec(`select set_config('request.jwt.claims','{}',false)`);
    },
  );
  await t.test(
    'quarantine survives health outage and stale native receipts; no legacy upload fallback',
    async () => {
      await act(1);
      const prepared = await rpc('api_prepare_attachment', [
        id(301),
        id(21),
        null,
        'fixture.txt',
        'txt',
        12,
        'a'.repeat(64),
        'CV',
      ]);
      assert.equal(prepared.required, true);
      await rpc('api_attachment_uploaded', [id(301)]);
      await act(0, 'service_role');
      assert.equal(await rpc('worker_claim_attachment_scan'), null);
      await evidence('scan');
      await decision('accept');
      await decision('enable');
      await act(0, 'service_role');
      const file = await rpc('worker_claim_attachment_scan');
      assert.equal(file.id, id(301));
      await evidence('scan', 'unavailable', { code: 'scanner-outage' });
      await act(0, 'service_role');
      await assert.rejects(
        rpc('worker_finish_attachment_scan', [
          file.id,
          file.scan_lease,
          'clean',
          'etag',
          'Native fixture',
        ]),
        /health gate/,
      );
      await evidence('scan');
      await act(0, 'service_role');
      assert.equal(
        await rpc('worker_finish_attachment_scan', [
          file.id,
          file.scan_lease,
          'clean',
          'etag',
          'Native fixture',
        ]),
        true,
      );
      await act(0, 'postgres');
      await db.exec(
        `update ecod_processing_private.evidence set at=clock_timestamp()-interval'16 minutes'where component='scan'`,
      );
      assert.equal(await rpc('ecod_processing_private.ready', [id(11)]), false);
      await config('processing', true);
      await evidence('scan');
      await assert.rejects(decision('accept'), /Fresh/);
      await evidence('ocr');
      await decision('accept');
      await decision('enable');
      await act(0, 'postgres');
      await db.exec(
        `update memberships set role='recruiter'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
      );
      assert.equal(await rpc('ecod_processing_private.ready', [id(11)]), false);
      await db.exec(
        `update memberships set role='admin'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
      );
    },
  );
  await t.test(
    'recovery requires authenticated complete encrypted proof and matching isolated restore within RTO',
    async () => {
      await config('recovery');
      const proof = {
        digest: 'b'.repeat(64),
        keyRef: 'custody:test',
        destinationRef: 'offsite:test',
        sourceRef: 'source-test',
        durationSeconds: 20,
        encrypted: true,
        database: true,
        objects: true,
        privateJournals: true,
        sequences: true,
        rolesAuth: true,
        paused: true,
      };
      await assert.rejects(
        evidence('backup', 'passed', { ...proof, privateJournals: false }),
        /Complete/,
      );
      await evidence('backup', 'passed', proof);
      await assert.rejects(decision('accept', 'recovery'), /Fresh/);
      await assert.rejects(
        evidence('restore', 'passed', {
          ...proof,
          backupDigest: proof.digest,
          targetRef: 'source-test',
        }),
        /Isolated/,
      );
      await assert.rejects(
        evidence('restore', 'passed', {
          ...proof,
          backupDigest: proof.digest,
          targetRef: 'isolated-target',
          durationSeconds: 7300,
        }),
        /RTO/,
      );
      await assert.rejects(
        evidence('restore', 'passed', {
          ...proof,
          sourceRef: 'another-source',
          backupDigest: proof.digest,
          targetRef: 'isolated-target',
        }),
        /Isolated/,
      );
      await evidence('restore', 'passed', {
        ...proof,
        backupDigest: proof.digest,
        targetRef: 'isolated-target',
      });
      await decision('accept', 'recovery');
      await decision('enable', 'recovery');
      await act(1);
      await assert.rejects(
        rpc('api_delivery_sandbox', [
          'configure',
          null,
          id(++seq),
          null,
          { kind: 'processing' },
          0,
        ]),
        /Stage 2/,
      );
    },
  );
  await t.test(
    'current server evidence is deduplicated, generation-bound and paged without tenant leakage',
    async () => {
      await act(1);
      const cfg = (await api('context')).policies.find((x) => x.kind === 'processing');
      const report = {
        id: id(++seq),
        workspace: id(11),
        kind: 'processing',
        generation: cfg.generation,
        component: 'scan',
        status: 'passed',
        body: { clean: true, blocked: true, engine: 'Fixture' },
      };
      await assert.rejects(rpc('worker_processing_recovery', ['evidence', report]), /permission/);
      await worker('evidence', report);
      assert.equal((await worker('evidence', report)).replayed, true);
      await assert.rejects(
        worker('evidence', { ...report, body: { ...report.body, engine: 'Different' } }),
        /conflict/,
      );
      await assert.rejects(
        worker('evidence', { ...report, id: id(++seq), generation: cfg.generation - 1 }),
        /generation/,
      );
      for (let i = 0; i < 30; i++) await worker('evidence', { ...report, id: id(++seq) });
      await act(1);
      const first = await api('history', { kind: 'processing' });
      assert.equal(first.rows.length, 25);
      assert.equal(first.more, true);
      const next = await api('history', { kind: 'processing' }, null, null, 25);
      assert.ok(next.rows.length > 0 && next.rows.length <= 25);
      assert.equal(
        new Set([...first.rows, ...next.rows].map((x) => x.id)).size,
        first.rows.length + next.rows.length,
      );
      await act(4);
      assert.equal((await api('history', { kind: 'processing' })).rows.length, 0);
    },
  );
  await t.test(
    'native backup inventory covers private rows and Anthro-ID sequence state; lockdown freezes all application journals',
    async () => {
      await act(0, 'postgres');
      for (const fn of [
        'worker_claim_cv_scan',
        'worker_claim_cv',
        'worker_claim_ocr_cv',
        'worker_claim_attachment_scan',
        'worker_claim_attachment_extract',
        'worker_claim_ocr_attachment',
      ])
        assert.match(
          (await db.query(`select pg_get_functiondef('public.${fn}()'::regprocedure)d`)).rows[0].d,
          /ecod_processing_private.ready/,
        );
      await db.exec(
        "create role stage2_operator_member;create role stage2_operator_group;grant stage2_operator_group to stage2_operator_member;alter role stage2_operator_member set statement_timeout='1min';create sequence auth.stage2_auth_sequence start with 41;select nextval('auth.stage2_auth_sequence');",
      );
      assert.ok((await db.query(emptyTargetSql)).rows[0].count > 0);
      const results = await db.exec(baselineSql);
      const inventory = results.at(-1).rows[0].recovery_inventory;
      assert.ok(
        inventory.tables.some(
          (x) => x.schema === 'ecod_delivery_private' && x.table === 'provider_receipts',
        ),
      );
      assert.ok(inventory.tables.some((x) => x.schema === 'ecod_processing_private'));
      assert.ok(inventory.sequences.length > 0);
      assert.equal(
        inventory.sequences.find(
          (x) => x.schema === 'auth' && x.sequence === 'stage2_auth_sequence',
        ).state.last_value,
        41,
      );
      assert.ok(
        inventory.roleMemberships.some(
          (x) => x[0] === 'stage2_operator_group' && x[1] === 'stage2_operator_member',
        ),
      );
      assert.ok(
        inventory.roles
          .find((x) => x[0] === 'stage2_operator_member')
          .at(-1)
          .some((x) => x.startsWith('statement_timeout=')),
      );
      await worker('lockdown', { reason: 'Isolated recovery fixture lockdown' });
      await act(1);
      assert.equal((await api('context')).paused, true);
      await assert.rejects(
        db.query(`update candidates set name='Changed'where id='${id(21)}'`),
        /lockdown/,
      );
      await assert.rejects(config(), /lockdown/);
      await act(0, 'postgres');
      await assert.rejects(db.exec('truncate ecod_processing_private.evidence'), /lockdown/);
      await act(0, 'service_role');
      assert.equal(await rpc('worker_claim_attachment_extract'), null);
      await worker('unlock', { reason: 'Reviewed recovery fixture resume' });
      await act(1);
      assert.equal((await api('context')).paused, false);
      assert.equal((await api('context')).policies[0].state, 'configured');
      assert.equal(await rpc('api_attachment_mode'), true);
      await act(0, 'postgres');
      assert.equal(await rpc('ecod_processing_private.ready', [id(11)]), false);
      await act(0, 'postgres');
      assert.equal(
        (await rpc('ecod_private.erasure_inventory', [id(11), id(21)])).counts.length,
        68,
      );
      await db.exec(
        await readFile(
          new URL('20261008055723_dependent_stage2_processing_recovery.sql', root),
          'utf8',
        ),
      );
    },
  );
});
