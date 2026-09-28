import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 014 binds approvals to admin identity and an immutable terms snapshot', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  const files = [
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
  ];
  for (const file of files) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  const admin = '00000000-0000-4000-8000-000000000001';
  const recruiter = '00000000-0000-4000-8000-000000000002';
  const workspace = '00000000-0000-4000-8000-000000000011';
  const candidate = '00000000-0000-4000-8000-000000000021';
  const draft1 = '00000000-0000-4000-8000-000000000031';
  const draft2 = '00000000-0000-4000-8000-000000000032';
  const sentWithoutGate = '00000000-0000-4000-8000-000000000033';
  await db.exec(`
    insert into auth.users values
      ('${admin}', 'approver@example.com'), ('${recruiter}', 'recruiter@example.com');
    insert into public.workspaces(id, name) values ('${workspace}', 'Test workspace');
    insert into public.memberships values
      ('${admin}', '${workspace}', 'admin'), ('${recruiter}', '${workspace}', 'recruiter');
  `);
  const act = (user) =>
    db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${user}', false);
    set role authenticated;
  `);

  await act(admin);
  await db.exec(`
    insert into public.candidates(id, name, email)
      values ('${candidate}', 'Offer Candidate', 'offer.candidate@example.com');
    insert into public."settings"(id, custom)
      values ('workspace', '{"offerApprovals":true}'::jsonb);
    insert into public.offers(id, "candidateId", role, location, ctc, joining, status)
      values ('${draft1}', '${candidate}', 'Architect', 'Bengaluru', 28, '2027-01-01', 'Draft');
  `);

  await act(recruiter);
  await assert.rejects(
    () =>
      db.exec(`
    update public.offers
       set status='Sent', "approvedAt"=now(), "approvedBy"='Admin'
     where id='${draft1}';
  `),
    /Only a workspace admin can approve an offer/i,
    'a recruiter cannot forge an approval while sending',
  );
  await assert.rejects(
    () =>
      db.exec(`
    insert into public.offers(id, "candidateId", role, ctc, status, "approvedAt", "approvedBy")
      values ('${sentWithoutGate}', '${candidate}', 'Forged offer', 35, 'Sent', now(), 'Admin');
  `),
    /Only a workspace admin can approve an offer/i,
    'the same bypass is blocked on insert',
  );

  await act(admin);
  await db.exec(`
    update public.offers
       set "approvedAt"=now(), "approvedBy"='client supplied text'
     where id='${draft1}';
  `);
  const granted = (
    await db.query(`
    select "approvedAt", "approvedBy", "approvedTerms"
      from public.offers where id='${draft1}'
  `)
  ).rows[0];
  assert.ok(granted.approvedAt, 'the admin approval is recorded');
  assert.equal(
    granted.approvedBy,
    'approver@example.com',
    'the actor comes from the authenticated identity',
  );
  assert.deepEqual(
    granted.approvedTerms,
    {
      candidateId: candidate,
      demandId: null,
      role: 'Architect',
      location: 'Bengaluru',
      ctc: 28,
      joining: '2027-01-01',
    },
    'the database snapshots the exact approved terms',
  );

  await act(recruiter);
  await db.exec(`update public.offers set status='Sent' where id='${draft1}';`);
  assert.equal(
    (await db.query(`select status from public.offers where id='${draft1}'`)).rows[0].status,
    'Sent',
    'a recruiter can send the unchanged package after an admin approves it',
  );

  await assert.rejects(
    () =>
      db.exec(`
    update public.offers set ctc=99 where id='${draft1}';
  `),
    /requires admin approval of the current offer terms/i,
    'changing a sent package cannot preserve the old approval and remain Sent',
  );
  const afterBlockedChange = (
    await db.query(`
    select status, ctc, "approvedAt" from public.offers where id='${draft1}'
  `)
  ).rows[0];
  assert.equal(afterBlockedChange.status, 'Sent');
  assert.equal(Number(afterBlockedChange.ctc), 28, 'the rejected edit is rolled back');
  assert.ok(
    afterBlockedChange.approvedAt,
    'and the old approval remains intact for the unchanged sent offer',
  );

  // A recruiter may prepare a changed draft, but that automatically voids its old approval.
  await act(admin);
  await db.exec(`
    insert into public.offers(id, "candidateId", role, location, ctc, joining, status)
      values ('${draft2}', '${candidate}', 'Engineer', 'Pune', 30, '2027-02-01', 'Draft');
    update public.offers set "approvedAt"=now() where id='${draft2}';
  `);
  await act(recruiter);
  await db.exec(`update public.offers set ctc=32 where id='${draft2}';`);
  const invalidated = (
    await db.query(`
    select status, ctc, "approvedAt", "approvedBy", "approvedTerms"
      from public.offers where id='${draft2}'
  `)
  ).rows[0];
  assert.equal(Number(invalidated.ctc), 32, 'the new terms can be saved as a draft');
  assert.equal(invalidated.approvedAt, null, 'the previous stamp is cleared');
  assert.equal(invalidated.approvedBy, '', 'the approver is cleared');
  assert.equal(invalidated.approvedTerms, null, 'the old terms snapshot is cleared');
  await assert.rejects(
    () => db.exec(`update public.offers set status='Sent' where id='${draft2}';`),
    /requires admin approval of the current offer terms/i,
    'the changed draft must be approved again before it can be sent',
  );

  await act(admin);
  await db.exec(
    `update public."settings" set custom='{"offerApprovals":false}'::jsonb where id='workspace';`,
  );
  await act(recruiter);
  await db.exec(`
    insert into public.offers(id, "candidateId", role, ctc, status)
      values ('${sentWithoutGate}', '${candidate}', 'No approval required', 25, 'Sent');
  `);
  assert.equal(
    (await db.query(`select status from public.offers where id='${sentWithoutGate}'`)).rows[0]
      .status,
    'Sent',
    'the database respects an explicitly disabled approval policy',
  );

  await db.close();
});
