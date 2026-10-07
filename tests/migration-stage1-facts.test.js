import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { id, stage1Database } from './stage1-harness.js';
test('dated facts require explicit verification, preserve corrections and apply current values transactionally', async (t) => {
  const { db, act, rpc, today, root, files } = await stage1Database(t);
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_stage1_verified_candidate_facts.sql')),
        root,
      ),
      'utf8',
    ),
  );
  await act(2);
  const initial = await rpc('api_candidate_facts', [id(21), 'employment']);
  assert.equal(initial.rows.length, 0);
  assert.equal(initial.latestConfirmed, null);
  const role = {
    company: 'Employer',
    title: 'Engineer',
    location: 'Pune',
    employmentType: 'Permanent',
    startDate: '2024-01-01',
    endDate: null,
    source: 'Candidate employment letter reviewed',
    observed: today,
  };
  const first = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(31),
    initial.head,
    role,
    false,
    true,
    null,
  ]);
  assert.equal(first.rows[0].verification, 'observed');
  assert.equal(first.rows[0].verifiedAt, null);
  assert.equal(first.current.company, 'Employer');
  assert.equal(first.latestConfirmed, null);
  const corrected = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(32),
    first.head,
    { ...role, title: 'Senior engineer' },
    true,
    true,
    id(31),
  ]);
  assert.equal(corrected.rows[0].verification, 'confirmed');
  assert.equal(corrected.rows[0].verifiedBy, id(2));
  assert.ok(corrected.rows[0].verifiedAt);
  assert.equal(corrected.rows.find((r) => r.id === id(31)).superseded, true);
  assert.equal(corrected.current.title, 'Senior engineer');
  assert.equal(corrected.latestConfirmed.id, id(32));
  const replay = await rpc('api_record_candidate_fact', [
    id(21),
    'employment',
    id(32),
    first.head,
    { ...role, title: 'Senior engineer' },
    true,
    true,
    id(31),
  ]);
  assert.equal(replay.replayed, true);
  assert.equal(replay.rows.length, 2);
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'employment',
      id(33),
      initial.head,
      role,
      false,
      false,
      null,
    ]),
    /changed/,
  );
  for (const bad of [
    { ...role, endDate: '2020-01-01' },
    { ...role, startDate: 'yesterday' },
    { ...role, company: ' ' },
    { ...role, observed: '2099-01-01' },
    { ...role, verifiedAt: today },
    { ...role, employmentType: 'Invented' },
  ])
    await assert.rejects(
      rpc('api_record_candidate_fact', [
        id(21),
        'employment',
        id(33),
        corrected.head,
        bad,
        true,
        false,
        null,
      ]),
    );
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'employment',
      id(33),
      corrected.head,
      { ...role, endDate: '2025-01-01' },
      true,
      true,
      null,
    ]),
    /applicable role/,
  );
  await assert.rejects(
    db.query(
      'insert into "employmentHistory"(workspace_id,"candidateId",verification)values($1,$2,$3)',
      [id(11), id(21), 'confirmed'],
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query('update "employmentHistory" set title=$1 where id=$2', ['Forgery', id(32)]),
    /permission denied/,
  );
  const avail = await rpc('api_candidate_facts', [id(21), 'availability']);
  const available = {
    notice: 0,
    earliestStart: null,
    activeStatus: 'Active',
    mode: '',
    source: 'Candidate availability call',
    observed: today,
  };
  const recorded = await rpc('api_record_candidate_fact', [
    id(21),
    'availability',
    id(34),
    avail.head,
    available,
    true,
    true,
    null,
  ]);
  assert.equal(recorded.current.notice, 0);
  assert.equal(recorded.current.mode, '');
  await act(3);
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'employment',
      id(35),
      recorded.head,
      role,
      true,
      true,
      null,
    ]),
    /Editor/,
  );
  await assert.rejects(rpc('api_candidate_facts', [id(21), 'compensation']), /Administrator/);
  await act(4);
  await assert.rejects(rpc('api_candidate_facts', [id(21), 'employment']), /not found/);
  await db.exec('reset role');
  const profile = (
    await db.query('select to_jsonb(c)person from candidates c where id=$1', [id(21)])
  ).rows[0].person;
  assert.equal(profile.verified, '2026-01-01');
  assert.equal(profile.current, 10);
  assert.equal(profile.expected, 12);
  assert.equal(profile.name, 'Person');
  await act(0, 'anon');
  await assert.rejects(rpc('api_candidate_facts', [id(21), 'employment']), /permission denied/);
});
test('currency compensation facts remain admin-only and never invent FX conversion', async (t) => {
  const { act, rpc, today } = await stage1Database(t);
  await act(1);
  const read = () => rpc('api_candidate_facts', [id(21), 'compensation']);
  const initial = await read();
  const amount = {
    kind: 'current',
    amount: 1500000,
    currency: 'INR',
    basis: 'Annual',
    components: { fixed: 1200000, variable: 300000 },
    source: 'Candidate compensation statement',
    observed: today,
  };
  const first = await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(41),
    initial.head,
    amount,
    true,
    true,
    null,
  ]);
  assert.equal(first.current.current, 15);
  assert.equal(first.rows[0].amount, 1500000);
  assert.equal(first.rows[0].amountUnit, 'currency');
  for (const bad of [
    { ...amount, amount: -1 },
    { ...amount, amount: '15' },
    { ...amount, components: { fixed: 1600000 } },
    { ...amount, currency: 'inr' },
    { ...amount, basis: 'Weekly' },
    { ...amount, components: { injected: 1 } },
  ])
    await assert.rejects(
      rpc('api_record_candidate_fact', [
        id(21),
        'compensation',
        id(42),
        first.head,
        bad,
        true,
        false,
        null,
      ]),
    );
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'compensation',
      id(42),
      first.head,
      { ...amount, currency: 'USD' },
      true,
      true,
      null,
    ]),
    /annual INR/,
  );
  const usd = await rpc('api_record_candidate_fact', [
    id(21),
    'compensation',
    id(42),
    first.head,
    { ...amount, currency: 'USD', amount: 50000, components: {} },
    true,
    false,
    null,
  ]);
  assert.equal(usd.current.current, 15);
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'compensation',
      id(43),
      usd.head,
      { ...amount, kind: 'expected' },
      true,
      false,
      id(41),
    ]),
    /preserve compensation kind/,
  );
  await act(2);
  await assert.rejects(read(), /Administrator/);
  await assert.rejects(
    rpc('api_record_candidate_fact', [
      id(21),
      'compensation',
      id(43),
      usd.head,
      amount,
      true,
      false,
      null,
    ]),
    /Administrator/,
  );
});
