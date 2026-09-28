import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 018 isolates public careers reads and validates consent and open published roles', async () => {
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
    '017_complete_incremental_feed.sql',
    '018_public_careers_isolation.sql',
  ];
  for (const file of files) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  const adminA = '00000000-0000-4000-8000-000000000001';
  const adminB = '00000000-0000-4000-8000-000000000002';
  const workspaceA = '00000000-0000-4000-8000-000000000011';
  const workspaceB = '00000000-0000-4000-8000-000000000012';
  const publishedA = '00000000-0000-4000-8000-000000000031';
  const privateA = '00000000-0000-4000-8000-000000000032';
  const closedA = '00000000-0000-4000-8000-000000000033';
  const publishedB = '00000000-0000-4000-8000-000000000034';

  await db.exec(`
    insert into auth.users values
      ('${adminA}', 'admin-a@example.com'), ('${adminB}', 'admin-b@example.com');
    insert into public.workspaces(id, name) values
      ('${workspaceA}', 'Workspace A'), ('${workspaceB}', 'Workspace B');
    insert into public.memberships values
      ('${adminA}', '${workspaceA}', 'admin'), ('${adminB}', '${workspaceB}', 'admin');
  `);

  const demandSql = (id, workspace, title, status, visible, budget) => `
    insert into public.demands(
      id, workspace_id, title, client, skills, "minExperience", "maxNotice", budget,
      location, mode, positions, priority, status, target, description, weights, "careersVisible"
    ) values (
      '${id}', '${workspace}', '${title}', 'Private Client Name', '{SQL}', 3, 30, ${budget},
      'Remote', 'Remote', 1, 'Medium', '${status}', current_date + 30,
      'Public role description',
      '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}',
      ${visible}
    );
  `;
  const setMember = (user) =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`,
    );

  await setMember(adminA);
  await db.exec(demandSql(publishedA, workspaceA, 'Workspace A published role', 'Open', true, 99));
  await db.exec(demandSql(privateA, workspaceA, 'Workspace A internal role', 'Open', false, 88));
  await db.exec(demandSql(closedA, workspaceA, 'Workspace A closed role', 'Closed', true, 77));
  await setMember(adminB);
  await db.exec(demandSql(publishedB, workspaceB, 'Workspace B published role', 'Open', true, 66));
  await db.exec(`
    insert into public."publicApplications"("demandId", workspace_id, name, email)
    values ('${publishedB}', '${workspaceB}', 'Priya Applicant', 'priya@example.com');
  `);

  await db.exec('reset role; set role anon;');
  await assert.rejects(
    () => db.query('select * from public.demands'),
    /permission denied/i,
    'anonymous callers cannot use table-level SELECT to retrieve internal columns or other tenants',
  );

  const rolesA = await db.query(`select * from public.api_public_open_roles('${workspaceA}')`);
  const rolesB = await db.query(`select * from public.api_public_open_roles('${workspaceB}')`);
  assert.deepEqual(
    rolesA.rows.map((role) => role.id),
    [publishedA],
  );
  assert.deepEqual(
    rolesB.rows.map((role) => role.id),
    [publishedB],
  );
  assert.ok(!('budget' in rolesA.rows[0]), 'the public projection omits internal budget');
  assert.ok(!('workspace_id' in rolesA.rows[0]), 'the public projection omits tenant identifiers');
  assert.ok(
    !('careersVisible' in rolesA.rows[0]),
    'the public projection omits internal publish state',
  );

  const apply = (workspace, demandId, consentContact = true, extra = {}) =>
    db.query(
      `select public.api_public_apply(
        '${workspace}',
        $payload$${JSON.stringify({
          name: 'Priya Applicant',
          email: 'priya@example.com',
          demandId,
          consentContact,
          ...extra,
        })}$payload$::jsonb
      ) as id`,
    );
  await assert.rejects(
    () => apply(workspaceA, publishedA, false),
    /consent to contact is required/i,
  );
  await assert.rejects(() => apply(workspaceA, null), /select an open role/i);
  await assert.rejects(() => apply(workspaceA, privateA), /no longer accepting applications/i);
  await assert.rejects(() => apply(workspaceA, closedA), /no longer accepting applications/i);
  await assert.rejects(() => apply(workspaceA, publishedB), /no longer accepting applications/i);

  const applied = await apply(workspaceA, publishedA, true);
  assert.ok(applied.rows[0].id, 'a consenting applicant can apply to the published open role');

  const statusA = (
    await db.query(
      `select public.api_public_application_status('${workspaceA}', 'priya@example.com') as result`,
    )
  ).rows[0].result;
  const statusB = (
    await db.query(
      `select public.api_public_application_status('${workspaceB}', 'priya@example.com') as result`,
    )
  ).rows[0].result;
  assert.equal(statusA.length, 1, 'status lookup is constrained to the careers workspace');
  assert.equal(statusA[0].role, 'Workspace A published role');
  assert.equal(statusB.length, 1, 'the same email in another workspace stays separate');
  assert.equal(statusB[0].role, 'Workspace B published role');

  await db.exec('reset role;');
  const stored = (
    await db.query(`
      select "consentContact", "consentSharing", "demandId", workspace_id, email
      from public."publicApplications"
      where "demandId" = '${publishedA}'
    `)
  ).rows[0];
  assert.equal(stored.consentContact, true);
  assert.equal(stored.consentSharing, false, 'optional profile-sharing consent defaults to false');
  assert.equal(stored.demandId, publishedA);
  assert.equal(stored.workspace_id, workspaceA);
  assert.equal(stored.email, 'priya@example.com');
  await db.close();
});
