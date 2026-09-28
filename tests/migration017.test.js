import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 017 includes every repository table, tracks auxiliary updates, and paginates safely', async () => {
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
  const demand = '00000000-0000-4000-8000-000000000031';
  await db.exec(`
    insert into auth.users values ('${admin}','admin@example.com'),('${recruiter}','recruiter@example.com');
    insert into public.workspaces(id,name) values ('${workspace}','Sync workspace');
    insert into public.memberships values ('${admin}','${workspace}','admin'),('${recruiter}','${workspace}','recruiter');
    select set_config('request.jwt.claim.sub','${admin}',false);
    set role authenticated;
  `);
  await db.exec(`
    insert into public.candidates(id,name,email) values ('${candidate}','Sync Person','sync@example.com');
    insert into public.demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)
      values ('${demand}','Sync Engineer','Sync Client','{SQL}',3,30,35,'Bengaluru','Hybrid',1,'Medium',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}'::jsonb);
    insert into public.considerations("candidateId","demandId",stage) values ('${candidate}','${demand}','Identified');
    insert into public.assessments("candidateId",title,score,assessor,date,evidence) values ('${candidate}','Sync assessment',80,'Reviewer',current_date,'Evidence');
    insert into public.notes("candidateId",text,date,author) values ('${candidate}','Sync note',current_date,'Reviewer');
    insert into public.enrichment("candidateId",title,description,due,owner,status) values ('${candidate}','Sync plan','Evidence due',current_date+5,'Reviewer','Planned');
    insert into public."employmentHistory"("candidateId",company,title) values ('${candidate}','Sync Co','Engineer');
    insert into public."compensationHistory"("candidateId",kind,amount) values ('${candidate}','expected',40);
    insert into public."availabilityHistory"("candidateId",notice,status) values ('${candidate}',30,'Active');
    insert into public."auditEvents"("entityType","entityId",action,detail) values ('candidate','${candidate}','viewed','Sync probe');
    insert into public."documents"("candidateId",name,mime) values ('${candidate}','sync-cv.txt','text/plain');
    insert into public."taxonomy"(id,custom) values ('workspace','{"skills":[]}');
    insert into public."demandCommercials"("demandId","internalCost") values ('${demand}',25);
    insert into public."settings"(id,custom) values ('workspace','{"offerApprovals":true}');
    insert into public."consents"("candidateId",purpose,status) values ('${candidate}','marketing','granted');
    insert into public.interviews("candidateId","demandId",round,mode,"scheduledAt") values ('${candidate}','${demand}','Round 1','Video',now()+interval '2 days');
    insert into public.offers("candidateId","demandId",role,ctc,status) values ('${candidate}','${demand}','Engineer',35,'Draft');
    insert into public.tasks(title,"candidateId","demandId",due) values ('Sync task','${candidate}','${demand}',current_date+2);
    insert into public.submissions("candidateId","demandId","clientContact",method) values ('${candidate}','${demand}','client@example.com','Email');
    insert into public."publicApplications"("demandId",name,email) values ('${demand}','Applicant','applicant@example.com');
    -- This value was offered by the UI, but migration 011's original CHECK omitted it.
    insert into public."workflowRules"(name,"triggerTable","triggerField",op,value,actions)
      values ('Stage rule','considerations','stage','eq','Interview','[]'::jsonb);
  `);

  const day = (await db.query('select current_date::text as day')).rows[0].day;
  // Age auxiliary rows out of the current feed, then modify them through authenticated writes.
  // Their new `updated` timestamps must be what makes them appear again.
  await db.exec(`
    reset role;
    update public."documents" set uploaded=now()-interval '2 days', updated=now()-interval '2 days';
    update public."consents" set date=now()-interval '2 days', updated=now()-interval '2 days';
    update public."workflowRules" set created=now()-interval '2 days', updated=now()-interval '2 days';
    update public."settings" set updated=now()-interval '2 days';
    update public."taxonomy" set updated=now()-interval '2 days';
    update public."demandCommercials" set updated=now()-interval '2 days';
    set role authenticated;
    update public."documents" set removed=true;
    update public."consents" set status='revoked';
    update public."workflowRules" set enabled=false;
    update public."settings" set custom=custom || '{"feedProbe":true}'::jsonb;
    update public."taxonomy" set custom=custom || '{"feedProbe":true}'::jsonb;
    update public."demandCommercials" set notes='changed in this test';
  `);
  const adminFeed = (await db.query(`select public.api_changes_since('${day}'::date) as payload`))
    .rows[0].payload;
  const expectedTables = [
    'candidates',
    'demands',
    'considerations',
    'assessments',
    'notes',
    'enrichment',
    'history',
    'employmentHistory',
    'compensationHistory',
    'availabilityHistory',
    'auditEvents',
    'documents',
    'taxonomy',
    'demandCommercials',
    'settings',
    'consents',
    'interviews',
    'offers',
    'tasks',
    'submissions',
    'publicApplications',
    'workflowRules',
  ];
  for (const table of expectedTables) {
    assert.ok(Array.isArray(adminFeed[table]), `the feed contains ${table}`);
    assert.ok(adminFeed[table].length > 0, `recent ${table} rows are in the feed`);
  }
  assert.equal(adminFeed.workflowRules[0].triggerTable, 'considerations');
  assert.equal(adminFeed.demandCommercials.length, 1, 'an admin receives internal commercials');
  assert.equal(
    adminFeed.documents[0].removed,
    true,
    'a document soft-delete is present in the change feed',
  );
  assert.ok(
    String(adminFeed.documents[0].updated).slice(0, 10) >= day,
    'document updates advance their sync timestamp',
  );
  assert.equal(
    adminFeed.consents[0].status,
    'revoked',
    'consent withdrawal is present in the change feed',
  );
  assert.ok(
    String(adminFeed.consents[0].updated).slice(0, 10) >= day,
    'consent changes advance their sync timestamp',
  );
  assert.equal(
    adminFeed.workflowRules[0].enabled,
    false,
    'rule toggles are present in the change feed',
  );
  assert.ok(
    String(adminFeed.workflowRules[0].updated).slice(0, 10) >= day,
    'rule changes advance their sync timestamp',
  );
  assert.ok(
    !('workspace_id' in adminFeed.candidates[0]),
    'tenant ids do not need to travel in each payload row',
  );
  assert.ok(adminFeed.settings[0].custom.feedProbe, 'settings edits are included');
  assert.ok(adminFeed.taxonomy[0].custom.feedProbe, 'taxonomy edits are included');
  assert.equal(
    adminFeed.demandCommercials[0].notes,
    'changed in this test',
    'admin sees recent commercials edits',
  );

  await db.exec(`select set_config('request.jwt.claim.sub','${recruiter}',false);`);
  const recruiterFeed = (
    await db.query(`select public.api_changes_since('${day}'::date) as payload`)
  ).rows[0].payload;
  assert.equal(
    recruiterFeed.demandCommercials.length,
    0,
    'SECURITY DEFINER sync never leaks the admin-only commercial table',
  );
  const recruiterPage = (
    await db.query(`select public.api_changes_page('${day}'::date,0,50) as payload`)
  ).rows[0].payload;
  assert.equal(
    recruiterPage.demandCommercials.length,
    0,
    'the paginated SECURITY DEFINER endpoint preserves the same admin boundary',
  );
  for (const table of expectedTables.filter((t) => t !== 'demandCommercials')) {
    assert.ok(Array.isArray(recruiterFeed[table]), `the recruiter feed contains ${table}`);
  }

  // Isolate a table without history triggers. The `next` flag must not depend only on candidates
  // or the history table; a consumer must continue paging when workflowRules alone has >1 row.
  await db.exec(`
    select set_config('request.jwt.claim.sub','${admin}',false);
    insert into public."workflowRules"(name,"triggerTable","triggerField",op,value,actions,created)
      values ('Future rule A','demands','status','eq','Open','[]'::jsonb,'2100-01-01'),
             ('Future rule B','demands','status','eq','Open','[]'::jsonb,'2100-01-01');
  `);
  const futurePage0 = (
    await db.query(`select public.api_changes_page('2100-01-01',0,1) as payload`)
  ).rows[0].payload;
  assert.equal(futurePage0.workflowRules.length, 1);
  assert.equal(futurePage0.next, true, 'the feed asks the client to continue');
  const futurePage1 = (
    await db.query(`select public.api_changes_page('2100-01-01',1,1) as payload`)
  ).rows[0].payload;
  assert.equal(futurePage1.workflowRules.length, 1);
  assert.equal(futurePage1.next, false, 'the final block terminates paging');
  await db.close();
});
