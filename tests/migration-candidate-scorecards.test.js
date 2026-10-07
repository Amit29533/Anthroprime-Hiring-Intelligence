import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('sealed scorecards preserve rubric evidence and server authorship, replay safely and resolve same-day readiness chronology', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url),
    files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  const migration = files.find((n) => n.endsWith('_candidate_scorecards.sql'));
  for (const file of files.filter((n) => n !== migration))
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,verified) values('${id(101)}','${id(11)}','One','one@e.com',current_date),('${id(102)}','${id(11)}','Survivor','two@e.com',current_date),('${id(103)}','${id(12)}','Other','other@e.com',current_date);
    insert into "assessmentTemplates"(id,workspace_id,name,rubric) values('${id(301)}','${id(11)}','Technical review','[{"id":"technical","label":"Technical","weight":70,"maxScore":5},{"id":"communication","label":"Communication","weight":30,"maxScore":5}]');
    insert into assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence) values('${id(401)}','${id(11)}','${id(101)}','Legacy one',90,'Legacy reviewer',current_date,'Legacy review evidence'),('${id(402)}','${id(11)}','${id(101)}','Legacy two',30,'Legacy reviewer',current_date,'Legacy review evidence');`);
  await db.exec(await readFile(new URL(migration, path), 'utf8'));
  await db.exec(await readFile(new URL(migration, path), 'utf8'));
  assert.equal(
    (await db.query(`select "recordedAt" from assessments where id='${id(401)}'`)).rows[0]
      .recordedAt,
    null,
    'migration does not invent legacy recording times',
  );
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const read = (person = 101, offset = 0, templatesOffset = 0) =>
    rpc('api_candidate_scorecards', [id(person), offset, templatesOffset]);
  const readiness = (person = 101) => rpc('api_candidate_readiness', [id(person), 0]);
  const date = (await db.query('select current_date::text as day')).rows[0].day;
  const record = (
    op = 501,
    scores = { technical: 4, communication: 5 },
    version = 1,
    person = 101,
    evidence = 'Observed reasoning and communication during review',
  ) =>
    rpc('api_record_candidate_scorecard', [
      id(person),
      id(op),
      id(301),
      version,
      scores,
      date,
      evidence,
    ]);
  await act(2);
  let page = await read();
  assert.equal(page.rows.length, 0);
  assert.equal(page.templates.length, 1);
  assert.ok((await readiness()).blockers.some((s) => s.includes('share the latest date')));
  const first = await record();
  assert.equal(first.score, 86);
  assert.equal((await record()).replayed, true);
  await assert.rejects(record(501, { technical: 5, communication: 5 }), /operation conflict/);
  page = await read();
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].recordedBy, id(2));
  assert.equal(page.rows[0].templateSnapshot.version, 1);
  assert.ok(page.rows[0].recordedAt);
  assert.ok(page.rows[0].recordedSequence > 0);
  assert.equal(
    (await readiness()).eligible,
    true,
    'new server chronology resolves the legacy same-day ambiguity',
  );
  await assert.rejects(record(502, { technical: 6, communication: 5 }), /out of range/);
  await assert.rejects(record(502, { technical: 4 }), /criterion/);
  await assert.rejects(record(502, { technical: 4, communication: 5, extra: 1 }), /Unknown rubric/);
  await assert.rejects(record(502, { technical: '4', communication: 5 }), /criterion/);
  await assert.rejects(record(502, undefined, 1, 101, 'short'), /Invalid/);
  await assert.rejects(
    db.exec(`update assessments set title='Rewrite' where id='${id(501)}'`),
    /sealed/,
  );
  await assert.rejects(
    db.exec(`update assessments set "recordedBy"='${id(1)}' where id='${id(501)}'`),
    /provenance/,
  );
  await assert.rejects(
    db.exec(`update assessments set "scorecardRequestHash"=null where id='${id(501)}'`),
    /provenance/,
  );
  await assert.rejects(
    db.exec(`update assessments set evidence='Changed evidence' where id='${id(501)}'`),
    /immutable/,
  );
  await assert.rejects(
    db.query('select nextval($1::regclass)', [
      'ecod_readiness_private.assessment_recording_sequence',
    ]),
    /permission denied/,
  );
  await act(1);
  await assert.rejects(record(), /operation conflict/);
  let review = await readiness();
  await rpc('api_decide_candidate_readiness', [
    id(101),
    id(601),
    review.headId,
    review.fingerprint,
    'Ready',
    30,
    'Reviewed current sealed assessment evidence',
  ]);
  await db.exec(`update "assessmentTemplates" set name='Updated rubric' where id='${id(301)}'`);
  assert.equal(
    (await readiness()).state,
    'Ready',
    'later template changes do not rewrite recorded evidence',
  );
  await act(2);
  assert.equal((await record()).replayed, true, 'retry remains valid after rubric changes');
  await db.exec(`insert into assessments select * from assessments where id='${id(501)}'
    on conflict(id) do update set title=excluded.title,"templateSnapshot"=excluded."templateSnapshot",
    "recordedAt"=excluded."recordedAt","recordedBy"=excluded."recordedBy","recordedSequence"=excluded."recordedSequence"`);
  assert.equal(
    (await read()).rows[0].templateSnapshot.version,
    1,
    'UPSERT preserves the frozen rubric after edits',
  );
  await assert.rejects(record(502), /Rubric changed/);
  await record(502, { technical: 1, communication: 1 }, 2);
  review = await readiness();
  assert.equal(review.assessment.id, id(502));
  assert.equal(review.state, 'Needs review');
  assert.equal(review.eligible, false);
  assert.equal(
    (await read()).rows.find((r) => r.id === id(501)).templateSnapshot.name,
    'Technical review',
  );
  await db.exec(
    `insert into assessments(id,workspace_id,"candidateId",title,score,assessor,date,evidence,"recordedAt","recordedBy","recordedSequence") values('${id(503)}','${id(11)}','${id(101)}','Legacy entry',80,'Declared reviewer',current_date,'New declared assessment evidence','2000-01-01','${id(1)}',999999)`,
  );
  const spoof = (
    await db.query(
      `select "recordedAt"::text,"recordedBy","recordedSequence" from assessments where id='${id(503)}'`,
    )
  ).rows[0];
  assert.equal(spoof.recordedBy, id(2));
  assert.notEqual(spoof.recordedSequence, 999999);
  assert.ok(!spoof.recordedAt.startsWith('2000-01-01'));
  await act(3);
  assert.equal((await read()).rows.length, 2);
  await assert.rejects(record(504, undefined, 2), /Editor/);
  await act(4);
  await assert.rejects(read(), /not found/);
  await assert.rejects(record(504, undefined, 2), /not found/);
  assert.equal((await read(103)).templates.length, 0);
  await act(1);
  await db.exec(
    `insert into assessments select (jsonb_populate_record(null::public.assessments,to_jsonb(a)||jsonb_build_object('candidateId','${id(102)}'))).* from assessments a where "candidateId"='${id(101)}'
    on conflict(id) do update set "candidateId"=excluded."candidateId","templateSnapshot"=excluded."templateSnapshot",
    "recordedAt"=excluded."recordedAt","recordedBy"=excluded."recordedBy","recordedSequence"=excluded."recordedSequence";
    update candidates set "mergedInto"='${id(102)}',email='' where id='${id(101)}'`,
  );
  page = await read();
  assert.equal(page.candidateId, id(102));
  assert.equal(page.rows.length, 2);
  assert.equal(page.rows[1].recordedBy, id(2));
  assert.equal(
    (await db.query(`select "recordedAt" from assessments where id='${id(401)}'`)).rows[0]
      .recordedAt,
    null,
    'legacy UPSERTs keep unknown provenance',
  );
  await assert.rejects(record(504, undefined, 2), /not found/);
  for (let i = 700; i < 751; i++) await record(i, { technical: 5, communication: 5 }, 2, 102);
  assert.equal((await read(102)).rows.length, 50);
  assert.equal((await read(102)).more, true);
  assert.equal((await read(102, 50)).rows.length, 3);
  await assert.rejects(read(102, -1), /page/);
  await db.exec('reset role');
  const scope = (
    await db.query(`select ecod_private.erasure_inventory('${id(11)}','${id(102)}') as scope`)
  ).rows[0].scope;
  assert.equal(scope.counts.find((c) => c.category === 'assessments').count, 56);
  await act(0, 'anon');
  await assert.rejects(read(102), /permission denied/);
  await act(0);
  await assert.rejects(read(102), /membership/);
});
