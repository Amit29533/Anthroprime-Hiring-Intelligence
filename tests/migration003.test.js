import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Batch-2 migration: documents and taxonomy are tenant-scoped, viewers read but cannot edit',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await db.exec(await readFile(new URL('../supabase/migrations/001_ecod.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/002_blueprint_r1.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/003_documents_taxonomy.sql',import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',viewer='00000000-0000-4000-8000-000000000003';
 const w1='00000000-0000-4000-8000-000000000011',w2='00000000-0000-4000-8000-000000000012';
 const c1='00000000-0000-4000-8000-000000000021',d1='00000000-0000-4000-8000-000000000031';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${other}','other@example.com'),('${viewer}','viewer@example.com');insert into public.workspaces(id,name) values('${w1}','A'),('${w2}','B');insert into public.memberships values('${admin}','${w1}','admin'),('${other}','${w2}','recruiter'),('${viewer}','${w1}','viewer');`);
 const act=async user=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(admin);
 await db.exec(`insert into candidates(id,name,email) values('${c1}','Doc Person','doc@example.com');`);
 await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values('${d1}','Engineer','Example',array['Python'],3,30,30,'Pune','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
 await db.exec(`insert into "documents"("candidateId",name,kind,size,"parserStatus",extracted) values('${c1}','cv.pdf','CV',12345,'parsed','Senior Databricks architect with 9 years');`);
 await db.exec(`insert into "taxonomy"(id,custom) values('workspace','{"skills":["Apache Iceberg"],"aliases":{"iceberg":"Apache Iceberg"},"domains":{}}');`);
 await db.exec(`insert into assessments("candidateId",title,score,assessor,date,evidence,skill) values('${c1}','Review',80,'A','2026-09-01','evidence','Databricks');`);
 await db.exec(`insert into enrichment("candidateId",title,description,due,owner,status,"demandId","gapSkill") values('${c1}','Lab','practice',current_date,'A','Planned','${d1}','Unity Catalog');`);
 // documents can be soft-removed (update allowed for editors), never hard-deleted
 await db.exec(`update "documents" set removed=true where "candidateId"='${c1}';`);
 await assert.rejects(()=>db.exec(`delete from "documents";`),/permission/i);
 // other workspace sees nothing
 await act(other);
 assert.equal((await db.query('select count(*)::int as count from "documents"')).rows[0].count,0);
 assert.equal((await db.query('select count(*)::int as count from "taxonomy"')).rows[0].count,0);
 // viewer reads documents and taxonomy but cannot write either
 await act(viewer);
 assert.equal((await db.query('select count(*)::int as count from "documents"')).rows[0].count,1);
 assert.equal((await db.query('select count(*)::int as count from "taxonomy"')).rows[0].count,1);
 await assert.rejects(()=>db.exec(`insert into "documents"(name) values('x');`),/row-level security/i);
 await assert.rejects(()=>db.exec(`insert into "taxonomy"(id,custom) values('workspace','{}');`),/row-level security/i);
 assert.equal((await db.query(`update "taxonomy" set custom='{}' returning id`)).rows.length,0,'viewer cannot modify taxonomy');
 // cross-workspace FK boundaries still hold for the new enrichment link
 await act(other);
 await db.exec(`insert into candidates(id,name,email) values('00000000-0000-4000-8000-000000000022','Other Person','other@example.com');`);
 await assert.rejects(()=>db.exec(`insert into enrichment("candidateId",title,description,due,owner,status,"demandId") values('00000000-0000-4000-8000-000000000022','x','y',current_date,'z','Planned','${d1}');`),/foreign key/i);
 await db.close();
});
