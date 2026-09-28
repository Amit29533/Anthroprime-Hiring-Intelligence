import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = [
  '001_ecod.sql',
  '002_blueprint_r1.sql',
  '003_documents_taxonomy.sql',
  '004_admin_settings.sql',
  '005_consents_sync.sql',
  '006_interviews.sql',
  '007_offers_tasks_custom.sql',
  '008_submissions_demand_fields.sql',
  '009_careers_portal.sql',
  '010_sync_pagination.sql',
  '011_automation_portal.sql',
  '012_candidate_portal.sql',
  '013_offer_approvals.sql',
  '014_offer_approval_integrity.sql',
  '015_sync_offer_approval_fields.sql',
  '016_portal_clearable_preferences.sql',
  '017_complete_incremental_feed.sql',
  '018_public_careers_isolation.sql',
  '019_private_application_status.sql',
  '020_clients_contacts.sql',
  '021_user_administration.sql',
  '022_requisitions_departments.sql',
  '023_careers_seo.sql',
  '024_saved_reports.sql',
  '025_skills_model.sql',
  '026_referrals.sql',
  '027_interview_slots.sql',
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const aaravUser = '00000000-0000-4000-8000-000000000004';
const bhavnaUser = '00000000-0000-4000-8000-000000000005';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const aarav = '00000000-0000-4000-8000-000000000021';
const bhavna = '00000000-0000-4000-8000-000000000022';
const demandId = '00000000-0000-4000-8000-000000000031';
const slotA = '00000000-0000-4000-8000-000000000041';
const slotB = '00000000-0000-4000-8000-000000000042';

const WEIGHTS = `'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}'`;

async function boot() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of MIGRATIONS)
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.exec(
    `insert into auth.users values('${admin}','a@e.com'),('${recruiter}','r@e.com'),('${outsider}','o@e.com'),
       ('${aaravUser}','aarav@example.com'),('${bhavnaUser}','bhavna@example.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  await act(admin);
  await db.exec(
    `insert into public.candidates(id,name,email,title,location,skills,status,source) values
       ('${aarav}','Aarav','aarav@example.com','Engineer','Pune','{"SQL"}','Ready','Referral'),
       ('${bhavna}','Bhavna','bhavna@example.com','Engineer','Pune','{"SQL"}','Ready','Referral');
     insert into public.demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights)
       values('${demandId}','Data Engineer','Meridian','{"SQL"}',3,30,20,'Pune','Remote',1,'High','Open',current_date+30,${WEIGHTS});`,
  );
  const slot = (id, candidateId, over = {}) =>
    db.exec(
      `insert into public."interviewSlots"(id,"demandId","candidateId",interviewer,round,mode,"startsAt","durationMins"${over.status ? ',status' : ''})
       values('${id}','${demandId}','${candidateId}','${over.interviewer || 'Priya Raman'}','${over.round || 'Round 1'}','Video',
              now() + interval '${over.inDays || 2} days','45'${over.status ? `,'${over.status}'` : ''});`,
    );
  const call = async (user, sql) => {
    await act(user);
    return (await db.query(`select ${sql} as r`)).rows[0].r;
  };
  return { db, act, slot, call };
}

test('Batch-25: a candidate sees only the slots offered to them', async () => {
  const { db, slot, call } = await boot();
  await slot(slotA, aarav);
  await slot(slotB, bhavna, { interviewer: 'Vikram Shah' });

  const mine = await call(aaravUser, 'public.api_portal_slots()');
  assert.equal(mine.slots.length, 1, 'one slot, and it is theirs');
  assert.equal(mine.slots[0].id, slotA);
  assert.equal(mine.slots[0].role, 'Data Engineer', 'with the role it is for');
  assert.equal(
    mine.slots[0].interviewer,
    undefined,
    'the panel’s identity is withheld — the candidate needs the time, not the name',
  );
  const theirs = await call(bhavnaUser, 'public.api_portal_slots()');
  assert.deepEqual(
    theirs.slots.map((s) => s.id),
    [slotB],
  );
  await db.close();
});

test('Batch-25: past and already-taken slots are never offered', async () => {
  const { db, act, slot, call } = await boot();
  await slot(slotA, aarav, { inDays: -1 });
  await slot(slotB, aarav, { status: 'Booked', interviewer: 'Vikram Shah' });
  const mine = await call(aaravUser, 'public.api_portal_slots()');
  assert.deepEqual(mine.slots, [], 'nothing bookable');
  assert.equal(mine.booked.length, 1, 'but the booked one is shown so they know when to attend');
  await act(admin);
  await db.close();
});

test('Batch-25: booking creates the interview and withdraws the alternatives', async () => {
  const { db, act, slot, call } = await boot();
  await slot(slotA, aarav);
  await slot(slotB, aarav, { interviewer: 'Vikram Shah', inDays: 3 });

  const res = await call(aaravUser, `public.api_portal_book_slot('${slotA}')`);
  assert.equal(res.ok, true);
  assert.ok(res.interviewId, 'an interview was created');

  await act(admin);
  const interview = (
    await db.query(`select * from public.interviews where id='${res.interviewId}'`)
  ).rows[0];
  assert.equal(interview.candidateId, aarav);
  assert.equal(interview.demandId, demandId);
  assert.equal(interview.status, 'Scheduled');
  assert.equal(interview.durationMins, 45);
  assert.match(interview.notes, /Booked by the candidate/);

  const slots = (
    await db.query(
      `select id, status, "interviewId" as iv from public."interviewSlots" order by id`,
    )
  ).rows;
  assert.equal(slots.find((s) => s.id === slotA).status, 'Booked');
  assert.equal(slots.find((s) => s.id === slotA).iv, res.interviewId, 'the slot links to it');
  assert.equal(
    slots.find((s) => s.id === slotB).status,
    'Cancelled',
    'the other offer for the same round is withdrawn, freeing the interviewer',
  );

  const audit = (
    await db.query(`select action, actor from public."auditEvents" where action='self-booked'`)
  ).rows;
  assert.equal(audit.length, 1, 'self-booking is audited');
  assert.equal(audit[0].actor, 'Candidate portal');
  await db.close();
});

test('Batch-25: two candidates racing for one slot — exactly one wins', async () => {
  const { db, act, call } = await boot();
  // A slot deliberately offered to Aarav, and a second identical row offered to Bhavna would
  // be a different row; the real race is one row and two attempts on it.
  await db.exec(
    `insert into public."interviewSlots"(id,"demandId","candidateId",interviewer,"startsAt")
     values('${slotA}','${demandId}','${aarav}','Priya Raman', now() + interval '2 days');`,
  );
  const first = await call(aaravUser, `public.api_portal_book_slot('${slotA}')`);
  const second = await call(aaravUser, `public.api_portal_book_slot('${slotA}')`);
  assert.equal(first.ok, true, 'the first booking succeeds');
  assert.equal(second.ok, undefined, 'the second does not');
  assert.match(second.error, /no longer available/);

  await act(admin);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.interviews`)).rows[0].c,
    1,
    'exactly one interview exists — no double booking',
  );
  await db.close();
});

test('Batch-25: a candidate cannot book a slot offered to somebody else', async () => {
  const { db, act, slot, call } = await boot();
  await slot(slotA, aarav);
  const res = await call(bhavnaUser, `public.api_portal_book_slot('${slotA}')`);
  assert.match(
    res.error,
    /no longer available/,
    'the refusal is identical to "already taken", so a candidate cannot probe for other people’s slots',
  );
  await act(admin);
  assert.equal(
    (await db.query(`select status from public."interviewSlots" where id='${slotA}'`)).rows[0]
      .status,
    'Open',
    'and the slot is untouched',
  );
  await db.close();
});

test('Batch-25: a slot in the past cannot be booked', async () => {
  const { db, slot, call } = await boot();
  await slot(slotA, aarav, { inDays: -1 });
  const res = await call(aaravUser, `public.api_portal_book_slot('${slotA}')`);
  assert.match(res.error, /no longer available/);
  await db.close();
});

test('Batch-25: an unknown slot id is refused without revealing anything', async () => {
  const { db, call } = await boot();
  const res = await call(
    aaravUser,
    `public.api_portal_book_slot('00000000-0000-4000-8000-0000000000ff')`,
  );
  assert.match(res.error, /no longer available/, 'same message for every failure mode');
  await db.close();
});

test('Batch-25: an interviewer cannot be published as free twice at the same moment', async () => {
  const { db, act, slot } = await boot();
  await slot(slotA, aarav);
  await act(admin);
  await assert.rejects(
    db.exec(
      `insert into public."interviewSlots"(id,"demandId","candidateId",interviewer,"startsAt")
       select '${slotB}','${demandId}','${bhavna}',interviewer,"startsAt" from public."interviewSlots" where id='${slotA}';`,
    ),
    /interview_slots_no_double_booking|duplicate key/i,
    'the same person cannot be in two places at once',
  );
  await db.close();
});

test('Batch-25: slots are tenant-scoped, audited and in the sync feed', async () => {
  const { db, act, slot } = await boot();
  await slot(slotA, aarav);
  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public."interviewSlots"`)).rows[0].c,
    0,
    'another workspace sees nothing',
  );
  await act(admin);
  const feed = (await db.query(`select public.api_changes_since(current_date - 1) as f`)).rows[0].f;
  assert.equal(feed.interviewSlots.length, 1);
  assert.equal(feed.interviewSlots[0].workspace_id, undefined, 'workspace_id stripped');
  const page = (await db.query(`select public.api_changes_page(current_date - 1,0,50) as f`))
    .rows[0].f;
  assert.equal(page.interviewSlots.length, 1);
  assert.deepEqual(
    (
      await db.query(`select action from public.history where "entityType"='interviewSlots'`)
    ).rows.map((r) => r.action),
    ['interviewSlots created'],
  );
  await db.close();
});

test('Batch-25: a viewer cannot publish availability', async () => {
  const { db, act } = await boot();
  await db.exec(
    `reset role;update public.memberships set role='viewer' where user_id='${recruiter}';`,
  );
  await act(recruiter);
  await assert.rejects(
    db.exec(
      `insert into public."interviewSlots"("demandId","candidateId",interviewer,"startsAt") values('${demandId}','${aarav}','X', now() + interval '1 day');`,
    ),
    /row-level security|permission denied/i,
  );
  await db.close();
});
