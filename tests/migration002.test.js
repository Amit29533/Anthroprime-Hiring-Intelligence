import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Blueprint R1 migration: history tables are insert-only and tenant-isolated',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await db.exec(await readFile(new URL('../supabase/migrations/001_ecod.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/002_blueprint_r1.sql',import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',viewer='00000000-0000-4000-8000-000000000003';
 const w1='00000000-0000-4000-8000-000000000011',w2='00000000-0000-4000-8000-000000000012';
 const c1='00000000-0000-4000-8000-000000000021';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${other}','other@example.com'),('${viewer}','viewer@example.com');insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');insert into public.memberships values('${admin}','${w1}','admin'),('${other}','${w2}','recruiter'),('${viewer}','${w1}','viewer');`);
 const act=async user=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(admin);
 await db.exec(`insert into candidates(id,name,email,engagement,"activeStatus","skillsDetail") values('${c1}','History Person','hist@example.com','Contract','Active','[{"skill":"SQL","proficiency":"Proficient","validated":true}]');`);
 await db.exec(`insert into "employmentHistory"("candidateId",company,title,"startDate") values('${c1}','OldCo','Engineer','2019-01-01');`);
 await db.exec(`insert into "compensationHistory"("candidateId",kind,amount) values('${c1}','expected',42);`);
 await db.exec(`insert into "availabilityHistory"("candidateId",notice,status) values('${c1}',15,'Active');`);
 await db.exec(`insert into "auditEvents"("entityType","entityId",action,detail,actor) values('candidate','${c1}','viewed','History Person','admin@example.com');`);
 // History and audit rows reject updates and deletes from the application roles.
 await assert.rejects(()=>db.exec(`update "employmentHistory" set company='Hacked' where "candidateId"='${c1}';`),/permission/i);
 await assert.rejects(()=>db.exec(`delete from "compensationHistory";`),/permission/i);
 await assert.rejects(()=>db.exec(`update "auditEvents" set action='tampered';`),/permission/i);
 // Other workspace sees nothing; viewer can read histories and record view events but not edit candidates.
 await act(other);
 assert.equal((await db.query('select count(*)::int as count from "employmentHistory"')).rows[0].count,0);
 assert.equal((await db.query('select count(*)::int as count from "auditEvents"')).rows[0].count,0);
 await act(viewer);
 assert.equal((await db.query('select count(*)::int as count from "employmentHistory"')).rows[0].count,1);
 await db.exec(`insert into "auditEvents"("entityType","entityId",action,detail,actor) values('candidate','${c1}','viewed','History Person','viewer@example.com');`);
 await assert.rejects(()=>db.exec(`insert into "employmentHistory"("candidateId") values('${c1}');`),/row-level security/i);
 await db.close();
});
