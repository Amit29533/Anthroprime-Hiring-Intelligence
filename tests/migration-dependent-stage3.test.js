import test from 'node:test';
import assert from 'node:assert/strict';
import { stage1Database, id } from './stage1-harness.js';

test('Stage 3 Google database controls, mailbox checkpoints, scheduling and privacy', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(`create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt()to authenticated,anon,service_role;
    insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"privateDocuments":true}');`);
  const api = (a, p = {}, op = null, head = null, c = null, off = 0) =>
    rpc('api_google_collaboration', [a, c, op, head, p, off]);
  const worker = async (a, p = {}) => {
    await act(0, 'service_role');
    return rpc('worker_google_collaboration', [a, p]);
  };
  let seq = 30000;
  const configure = async (kind) => {
    await act(1);
    const ctx = await api('context'),
      old = ctx.connections.find((x) => x.kind === kind);
    await api(
      'configure',
      {
        kind,
        owner: id(1),
        account: 'admin@example.invalid',
        calendarId: 'primary',
        purpose: 'Recruiting communication fixture',
        costDecision: 'Existing Google account quota reviewed',
        evidence: 'Fictional local authorized account fixture',
      },
      id(++seq),
      old?.head || ctx.defaultHead,
    );
    const cfg = (await api('context')).connections.find((x) => x.kind === kind);
    const ticket = await api('oauth-start', { kind }, id(++seq), cfg.head);
    await worker('oauth-claim', { ticket: ticket.ticket });
    await assert.rejects(worker('oauth-claim', { ticket: ticket.ticket }), /consumed/);
    await worker('oauth-save', {
      ticket: ticket.ticket,
      account: 'admin@example.invalid',
      credentials: { cipher: 'fictional-cipher' },
    });
    await worker('diagnostic', {
      workspace: id(11),
      kind,
      generation: cfg.generation,
      actor: id(1),
      status: 'passed',
    });
    await act(1);
    let current = (await api('context')).connections.find((x) => x.kind === kind);
    await api('accept', { kind }, id(++seq), current.head);
    current = (await api('context')).connections.find((x) => x.kind === kind);
    await api('enable', { kind }, id(++seq), current.head);
    return current.generation;
  };
  await t.test('current role, MFA, raw grants, single-use OAuth and generation gates', async () => {
    await act(3);
    await assert.rejects(api('context'), /access|role|Editor/i);
    await act(1);
    await assert.rejects(
      db.query('select *from ecod_collaboration_private.connections'),
      /permission denied/,
    );
    await assert.rejects(rpc('worker_google_collaboration', ['claim', {}]), /permission denied/);
    await configure('mailbox');
    const ctx = await api('context');
    assert.equal(ctx.connections[0].state, 'enabled');
    assert.ok(!JSON.stringify(ctx).includes('fictional-cipher'));
    await act(0, 'postgres');
    await db.exec(
      `update settings set custom=custom||'{"privilegedMfa":true,"auditedDocumentAccess":true,"auditedCandidateExports":true}'where workspace_id='${id(11)}'`,
    );
    await act(1);
    await assert.rejects(api('diagnostic-token', { kind: 'mailbox' }), /authenticator/);
    await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
    assert.equal((await api('diagnostic-token', { kind: 'mailbox' })).generation, 1);
    await act(0, 'postgres');
    await db.exec(
      `update settings set custom=custom||'{"privilegedMfa":false}'where workspace_id='${id(11)}'`,
    );
    await act(4);
    assert.deepEqual((await api('context')).connections, []);
    await act(1);
    const current = (await api('context')).connections[0];
    await api('pause', { kind: 'mailbox' }, id(++seq), current.head);
    await assert.rejects(
      worker('gate', {
        mode: 'diagnostic',
        workspace: id(11),
        kind: 'mailbox',
        generation: current.generation,
      }),
      /authorization/,
    );
    await configure('mailbox');
  });
  await t.test(
    'atomic sync checkpoint, duplicate messages, reviewed thread binding and private attachments',
    async () => {
      const lease = await worker('claim');
      assert.equal(lease.mode, 'sync');
      assert.equal(lease.kind, 'mailbox');
      await worker('gate', lease);
      const item = {
        id: 'message1',
        thread: 'thread1',
        body: { subject: 'Fictional CV', text: 'Example only' },
        attachments: [
          {
            part: '1',
            attachmentId: 'attachment1',
            name: 'example.txt',
            size: 3,
            mime: 'text/plain',
          },
        ],
      };
      await worker('sync-finish', {
        ...lease,
        items: [item],
        cursor: '100',
        page: null,
        baseline: '100',
      });
      await assert.rejects(worker('sync-finish', { ...lease, items: [], cursor: '101' }), /lease/);
      await act(2);
      let page = await api('inbox');
      assert.equal(page.rows.length, 1);
      assert.equal(page.rows[0].candidate_id, null);
      const row = page.rows[0],
        op = id(++seq);
      await api(
        'link',
        { message: row.id, evidence: 'Reviewed candidate supplied this thread' },
        op,
        row.head,
        id(21),
      );
      assert.equal(
        (
          await api(
            'link',
            { message: row.id, evidence: 'Reviewed candidate supplied this thread' },
            op,
            row.head,
            id(21),
          )
        ).replayed,
        true,
      );
      await assert.rejects(
        api(
          'link',
          { message: row.id, evidence: 'A conflicting candidate association' },
          op,
          row.head,
          id(22),
        ),
        /unavailable|conflict/i,
      );
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.connections set due_at=clock_timestamp()where kind='mailbox'`,
      );
      const next = await worker('claim');
      await worker('sync-finish', { ...next, items: [item], cursor: '101', page: null });
      await act(2);
      page = await api('inbox', {}, null, null, id(21));
      assert.equal(page.rows.length, 1);
      assert.equal(page.rows[0].attachments.length, 1);
      assert.equal(page.rows[0].candidate_id, id(21));
      // Live attachment release requires a configured and accepted Stage 2 worker; metadata alone cannot release a document.
      assert.equal(page.rows[0].attachments[0].documentId, null);
      const reset = await worker('claim');
      assert.equal(reset.mode, 'idle');
    },
  );
  await t.test(
    'inbound attachment bytes reserve an immutable original and remain quarantined',
    async () => {
      await act(2);
      const message = (await api('inbox', {}, null, null, id(21))).rows[0],
        p = { operation: 'attachment', attachment: message.attachments[0].id };
      assert.equal((await api('preview', p, null, null, id(21))).eligible, false);
      await act(0, 'postgres');
      await db.exec(
        `insert into ecod_processing_private.policies(workspace_id,kind,state,body)values('${id(11)}','processing','enabled','{"owner":"${id(1)}","requireOcr":false}'),('${id(11)}','recovery','enabled','{"owner":"${id(1)}","rpoHours":24}');insert into ecod_processing_private.evidence(id,workspace_id,kind,generation,component,status,body)values('${id(35001)}','${id(11)}','processing',1,'scan','passed','{"engine":"fictional controlled fixture"}'),('${id(35002)}','${id(11)}','recovery',1,'backup','passed','{"fixture":true}'),('${id(35003)}','${id(11)}','recovery',1,'restore','passed','{"fixture":true}');`,
      );
      await act(2);
      const v = await api('preview', p, null, null, id(21)),
        op = id(++seq);
      assert.equal(v.eligible, true);
      await api('quarantine', p, op, v.head, id(21));
      const lease = await worker('claim');
      assert.equal(lease.mode, 'work');
      const g = await worker('gate', lease);
      assert.equal(g.operation, 'attachment');
      await assert.rejects(
        worker('attachment-reserve', { ...lease, hash: 'ab'.repeat(32), size: 4 }),
        /immutable/,
      );
      const manifest = await worker('attachment-reserve', {
        ...lease,
        hash: 'ab'.repeat(32),
        size: 3,
      });
      assert.ok(manifest.path.endsWith('/original.txt'));
      await assert.rejects(
        worker('attachment-reserve', { ...lease, hash: 'cd'.repeat(32), size: 3 }),
        /conflict/,
      );
      await worker('attachment-uploaded', { ...lease, etag: 'fixture-etag' });
      await worker('finish', { ...lease, outcome: 'accepted', providerId: manifest.id });
      await act(0, 'postgres');
      const job = (await db.query('select *from public."documentJobs"where id=$1', [op])).rows[0];
      assert.equal(job.uploaded, true);
      assert.equal(job.scan_status, 'pending');
      assert.equal(job.parse_state, 'quarantined');
      assert.equal(job.extracted, '');
    },
  );
  await act(1);
  await rpc('api_test_communications', [
    'template',
    null,
    id(100),
    null,
    {
      key: 'live-fixture',
      version: 0,
      kind: 'custom',
      purpose: 'recruiting-contact',
      subject: 'Hello {{candidateName}}',
      text: 'Fictional message {{anthroId}}',
      enabled: true,
    },
    0,
  ]);
  await rpc('api_test_communications', [
    'template',
    null,
    id(110),
    null,
    {
      key: 'invite-fixture',
      version: 0,
      kind: 'interview-invite',
      purpose: 'recruiting-contact',
      subject: 'Interview {{candidateName}}',
      text: 'Your interview is {{scheduledAt}}',
      enabled: true,
    },
    0,
  ]);
  await act(2);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(++seq),
    'add',
    id(102),
    0,
    { kind: 'email', value: 'one@e.com', source: 'Candidate supplied contact' },
  ]);
  await rpc('api_change_candidate_contact', [
    id(21),
    id(++seq),
    'verify',
    id(102),
    1,
    { reason: 'Candidate confirmed ownership' },
  ]);
  await db.exec(
    `insert into consents(workspace_id,"candidateId",purpose,status)values('${id(11)}','${id(21)}','recruiting-contact','granted')`,
  );
  await t.test(
    'exact source preparation, ambiguous lease expiry and dispatch hold suppression',
    async () => {
      const p = { operation: 'send', template: id(100), context: {} },
        v = await api('preview', p, null, null, id(21));
      assert.equal(v.eligible, true);
      assert.equal(v.preview.recipient, 'one@e.com');
      const op = id(++seq);
      await api('prepare', p, op, v.head, id(21));
      assert.equal((await api('prepare', p, op, v.head, id(21))).replayed, true);
      await assert.rejects(
        api('prepare', { ...p, extra: 'changed' }, id(++seq), v.head, id(21)),
        /Source changed|Unsupported operation field/,
      );
      const lease = await worker('claim');
      assert.equal(lease.mode, 'work');
      const gate = await worker('gate', lease);
      assert.equal(gate.operation, 'send');
      await act(1);
      await rpc('api_create_subject_request', [
        id(34000),
        id(21),
        'restriction',
        'Candidate requested outbound restriction',
        'email',
      ]);
      await rpc('api_update_subject_request', [
        id(34001),
        id(34000),
        1,
        'verify',
        'Verified candidate through confirmed contact',
      ]);
      await rpc('api_update_subject_request', [
        id(34002),
        id(34000),
        2,
        'start',
        'Reviewed administrator restriction',
      ]);
      await rpc('api_set_subject_outbound_hold', [
        id(34003),
        id(34000),
        3,
        true,
        'Reviewed candidate restriction evidence',
      ]);
      await assert.rejects(worker('gate', lease), /source changed/);
      await act(1);
      await rpc('api_set_subject_outbound_hold', [
        id(34004),
        id(34000),
        4,
        false,
        'Reviewed release of candidate restriction',
      ]);
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.work set lease_until=clock_timestamp()-interval'1 minute';update ecod_collaboration_private.connections set lease_until=clock_timestamp()-interval'1 minute';`,
      );
      await worker('claim');
      await act(2);
      const history = await api('history', {}, null, null, id(21));
      assert.equal(history.rows[0].status, 'Ambiguous');
      await assert.rejects(
        api('retry', { id: op }, id(++seq), history.rows[0].head, id(21)),
        /transition/,
      );
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.work set available_at=clock_timestamp()where id='${op}'`,
      );
      const reconciliation = await worker('claim');
      assert.equal(reconciliation.mode, 'reconcile');
      // Crash before any gate: the previous unknown write must retain reconciliation mode.
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.work set lease_until=clock_timestamp()-interval'1 minute'where id='${op}';update ecod_collaboration_private.connections set lease_until=clock_timestamp()-interval'1 minute'where kind='mailbox'`,
      );
      await worker('claim');
      await act(2);
      assert.equal((await api('history', {}, null, null, id(21))).rows[0].status, 'Ambiguous');
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.work set status='Manual review'where id='${op}'`,
      );
    },
  );
  await t.test(
    'fresh free/busy, overlapping reservations, explicit timezone and RSVP reconciliation',
    async () => {
      await configure('calendar');
      await act(0, 'postgres');
      const start = (
        await db.query(
          "select to_char(date_trunc('minute',clock_timestamp()+interval'2 days')at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')s",
        )
      ).rows[0].s;
      await db.query(
        `insert into interviews(id,workspace_id,"candidateId","scheduledAt","durationMins")values($1,$2,$3,$4,45),($5,$2,$3,$4,45)`,
        [id(201), id(11), id(21), start, id(202)],
      );
      const lease = await worker('claim');
      assert.equal(lease.kind, 'calendar');
      const channel = {
        id: id(38000),
        token: 'ab'.repeat(32),
        resourceId: 'calendar-resource',
        expiration: new Date(Date.now() + 86400000).toISOString(),
        number: '0',
      };
      await worker('channel', { ...lease, channel });
      const hint = {
        channel: channel.id,
        token: channel.token,
        resourceId: channel.resourceId,
        number: '10',
      };
      assert.equal((await worker('hint', hint)).status, 'Hint recorded');
      assert.equal((await worker('hint', { ...hint, number: '9' })).duplicate, true);
      await assert.rejects(worker('hint', { ...hint, token: 'cd'.repeat(32) }), /channel/);
      await worker('sync-finish', {
        ...lease,
        items: [],
        cursor: 'sync1',
        page: null,
        busy: [],
        windowStart: new Date(Date.parse(start) - 86400000).toISOString(),
        windowEnd: new Date(Date.parse(start) + 7 * 86400000).toISOString(),
      });
      await act(2);
      const payload = {
        operation: 'book',
        template: id(110),
        context: { interview: id(201) },
        interview: id(201),
        start,
        local: start.slice(0, 16),
        zone: 'UTC',
      };
      const review = await api('preview', payload, null, null, id(21));
      assert.equal(review.eligible, true);
      const op = id(++seq);
      await api('prepare', payload, op, review.head, id(21));
      const other = { ...payload, context: { interview: id(202) }, interview: id(202) },
        pv = await api('preview', other, null, null, id(21));
      await assert.rejects(api('prepare', other, id(++seq), pv.head, id(21)), /reserved/);
      const l = await worker('claim');
      assert.equal(l.mode, 'work');
      const gate = await worker('gate', l);
      assert.equal(gate.booking.provider_id.replaceAll('-', '').length, 32);
      await worker('finish', {
        ...l,
        outcome: 'accepted',
        providerId: gate.booking.provider_id,
        etag: 'fixture-etag',
      });
      await act(0, 'postgres');
      await db.exec(
        `update ecod_collaboration_private.connections set due_at=clock_timestamp()where kind='calendar'`,
      );
      const sync = await worker('claim');
      await worker('sync-finish', {
        ...sync,
        items: [
          {
            id: gate.booking.provider_id,
            status: 'confirmed',
            start,
            updated: new Date(Date.now() + 1000).toISOString(),
            rsvp: 'accepted',
          },
        ],
        cursor: 'sync2',
        page: null,
      });
      await act(0, 'postgres');
      assert.equal(
        (await db.query('select rsvp from ecod_collaboration_private.bookings')).rows[0].rsvp,
        'accepted',
      );
      await act(2);
      const bad = {
          ...other,
          local: '2026-03-08T02:30',
          zone: 'America/New_York',
          start: '2026-03-08T07:30:00.000Z',
        },
        bv = await api('preview', bad, null, null, id(21));
      await assert.rejects(api('prepare', bad, id(++seq), bv.head, id(21)), /Nonexistent/);
      const later = new Date(Date.parse(start) + 86400000).toISOString(),
        move = { ...payload, operation: 'reschedule', start: later, local: later.slice(0, 16) };
      const mv = await api('preview', move, null, null, id(21));
      assert.ok(mv.preview.text.includes(later), 'reschedule preview uses the proposed time');
      await api('prepare', move, id(++seq), mv.head, id(21));
      const moving = await worker('claim'),
        mg = await worker('gate', moving);
      assert.equal(new Date(mg.booking.old_start).toISOString(), start);
      assert.equal(new Date(mg.booking.starts_at).toISOString(), later);
      await worker('finish', { ...moving, outcome: 'ambiguous' });
      await act(0, 'postgres');
      assert.equal(
        (
          await db.query('select old_start from ecod_collaboration_private.bookings')
        ).rows[0].old_start.toISOString(),
        start,
      );
      await db.exec(
        `update ecod_collaboration_private.work set available_at=clock_timestamp()where id='${moving.id}'`,
      );
      const reconcile = await worker('claim');
      assert.equal(reconcile.mode, 'reconcile');
      await worker('gate', reconcile);
      await worker('finish', {
        ...reconcile,
        outcome: 'accepted',
        providerId: mg.booking.provider_id,
        etag: 'fixture-v2',
      });
      await act(0, 'postgres');
      assert.equal(
        (
          await db.query('select "scheduledAt"from interviews where id=$1', [id(201)])
        ).rows[0].scheduledAt.toISOString(),
        later,
      );
      await act(2);
      const cancel = {
          operation: 'cancel',
          template: id(110),
          interview: id(201),
          context: { interview: id(201) },
          zone: 'UTC',
          local: '',
        },
        cv = await api('preview', cancel, null, null, id(21));
      await api('prepare', cancel, id(++seq), cv.head, id(21));
      const cancelling = await worker('claim');
      await worker('gate', cancelling);
      await worker('finish', {
        ...cancelling,
        outcome: 'accepted',
        providerId: mg.booking.provider_id,
      });
      await act(0, 'postgres');
      assert.equal(
        (await db.query('select state from ecod_collaboration_private.bookings')).rows[0].state,
        'Cancelled',
      );
      assert.equal(
        (await db.query('select status from interviews where id=$1', [id(201)])).rows[0].status,
        'Cancelled',
      );
    },
  );
  await t.test(
    'erasure categories and recovery freeze include every private candidate journal',
    async () => {
      await act(0, 'postgres');
      const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
      assert.equal(inv.counts.length, 74);
      assert.ok(inv.counts.some((x) => x.category === 'mailboxMessages' && x.count > 0));
      assert.equal(
        (await rpc('ecod_ops_private.source_inventory', [id(11), id(21)])).counts.length,
        71,
      );
      await act(0, 'service_role');
      await rpc('worker_processing_recovery', [
        'lockdown',
        { reason: 'Stage 3 isolated recovery fixture' },
      ]);
      await act(0, 'postgres');
      await assert.rejects(
        db.exec('truncate ecod_collaboration_private.messages cascade'),
        /lockdown/,
      );
      assert.equal((await worker('claim')).mode, 'idle');
      await act(0, 'service_role');
      await rpc('worker_processing_recovery', [
        'unlock',
        { reason: 'Stage 3 reviewed fixture unlock' },
      ]);
      await act(1);
      assert.ok((await api('context')).connections.every((x) => x.state === 'paused'));
    },
  );
});
