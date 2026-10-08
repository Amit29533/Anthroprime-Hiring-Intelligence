import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stage1Database, id } from './stage1-harness.js';
test('Stage 1 Dependent Milestone leased sandbox contracts', async (t) => {
  const h = await stage1Database(t),
    { db, rpc, act } = h;
  await db.exec(
    `create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt()to authenticated,anon,service_role`,
  );
  await db.exec(
    `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"auditedCandidateExports":true}')`,
  );
  const api = (a, p = {}, op = null, head = null, c = null, off = 0) =>
    rpc('api_delivery_sandbox', [a, c, op, head, p, off]);
  const worker = async (a, p = {}) => {
    await act(0, 'service_role');
    return rpc('worker_delivery_sandbox', [a, p]);
  };
  const configure = async (scenario = 'success', number = 8000) => {
    await act(1);
    const ctx = await api('context'),
      conn = ctx.connections.find((x) => x.kind === 'delivery');
    await api(
      'configure',
      {
        kind: 'delivery',
        owner: id(1),
        account: 'Fictional fixture',
        purpose: 'Sandbox recruiting rehearsal',
        costDecision: 'No external service purchased',
        evidence: 'Local fictional fixture acceptance',
        scenario,
        secretRef: 'none',
      },
      id(number),
      conn?.head || ctx.defaultHead,
    );
  };
  const enable = async () => {
    await act(1);
    const token = await api('diagnostic-token');
    await worker('diagnose', { ...token, actor: id(1), callbackConfigured: false });
    await act(1);
    let conn = (await api('context')).connections[0];
    await api(
      'accept',
      { reason: 'Accepted fictional diagnostic' },
      id(8100 + conn.generation * 2),
      conn.head,
    );
    conn = (await api('context')).connections[0];
    await api(
      'enable',
      { reason: 'Enable fictional sandbox only' },
      id(8101 + conn.generation * 2),
      conn.head,
    );
  };
  const prepare = async (number) => {
    await act(2);
    const p = { template: id(100), context: {} };
    const preview = await api('preview', p, null, null, id(21));
    return api('prepare', p, id(number), preview.head, id(21));
  };
  const current = async () => {
    await act(2);
    return (await api('context')).rows[0];
  };
  await t.test('private grants, tenants, current roles and catalog ownership', async () => {
    await act(1);
    await assert.rejects(
      db.query('select *from ecod_delivery_private.connections'),
      /permission denied/,
    );
    await assert.rejects(rpc('worker_delivery_sandbox', ['claim', {}]), /permission denied/);
    await configure();
    assert.equal((await api('context')).connections[0].state, 'configured');
    await act(0, 'postgres');
    await db.exec(
      `update settings set custom=custom||'{"privilegedMfa":true,"auditedDocumentAccess":true}'where workspace_id='${id(11)}'`,
    );
    await act(1);
    await db.exec(`select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
    await assert.rejects(api('diagnostic-token'), /authenticator/);
    await assert.rejects(api('configure', {}, id(8009)), /authenticator/);
    await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
    assert.equal((await api('diagnostic-token')).generation, 1);
    await act(0, 'postgres');
    await db.exec(
      `update settings set custom=custom||'{"privilegedMfa":false}'where workspace_id='${id(11)}'`,
    );
    await db.exec(`select set_config('request.jwt.claims','{}',false)`);
    await act(2);
    await assert.rejects(api('configure', {}, id(8010)), /Administrator/);
    await act(3);
    await assert.rejects(api('prepare', {}, id(8011)), /Editor/);
    await act(4);
    assert.equal((await api('context')).connections.length, 0);
    await act(0, 'anon');
    await assert.rejects(api('context'), /permission denied/);
    await act(1);
    let conn = (await api('context')).connections[0];
    await assert.rejects(
      api('enable', { reason: 'Trying before acceptance' }, id(8012), conn.head),
      /diagnostic/,
    );
    await enable();
  });
  await act(1);
  await rpc('api_test_communications', [
    'template',
    null,
    id(100),
    null,
    {
      key: 'dependent-welcome',
      version: 0,
      kind: 'custom',
      purpose: 'recruiting-contact',
      subject: 'Hello {{candidateName}}',
      text: 'Your identifier is {{anthroId}}.',
      enabled: true,
    },
    0,
  ]);
  await act(2);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(101),
    'add',
    id(102),
    0,
    { kind: 'email', value: 'one@e.com', source: 'Candidate supplied contact' },
  ]);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(103),
    'verify',
    id(102),
    1,
    { reason: 'Candidate confirmed contact ownership' },
  ]);
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status)values('${id(11)}','${id(21)}','recruiting-contact','granted')`,
  );
  await t.test(
    'source preview is fictional, preparation freezes actor/source and replays exactly',
    async () => {
      const p = { template: id(100), context: {} };
      const preview = await api('preview', p, null, null, id(21));
      assert.equal(preview.preview.recipient, 'fixture@example.invalid');
      assert.ok(!JSON.stringify(preview).includes('one@e.com'));
      assert.equal(preview.eligible, true);
      await api('prepare', p, id(8200), preview.head, id(21));
      assert.equal((await api('prepare', p, id(8200), preview.head, id(21))).replayed, true);
      await assert.rejects(
        api('prepare', { ...p, context: { demand: id(999) } }, id(8200), preview.head, id(21)),
        /conflict/,
      );
    },
  );
  await t.test(
    'leases and final gates survive lost acknowledgements with durable reconciliation',
    async () => {
      const lease = (await worker('claim', { limit: 1 })).rows[0];
      assert.ok(lease.lease);
      assert.equal((await worker('claim', { limit: 1 })).rows.length, 0);
      await assert.rejects(worker('sink', lease), /gate/);
      await worker('gate', lease);
      await worker('sink', lease);
      await worker('finish', { ...lease, outcome: 'ambiguous' });
      assert.equal((await current()).status, 'Ambiguous');
      await assert.rejects(
        api(
          'retry',
          { intent: lease.id, reason: 'Unsafe blind resend forbidden' },
          id(8201),
          (await current()).head,
        ),
        /failed/,
      );
      assert.equal((await worker('reconcile', { id: lease.id })).status, 'Provider accepted');
      await assert.rejects(worker('finish', { ...lease, outcome: 'accepted' }), /lease/);
    },
  );
  await t.test('duplicate/reordered callbacks bind workspace/generation/provider ID', async () => {
    const event = {
      workspace: id(11),
      intent: id(8200),
      generation: 1,
      eventId: 'delivery-fixture',
      messageId: 'sandbox:' + id(8200),
      type: 'Delivered',
      at: new Date(Date.now() + 100).toISOString(),
    };
    await worker('event', event);
    assert.equal((await worker('event', event)).replayed, true);
    await assert.rejects(worker('event', { ...event, type: 'Bounced' }), /conflict/);
    await worker('event', {
      ...event,
      eventId: 'late-accepted',
      type: 'Provider accepted',
      at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal((await worker('reconcile', { id: id(8200) })).status, 'Delivered');
    await worker('event', {
      ...event,
      eventId: 'late-bounce',
      type: 'Bounced',
      at: new Date(Date.now() + 200).toISOString(),
    });
    assert.equal((await worker('reconcile', { id: id(8200) })).status, 'Bounced');
    await assert.rejects(
      worker('event', { ...event, workspace: id(12), eventId: 'wrong-tenant' }),
      /unavailable/,
    );
    await assert.rejects(
      worker('event', { ...event, generation: 2, eventId: 'wrong-generation' }),
      /unavailable/,
    );
  });
  await t.test(
    'unknown acceptance never automatically resends and source change suppresses at final gate',
    async () => {
      await configure('unknown', 8300);
      await enable();
      await prepare(8301);
      let lease = (await worker('claim', { limit: 1 })).rows[0];
      await worker('gate', lease);
      assert.equal((await worker('sink', lease)).outcome, 'unknown');
      await worker('finish', { ...lease, outcome: 'ambiguous' });
      assert.equal((await worker('reconcile', { id: lease.id })).status, 'Ambiguous');
      assert.equal((await worker('claim', { limit: 1 })).rows.length, 0);
      await configure('success', 8310);
      await enable();
      await prepare(8311);
      lease = (await worker('claim', { limit: 1 })).rows[0];
      await db.exec('reset role');
      await act(1);
      await rpc('api_create_subject_request', [
        id(8350),
        id(21),
        'restriction',
        'Candidate requested outbound restriction',
        'email',
      ]);
      await rpc('api_update_subject_request', [
        id(8351),
        id(8350),
        1,
        'verify',
        'Verified requester through confirmed contact',
      ]);
      await rpc('api_update_subject_request', [
        id(8352),
        id(8350),
        2,
        'start',
        'Reviewed restriction by administrator',
      ]);
      await rpc('api_set_subject_outbound_hold', [
        id(8353),
        id(8350),
        3,
        true,
        'Reviewed outbound restriction evidence',
      ]);
      assert.equal((await worker('gate', lease)).allowed, false);
      assert.equal((await current()).status, 'Suppressed');
      await db.exec('reset role');
      await act(1);
      await rpc('api_set_subject_outbound_hold', [
        id(8354),
        id(8350),
        4,
        false,
        'Reviewed request to release outbound hold',
      ]);
    },
  );
  await t.test(
    'expired gated leases become ambiguous, pre-gate leases can recover, rotation rejects stale completion',
    async () => {
      await db.exec('reset role');
      await db.exec(
        "update ecod_delivery_private.intents set created_at=created_at-interval'3 days';update ecod_delivery_private.attempts set gate_at=gate_at-interval'3 days'",
      );
      await configure('success', 8400);
      await enable();
      await prepare(8401);
      let lease = (await worker('claim', { limit: 1 })).rows[0];
      await worker('gate', lease);
      await db.exec('reset role');
      await db.exec(
        `update ecod_delivery_private.intents set lease_until=clock_timestamp()-interval'1 second'where id='${lease.id}'`,
      );
      await worker('claim', { limit: 1 });
      assert.equal((await current()).status, 'Ambiguous');
      await assert.rejects(worker('finish', { ...lease, outcome: 'accepted' }), /lease/);
      await configure('success', 8410);
      await enable();
      await prepare(8411);
      lease = (await worker('claim', { limit: 1 })).rows[0];
      await db.exec('reset role');
      await db.exec(
        `update ecod_delivery_private.intents set lease_until=clock_timestamp()-interval'1 second'where id='${lease.id}'`,
      );
      const replacement = (await worker('claim', { limit: 1 })).rows[0];
      assert.notEqual(replacement.lease, lease.lease);
      await assert.rejects(worker('gate', lease), /lease/);
      await act(1);
      const conn = (await api('context')).connections[0];
      await api(
        'rotate',
        { reason: 'Rotate sandbox configuration generation' },
        id(8420),
        conn.head,
      );
      assert.equal((await worker('gate', replacement)).allowed, false);
    },
  );
  await t.test('preparing actor and connection owner revocation suppress dispatch', async () => {
    await configure('success', 8500);
    await enable();
    await prepare(8501);
    const lease = (await worker('claim', { limit: 1 })).rows[0];
    await db.exec('reset role');
    await db.exec(
      `update memberships set role='viewer'where user_id='${id(2)}'and workspace_id='${id(11)}'`,
    );
    assert.equal((await worker('gate', lease)).allowed, false);
    await db.exec('reset role');
    await db.exec(
      `update memberships set role='recruiter'where user_id='${id(2)}'and workspace_id='${id(11)}'`,
    );
    await configure('success', 8510);
    await enable();
    await prepare(8511);
    const next = (await worker('claim', { limit: 1 })).rows[0];
    await db.exec('reset role');
    await db.exec(
      `update memberships set role='recruiter'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
    );
    assert.equal((await worker('gate', next)).allowed, false);
    await db.exec('reset role');
    await db.exec(
      `update memberships set role='admin'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
    );
  });
  await t.test(
    'definite transient failures have finite retries and no fictional provider receipt',
    async () => {
      await configure('transient', 8520);
      await enable();
      await prepare(8521);
      for (let n = 0; n < 3; n++) {
        const lease = (await worker('claim', { limit: 1 })).rows[0];
        assert.ok(lease);
        await worker('gate', lease);
        assert.equal((await worker('sink', lease)).outcome, 'transient');
        await worker('finish', { ...lease, outcome: 'transient' });
        await db.exec('reset role');
        await db.exec(
          `update ecod_delivery_private.intents set available_at=clock_timestamp()where id='${id(8521)}'`,
        );
      }
      assert.equal((await current()).status, 'Failed');
      assert.equal((await worker('claim', { limit: 1 })).rows.length, 0);
      await assert.rejects(
        api(
          'retry',
          { intent: id(8521), reason: 'Cannot exceed three attempts' },
          id(8522),
          (await current()).head,
        ),
        /three/,
      );
      await act(0, 'postgres');
      await db.exec(
        `insert into candidates(id,workspace_id,name,"mergedInto")values('${id(8550)}','${id(11)}','Retained alias','${id(21)}')`,
      );
      await configure('success', 8530);
      await enable();
      await prepare(8531);
      const pending = (await worker('claim', { limit: 1 })).rows[0];
      assert.ok(pending);
      await db.exec('reset role');
      // Other work on a retained identity alias passed its gate after this claim.
      for (let n = 0; n < 3; n++) {
        await db.query(
          `insert into ecod_delivery_private.intents(id,workspace_id,candidate_id,template_id,context,source_head,generation,actor,status,attempts,available_at,expires_at)
          values($1,$2,$3,$4,'{}',$5,1,$6,'Failed',1,clock_timestamp(),clock_timestamp()+interval'1 day')`,
          [id(8560 + n), id(11), id(8550), id(100), 'historical-alias-' + n, id(2)],
        );
        await db.query(
          `insert into ecod_delivery_private.attempts(id,workspace_id,candidate_id,intent_id,number,gate_at,outcome)
          values($1,$2,$3,$4,1,clock_timestamp(),'permanent')`,
          [id(8570 + n), id(11), id(8550), id(8560 + n)],
        );
      }
      assert.equal((await worker('gate', pending)).allowed, false);
      await act(2);
      assert.equal((await api('context')).rows.find((x) => x.id === pending.id).status, 'Deferred');
      await assert.rejects(worker('sink', pending), /lease/);
    },
  );
  await t.test(
    'private journals enter both inventories, migrations replay and limited users never inherit workspace access',
    async () => {
      await db.exec('reset role');
      const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
      assert.equal(inv.counts.length, 78);
      for (const category of [
        'deliveryIntents',
        'deliveryAttempts',
        'deliveryEvents',
        'deliveryProvider',
        'deliveryReceipts',
      ])
        assert.ok(inv.counts.find((x) => x.category === category)?.count > 0, category);
      const sources = await rpc('ecod_ops_private.source_inventory', [id(11), id(21)]);
      assert.ok(sources.counts.find((x) => x.category === 'deliveryIntents')?.count >= 3);
      assert.equal(
        (await rpc('ecod_ops_private.source_inventory', [id(11), id(21)])).counts.length,
        75,
      );
      await db.exec(
        await readFile(new URL('20261008050701_dependent_stage1_delivery.sql', h.root), 'utf8'),
      );
      await db.exec(`insert into memberships values('${id(5)}','${id(11)}','assessor')`);
      await act(5);
      await assert.rejects(api('context'), /membership/);
    },
  );
});
