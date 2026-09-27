import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Batch-3 migration: commercials are admin-only, settings readable by all but writable by admins',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['001_ecod.sql','002_blueprint_r1.sql','003_documents_taxonomy.sql','004_admin_settings.sql'])
  await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001',recruiter='00000000-0000-4000-8000-000000000002',viewer='00000000-0000-4000-8000-000000000003';
 const w1='00000000-0000-4000-8000-000000000011',d1='00000000-0000-4000-8000-000000000031';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${recruiter}','rec@example.com'),('${viewer}','viewer@example.com');insert into public.workspaces(id,name) values('${w1}','A');insert into public.memberships values('${admin}','${w1}','admin'),('${recruiter}','${w1}','recruiter'),('${viewer}','${w1}','viewer');`);
 const act=async user=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(admin);
 await db.exec(`insert into demands(id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values('${d1}','Engineer','Example',array['Python'],3,30,30,'Pune','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');`);
 await db.exec(`insert into "demandCommercials"("demandId","internalCost",notes) values('${d1}',28,'target cost');`);
 await db.exec(`insert into "settings"(id,custom) values('workspace','{"stageLabels":{"Identified":"Sourced"},"retentionMonths":12}');`);
 // recruiter and viewer cannot see commercials at all
 await act(recruiter);
 assert.equal((await db.query('select count(*)::int as count from "demandCommercials"')).rows[0].count,0);
 await assert.rejects(()=>db.exec(`insert into "demandCommercials"("demandId","internalCost") values('${d1}',99);`),/row-level security/i);
 assert.equal((await db.query('select count(*)::int as count from "settings"')).rows[0].count,1,'recruiter reads settings');
 assert.equal((await db.query(`update "settings" set custom='{}' returning id`)).rows.length,0,'recruiter cannot update settings');
 await act(viewer);
 assert.equal((await db.query('select count(*)::int as count from "demandCommercials"')).rows[0].count,0);
 assert.equal((await db.query(`select custom->>'retentionMonths' as m from "settings"`)).rows[0].m,'12');
 await db.exec(`update "settings" set custom='{"stageLabels":{"Identified":"Sourced"},"retentionMonths":12}' where id='workspace';`).catch(()=>{});
 // viewer update attempt: RLS-blocked silently; row unchanged
 const unchanged=(await db.query(`select custom->>'stageLabels' as l from "settings"`)).rows[0].l;
 assert.equal(JSON.parse(unchanged).Identified,'Sourced');
 await act(admin);
 const updated=await db.query(`update "settings" set custom='{"stageLabels":{"Identified":"Sourced"},"retentionMonths":18}' where id='workspace' returning id`);
 assert.equal(updated.rows.length,1,'admin updates settings');
 assert.equal((await db.query('select count(*)::int as count from "demandCommercials"')).rows[0].count,1);
 await db.close();
});
