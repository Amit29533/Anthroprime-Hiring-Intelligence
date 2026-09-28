import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 019 requires a private per-application code for public status lookups', async () => {
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
  const migrations = [
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
  for (const file of migrations) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  const adminA = '00000000-0000-4000-8000-000000000001';
  const adminB = '00000000-0000-4000-8000-000000000002';
  const workspaceA = '00000000-0000-4000-8000-000000000011';
  const workspaceB = '00000000-0000-4000-8000-000000000012';
  const demandA = '00000000-0000-4000-8000-000000000031';
  const demandB = '00000000-0000-4000-8000-000000000032';

  await db.exec(`
    insert into auth.users values
      ('${adminA}', 'admin-a@example.com'), ('${adminB}', 'admin-b@example.com');
    insert into public.workspaces(id, name) values
      ('${workspaceA}', 'Workspace A'), ('${workspaceB}', 'Workspace B');
    insert into public.memberships values
      ('${adminA}', '${workspaceA}', 'admin'), ('${adminB}', '${workspaceB}', 'admin');
  `);
  const asMember = (user) =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`,
    );
  const insertDemand = (id, workspace, title) => `
    insert into public.demands(
      id, workspace_id, title, client, skills, "minExperience", "maxNotice", budget,
      location, mode, positions, priority, status, target, description, weights, "careersVisible"
    ) values (
      '${id}', '${workspace}', '${title}', 'Client', '{SQL}', 3, 30, 50,
      'Remote', 'Remote', 1, 'Medium', 'Open', current_date + 30, 'Public role',
      '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}', true
    );
  `;

  await asMember(adminA);
  await db.exec(insertDemand(demandA, workspaceA, 'Workspace A role'));
  await db.exec(`
    insert into public."publicApplications"(workspace_id, "demandId", name, email)
    values ('${workspaceA}', '${demandA}', 'Priya Applicant', 'priya@example.com');
  `);
  await asMember(adminB);
  await db.exec(insertDemand(demandB, workspaceB, 'Workspace B role'));
  await db.exec(`
    insert into public."publicApplications"(workspace_id, "demandId", name, email)
    values ('${workspaceB}', '${demandB}', 'Priya Applicant', 'priya@example.com');
  `);
  await db.exec('reset role;');

  await db.exec(
    await readFile(
      new URL('../supabase/migrations/019_private_application_status.sql', import.meta.url),
      'utf8',
    ),
  );

  await db.exec('reset role;');
  const existingA = (
    await db.query(
      `select "statusToken" from public."publicApplications" where workspace_id='${workspaceA}'`,
    )
  ).rows[0].statusToken;
  const existingB = (
    await db.query(
      `select "statusToken" from public."publicApplications" where workspace_id='${workspaceB}'`,
    )
  ).rows[0].statusToken;
  assert.ok(existingA, 'existing applications receive a code during migration');
  assert.ok(existingB, 'applications in other workspaces receive independent codes');
  assert.notEqual(existingA, existingB, 'status codes are unique per application');

  await db.exec('reset role; set role anon;');
  await assert.rejects(
    () => db.query('select * from public."publicApplications"'),
    /permission denied/i,
    'anonymous callers cannot read the stored status code or application record',
  );

  const payload = (consentContact = true) =>
    `$payload$${JSON.stringify({
      name: 'Priya Applicant',
      email: 'priya@example.com',
      demandId: demandA,
      consentContact,
    })}$payload$::jsonb`;
  await assert.rejects(
    () => db.query(`select public.api_public_apply('${workspaceA}', ${payload(false)})`),
    /consent to contact is required/i,
  );
  const receipt = (
    await db.query(`select public.api_public_apply('${workspaceA}', ${payload()}) as receipt`)
  ).rows[0].receipt;
  assert.ok(receipt.applicationId, 'the application id remains available in the private response');
  assert.ok(receipt.statusToken, 'a separate private code is returned for status checks');
  assert.notEqual(receipt.applicationId, receipt.statusToken);

  const status = (workspace, email, token) =>
    db.query(
      `select public.api_public_application_status(
        '${workspace}', '${email}', '${token}'
      ) as result`,
    );
  const exact = (await status(workspaceA, 'priya@example.com', receipt.statusToken)).rows[0].result;
  assert.equal(exact.length, 1);
  assert.equal(exact[0].role, 'Workspace A role');
  assert.equal(exact[0].status, 'pending');
  assert.ok(!('statusToken' in exact[0]), 'the public response does not echo the secret code');

  const wrongEmail = (await status(workspaceA, 'someone-else@example.com', receipt.statusToken))
    .rows[0].result;
  const wrongWorkspace = (await status(workspaceB, 'priya@example.com', receipt.statusToken))
    .rows[0].result;
  const wrongCode = (await status(workspaceA, 'priya@example.com', existingB)).rows[0].result;
  assert.deepEqual(wrongEmail, [], 'email alone does not reveal an application');
  assert.deepEqual(wrongWorkspace, [], 'a code cannot be replayed in another workspace');
  assert.deepEqual(wrongCode, [], 'a different application code does not match');

  await db.close();
});
