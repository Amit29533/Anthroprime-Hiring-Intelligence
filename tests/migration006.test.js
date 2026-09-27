import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Batch-5 migration: interviews are tenant-scoped, audit-trailed, bar-checked and synced',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['001_ecod.sql','002_blueprint_r1.sql','003_documents_taxonomy.sql','004_admin_settings.sql','005_consents_sync.sql','006_interviews.sql'])
  await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const w1='00000000-0000-4000-8000-000000000011',w2='00000000-0000-4000-8000-000000000012';
 const c1='00000000-0000-4000-8000-000000000021';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${other}','other@example.com');insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');insert into public.memberships values('${admin}','${w1}','admin'),('${other}','${w2}','recruiter');`);
 const act=async user=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(admin);
 await db.exec(`insert into candidates(id,name,email,tags) values('${c1}','Panel Person','panel@example.com','{"Client favourite"}');`);
 await db.exec(`insert into interviews("candidateId",round,mode,"scheduledAt",interviewers,feedback,recommendation) values('${c1}','Round 1','Video',now()+interval '2 days','{"Neha"}','{"Technical depth":4,"Communication":5}','Hire');`);
 // invalid status is rejected by the check constraint
 await assert.rejects(()=>db.exec(`insert into interviews("candidateId","scheduledAt",status) values('${c1}',now(),'Done');`),/interviews_status_check|check/i);
 // cross-tenant composite FK: a demand from another workspace can not be linked
 await act(other);
 await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,status,target,weights) values('00000000-0000-4000-8000-000000000031','Other tenant demand','Other Client','{"Azure"}',3,30,30,'Remote','Remote',1,'Medium','Open',current_date+30,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
 const otherDemand='00000000-0000-4000-8000-000000000031';
 await act(admin);
 await assert.rejects(()=>db.exec(`insert into interviews("candidateId","demandId","scheduledAt") values('${c1}','${otherDemand}',now());`),/foreign key/i);
 // interviewer sees their own workspace rows; the other workspace sees none
 assert.equal((await db.query('select count(*)::int as count from interviews')).rows[0].count,1);
 await act(other);
 assert.equal((await db.query('select count(*)::int as count from interviews')).rows[0].count,0,'cross-tenant interviews never leak');
 const feed=await db.query(`select api_changes_since('2026-01-01') as feed`);
 assert.equal(feed.rows[0].feed.interviews.length,0,'other workspace feed has no interviews');
 await act(admin);
 const adminFeed=await db.query(`select api_changes_since('2026-01-01') as feed`);
 assert.equal(adminFeed.rows[0].feed.interviews.length,1,'interviews travel in the sync payload');
 await db.exec(`update interviews set status='Completed', recommendation='Strong hire', completed=now() where "candidateId"='${c1}';`);
 const hist=await db.query(`select count(*)::int as count from history where "entityType"='interviews'`);
 assert.equal(hist.rows[0].count,2,'interview insert and update are both audit-trailed');
 // candidate tags round-trip
 const tags=await db.query(`select tags from candidates where id='${c1}'`);
 assert.deepEqual(tags.rows[0].tags,['Client favourite']);
 await db.exec('reset role;set role anon;');
 await assert.rejects(()=>db.exec('select count(*) from interviews;'),/permission/i);
 await db.close();
});
