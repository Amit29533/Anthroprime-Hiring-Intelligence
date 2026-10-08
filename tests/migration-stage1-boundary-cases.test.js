import test from 'node:test';
import assert from 'node:assert/strict';
import { id, stage1Database } from './stage1-harness.js';

test('offers, import staging, revoked financial approval and server read audit enforce financial authority', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await act(1);
  await rpc('api_save_offers', [[{ id: id(91), candidateId: id(21), role: 'Engineer', ctc: 19 }]]);
  await rpc('api_create_import', [id(92), 'Financial review', 1, {}]);
  await rpc('api_stage_import', [
    id(92),
    1,
    [
      {
        row: 1,
        sourceLine: 2,
        candidate: { name: 'Incoming', email: 'incoming@e.com', current: 7, expected: 9 },
      },
    ],
  ]);
  assert.equal((await rpc('api_import_page', [id(92), 0])).rows[0].candidate.expected, 9);
  await act(2);
  await assert.rejects(db.query('select payload from "importRows"'), /permission denied/);
  assert.equal((await db.query('select batch_id,status from "importRows"')).rows.length, 1);
  const staged = await rpc('api_import_page', [id(92), 0]);
  assert.equal(staged.rows[0].candidate.expected, undefined);
  const offers = (await rpc('api_legacy_rows', ['offers'])).rows;
  assert.equal(offers[0].ctc, undefined);
  assert.equal(offers[0].approvedTerms, undefined);
  await assert.rejects(db.query('select ctc from offers'), /permission denied/);
  await assert.rejects(rpc('api_save_offers', [[{ id: id(91), ctc: 0 }]]), /administrator/);
  await assert.rejects(db.query('update offers set ctc=0 where id=$1', [id(91)]), /administrator/);
  const updated = await rpc('api_save_offers', [[{ id: id(91), notes: 'Interview follow-up' }]]);
  assert.equal(updated.rows[0].notes, 'Interview follow-up');
  await assert.rejects(
    rpc('api_stage_import', [
      id(92),
      2,
      [
        {
          row: 1,
          sourceLine: 2,
          candidate: { name: 'Incoming', email: 'incoming@e.com', expected: 0 },
        },
      ],
    ]),
    /administrator/,
  );
  await rpc('api_candidate_facts', [id(21), 'employment']);
  await rpc('api_legacy_rows', ['candidates']);
  await act(1);
  assert.equal((await rpc('api_legacy_rows', ['offers'])).rows[0].ctc, 19);
  await assert.rejects(rpc('api_save_candidates', [[{ id: id(21), current: 'NaN' }]]), /finite/);
  await assert.rejects(rpc('api_save_offers', [[{ id: id(91), ctc: 'Infinity' }]]), /finite/);
  await rpc('api_import_action', [id(92), 2, 'approve']);
  await db.exec(`reset role;update memberships set role='recruiter'where user_id='${id(1)}';`);
  await act(0, 'service_role');
  const result = await rpc('worker_run_imports', [10]);
  assert.equal(result.paused, true);
  assert.match(result.reason, /Financial approval revoked/);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select status from "importBatches"where id=$1', [id(92)])).rows[0].status,
    'paused',
  );
  assert.equal(
    (
      await db.query('select count(*)::integer n from candidates where email=$1', [
        'incoming@e.com',
      ])
    ).rows[0].n,
    0,
  );
  const audits = (
    await db.query(
      `select *from "auditEvents"where workspace_id=$1 and "entityId"=$2 and action='server_read'`,
      [id(11), id(21)],
    )
  ).rows;
  assert.ok(audits.some((a) => a.actor === id(2) && a.detail.includes('employment')));
  assert.ok(audits.some((a) => a.actor === id(2) && /legacy/i.test(a.detail)));
});

test('confirmation freshness is field-specific and quality follows the applicable confirmed facts', async (t) => {
  const { db, act, rpc, today } = await stage1Database(t);
  await act(2);
  const read = () => rpc('api_candidate_facts', [id(21), 'employment']);
  let c = await read();
  assert.deepEqual(c.confirmationState, { state: 'unconfirmed', stale: true });
  const role = {
    company: 'Employer',
    title: 'Engineer',
    location: 'Pune',
    employmentType: 'Permanent',
    startDate: '2024-01-01',
    endDate: null,
    source: 'Employment document',
    observed: today,
  };
  c = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(101),
    c.head,
    role,
    true,
    true,
    null,
  ]);
  assert.equal(c.confirmationState.state, 'matches-current');
  assert.equal(c.confirmationState.stale, false);
  assert.equal((await rpc('api_repository_quality', ['employment-fact-review'])).rows.length, 0);
  await db.query('update candidates set title=$1 where id=$2', ['Architect', id(21)]);
  c = await read();
  assert.equal(c.confirmationState.state, 'current-differs');
  assert.equal((await rpc('api_repository_quality', ['employment-fact-review'])).rows.length, 1);
  c = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(102),
    c.head,
    { ...role, title: 'Architect' },
    false,
    false,
    id(101),
  ]);
  assert.equal(c.latestConfirmed, null);
  assert.equal(c.confirmationState.state, 'unconfirmed');
  const old = (
    await db.query("select ((statement_timestamp()at time zone'UTC')::date-121)::text d")
  ).rows[0].d;
  c = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(103),
    c.head,
    { ...role, title: 'Architect', observed: old },
    true,
    false,
    null,
  ]);
  assert.equal(c.confirmationState.state, 'matches-current');
  assert.equal(c.confirmationState.stale, true);
  assert.equal((await rpc('api_repository_quality', ['employment-fact-review'])).rows.length, 1);
  await act(1);
  let pay = await rpc('api_candidate_facts', [id(21), 'compensation']);
  const salary = {
    kind: 'expected',
    amount: 0,
    currency: 'INR',
    basis: 'Annual',
    components: { fixed: 0 },
    source: 'Pay discussion',
    observed: today,
  };
  pay = await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(104),
    pay.head,
    salary,
    true,
    true,
    null,
  ]);
  assert.equal(pay.confirmationState.expected.state, 'matches-current');
  assert.equal(pay.confirmationState.current.state, 'unconfirmed');
  pay = await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(105),
    pay.head,
    { ...salary, kind: 'current', amount: 1200000, components: {}, observed: old },
    true,
    true,
    null,
  ]);
  assert.equal(pay.current.current, 12);
  assert.equal(pay.current.expected, 0);
  assert.equal(pay.confirmationState.current.stale, true);
  assert.equal(pay.confirmationState.expected.stale, false);
  assert.equal(pay.latestConfirmedByKind.current.id, id(105));
  assert.equal(pay.latestConfirmedByKind.expected.id, id(104));
});
