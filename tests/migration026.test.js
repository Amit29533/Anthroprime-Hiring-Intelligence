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
];

const admin = '00000000-0000-4000-8000-000000000001';
const recruiter = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const w1 = '00000000-0000-4000-8000-000000000011';
const w2 = '00000000-0000-4000-8000-000000000012';
const demandId = '00000000-0000-4000-8000-000000000031';

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
    `insert into auth.users values('${admin}','a@e.com'),('${recruiter}','r@e.com'),('${outsider}','o@e.com');
     insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');
     insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${outsider}','${w2}','admin');`,
  );
  const act = (user) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`,
    );
  await act(admin);
  await db.exec(
    `insert into public.demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights,"careersVisible")
     values('${demandId}','Data Engineer','Meridian','{"SQL"}',3,30,20,'Pune','Remote',1,'High','Open',current_date+30,${WEIGHTS},true);`,
  );
  const refer = async (payload, ws = w1) => {
    await db.exec('reset role;set role anon;');
    const sql = `select public.api_public_refer('${ws}','${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) as r`;
    try {
      const res = (await db.query(sql)).rows[0].r;
      return { ok: true, res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  return { db, act, refer };
}

test('Batch-24: a referral from the careers page is recorded and audited', async () => {
  const { db, act, refer } = await boot();
  const out = await refer({
    referrerName: '  Priya Raman ',
    referrerEmail: 'PRIYA@anthroprime.example',
    referrerType: 'Employee',
    refereeName: 'Devika Iyer',
    refereeEmail: ' Devika@Example.com ',
    relationship: 'Former colleague',
    note: 'Strong lakehouse background.',
    demandId,
    confirmPermission: true,
  });
  assert.equal(out.ok, true, out.error);

  await act(admin);
  const row = (await db.query(`select * from public.referrals`)).rows[0];
  assert.equal(row.referrerName, 'Priya Raman', 'names are trimmed');
  assert.equal(row.referrerEmail, 'priya@anthroprime.example', 'emails normalised');
  assert.equal(row.refereeEmail, 'devika@example.com');
  assert.equal(row.demandId, demandId, 'the open, published role is linked');
  assert.equal(row.status, 'New');
  assert.equal(row.rewardStatus, 'Not eligible', 'no reward is implied on arrival');
  assert.equal(row.candidateId, null, 'a referral is not a candidate record');
  assert.equal(row.source, 'Careers page');

  const audit = (
    await db.query(`select action, detail from public."auditEvents" where "entityType"='referrals'`)
  ).rows;
  assert.equal(audit.length, 1);
  assert.match(audit[0].detail, /Priya Raman referred someone/);
  await db.close();
});

test('Batch-24: the public RPC is write-only — referrals can never be read back anonymously', async () => {
  const { db, refer } = await boot();
  await refer({
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    confirmPermission: true,
  });
  await db.exec('reset role;set role anon;');
  await assert.rejects(
    db.query(`select * from public.referrals`),
    /permission denied/i,
    'a referral list is a list of people who never opted in',
  );
  await assert.rejects(
    db.query(`update public.referrals set status='Hired'`),
    /permission denied/i,
  );
  await db.close();
});

test('Batch-24: submissions are validated, and permission must be asserted', async () => {
  const { refer } = await boot();
  assert.match((await refer({ refereeName: 'X', confirmPermission: true })).error, /your name/);
  assert.match((await refer({ referrerName: 'P', confirmPermission: true })).error, /your name/);
  assert.match(
    (await refer({ referrerName: 'P', refereeName: 'D', confirmPermission: true })).error,
    /email address or phone number/,
    'a referral with no way to make contact is not actionable',
  );
  assert.match(
    (
      await refer({
        referrerName: 'P',
        refereeName: 'D',
        refereeEmail: 'nope',
        confirmPermission: true,
      })
    ).error,
    /valid email address/,
  );
  assert.match(
    (await refer({ referrerName: 'P', refereeName: 'D', refereeEmail: 'd@e.com' })).error,
    /happy to be contacted/,
    'the referrer must assert they have permission',
  );
  const unknownWorkspace = await refer(
    { referrerName: 'P', refereeName: 'D', refereeEmail: 'd@e.com', confirmPermission: true },
    '00000000-0000-4000-8000-000000000013',
  );
  assert.equal(unknownWorkspace.ok, false);
  assert.match(unknownWorkspace.error, /unknown workspace/);
  // A phone number alone is enough.
  assert.equal(
    (
      await refer({
        referrerName: 'P',
        refereeName: 'D',
        refereePhone: '+91 99999 00000',
        confirmPermission: true,
      })
    ).ok,
    true,
  );
});

test('Batch-24: a duplicate referral succeeds silently without revealing the pipeline', async () => {
  const { db, act, refer } = await boot();
  const payload = {
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    demandId,
    confirmPermission: true,
  };
  assert.equal((await refer(payload)).ok, true);
  const second = await refer({ ...payload, referrerName: 'Someone Else' });
  assert.equal(second.ok, true, 'the second submitter is not shown an error');
  assert.equal(
    second.res.duplicate,
    undefined,
    'and is not told that the person is already referred — that would leak the pipeline',
  );
  await act(admin);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.referrals`)).rows[0].c,
    1,
    'but only one referral is stored',
  );
  await db.close();
});

test('Batch-24: a closed or unpublished role is dropped rather than linked', async () => {
  const { db, act, refer } = await boot();
  await act(admin);
  await db.exec(`update public.demands set "careersVisible"=false where id='${demandId}';`);
  await refer({
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    demandId,
    confirmPermission: true,
  });
  await act(admin);
  const row = (await db.query(`select "demandId" as d from public.referrals`)).rows[0];
  assert.equal(row.d, null, 'the referral is kept, but not attached to a role nobody can see');
  await db.close();
});

test('Batch-24: referrals are tenant-scoped and travel in the sync feed', async () => {
  const { db, act, refer } = await boot();
  await refer({
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    confirmPermission: true,
  });
  await act(outsider);
  assert.equal(
    (await db.query(`select count(*)::int as c from public.referrals`)).rows[0].c,
    0,
    'another workspace sees none of it',
  );
  await act(admin);
  const feed = (await db.query(`select public.api_changes_since(current_date - 1) as f`)).rows[0].f;
  assert.equal(feed.referrals.length, 1, 'referrals are in the incremental feed');
  assert.equal(feed.referrals[0].workspace_id, undefined, 'with workspace_id stripped');
  const page = (await db.query(`select public.api_changes_page(current_date - 1,0,50) as f`))
    .rows[0].f;
  assert.equal(page.referrals.length, 1, 'and in the paginated feed');
  assert.deepEqual(
    (await db.query(`select action from public.history where "entityType"='referrals'`)).rows.map(
      (r) => r.action,
    ),
    ['referrals created'],
    'and are audited like any other write',
  );
  await db.close();
});

test('Batch-24: a viewer cannot record or edit a referral', async () => {
  const { db, act, refer } = await boot();
  await refer({
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    confirmPermission: true,
  });
  await db.exec(
    `reset role;update public.memberships set role='viewer' where user_id='${recruiter}';`,
  );
  await act(recruiter);
  await assert.rejects(
    db.exec(
      `insert into public.referrals("referrerName","refereeName","refereeEmail") values('X','Y','y@e.com');`,
    ),
    /row-level security|permission denied/i,
  );
  await db.exec(`update public.referrals set status='Hired';`);
  await db.exec('reset role;');
  assert.equal(
    (await db.query(`select status from public.referrals`)).rows[0].status,
    'New',
    'a viewer cannot advance a referral',
  );
  await db.close();
});

test('Batch-24: linking a referral to a candidate never crosses a tenant, and survives deletion', async () => {
  const { db, act, refer } = await boot();
  await refer({
    referrerName: 'Priya',
    refereeName: 'Devika',
    refereeEmail: 'devika@example.com',
    confirmPermission: true,
  });
  const candidateId = '00000000-0000-4000-8000-000000000051';
  await act(outsider);
  await db.exec(
    `insert into public.candidates(id,name,email,title,location,skills,status,source) values('${candidateId}','Foreign','f@e.com','E','Pune','{"SQL"}','Ready','Referral');`,
  );
  await act(admin);
  await assert.rejects(
    db.exec(`update public.referrals set "candidateId"='${candidateId}';`),
    /violates foreign key/i,
    'a referral cannot point at another tenant’s candidate',
  );

  const mine = '00000000-0000-4000-8000-000000000052';
  await db.exec(
    `insert into public.candidates(id,name,email,title,location,skills,status,source) values('${mine}','Devika','devika@example.com','E','Pune','{"SQL"}','Ready','Referral');`,
  );
  await db.exec(`update public.referrals set "candidateId"='${mine}', status='In pipeline';`);
  await db.exec(`reset role;delete from public.candidates where id='${mine}';`);
  const row = (
    await db.query(`select workspace_id as ws, "candidateId" as c from public.referrals`)
  ).rows[0];
  assert.equal(row.c, null, 'the link clears');
  assert.equal(row.ws, w1, 'and the referral keeps its workspace');
  await db.close();
});
