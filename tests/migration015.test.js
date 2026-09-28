import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 015 exports approval-only offer changes through both sync RPCs', async () => {
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
    '015_sync_offer_approval_fields.sql',
  ];
  for (const file of files) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  const admin = '00000000-0000-4000-8000-000000000001';
  const workspace = '00000000-0000-4000-8000-000000000011';
  const candidate = '00000000-0000-4000-8000-000000000021';
  const offer = '00000000-0000-4000-8000-000000000031';
  await db.exec(`
    insert into auth.users values ('${admin}', 'admin@example.com');
    insert into public.workspaces(id, name) values ('${workspace}', 'Test workspace');
    insert into public.memberships values ('${admin}', '${workspace}', 'admin');
    select set_config('request.jwt.claim.sub', '${admin}', false);
    set role authenticated;
  `);
  await db.exec(`
    insert into public.candidates(id, name, email)
      values ('${candidate}', 'Offer Candidate', 'offer.candidate@example.com');
    insert into public."settings"(id, custom)
      values ('workspace', '{"offerApprovals":true}'::jsonb);
    insert into public.offers(id, "candidateId", role, location, ctc, joining, status, created)
      values ('${offer}', '${candidate}', 'Architect', 'Bengaluru', 28, '2027-01-01', 'Draft', now() - interval '60 days');
    update public.offers set "approvedAt"=now() where id='${offer}';
  `);
  const day = (await db.query('select current_date::text as day')).rows[0].day;

  const simple = (await db.query(`select public.api_changes_since('${day}'::date) as payload`))
    .rows[0].payload;
  assert.equal(
    simple.offers.length,
    1,
    'approval of an old draft makes it appear even though created/sent/decision dates are old or empty',
  );
  assert.equal(simple.offers[0].id, offer);
  assert.equal(simple.offers[0].approvedBy, 'admin@example.com');
  assert.ok(simple.offers[0].approvedAt);
  assert.deepEqual(simple.offers[0].approvedTerms, {
    candidateId: candidate,
    demandId: null,
    role: 'Architect',
    location: 'Bengaluru',
    ctc: 28,
    joining: '2027-01-01',
  });

  const page = (await db.query(`select public.api_changes_page('${day}'::date, 0, 1) as payload`))
    .rows[0].payload;
  assert.equal(page.offers.length, 1, 'the paginated endpoint includes the changed offer too');
  assert.equal(page.offers[0].approvedBy, 'admin@example.com');
  assert.deepEqual(page.offers[0].approvedTerms, simple.offers[0].approvedTerms);

  // Re-approval invalidation is itself a change. Even though approvedAt is now NULL, the
  // history-backed filter returns the new record state for downstream consumers.
  await db.exec(`update public.offers set ctc=32 where id='${offer}';`);
  const invalidated = (await db.query(`select public.api_changes_since('${day}'::date) as payload`))
    .rows[0].payload;
  assert.equal(invalidated.offers.length, 1);
  assert.equal(Number(invalidated.offers[0].ctc), 32);
  assert.equal(invalidated.offers[0].approvedAt, null);
  assert.equal(invalidated.offers[0].approvedBy, '');
  assert.equal(invalidated.offers[0].approvedTerms, null);
  await db.close();
});
