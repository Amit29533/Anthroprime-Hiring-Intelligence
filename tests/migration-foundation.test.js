import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stage1Database, id } from './stage1-harness.js';

test('Foundation Milestone full-chain API contracts and recovery', async (t) => {
  const h = await stage1Database(t);
  const { db, act, rpc } = h;
  const call = (action, payload = {}, operation = null, offset = 0) =>
    rpc('api_foundation', [action, payload, offset, operation]);
  await act(1);
  await t.test('migration replay, private isolation and current role boundaries', async () => {
    await db.exec('reset role');
    await db.exec(
      await readFile(new URL('20261008035834_foundation_milestone.sql', h.root), 'utf8'),
    );
    await act(1);
    await assert.rejects(
      db.query('select * from ecod_foundation_private.views'),
      /permission denied/,
    );
    await assert.rejects(rpc('ecod_foundation_private.hash', [{}]), /permission denied/);
    const ctx = await call('context');
    assert.ok(Array.isArray(ctx.fields));
    await act(4);
    assert.equal((await call('filter', { filters: {} })).rows[0].id, id(22));
    await db.exec('reset role');
    await db.exec(`insert into memberships values('${id(5)}','${id(11)}','assessor')`);
    await act(5);
    await assert.rejects(call('context'), /membership/);
    await act(1);
  });
  await t.test(
    'typed filters, unknowns, exact receipts, archive conflicts and cursor binding',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `insert into settings(id,workspace_id,custom)values('workspace','${id(11)}','{"customFields":{"candidates":[{"name":"Rating","type":"number"},{"name":"Region","type":"select","options":["East","West"]}]}}'); update candidates set custom='{"Rating":0,"Region":"East"}',notice=0,experience=3 where id='${id(21)}'`,
      );
      await act(1);
      const ctx = await call('context');
      const field = ctx.fields.find((f) => f.name === 'Rating');
      const filters = {
        version: 1,
        base: { maxNotice: '0', minExperience: '2', sort: 'experience' },
        custom: [{ id: field.id, version: field.version, op: 'eq', value: 0 }],
      };
      const page = await call('filter', { filters });
      assert.equal(page.rows.length, 1);
      assert.equal(page.count, 1);
      const saved = { name: 'Zero is known', filters };
      await call('save-view', saved, id(700));
      assert.equal((await call('save-view', saved, id(700))).replayed, true);
      await assert.rejects(call('save-view', { ...saved, name: 'Changed' }, id(700)), /conflict/);
      await assert.rejects(
        call('filter', { filters: { ...filters, custom: [{ ...filters.custom[0], value: '0' }] } }),
        /Numeric/,
      );
      await assert.rejects(
        call('filter', { filters: { minExperience: 10, maxExperience: 1 } }),
        /range/,
      );
      await assert.rejects(
        call('filter', { filters: { version: 2, base: {}, custom: [] } }),
        /version/,
      );
      await act(2);
      await assert.rejects(
        call('filter', { filters: { maxExpected: 20, payCurrency: 'INR', payBasis: 'Annual' } }),
        /administrator/,
      );
      await act(1);
      await assert.rejects(call('filter', { filters: { maxExpected: 20 } }), /currency/);
      await db.exec('reset role');
      await db.exec(
        `update settings set custom=jsonb_set(custom,'{customFields,candidates,0,archived}','true')where workspace_id='${id(11)}'`,
      );
      await act(1);
      await assert.rejects(call('filter', { filters }), /archived/);
      assert.equal((await call('context')).views[0].filters.custom[0].value, 0);
    },
  );
  await t.test(
    'quality review preserves errors, rejects false resolution and reopens changed evidence',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `insert into taxonomy(id,workspace_id,custom)values('workspace','${id(11)}','{"skills":[],"aliases":{"Broken":""},"domains":{}}')`,
      );
      await act(2);
      const row = (await call('quality')).rows[0];
      const payload = {
        kind: row.kind,
        target: row.target,
        head: row.head,
        status: 'Reviewed',
        assignee: id(2),
        reason: 'Reviewed source issue',
      };
      await call('quality-decide', payload, id(701));
      assert.equal((await call('quality')).rows[0].status, 'Reviewed');
      await assert.rejects(
        call(
          'quality-decide',
          { ...payload, head: (await call('quality')).rows[0].head, status: 'Resolved' },
          id(702),
        ),
        /Correct the source/,
      );
      await assert.rejects(
        call('quality-decide', { ...payload, status: 'Deferred' }, id(703)),
        /changed/,
      );
      await db.exec('reset role');
      await db.exec(
        `update taxonomy set custom=jsonb_set(custom,'{skills}','["New"]')where workspace_id='${id(11)}'`,
      );
      await act(2);
      assert.equal((await call('quality')).rows[0].status, 'Needs review');
      await db.exec('reset role');
      await db.exec(
        `update taxonomy set custom=jsonb_set(custom,'{aliases}','{}')where workspace_id='${id(11)}'`,
      );
      await act(2);
      const history = await call('quality-history', { kind: row.kind, target: row.target });
      assert.equal(history.canResolve, true);
      await call('quality-decide', { ...payload, head: history.head, status: 'Resolved' }, id(704));
      assert.equal(
        (await call('quality-history', { kind: row.kind, target: row.target })).rows[0].status,
        'Resolved',
      );
    },
  );
  await t.test('task handoff ownership, lost acknowledgements and revoked assignees', async () => {
    await db.exec('reset role');
    await db.exec(
      `insert into tasks(id,workspace_id,title,"candidateId")values('${id(80)}','${id(11)}','Call candidate','${id(21)}')`,
    );
    await act(2);
    let row = (await call('tasks')).rows[0];
    assert.equal(row.id, id(80));
    const payload = {
      id: row.id,
      head: row.head,
      assignee: id(2),
      done: false,
      reason: 'Taking responsibility today',
    };
    await call('task-act', payload, id(705));
    assert.equal((await call('task-act', payload, id(705))).replayed, true);
    row = (await call('tasks', { scope: 'mine' })).rows[0];
    assert.equal(row.assignee, id(2));
    await assert.rejects(
      call('task-act', { ...payload, head: row.head, assignee: id(3) }, id(706)),
      /editor/,
    );
    await call('task-act', { ...payload, head: row.head, assignee: id(1), done: true }, id(707));
    await assert.rejects(
      call(
        'task-act',
        { ...payload, head: (await call('tasks', { state: 'completed' })).rows[0].head },
        id(708),
      ),
      /Only current owner/,
    );
    assert.equal((await call('task-history', { id: id(80) })).rows.length, 2);
    await db.exec('reset role');
    await db.exec(`update auth.users set email='admin-renamed@e.com'where id='${id(1)}'`);
    await act(1);
    assert.equal(
      (await call('tasks', { state: 'completed', scope: 'mine' })).rows[0].assignee,
      id(1),
      'UUID ownership survives changed Auth email',
    );
    await db.exec('reset role');
    await db.exec(`update auth.users set email='admin@e.com'where id='${id(1)}'`);
    await act(2);
    await act(3);
    await assert.rejects(call('task-act', payload, id(709)), /Editor/);
    await act(1);
    const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]).catch(() => null);
    // Raw inventory helper remains ungranted; formal scope exercised separately below.
    assert.equal(inv, null);
  });
  await t.test(
    'discovery and report denominators stay distinct, search is literal and export source checked',
    async () => {
      await act(1);
      const report = await call('report', { filters: {} });
      assert.equal(report.evaluated, 1);
      assert.equal(report.cohorts.unknown, 1);
      const criteria = { filters: {}, head: report.head };
      const exported = await call('export-report', criteria, id(710));
      assert.equal(exported.rows, undefined);
      assert.equal((await call('export-report', criteria, id(710))).replayed, true);
      await db.exec('reset role');
      await db.exec(`update candidates set title='Changed evidence'where id='${id(21)}'`);
      await act(1);
      await assert.rejects(call('export-report', criteria, id(711)), /changed/);
      const matches = await call('discovery', { filters: {} });
      assert.equal(matches.rows[0].eligibility, 'unknown');
      assert.equal(matches.rows[0].score, 0);
      assert.equal(matches.rows[0].custom, undefined);
      assert.equal((await call('search', { query: '%%' })).rows.length, 0);
      await act(2);
      assert.equal((await call('search', { query: 'Person' })).rows[0].kind, 'candidate');
      await act(1);
    },
  );
  await t.test(
    'confirmed pay uses latest declared units, unknown cannot pass, and definition types stay exact',
    async () => {
      await act(1);
      const read = () => rpc('api_candidate_facts', [id(21), 'compensation']);
      let ctx = await read();
      const details = {
        kind: 'expected',
        amount: 1500000,
        currency: 'INR',
        basis: 'Annual',
        components: {},
        source: 'Candidate statement reviewed',
        observed: h.today,
      };
      await rpc('api_record_candidate_fact', [
        id(21),
        'compensation',
        id(720),
        ctx.head,
        details,
        true,
        false,
        null,
      ]);
      const filters = { maxExpected: 1600000, payCurrency: 'INR', payBasis: 'Annual' };
      assert.equal((await call('filter', { filters })).rows.length, 1);
      assert.equal(
        (await call('filter', { filters: { ...filters, payCurrency: 'USD' } })).rows.length,
        0,
      );
      ctx = await read();
      await rpc('api_record_candidate_fact', [
        id(21),
        'compensation',
        id(721),
        ctx.head,
        { ...details, amount: 2000000 },
        true,
        false,
        null,
      ]);
      assert.equal(
        (await call('filter', { filters })).rows.length,
        0,
        'newer high pay cannot fall back to old passing amount',
      );
      await assert.rejects(
        call('filter', { filters: { version: null, base: {}, custom: [] } }),
        /version/,
      );
      await act(3);
      await assert.rejects(call('export-report', { filters: {} }, id(722)), /Editor/);
      await act(1);
    },
  );
  await t.test(
    '25-row keyset pages, literal predicates, unknowns, and tenant-bound cursors',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `insert into candidates(id,workspace_id,name,email,notice,experience,skills,custom)select ('79000000-0000-4000-8000-'||lpad((800+n)::text,12,'0'))::uuid,'${id(11)}','Tied','fixture'||n||'@e.com',case when n%2=0 then 0 else null end,5,array['React'],'{}'from generate_series(1,60)n`,
      );
      await act(1);
      let cursor = null;
      const ids = [];
      do {
        const page = await call('filter', {
          filters: { query: 'Tied', sort: 'experience' },
          cursor,
        });
        assert.ok(page.rows.length <= 25);
        ids.push(...page.rows.map((r) => r.id));
        cursor = page.next;
      } while (cursor);
      assert.equal(ids.length, 60);
      assert.equal(new Set(ids).size, 60);
      assert.equal((await call('filter', { filters: { query: 'Tied', maxNotice: 0 } })).count, 30);
      const first = await call('filter', { filters: { query: 'Tied' } });
      await assert.rejects(
        call('filter', { filters: { query: 'Person' }, cursor: first.next }),
        /changed/,
      );
      await act(4);
      await assert.rejects(
        call('filter', { filters: { query: 'Tied' }, cursor: first.next }),
        /changed/,
      );
      await act(1);
      assert.equal((await call('filter', { filters: { query: '%%' } })).count, 0);
      await db.exec('reset role');
      const inv = await rpc('ecod_private.erasure_inventory', [id(11), id(21)]);
      assert.equal(inv.counts.length, 74);
      assert.ok(inv.counts.some((x) => x.category === 'foundationTasks'));
      const source = await rpc('ecod_ops_private.source_inventory', [id(11), id(21)]);
      assert.equal(source.counts.length, 71);
      const plans = await db.query(
        `explain select *from ecod_foundation_private.task_events where workspace_id='${id(11)}'and task_id='${id(80)}'order by sequence desc limit 25`,
      );
      assert.ok(plans.rows.length > 0);
      await act(1);
    },
  );
  await t.test(
    'group identity preserves missing values and long labels, and weighted discovery respects evidence',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `update settings set custom=jsonb_set(custom,'{customFields,candidates}',(custom#>'{customFields,candidates}')||'[{"name":"Group","type":"text"}]'::jsonb)where workspace_id='${id(11)}';update candidates set custom=jsonb_build_object('Group',case when id='${id(801)}'then 'Unknown' when id='${id(802)}'then repeat('a',130)||'x'when id='${id(803)}'then repeat('a',130)||'y'else null end)where workspace_id='${id(11)}';insert into demands(id,workspace_id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(51)}','${id(11)}','Foundation Engineer','Fixture client',array['React'],2,30,20,'Pune','Remote',1,'High',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}');`,
      );
      await act(1);
      const field = (await call('context')).fields.find((f) => f.name === 'Group');
      const report = await call('report', { filters: {}, group: field.id });
      assert.equal(report.groups.length, 4);
      assert.equal(
        report.groups.reduce((n, g) => n + g.count, 0),
        61,
      );
      assert.equal(report.groups.filter((g) => g.value === 'Unknown').length, 2);
      assert.equal(report.groups.filter((g) => g.unknown).length, 1);
      assert.equal(new Set(report.groups.map((g) => g.id)).size, 4);
      assert.equal(report.groups.filter((g) => g.value === 'a'.repeat(120)).length, 2);
      const p = { filters: { query: 'Tied' }, demandId: id(51) };
      const discovery = await call('discovery', p);
      assert.equal(discovery.evaluated, 60);
      assert.equal(discovery.rows[0].matchedSkills, 1);
      assert.equal(discovery.rows[0].score, 77.8);
      assert.equal(discovery.rows[0].eligibility, 'unknown');
      assert.equal((await call('discovery', { ...p, eligibleOnly: true })).rows.length, 0);
      assert.equal((await call('report', p)).heatmap[0].observed, 60);
      assert.equal((await call('report', p)).heatmap[0].missing, 0);
      await call('discovery', { ...p, head: discovery.head }, null, 25);
      await db.exec('reset role');
      await db.exec(`update candidates set experience=6 where id='${id(801)}'`);
      await act(1);
      await assert.rejects(call('discovery', { ...p, head: discovery.head }, null, 25), /changed/);
      await assert.rejects(call('discovery', { ...p, demandId: id(999) }), /unavailable/);
      await assert.rejects(call('report', { ...p, eligibleOnly: true }), /denominator/);
      const latest = await call('report', {});
      for (let n = 0; n < 5; n++) await call('export-report', { head: latest.head }, id(750 + n));
      await assert.rejects(call('export-report', { head: latest.head }, id(759)), /quota/);
      await act(3);
      await assert.rejects(call('task-act', {}, id(760)), /Editor/);
      await act(1);
    },
  );
  await t.test(
    'typed date, text and choice criteria reject blanks and malformed values without broadening',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `update settings set custom=jsonb_set(custom,'{customFields,candidates}',(custom#>'{customFields,candidates}')||'[{"name":"Measure","type":"number"},{"name":"Started","type":"date"},{"name":"Note","type":"text"}]'::jsonb)where workspace_id='${id(11)}';update candidates set custom='{"Measure":"","Started":"","Note":"100% checked","Region":"East"}'where id='${id(21)}';`,
      );
      await act(1);
      const fields = (await call('context')).fields;
      const predicate = (name, op, value) => {
        const f = fields.find((x) => x.name === name);
        return { id: f.id, version: f.version, op, ...(value === undefined ? {} : { value }) };
      };
      const filter = (custom) =>
        call('filter', { filters: { version: 1, base: { query: 'Person' }, custom } });
      assert.equal((await filter([predicate('Measure', 'gte', 0)])).count, 0);
      assert.equal((await filter([predicate('Started', 'lte', h.today)])).count, 0);
      assert.equal((await filter([predicate('Measure', 'missing')])).count, 1);
      assert.equal((await filter([predicate('Note', 'contains', '%')])).count, 1);
      assert.equal((await filter([predicate('Region', 'eq', 'East')])).count, 1);
      await assert.rejects(filter([predicate('Region', 'eq', 'Unavailable')]), /choice/);
      await assert.rejects(filter([predicate('Started', 'gte', '2026-02-30')]), /date/);
      await db.exec('reset role');
      await db.exec(
        `update candidates set custom=jsonb_set(jsonb_set(custom,'{Measure}','0'),'{Started}',to_jsonb('${h.today}'::text))where id='${id(21)}'`,
      );
      await act(1);
      assert.equal(
        (await filter([predicate('Measure', 'gte', 0), predicate('Started', 'eq', h.today)])).count,
        1,
      );
    },
  );

  await t.test(
    'role downgrade redacts flat personal financial views and invalidates privileged receipts',
    async () => {
      await act(1);
      await call(
        'save-view',
        {
          name: 'Zz financial flat',
          filters: { maxExpected: 1600000, payCurrency: 'INR', payBasis: 'Annual' },
        },
        id(770),
      );
      const report = await call('report', {});
      await db.exec('reset role');
      await db.exec(
        `update memberships set role='recruiter'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
      );
      await act(1);
      const view = (await call('context')).views.find((v) => v.id === id(770));
      assert.equal(view.restricted, true);
      assert.equal(view.filters.maxExpected, undefined);
      assert.equal(view.filters.payCurrency, undefined);
      assert.ok(view.filters);
      await assert.rejects(
        call(
          'save-view',
          {
            name: 'Zz financial flat',
            filters: { maxExpected: 1600000, payCurrency: 'INR', payBasis: 'Annual' },
          },
          id(770),
        ),
        /conflict/,
      );
      assert.notEqual((await call('report', {})).head, report.head);
      await db.exec('reset role');
      await db.exec(
        `update memberships set role='admin'where user_id='${id(1)}'and workspace_id='${id(11)}'`,
      );
      await act(1);
    },
  );
  await t.test(
    '1001-identity population reports the evaluation cap and never returns the full repository',
    async () => {
      await db.exec('reset role');
      await db.exec(
        `insert into candidates(id,workspace_id,name,email)select ('79000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'${id(11)}','Volume fixture','volume'||n||'@e.com'from generate_series(1,940)n`,
      );
      await act(1);
      const page = await call('discovery', { filters: {} });
      assert.equal(page.total, 1001);
      assert.equal(page.evaluated, 1000);
      assert.equal(page.bounded, true);
      assert.equal(page.rows.length, 25);
      assert.equal(page.more, true);
      assert.ok(page.rows.every((r) => !('custom' in r) && !('email' in r)));
    },
  );
});
