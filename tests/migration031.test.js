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
  '028_assignment_rules.sql',
  '029_placements.sql',
  '030_document_storage_provider.sql',
  '031_serialize_admin_changes.sql',
];

async function boot() {
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
  for (const migration of MIGRATIONS) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'),
    );
  }
  return db;
}

test('membership-removal RPCs lock the workspace and recheck admin authority before counting', async () => {
  const db = await boot();
  for (const signature of [
    'public.api_set_member_role(uuid,text)',
    'public.api_remove_member(uuid)',
  ]) {
    const { rows } = await db.query(
      `select pg_get_functiondef('${signature}'::regprocedure) as definition`,
    );
    const definition = rows[0].definition.toLowerCase();
    const lock = definition.indexOf('for update');
    const recheck = definition.indexOf('user_id = auth.uid()');
    const count = definition.indexOf('select count(*)::int into admin_count');
    assert.notEqual(lock, -1, `${signature} serializes changes on the workspace row`);
    assert.ok(recheck > lock, `${signature} rechecks the acting admin after acquiring the lock`);
    assert.ok(count > recheck, `${signature} counts current admins after the recheck`);
  }
  await db.close();
});
