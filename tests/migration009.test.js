import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Batch-8 migration: anonymous apply lands in the workspace queue; client decisions and public role read work',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['001_ecod.sql','002_blueprint_r1.sql','003_documents_taxonomy.sql','004_admin_settings.sql','005_consents_sync.sql','006_interviews.sql','007_offers_tasks_custom.sql','008_submissions_demand_fields.sql','009_careers_portal.sql'])
  await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const w1='00000000-0000-4000-8000-000000000011',w2='00000000-0000-4000-8000-000000000012';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${other}','other@example.com');insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');insert into public.memberships values('${admin}','${w1}','admin'),('${other}','${w2}','recruiter');`);
 const act=async user=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(admin);
 // anonymous visitor reads open roles
 await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights) values('00000000-0000-4000-8000-000000000041','Careers Role','Client Co','{"Azure"}',3,30,30,'Remote','Remote',1,'Medium','Open',current_date+30,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
 await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights) values('00000000-0000-4000-8000-000000000042','Closed Role','Client Co','{"Azure"}',3,30,30,'Remote','Remote',1,'Medium','Closed',current_date+30,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
  await db.exec('reset role;set role anon;');
 const publicRoles=await db.query(`select id,title from demands`);
 assert.equal(publicRoles.rows.length,1,'anon sees only the open role');
 assert.equal(publicRoles.rows[0].title,'Careers Role');
 // anonymous application through the RPC
 const applied=await db.query(`select api_public_apply('${w1}'::uuid,'{"name":"Devika Nair","email":"devika@example.com","consentContact":true,"consentSharing":true,"demandId":"00000000-0000-4000-8000-000000000041"}'::jsonb) as id`);
 assert.ok(applied.rows[0].id,'application created');
 await assert.rejects(()=>db.query(`select api_public_apply('${w1}'::uuid,'{"name":"No Email"}'::jsonb)`),/required/i);
 await assert.rejects(()=>db.query(`select api_public_apply('00000000-0000-4000-8000-000000000099'::uuid,'{"name":"X","email":"x@y.zz"}'::jsonb)`),/unknown workspace/i);
 // member triage: sees the pending application and can accept it
 await act(admin);
 const queue=await db.query(`select name,status,"consentContact" from "publicApplications"`);
 assert.equal(queue.rows.length,1);
 assert.equal(queue.rows[0].status,'pending');
 await db.exec(`update "publicApplications" set status='accepted' where email='devika@example.com';`);
 // cross-tenant isolation + anon cannot read the queue
 await act(other);
 assert.equal((await db.query('select count(*)::int as count from "publicApplications"')).rows[0].count,0,'other workspace sees no applications');
 await db.exec('reset role;set role anon;');
 await assert.rejects(()=>db.exec('select count(*) from "publicApplications";'),/permission/i);
 // client decision fields on submissions
 await act(admin);
 await db.exec(`insert into submissions("candidateId","clientContact","clientStatus") values('00000000-0000-4000-8000-000000000021','c@x.example','Hired');`)
 .catch(async()=>{
  const c='00000000-0000-4000-8000-000000000021';
  await db.exec(`insert into candidates(id,name,email) values('${c}','Temp','temp@example.com');`);
  await db.exec(`insert into submissions("candidateId","clientContact","clientStatus") values('${c}','c@x.example','Hired');`);
 });
 const sub=await db.query(`select "clientStatus" from submissions limit 1`);
 assert.equal(sub.rows[0].clientStatus,'Hired');
 const feed=await db.query(`select api_changes_since('2026-01-01') as feed`);
 assert.ok(feed.rows[0].feed.publicApplications.length>=1,'applications travel in the sync payload');
 await db.close();
});
