import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 016 makes cloud portal clears explicit and validates self-service availability', async () => {
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
    '016_portal_clearable_preferences.sql',
  ];
  for (const file of files) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  const admin = '00000000-0000-4000-8000-000000000001';
  const candidateUser = '00000000-0000-4000-8000-000000000002';
  const workspace = '00000000-0000-4000-8000-000000000011';
  const candidate = '00000000-0000-4000-8000-000000000021';
  await db.exec(`
    insert into auth.users values
      ('${admin}', 'admin@example.com'), ('${candidateUser}', 'person@example.com');
    insert into public.workspaces(id, name) values ('${workspace}', 'Test workspace');
    insert into public.memberships values ('${admin}', '${workspace}', 'admin');
    select set_config('request.jwt.claim.sub', '${admin}', false);
    set role authenticated;
    insert into public.candidates(id, name, email, notice, current, expected, "earliestStart", "activeStatus", mode, engagement, "preferredLocations")
      values ('${candidate}', 'Portal Person', 'person@example.com', 45, 29, 38, '2026-10-15', 'Passive', 'Hybrid', 'Contract', 'Bengaluru, Remote');
    select set_config('request.jwt.claim.sub', '${candidateUser}', false);
  `);

  const cleared = (
    await db.query(`select public.api_portal_update(
    '{"notice":null,"earliestStart":null,"expected":null,"engagement":"","preferredLocations":"","current":999,"status":"Ready"}'::jsonb
  ) as result`)
  ).rows[0].result;
  assert.equal(cleared.ok, true);
  await db.exec('reset role;');
  let row = (
    await db.query(`
    select notice, expected, "earliestStart", "activeStatus", mode, engagement, "preferredLocations", current, status
      from public.candidates where id='${candidate}'
  `)
  ).rows[0];
  assert.equal(row.notice, null, 'JSON null explicitly clears notice to unknown');
  assert.equal(row.expected, null, 'JSON null explicitly clears expected compensation');
  assert.equal(row.earliestStart, null, 'JSON null explicitly clears the earliest start date');
  assert.equal(row.activeStatus, 'Passive');
  assert.equal(row.mode, 'Hybrid');
  assert.equal(row.engagement, '', 'blank text preferences can be removed');
  assert.equal(row.preferredLocations, '');
  assert.equal(Number(row.current), 29, 'the portal cannot edit recruiter-only current CTC');
  assert.equal(row.status, 'Assessing', 'the portal cannot edit recruiter-owned readiness status');

  await db.exec(
    `set role authenticated; select public.api_portal_update('{"notice":15}'::jsonb); reset role;`,
  );
  row = (
    await db.query(
      `select notice, "earliestStart", "activeStatus", mode from public.candidates where id='${candidate}'`,
    )
  ).rows[0];
  assert.equal(row.notice, 15, 'provided values update');
  assert.equal(row.earliestStart, null, 'omitted fields are preserved rather than cleared');
  assert.equal(row.activeStatus, 'Passive');
  assert.equal(row.mode, 'Hybrid');

  await assert.rejects(
    () => db.query(`select public.api_portal_update('{"notice":"366"}'::jsonb);`),
    /Notice period must be a whole number from 0 to 365 days/i,
  );
  await assert.rejects(
    () => db.query(`select public.api_portal_update('{"notice":"-1"}'::jsonb);`),
    /Notice period must be a whole number from 0 to 365 days/i,
  );
  await assert.rejects(
    () => db.query(`select public.api_portal_update('{"expected":"-1"}'::jsonb);`),
    /Expected CTC must be a finite non-negative number/i,
  );
  await assert.rejects(
    () => db.query(`select public.api_portal_update('{"expected":"NaN"}'::jsonb);`),
    /Expected CTC must be a finite non-negative number/i,
  );
  await assert.rejects(
    () => db.query(`select public.api_portal_update('{"activeStatus":"Unavailable"}'::jsonb);`),
    /Choose Active or Passive availability status/i,
  );
  await db.close();
});
