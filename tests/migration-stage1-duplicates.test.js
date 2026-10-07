import test from 'node:test';
import assert from 'node:assert/strict';
import { id, stage1Database } from './stage1-harness.js';
test('reviewed duplicates preserve identity aliases, evidence, contacts and safe transactional retries', async (t) => {
  const { db, act, rpc, today } = await stage1Database(t);
  await db.exec(
    `update candidates set name='Same',company='Employer',phone='9876543210'where id='${id(21)}';insert into candidates(id,workspace_id,name,email,company,phone)values('${id(23)}','${id(11)}','Same','duplicate@e.com','Employer','9876543211');insert into notes(workspace_id,"candidateId",text)values('${id(11)}','${id(23)}','Retained note');insert into "employmentHistory"(workspace_id,"candidateId",company,title,source)values('${id(11)}','${id(23)}','Past employer','Developer','Legacy record');`,
  );
  await act(2);
  const suggestions = await rpc('api_duplicate_queue');
  assert.equal(suggestions.rows.length, 1);
  assert.match(suggestions.rows[0].reason, /Name and employer/);
  const context = () => rpc('api_duplicate_context', [id(21), id(23)]);
  const first = await context();
  assert.equal(first.a.current, undefined);
  assert.ok(!first.fields.includes('expected'));
  const decide = (op, c, status, picks = {}) =>
    rpc('api_duplicate_decision', [
      id(21),
      id(23),
      id(op),
      c.head,
      status,
      'Reviewed original records',
      picks,
    ]);
  const distinct = await decide(71, first, 'distinct');
  assert.equal(distinct.status, 'distinct');
  assert.equal((await rpc('api_duplicate_queue')).rows.length, 0);
  assert.equal((await rpc('api_duplicate_queue', [0, true])).rows.length, 1);
  assert.equal((await decide(71, first, 'distinct')).replayed, true);
  await assert.rejects(
    decide(79, first, 'deferred'),
    /changed/,
    'a newer human decision invalidates older contexts',
  );
  await assert.rejects(decide(71, first, 'deferred'), /conflict/);
  await db.query('update candidates set title=$1 where id=$2', ['Engineer', id(23)]);
  assert.equal((await rpc('api_duplicate_queue')).rows.length, 1);
  await assert.rejects(
    decide(72, first, 'merged', Object.fromEntries(first.fields.map((k) => [k, 'a']))),
    /changed/,
  );
  const fresh = await context();
  await assert.rejects(decide(72, fresh, 'merged', { name: 'a' }), /every permitted field/);
  const picks = Object.fromEntries(fresh.fields.map((k) => [k, k === 'title' ? 'b' : 'a']));
  await assert.rejects(
    decide(72, fresh, 'merged', { ...picks, expected: 'b' }),
    /every permitted field/,
  );
  await act(3);
  await assert.rejects(decide(72, fresh, 'merged', picks), /Editor/);
  await act(4);
  await assert.rejects(context(), /not found/);
  await act(2);
  const merged = await decide(72, fresh, 'merged', picks);
  assert.equal(merged.survivor, id(21));
  assert.equal(merged.retired, id(23));
  assert.equal((await decide(72, fresh, 'merged', picks)).replayed, true);
  const formerId = fresh.b.anthroId;
  const resolved = await rpc('api_candidate_by_anthro_id', [formerId]);
  assert.equal(resolved.candidateId, id(21));
  const section = await rpc('api_candidate_section', [id(21), 'notes', 0]);
  assert.equal(section.rows.length, 1);
  assert.equal(section.rows[0].candidateId, id(23));
  const facts = await rpc('api_candidate_facts', [id(21), 'employment']);
  assert.equal(facts.rows[0].candidateId, id(23));
  assert.equal(facts.rows[0].verification, 'observed');
  const contacts = await rpc('api_candidate_contacts', [id(21)]);
  assert.ok(contacts.rows.some((c) => c.value === 'duplicate@e.com' && c.verified_at === null));
  const profile = await rpc('api_candidate_section', [id(21), 'profile', 0]);
  assert.equal(profile.candidate.title, 'Engineer');
  assert.equal(profile.candidate.verified, '2026-01-01');
  await db.exec('reset role');
  const tombstone = (await db.query('select *from candidates where id=$1', [id(23)])).rows[0];
  assert.equal(tombstone.mergedInto, id(21));
  assert.equal(tombstone.email, '');
  assert.equal(tombstone.phone, '');
  const root = (await db.query('select current,expected from candidates where id=$1', [id(21)]))
    .rows[0];
  assert.equal(Number(root.current), 10);
  assert.equal(Number(root.expected), 12);
  assert.ok(today);
});

test('duplicate review history is paged, stale human decisions fail, and blocked merges leave both identities intact', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await db.exec(
    `insert into candidates(id,workspace_id,name,email)values('${id(23)}','${id(11)}','Second','second@e.com');`,
  );
  await act(2);
  const context = (offset = 0) => rpc('api_duplicate_context', [id(21), id(23), offset]);
  let c = await context();
  for (let i = 0; i < 27; i++) {
    await rpc('api_duplicate_decision', [
      id(21),
      id(23),
      id(200 + i),
      c.head,
      'deferred',
      'Needs a source comparison',
      {},
    ]);
    const fresh = await context();
    assert.notEqual(fresh.head, c.head);
    c = fresh;
  }
  assert.equal(c.events.length, 25);
  assert.equal(c.eventsMore, true);
  const next = await context(25);
  assert.equal(next.events.length, 2);
  assert.equal(next.eventsMore, false);
  assert.equal(new Set([...c.events, ...next.events].map((e) => e.id)).size, 27);
  await db.exec(
    `reset role;insert into settings(workspace_id,id,custom)values('${id(11)}','workspace','{"auditedCandidateExports":true}');`,
  );
  await act(1);
  await rpc('api_create_subject_request', [
    id(231),
    id(23),
    'restriction',
    'Reviewed restriction',
    'email',
  ]);
  await rpc('api_update_subject_request', [id(232), id(231), 1, 'verify', 'Identity reviewed']);
  await rpc('api_update_subject_request', [id(233), id(231), 2, 'start', 'Restriction reviewed']);
  await rpc('api_set_subject_outbound_hold', [id(234), id(231), 3, true, 'Hold during review']);
  await act(2);
  c = await context();
  await assert.rejects(
    rpc('api_duplicate_decision', [
      id(21),
      id(23),
      id(230),
      c.head,
      'merged',
      'Identity reviewed',
      Object.fromEntries(c.fields.map((k) => [k, 'a'])),
    ]),
    /hold|restrict/i,
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select "mergedInto"from candidates where id=$1', [id(23)])).rows[0].mergedInto,
    null,
  );
  assert.equal(
    (await db.query('select email from candidates where id=$1', [id(21)])).rows[0].email,
    'one@e.com',
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::integer n from ecod_access_private.duplicate_events where id=$1',
        [id(230)],
      )
    ).rows[0].n,
    0,
  );
});
