import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Batch-9 migration: sync feed is deterministic and the paginated RPC pages with a next flag',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['001_ecod.sql','002_blueprint_r1.sql','003_documents_taxonomy.sql','004_admin_settings.sql','005_consents_sync.sql','006_interviews.sql','007_offers_tasks_custom.sql','008_submissions_demand_fields.sql','009_careers_portal.sql','010_sync_pagination.sql'])
  await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
 const admin='00000000-0000-4000-8000-000000000001';
 const w1='00000000-0000-4000-8000-000000000011';
 await db.exec(`insert into auth.users values('${admin}','admin@example.com');insert into public.workspaces(id,name) values('${w1}','A');insert into public.memberships values('${admin}','${w1}','admin');`);
 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`);
 for(let i=1;i<=5;i++)await db.exec(`insert into candidates(id,name,email,created) values('${String(i).padStart(8,'0')}-0000-4000-8000-0000000000aa','P${i}','p${i}@example.com',now());`);
 const feed=await db.query(`select api_changes_since('2026-01-01') as feed`);
 const ids=feed.rows[0].feed.candidates.map(c=>c.id);
 assert.deepEqual([...ids].sort(),ids,'feed is ordered by id deterministically');
 const page0=await db.query(`select api_changes_page('2026-01-01',0,2) as page`);
 assert.equal(page0.rows[0].page.candidates.length,2,'page honours size');
 assert.equal(page0.rows[0].page.next,true,'next is true when a table filled its page');
 const page9=await db.query(`select api_changes_page('2026-01-01',9,2) as page`);
 assert.equal(page9.rows[0].page.candidates.length,0,'offset beyond rows is empty');
 const pageBig=await db.query(`select api_changes_page('2026-01-01',0,500) as page`);
 assert.equal(pageBig.rows[0].page.candidates.length,5);
 assert.equal(pageBig.rows[0].page.next,false,'next false when nothing fills the page');
 await db.exec('reset role;set role anon;');
 await assert.rejects(()=>db.exec(`select api_changes_page('2026-01-01',0,10);`),/permission/i);
 await db.close();
});
