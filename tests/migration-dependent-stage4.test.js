import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stage1Database, id } from './stage1-harness.js';

test('Stage 4 controlled external workflows protect review, authority, versions and recovery', async (t) => {
  const { db, act, rpc, root } = await stage1Database(t);
  await db.exec(`update candidates set title='Engineer',skills=array['React','SQL'],experience=5 where id='${id(21)}';
    insert into auth.users values('${id(7)}','reviewer@example.invalid');insert into memberships values('${id(7)}','${id(11)}','admin');
    create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt()to authenticated,anon,service_role;`);
  const api = (a, p = {}, op = null, head = null, c = null, off = 0) =>
    rpc('api_controlled_workflows', [a, c, op, head, p, off]);
  const worker = async (a, p) => {
    await act(0, 'service_role');
    return rpc('worker_controlled_workflows', [a, p]);
  };
  let seq = 40000;
  const policy = async (kind, mode = 'fixture') => {
    await act(1);
    let ctx = await api('context'),
      old = ctx.policies.find((x) => x.kind === kind);
    const config = {
      kind,
      owner: id(1),
      purpose: 'Reviewed professional recruiting workflow',
      rights: 'Fictional local permission and account-rights evidence',
      processing: 'Professional projection only; approved manual review policy',
      costDecision: 'Local fixture budget; no provider billing',
      providerVersion:
        kind === 'ai'
          ? 'fixture-model'
          : kind === 'enrichment'
            ? 'pdl-v5'
            : kind === 'publishing'
              ? 'approved-feed-v1'
              : 'neutral-sign-v1',
      mode,
      dailyLimit: 20,
      attribution: 'Reviewed partner feed',
      currency: 'INR',
    };
    await api('configure', config, id(++seq), old?.head || ctx.defaultHead);
    const current = async () => (await api('context')).policies.find((x) => x.kind === kind);
    await api(
      'evaluate',
      {
        kind,
        cases: 10,
        baselineUtility: 3,
        providerUtility: 4,
        safetyFailures: 0,
        groundingPercent: 100,
        datasetHash: 'a'.repeat(64),
        evidence: 'Independent fictional dataset and baseline review recorded',
        mode,
      },
      id(++seq),
      (await current()).head,
    );
    await api('accept', { kind }, id(++seq), (await current()).head);
    await api('enable', { kind }, id(++seq), (await current()).head);
    return current();
  };
  const prepare = async (kind, c = id(21), p = {}) => {
    await act(1);
    const preview = await api('preview', { kind, ...p }, null, null, c),
      op = id(++seq);
    assert.equal(preview.eligible, true, preview.reason);
    const prepared = await api('prepare', { kind, ...p }, op, preview.head, c);
    return { prepared, preview, op };
  };
  const execute = async (x, content) => {
    const lease = await worker('claim', { id: x.op, workspace: id(11), actor: id(1) });
    const gate = await worker('gate', lease);
    await worker('finish', { ...lease, outcome: 'ok', content });
    return { lease, gate };
  };
  const row = async (x) => {
    await act(1);
    return (await api('browse')).rows.find((r) => r.id === x.op);
  };
  let ai, signing;
  await t.test(
    'tenant, role, MFA, raw grants and complete policy/evaluation evidence',
    async () => {
      await act(3);
      await assert.rejects(api('context'), /Editor/);
      await act(5);
      await assert.rejects(api('context'), /membership/);
      await act(1);
      await assert.rejects(
        db.query('select *from ecod_external_private.work'),
        /permission denied/,
      );
      await assert.rejects(rpc('worker_controlled_workflows', ['claim', {}]), /permission denied/);
      const ctx = await api('context');
      await assert.rejects(
        api('configure', { kind: 'ai' }, id(++seq), ctx.defaultHead),
        /evidence/,
      );
      await policy('ai');
      const q = (await api('context')).policies[0];
      await assert.rejects(
        api('evaluate', { kind: 'ai', mode: 'fixture' }, id(++seq), q.head),
        /evaluation/,
      );
      await act(4);
      await assert.rejects(api('preview', { kind: 'ai' }, null, null, id(21)), /workspace/);
      await act(0, 'postgres');
      await db.exec(
        `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"privilegedMfa":true,"auditedDocumentAccess":true,"auditedCandidateExports":true}');`,
      );
      await act(1);
      await assert.rejects(api('pause', { kind: 'ai' }, id(++seq), q.head), /authenticator/);
      await act(0, 'postgres');
      await db.exec(`update settings set custom='{}';`);
    },
  );
  await t.test('null policy/evaluation values cannot manufacture live acceptance', async () => {
    await act(1);
    const q = (await api('context')).policies.find((x) => x.kind === 'ai');
    await assert.rejects(
      api('configure', { kind: 'ai', ...q.body, mode: null }, id(++seq), q.head),
      /evidence/,
    );
    await assert.rejects(
      api(
        'evaluate',
        {
          kind: 'ai',
          cases: null,
          baselineUtility: 3,
          providerUtility: 4,
          safetyFailures: 0,
          groundingPercent: 100,
          datasetHash: 'a'.repeat(64),
          evidence: 'Null evaluation case must be rejected before acceptance',
          mode: 'fixture',
        },
        id(++seq),
        q.head,
      ),
      /evaluation/,
    );
    await assert.rejects(
      worker('legacy-enrichment-gate', {
        workspace: id(11),
        actor: id(1),
        profile: 'https://www.linkedin.com/in/fixture',
      }),
      /Stage 4/,
    );
  });
  await t.test(
    'source projection and exact receipts never expose identity or compensation',
    async () => {
      ai = await prepare('ai');
      assert.deepEqual(Object.keys(ai.preview.snapshot.fields).sort(), [
        'experience',
        'mode',
        'skills',
        'title',
      ]);
      assert.ok(!JSON.stringify(ai.preview.snapshot).includes('one@e.com'));
      assert.ok(!JSON.stringify(ai.preview.snapshot).includes('current'));
      assert.equal(
        (await api('prepare', { kind: 'ai' }, ai.op, ai.preview.head, id(21))).replayed,
        true,
      );
      await assert.rejects(
        api('prepare', { kind: 'ai', offer: id(2) }, ai.op, ai.preview.head, id(21)),
        /conflict/,
      );
      await assert.rejects(
        api(
          'prepare',
          { kind: 'ai', email: 'private@example.invalid' },
          id(++seq),
          ai.preview.head,
          id(21),
        ),
        /locators/,
      );
    },
  );
  await t.test(
    'literal citations, retained edits and independent acceptance leave candidate facts unchanged',
    async () => {
      const lease = await worker('claim', { id: ai.op, workspace: id(11), actor: id(1) });
      await worker('gate', lease);
      await assert.rejects(
        worker('finish', {
          ...lease,
          outcome: 'ok',
          content: {
            highlights: [{ field: 'title', quote: 'Chief Engineer' }],
            unknowns: [],
            notes: '',
          },
        }),
        /quote/,
      );
      await worker('finish', {
        ...lease,
        outcome: 'ok',
        content: {
          highlights: [{ field: 'title', quote: 'Engineer' }],
          unknowns: ['Certification evidence unknown'],
          notes: '',
          fixture: true,
        },
      });
      let r = await row(ai);
      assert.equal(r.status, 'Review');
      await assert.rejects(
        api(
          'review',
          { id: ai.op, decision: 'accept', reason: 'Reviewed exact grounded professional claims' },
          id(++seq),
          r.head,
          id(21),
        ),
        /Independent/,
      );
      await api(
        'edit',
        {
          id: ai.op,
          content: { ...r.content, notes: 'Reviewer notes; assertions remain unverified' },
          reason: 'Added explicit missing-evidence review notes',
        },
        id(++seq),
        r.head,
        id(21),
      );
      await act(0, 'postgres');
      await db.exec(
        `update ecod_external_private.work set expires_at=clock_timestamp()-interval '1 hour' where id='${ai.op}'`,
      );
      r = await row(ai);
      await act(2);
      await api(
        'review',
        {
          id: ai.op,
          decision: 'accept',
          reason: 'Independent professional citation review complete',
        },
        id(++seq),
        r.head,
        id(21),
      );
      assert.equal(
        (await db.query('select title from candidates where id=$1', [id(21)])).rows[0].title,
        'Engineer',
      );
      const revisions = await api('versions', { id: ai.op });
      assert.equal(revisions.rows.length, 2);
      assert.equal(revisions.rows[1].content.notes, '');
      await assert.rejects(
        api('prepare', { kind: 'ai' }, id(++seq), ai.preview.head, id(21)),
        /duplicate key/,
      );
    },
  );
  await t.test(
    'stale sources, lost leases and revoked actors suppress I/O and never blindly repeat',
    async () => {
      await policy('ai');
      const x = await prepare('ai');
      const lease = await worker('claim', { id: x.op, workspace: id(11), actor: id(1) });
      await worker('gate', lease);
      await db.exec(
        `reset role;update candidates set title='Updated engineer'where id='${id(21)}';`,
      );
      await assert.rejects(worker('gate', lease), /Final source/);
      await db.exec(
        `reset role;update ecod_external_private.work set lease_until=clock_timestamp()-interval'1 second'where id='${x.op}';`,
      );
      const recovered = await worker('claim', { id: x.op, workspace: id(11), actor: id(1) });
      assert.equal(recovered.status, 'Unknown');
      let r = await row(x);
      await api(
        'resolve',
        { id: x.op, evidence: 'Checked provider journal; discarded uncertain draft without retry' },
        id(++seq),
        r.head,
        id(21),
      );
      assert.equal((await row(x)).status, 'Closed by review');
      const y = await prepare('ai');
      await db.exec(
        `reset role;delete from memberships where workspace_id='${id(11)}'and user_id='${id(1)}';`,
      );
      await assert.rejects(
        worker('claim', { id: y.op, workspace: id(11), actor: id(1) }),
        /authority/,
      );
      await db.exec(`reset role;insert into memberships values('${id(1)}','${id(11)}','admin');`);
    },
  );
  await t.test(
    'enrichment requires permitted existing profile and retains assertions instead of updating identity',
    async () => {
      await policy('enrichment');
      await act(1);
      assert.equal(
        (await api('preview', { kind: 'enrichment' }, null, null, id(21))).eligible,
        false,
      );
      await db.exec(
        `reset role;update candidates set linkedin='https://www.linkedin.com/in/fictional-person'where id='${id(21)}';`,
      );
      const x = await prepare('enrichment');
      await execute(x, {
        fields: { title: 'Provider engineer' },
        highlights: [{ field: 'title', quote: 'Provider engineer' }],
        unknowns: [],
        notes: '',
        fixture: true,
      });
      const r = await row(x);
      assert.equal(r.status, 'Review');
      assert.equal(
        (await db.query('select title from candidates where id=$1', [id(21)])).rows[0].title,
        'Updated engineer',
      );
    },
  );
  await t.test(
    'approved job exports bind all public content and preserve external-copy reports after revocation',
    async () => {
      await policy('publishing');
      await act(1);
      await db.exec(
        `insert into demands(id,workspace_id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights,"careersVisible","approvalStatus",description)values('${id(201)}','${id(11)}','Reviewed engineer','Example account',array['React'],0,90,100,'Example','Remote',1,'Medium','Open','2026-11-01','{"skills":30,"experience":20,"readiness":20,"availability":10,"budget":10,"location":10}',true,'Approved','Public role description');`,
      );
      const x = await prepare('publishing', null, { demand: id(201) });
      await execute(x, { fixture: true, export: x.preview.snapshot.fields });
      let r = await row(x);
      const exported = await api('export', { id: x.op }, null, r.head);
      assert.equal(exported.application.source, 'Reviewed partner feed');
      assert.equal(exported.job.title, 'Reviewed engineer');
      await db.exec(
        `reset role;update demands set description='Changed unreviewed text'where id='${id(201)}';`,
      );
      await act(1);
      await assert.rejects(api('export', { id: x.op }, null, r.head), /approved export/);
      await api(
        'report',
        {
          id: x.op,
          outcome: 'withdrawn',
          evidence: 'Operator checked original board and recorded external-copy withdrawal',
        },
        id(++seq),
        r.head,
      );
      r = await row(x);
      assert.equal(r.status, 'Reported withdrawn');
      assert.equal(r.source.fields.description, 'Public role description');
    },
  );
  await t.test(
    'signing is fixture-only, admin-only and bound to complete current approved offer and contact',
    async () => {
      await policy('signing');
      await act(1);
      await db.exec(`insert into offers(id,workspace_id,"candidateId",role,ctc,joining,"approvedAt")values('${id(301)}','${id(11)}','${id(21)}','Approved engineer',100,'2026-11-01',clock_timestamp());
      reset role;insert into ecod_contacts_private.contacts(id,workspace_id,candidate_id,kind,value,normalized,source,verified_at)values('${id(401)}','${id(11)}','${id(21)}','email','person@example.invalid','person@example.invalid','Fixture verified contact',clock_timestamp());
      insert into consents(id,workspace_id,"candidateId",purpose,status,date)values('${id(501)}','${id(11)}','${id(21)}','recruiting-contact','granted',clock_timestamp());`);
      await act(2);
      await assert.rejects(
        api('preview', { kind: 'signing', offer: id(301) }, null, null, id(21)),
        /financial administrator/,
      );
      signing = await prepare('signing', id(21), { offer: id(301) });
      assert.equal(signing.preview.snapshot.recipient, 'person@example.invalid');
      assert.ok(!('notes' in signing.preview.snapshot.fields));
      await execute(signing, { fixture: true, envelope: signing.op, status: 'prepared' });
      assert.equal((await row(signing)).status, 'Fixture prepared');
      await act(2);
      assert.ok(!(await api('browse')).rows.some((x) => x.kind === 'signing'));
    },
  );
  await t.test(
    'authenticated fixture receipts deduplicate, retain order and never claim legal signature or acceptance',
    async () => {
      const event = {
        id: signing.op,
        event: id(++seq),
        generation: signing.preview.generation,
        state: 'completed',
        envelope: signing.op,
      };
      await worker('fixture-event', event);
      assert.equal((await worker('fixture-event', event)).status, 'duplicate');
      await assert.rejects(
        worker('fixture-event', { ...event, state: 'declined' }),
        /replay conflict/,
      );
      await worker('fixture-event', { ...event, event: id(++seq), state: 'accepted' });
      assert.equal((await row(signing)).status, 'Fixture completed');
      assert.equal(
        (await db.query('select status from offers where id=$1', [id(301)])).rows[0].status,
        'Draft',
      );
      await assert.rejects(
        worker('fixture-event', { ...event, event: id(++seq), generation: 999 }),
        /generation mismatch/,
      );
    },
  );
  await t.test(
    'cancelled queued jobs, budget limits and current locator catalogs are bounded',
    async () => {
      await policy('ai');
      const x = await prepare('ai');
      let r = await row(x);
      await api('cancel', { id: x.op }, id(++seq), r.head, id(21));
      assert.equal(
        (await worker('claim', { id: x.op, workspace: id(11), actor: id(1) })).status,
        'Cancelled',
      );
      await act(1);
      const c = await api('catalog', { entity: 'candidates', search: 'Person' });
      assert.equal(c.rows.length, 1);
      assert.equal(c.rows[0].id, id(21));
      await act(2);
      await assert.rejects(api('catalog', { entity: 'offers' }), /Administrator/);
      await act(1);
      let q = (await api('context')).policies.find((p) => p.kind === 'ai');
      await api('configure', { kind: 'ai', ...q.body, dailyLimit: 1 }, id(++seq), q.head);
      const current = async () => (await api('context')).policies.find((p) => p.kind === 'ai');
      await api(
        'evaluate',
        {
          kind: 'ai',
          cases: 10,
          baselineUtility: 3,
          providerUtility: 3,
          safetyFailures: 0,
          groundingPercent: 100,
          datasetHash: 'a'.repeat(64),
          evidence: 'Controlled fixture budget must count all existing daily attempts',
          mode: 'fixture',
        },
        id(++seq),
        (await current()).head,
      );
      await api('accept', { kind: 'ai' }, id(++seq), (await current()).head);
      await api('enable', { kind: 'ai' }, id(++seq), (await current()).head);
      const p = await api('preview', { kind: 'ai' }, null, null, id(21));
      await assert.rejects(api('prepare', { kind: 'ai' }, id(++seq), p.head, id(21)), /budget/);
    },
  );
  await t.test(
    'inventory coverage, idempotent migration and recovery freeze retain journals but pause policies',
    async () => {
      await act(0, 'postgres');
      const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
      assert.equal(inv.counts.length, 78);
      assert.ok(inv.counts.find((x) => x.category === 'controlledWork').count > 0);
      await db.exec('reset role');
      await db.exec(
        await readFile(
          new URL('20261008092747_dependent_stage4_controlled_workflows.sql', root),
          'utf8',
        ),
      );
      await act(0, 'service_role');
      await rpc('worker_processing_recovery', [
        'lockdown',
        { reason: 'Isolated restore fixture; no external workflow enabled' },
      ]);
      await act(0, 'postgres');
      await assert.rejects(
        db.exec('truncate ecod_external_private.revisions'),
        /lockdown|paused|recovery/i,
      );
      await db.exec('reset role');
      assert.ok(
        (await db.query('select state from ecod_external_private.policies')).rows.every(
          (x) => x.state === 'paused',
        ),
      );
    },
  );
});
