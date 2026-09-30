import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('migration 032 secures templates and pools, snapshots rubric evidence and includes incremental changes', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((name) => /^\d+.*\.sql$/.test(name)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(await readFile(new URL('032_repository_structures.sql', path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','outside@e.com');
    insert into public.workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Outside');
    insert into public.memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`);
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
    );
  await act(1);
  await db.exec(`insert into public.candidates(id,name,email) values('${id(21)}','Aarav','a@e.com');
    insert into public."assessmentTemplates"(id,name,rubric,"validityDays") values('${id(31)}','Technical review','[{"id":"tech","label":"Technical","weight":70,"maxScore":5},{"id":"comm","label":"Communication","weight":30,"maxScore":5}]',30);
    insert into public."talentPools"(id,name) values('${id(41)}','Silver medalists');`);
  await assert.rejects(
    db.exec(
      `insert into public."assessmentTemplates"(name,rubric) values('Broken','[{"id":"a","label":"A","weight":40,"maxScore":5}]')`,
    ),
    /check constraint/,
  );
  await act(2);
  await assert.rejects(
    db.exec(
      `insert into public."assessmentTemplates"(name,rubric) values('Recruiter template','[{"id":"a","label":"A","weight":100,"maxScore":5}]')`,
    ),
    /row.level security/,
  );
  await db.exec(`insert into public."poolMembers"(id,"poolId","candidateId") values('${id(51)}','${id(41)}','${id(21)}');
    insert into public.assessments(id,"candidateId",title,score,assessor,date,evidence,"templateId","rubricScores","templateSnapshot","validUntil")
    values('${id(61)}','${id(21)}','Technical review',1,'Assessor',current_date,'Observed project evidence','${id(31)}','{"tech":4,"comm":3}','{"version":999}',current_date+999);`);
  const recorded = (
    await db.query(
      `select score,"templateSnapshot","validUntil"=date+30 as correct_expiry from public.assessments where id='${id(61)}'`,
    )
  ).rows[0];
  assert.equal(Number(recorded.score), 74);
  assert.equal(recorded.templateSnapshot.version, 1);
  assert.equal(recorded.correct_expiry, true);
  await assert.rejects(
    db.exec(`update public.assessments set score=100 where id='${id(61)}'`),
    /immutable/,
  );
  await assert.rejects(
    db.exec(
      `insert into public.assessments("candidateId",title,score,assessor,date,evidence,"templateId","rubricScores") values('${id(21)}','Invalid',90,'Assessor',current_date,'Evidence','${id(31)}','{"tech":6,"comm":3}')`,
    ),
    /out of range/,
  );
  await db.exec(`update public."poolMembers" set active=false where id='${id(51)}'`);
  assert.equal((await db.query('select count(*)::int as c from public.candidates')).rows[0].c, 1);
  await db.exec(`update public."poolMembers" set active=true where id='${id(51)}'`);
  await act(1);
  await db.exec(
    `update public."assessmentTemplates" set name='Technical review v2',"validityDays"=60 where id='${id(31)}'`,
  );
  assert.equal(
    (await db.query(`select version from public."assessmentTemplates" where id='${id(31)}'`))
      .rows[0].version,
    2,
  );
  assert.equal(
    (await db.query(`select "templateSnapshot" from public.assessments where id='${id(61)}'`))
      .rows[0].templateSnapshot.version,
    1,
  );
  await db.exec(`update public."talentPools" set archived=true where id='${id(41)}'`);
  await assert.rejects(
    db.exec(`update public."poolMembers" set active=true where id='${id(51)}'`),
    /Restore the pool/,
  );
  const feed = (await db.query('select public.api_changes_since(current_date-1) as feed')).rows[0]
    .feed;
  for (const table of ['assessmentTemplates', 'talentPools', 'poolMembers']) {
    assert.equal(feed[table].length, 1);
    assert.equal(feed[table][0].workspace_id, undefined);
  }
  assert.equal(feed.assessments[0].templateSnapshot.version, 1);
  const events = (
    await db.query(
      `select "entityType" from public.history where "entityType" in ('assessmentTemplates','talentPools','poolMembers')`,
    )
  ).rows;
  assert.ok(events.length >= 6);
  await act(3);
  assert.equal(
    (await db.query('select count(*)::int as c from public."talentPools"')).rows[0].c,
    1,
  );
  await assert.rejects(
    db.exec(`insert into public."talentPools"(name) values('Viewer pool')`),
    /row.level security/,
  );
  assert.deepEqual(
    (
      await db.query(
        `update public."poolMembers" set active=false where id='${id(51)}' returning id`,
      )
    ).rows,
    [],
  );
  await act(4);
  for (const table of ['assessmentTemplates', 'talentPools', 'poolMembers'])
    assert.equal((await db.query(`select count(*)::int as c from public."${table}"`)).rows[0].c, 0);
  await db.exec(`insert into public."talentPools"(id,name) values('${id(42)}','Outside pool')`);
  await assert.rejects(
    db.exec(
      `insert into public."poolMembers"("poolId","candidateId") values('${id(42)}','${id(21)}')`,
    ),
    /foreign key/,
  );
  await db.exec('reset role;set role anon;');
  await assert.rejects(db.query('select * from public."assessmentTemplates"'), /permission denied/);
});
