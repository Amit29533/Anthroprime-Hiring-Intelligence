import { reviewedMerge } from './stage1-api-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('reviewed outbound holds govern pipeline writes and CSVs without blocking cancellation or correction', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_candidate_outbound_holds.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Held','a@example.com'),('${id(51)}','${id(11)}','Free','b@example.com');
    insert into clients(id,workspace_id,name) values('${id(30)}','${id(11)}','Client');
    insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values('${id(40)}','${id(11)}','Engineer','Client','${id(30)}',array['SQL'],0,30,100,'Remote','Remote',1,'High',current_date,'{"skills":30,"experience":20,"readiness":15,"availability":15,"budget":10,"location":10}');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');
    insert into considerations(id,workspace_id,"candidateId","demandId",stage) values('${id(100)}','${id(11)}','${id(50)}','${id(40)}','Identified');
    insert into submissions(id,workspace_id,"candidateId","demandId") values('${id(101)}','${id(11)}','${id(50)}','${id(40)}');
    insert into interviews(id,workspace_id,"candidateId","demandId","scheduledAt") values('${id(102)}','${id(11)}','${id(50)}','${id(40)}',now());
    insert into offers(id,workspace_id,"candidateId","demandId") values('${id(103)}','${id(11)}','${id(50)}','${id(40)}');
    insert into placements(id,workspace_id,"candidateId","demandId","clientId","startDate") values('${id(104)}','${id(11)}','${id(50)}','${id(40)}','${id(30)}',current_date);`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  await rpc('api_create_subject_request', [
    id(200),
    id(50),
    'restriction',
    'Review outbound recruiting restriction',
    'email',
  ]);
  await assert.rejects(
    rpc('api_set_subject_outbound_hold', [
      id(203),
      id(200),
      1,
      true,
      'Review reference for outbound hold',
    ]),
    /Verify and review/,
  );
  await rpc('api_update_subject_request', [
    id(201),
    id(200),
    1,
    'verify',
    'Verified identity by existing contact',
  ]);
  await rpc('api_update_subject_request', [
    id(202),
    id(200),
    2,
    'start',
    'Restriction review started by administrator',
  ]);
  const apply = [id(203), id(200), 3, true, 'Review reference for outbound hold'];
  await assert.rejects(rpc('api_set_subject_outbound_hold', apply), /Enable audited/);
  await db.exec(`reset role;update settings set custom='{"auditedCandidateExports":true}';`);
  await act(1);
  await rpc('api_set_subject_outbound_hold', apply);
  await rpc('api_set_subject_outbound_hold', apply);
  const detail = await rpc('api_subject_request_detail', [id(200)]);
  assert.equal(detail.case.version, 4);
  assert.deepEqual(detail.outboundHold, { active: true, owned: true });
  await assert.rejects(
    db.query('update candidates set "processingRestricted"=false where id=$1', [id(50)]),
    /server-owned/,
  );
  await assert.rejects(db.query('update settings set custom=$1', ['{}']), /Release outbound holds/);
  await assert.rejects(reviewedMerge(db, id(51), id(50)), /before merging/);
  await assert.rejects(reviewedMerge(db, id(50), id(51)), /before merging/);
  await act(2);
  await assert.rejects(
    rpc('api_set_subject_outbound_hold', [
      id(204),
      id(200),
      4,
      false,
      'Release following reviewed decision',
    ]),
    /Administrator/,
  );
  await assert.rejects(rpc('api_prepare_candidate_export', [[id(50)]]), /outbound recruiting hold/);
  assert.equal((await rpc('api_prepare_candidate_export', [[id(51)]])).allowed, true);
  await db.query('update candidates set title=$1 where id=$2', ['Corrected role', id(50)]);
  await db.exec(
    `insert into candidates(id,workspace_id,name,email,title) values('${id(50)}','${id(11)}','Held','a@example.com','Upsert correction') on conflict(id) do update set title=excluded.title;`,
  );
  const upserted = (
    await db.query('select title,"processingRestricted" from candidates where id=$1', [id(50)])
  ).rows[0];
  assert.equal(upserted.title, 'Upsert correction');
  assert.equal(upserted.processingRestricted, true);
  for (const table of ['considerations', 'submissions', 'interviews', 'offers', 'placements']) {
    await assert.rejects(
      table === 'offers'
        ? rpc('api_save_offers', [
            [
              {
                id: id(300),
                candidateId: id(50),
                demandId: id(40),
                role: 'Held offer',
                status: 'Draft',
              },
            ],
          ])
        : db.exec(
            `insert into ${table} select (jsonb_populate_record(null::${table},to_jsonb(t)||jsonb_build_object('id','${id(300)}'))).* from ${table} t limit 1`,
          ),
      /outbound recruiting hold/,
    );
  }
  await assert.rejects(
    db.exec(
      `insert into submissions(workspace_id,"candidateId","demandId") values('${id(11)}','${id(50)}','${id(40)}')`,
    ),
    /outbound recruiting hold/,
  );
  await assert.rejects(
    db.exec(`update considerations set stage='Contacted' where id='${id(100)}'`),
    /outbound recruiting hold/,
  );
  await db.exec(
    `update considerations set stage='Withdrawn',reason='Outbound hold withdrawal' where id='${id(100)}';update interviews set status='Cancelled' where id='${id(102)}';update offers set status='Withdrawn' where id='${id(103)}';update placements set status='Cancelled' where id='${id(104)}';update submissions set notes='Administrative record only' where id='${id(101)}';`,
  );
  await assert.rejects(
    db.exec(`update interviews set status='Scheduled' where id='${id(102)}'`),
    /outbound recruiting hold/,
  );
  await assert.rejects(
    db.exec(`update submissions set "clientContact"='New recipient' where id='${id(101)}'`),
    /outbound recruiting hold/,
  );
  await act(4);
  await assert.rejects(
    rpc('api_set_subject_outbound_hold', [
      id(205),
      id(200),
      4,
      false,
      'Release following reviewed decision',
    ]),
    /not found/,
  );
  await act(0, 'anon');
  await assert.rejects(rpc('api_set_subject_outbound_hold', apply), /permission denied/);
  await act(1);
  await rpc('api_update_subject_request', [
    id(206),
    id(200),
    4,
    'close',
    'Closure decision keeps outbound hold active',
  ]);
  assert.equal((await rpc('api_subject_request_detail', [id(200)])).outboundHold.active, true);
  await rpc('api_set_subject_outbound_hold', [
    id(207),
    id(200),
    5,
    false,
    'Release following reviewed decision',
  ]);
  assert.equal((await rpc('api_subject_request_detail', [id(200)])).outboundHold.active, false);
  await db.exec(
    `insert into submissions(workspace_id,"candidateId","demandId") values('${id(11)}','${id(50)}','${id(40)}');update settings set custom='{}';`,
  );
});
