import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('client review isolates clients and demands, projects approved versions and revokes stale access and feedback', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url),
    files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_client_review_foundations.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(new URL('20261007165508_stage2_readiness_consumers.sql', path), 'utf8'),
  );
  for (let n = 1; n <= 7; n++)
    await db.query('insert into auth.users values($1,$2)', [id(n), `user${n}@e.com`]);
  await db.exec(`insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
 insert into clients(id,workspace_id,name)values('${id(21)}','${id(11)}','Client A'),('${id(22)}','${id(11)}','Client B'),('${id(23)}','${id(12)}','Other workspace');
 insert into candidates(id,workspace_id,name,email,current,phone)values('${id(101)}','${id(11)}','One','secret-one@e.com',999,'9876543210'),('${id(102)}','${id(11)}','Two','secret-two@e.com',999,'9876543211');
 insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights) values
 ('${id(201)}','${id(11)}','Role A','Client A','${id(21)}','{Python}',1,30,12345,'Delhi','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}'),
 ('${id(202)}','${id(11)}','Role B','Client B','${id(22)}','{Python}',1,30,12345,'Delhi','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');
 insert into submissions(id,workspace_id,"candidateId","demandId")values('${id(301)}','${id(11)}','${id(101)}','${id(201)}'),('${id(302)}','${id(11)}','${id(102)}','${id(202)}');
 insert into consents(id,workspace_id,"candidateId",purpose,status,date)values('${id(401)}','${id(11)}','${id(101)}','profile-sharing','granted',now()),('${id(402)}','${id(11)}','${id(102)}','profile-sharing','granted',now());`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args))
      .rows[0].value;
  const change = (action, target = null, details = {}, op = 500, client = 21) =>
    rpc('api_change_client_review', [id(client), id(op), action, target, details]);
  const portal = (client = 21) => rpc('api_client_portal', [id(client), 0, 0]);
  await act(1, 'postgres');
  await db.exec(
    `insert into demands(id,workspace_id,title,client,"clientId",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(203)}','${id(11)}','Other A demand','Client A','${id(21)}','{Python}',1,30,999,'Delhi','Remote',1,'High',current_date,'{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}');insert into submissions(id,workspace_id,"candidateId","demandId")values('${id(303)}','${id(11)}','${id(102)}','${id(203)}');`,
  );
  await act(1);
  await act(1, 'postgres');
  await db.exec(`update demands set "approvalStatus"='Approved'`);
  await act(1);
  const member = await change('grant', null, { userId: id(5), demandId: id(201) }, 501);
  await change('grant', null, { userId: id(7), demandId: id(203) }, 520);
  await act(1, 'postgres');
  await assert.rejects(
    db.exec(`insert into memberships values('${id(5)}','${id(11)}','viewer')`),
    /Revoke active client access/,
  );
  await act(1);
  const otherDemandPack = await change('prepare', id(303), {}, 521);
  await change('approve', otherDemandPack.id, { reason: 'Reviewed the other scoped demand' }, 522);
  await change('grant', null, { userId: id(6) }, 502, 22);
  await assert.rejects(change('grant', null, { userId: id(2) }, 503), /external client account/);
  await assert.rejects(
    change('grant', null, { userId: id(7), demandId: id(202) }, 504),
    /does not belong/,
  );
  const draft = await change('prepare', id(301), {}, 505);
  assert.equal((await change('prepare', id(301), {}, 505)).replayed, true);
  await assert.rejects(change('prepare', id(302), {}, 506), /another client/);
  await act(5);
  assert.equal((await portal()).packs.length, 0);
  await assert.rejects(
    rpc('api_client_respond', [
      otherDemandPack.id,
      id(620),
      'comment',
      null,
      null,
      'Cannot access another scoped demand',
      null,
    ]),
    /unavailable/,
  );
  await act(7);
  assert.equal((await portal()).packs.length, 1);
  await act(5);
  assert.equal((await portal()).demands.length, 1);
  await assert.rejects(portal(22), /access unavailable/);
  await assert.rejects(
    rpc('api_candidate_section', [id(101), 'profile', 0]),
    /membership|workspace/i,
  );
  await assert.rejects(db.query('select * from ecod_client_private.packs'), /permission denied/);
  await act(2);
  await assert.rejects(
    change('approve', draft.id, { reason: 'Reviewed candidate projection' }, 507),
    /Administrator/,
  );
  await act(1);
  await change('approve', draft.id, { reason: 'Reviewed allowed candidate fields' }, 508);
  await act(5);
  let view = await portal();
  assert.equal(view.packs.length, 1);
  assert.ok(!JSON.stringify(view).includes('secret-one@e.com'));
  // Amount substrings also occur in approval timestamps. Test prohibited fields
  // recursively instead of interpreting every numeric substring as financial data.
  const forbidden = new Set([
    'email',
    'phone',
    'current',
    'expected',
    'budget',
    'salary',
    'compensationHistory',
    'placementCommercials',
    'notes',
    'documents',
    'history',
  ]);
  const assertProjected = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `Client projection leaked ${key}`);
      assertProjected(child);
    }
  };
  assertProjected(view);
  const respond = (op = 601, comment = 'Client reviewed the approved shortlist') =>
    rpc('api_client_respond', [draft.id, id(op), 'decision', 'Shortlisted', 4, comment, null]);
  const decision = await respond();
  assert.equal((await respond()).replayed, true);
  await assert.rejects(respond(601, 'Changed decision evidence'), /operation conflict/);
  await act(6);
  await assert.rejects(respond(602), /unavailable/);
  await act(1);
  let internal = await rpc('api_client_review', [id(21), 0]);
  assert.equal(internal.feedback[0].id, decision.id);
  assert.equal(internal.feedback[0].decision, 'Shortlisted');
  await db.exec(`update candidates set title='Changed candidate profile' where id='${id(101)}'`);
  await act(5);
  assert.equal((await portal()).packs.length, 0);
  await assert.rejects(respond(603), /changed or revoked/);
  await act(1);
  const next = await change('prepare', id(301), {}, 509);
  assert.equal(next.version, 2);
  await change('approve', next.id, { reason: 'Reviewed revised candidate version' }, 510);
  await db.exec(
    `insert into offers(id,workspace_id,"candidateId","demandId",ctc)values('${id(701)}','${id(11)}','${id(101)}','${id(201)}',777)`,
  );
  await act(5);
  assert.equal((await portal()).packs.length, 0, 'offer changes invalidate submission approval');
  await act(1);
  const third = await change('prepare', id(301), {}, 511);
  await change('approve', third.id, { reason: 'Reviewed version after offer change' }, 512);
  await act(5);
  await rpc('api_client_respond', [
    third.id,
    id(604),
    'interview',
    null,
    null,
    'Please arrange a technical interview',
    new Date(Date.now() + 86400000).toISOString(),
  ]);
  await act(1);
  assert.equal((await rpc('api_client_review', [id(21), 0])).feedback[0].kind, 'interview');
  await act(1, 'postgres');
  await db.exec(
    `update ecod_client_private.members set expires_at=now()-interval '1 day' where id='${member.id}'`,
  );
  await act(5);
  await assert.rejects(portal(), /access unavailable/);
  await act(1);
  await change('grant', null, { userId: id(5), demandId: id(201) }, 523);
  await act(5);
  assert.equal((await portal()).packs.length, 1);
  await act(1);
  await rpc('api_create_subject_request', [
    id(801),
    id(101),
    'restriction',
    'Review client sharing restriction',
    'email',
  ]);
  await rpc('api_update_subject_request', [
    id(802),
    id(801),
    1,
    'verify',
    'Identity verified against existing record',
  ]);
  await rpc('api_update_subject_request', [
    id(803),
    id(801),
    2,
    'start',
    'Administrator started restriction review',
  ]);
  await act(1, 'postgres');
  await db.exec(
    `insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"auditedCandidateExports":true}') on conflict(workspace_id,id)do update set custom=excluded.custom`,
  );
  await act(1);
  await rpc('api_set_subject_outbound_hold', [
    id(804),
    id(801),
    3,
    true,
    'Restrict client sharing during review',
  ]);
  await act(5);
  assert.equal((await portal()).packs.length, 0, 'outbound holds stop approved client sharing');
  await act(1);
  await assert.rejects(change('prepare', id(301), {}, 525), /unrestricted/);
  await rpc('api_set_subject_outbound_hold', [
    id(805),
    id(801),
    4,
    false,
    'Release hold after the completed review',
  ]);
  await act(1, 'postgres');
  await db.exec(
    `insert into consents(id,workspace_id,"candidateId",purpose,status,date)values('${id(403)}','${id(11)}','${id(101)}','profile-sharing','revoked',now())`,
  );
  await act(5);
  assert.equal((await portal()).packs.length, 0, 'withdrawal removes approved versions');
  await act(1);
  await assert.rejects(change('prepare', id(301), {}, 524), /consent/);
  await change('remove', member.id, {}, 513);
  await act(5);
  await assert.rejects(portal(), /access unavailable/);
  await assert.rejects(
    rpc('api_client_respond', [
      third.id,
      id(605),
      'comment',
      null,
      null,
      'Revoked user should not submit',
      null,
    ]),
    /unavailable/,
  );
  await act(4);
  await assert.rejects(change('prepare', id(301), {}, 514), /Client not found/);
  await act(3);
  await assert.rejects(change('prepare', id(301), {}, 515), /Editor/);
  await act(0, 'anon');
  await assert.rejects(portal(), /permission denied/);
  await act(0);
  await assert.rejects(portal(), /sign-in/);
  await act(0, 'postgres');
  assert.ok(
    (await rpc('ecod_private.erasure_inventory', [id(11), id(101)])).counts.find(
      (c) => c.category === 'clientReads',
    ).count > 0,
  );
  const inventory = await rpc('ecod_private.erasure_inventory', [id(11), id(101)]);
  assert.equal(inventory.counts.length, 60);
  for (const category of ['duplicateDecisions', 'evaluationAssignments', 'assignmentReceipts'])
    assert.ok(inventory.counts.some((row) => row.category === category));
  assert.ok(inventory.counts.find((c) => c.category === 'clientPacks').count >= 3);
  assert.equal(inventory.counts.find((c) => c.category === 'clientFeedback').count, 2);
  assert.ok(inventory.counts.find((c) => c.category === 'machineEvents').count > 0);
});
