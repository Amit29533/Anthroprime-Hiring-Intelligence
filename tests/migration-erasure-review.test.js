import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('erasure review counts retired identities and linked history, blocks unreviewed closure and preserves sources', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const f of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(await readFile(new URL('20261007071142_reviewed_erasure_scope.sql', path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com'),('${id(5)}','second@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin'),('${id(5)}','${id(11)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Current','current@example.com'),('${id(51)}','${id(11)}','Retired','retired@example.com'),('${id(52)}','${id(12)}','Other','other@example.com');
    update candidates set "mergedInto"='${id(50)}' where id='${id(51)}';
    insert into notes(id,workspace_id,"candidateId",text) values('${id(60)}','${id(11)}','${id(51)}','Retired private note');
    insert into documents(id,workspace_id,"candidateId",name,"dataUrl",extracted) values('${id(61)}','${id(11)}','${id(51)}','Sensitive name.txt','secret-bytes','secret-extracted');
    insert into "externalMappings"(workspace_id,source,"externalId","candidateId") values('${id(11)}','source','secret-provider-id','${id(51)}');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1);
  await rpc('api_create_subject_request', [
    id(100),
    id(50),
    'erasure',
    'Candidate requests reviewed erasure',
    'email',
  ]);
  await assert.rejects(
    rpc('api_capture_erasure_scope', [id(110), id(100), 1, 'Verified erasure scope reference']),
    /verified erasure/,
  );
  await rpc('api_update_subject_request', [
    id(101),
    id(100),
    1,
    'verify',
    'Identity confirmed by existing contact',
  ]);
  await rpc('api_update_subject_request', [
    id(102),
    id(100),
    2,
    'start',
    'Erasure review started by administrator',
  ]);
  const capture = [id(110), id(100), 3, 'Verified erasure scope reference'];
  assert.equal((await rpc('api_capture_erasure_scope', capture)).version, 4);
  assert.equal((await rpc('api_capture_erasure_scope', capture)).version, 4);
  const page = await rpc('api_erasure_review', [id(100)]);
  assert.equal(page.review.inventory.identities, 2);
  const count = (category) =>
    page.review.inventory.counts.find((r) => r.category === category).count;
  assert.equal(count('candidates'), 2);
  assert.equal(count('notes'), 1);
  assert.equal(count('documents'), 1);
  assert.equal(count('externalMappings'), 1);
  assert.ok(count('history') >= 3);
  assert.doesNotMatch(
    JSON.stringify(page),
    /Retired private note|secret-bytes|secret-extracted|secret-provider-id|Sensitive name|fingerprint|storagePath/,
  );
  assert.equal(page.rows.length, 7);
  assert.ok(page.rows.every((r) => r.decision === 'pending'));
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(111),
      id(100),
      4,
      'close',
      'Attempt premature case closure',
    ]),
    /all seven/,
  );
  await assert.rejects(
    rpc('api_review_erasure_area', [
      id(112),
      id(100),
      4,
      id(110),
      'fake',
      'completed',
      'Evidence of completed manual review',
    ]),
    /area not found/,
  );
  const decide = [
    id(112),
    id(100),
    4,
    id(110),
    'records',
    'retained',
    'Retention policy ref RET-123 reviewed',
  ];
  assert.equal((await rpc('api_review_erasure_area', decide)).version, 5);
  assert.equal((await rpc('api_review_erasure_area', decide)).version, 5);
  await act(5);
  await assert.rejects(rpc('api_review_erasure_area', decide), /identifier conflict/);
  for (const n of [2, 3]) {
    await act(n);
    await assert.rejects(rpc('api_erasure_review', [id(100)]), /Administrator/);
  }
  await act(4);
  await assert.rejects(rpc('api_erasure_review', [id(100)]), /not found/);
  await act(0, 'anon');
  await assert.rejects(rpc('api_erasure_review', [id(100)]), /permission denied/);
  await act(1);
  await assert.rejects(
    db.query('select * from ecod_private.erasure_decisions'),
    /permission denied/,
  );
  await assert.rejects(
    rpc('ecod_private.erasure_inventory', [id(11), id(50)]),
    /permission denied/,
  );
  await db.exec('reset role');
  await db.query('update notes set text=$1 where id=$2', ['Changed after capture', id(60)]);
  await act(1);
  await assert.rejects(
    rpc('api_review_erasure_area', [
      id(113),
      id(100),
      5,
      id(110),
      'originals',
      'completed',
      'Manual cleanup evidence reviewed',
    ]),
    /Data changed/,
  );
  assert.equal(
    (
      await rpc('api_capture_erasure_scope', [
        id(114),
        id(100),
        5,
        'Reconciled current source scope',
      ])
    ).version,
    6,
  );
  await assert.rejects(
    rpc('api_review_erasure_area', [
      id(115),
      id(100),
      6,
      id(110),
      'originals',
      'completed',
      'Manual cleanup evidence reviewed',
    ]),
    /superseded/,
  );
  let version = 6;
  for (const [i, area] of [
    'records',
    'originals',
    'history',
    'integrations',
    'platform_records',
    'external_copies',
    'backups',
  ].entries())
    await rpc('api_review_erasure_area', [
      id(120 + i),
      id(100),
      version++,
      id(114),
      area,
      'retained',
      'Approved retention-policy evidence ref RET-123',
    ]);
  await db.exec('reset role');
  await db.query('update notes set text=$1 where id=$2', ['Changed before closure', id(60)]);
  await act(1);
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(130),
      id(100),
      version,
      'close',
      'All manual work reviewed before closure',
    ]),
    /Data changed/,
  );
  await rpc('api_capture_erasure_scope', [
    id(131),
    id(100),
    version++,
    'Final scope after approved manual work',
  ]);
  for (const [i, area] of [
    'records',
    'originals',
    'history',
    'integrations',
    'platform_records',
    'external_copies',
    'backups',
  ].entries())
    await rpc('api_review_erasure_area', [
      id(140 + i),
      id(100),
      version++,
      id(131),
      area,
      'retained',
      'Approved retention-policy evidence ref RET-123',
    ]);
  await rpc('api_update_subject_request', [
    id(150),
    id(100),
    version++,
    'close',
    'Reviewed retention decision and response reference',
  ]);
  await rpc('api_update_subject_request', [
    id(151),
    id(100),
    version++,
    'reopen',
    'Reopened erasure request with new evidence',
  ]);
  await rpc('api_update_subject_request', [
    id(152),
    id(100),
    version++,
    'verify',
    'Verified identity for the reopened request',
  ]);
  await rpc('api_update_subject_request', [
    id(153),
    id(100),
    version++,
    'start',
    'Reopened scope review started',
  ]);
  await assert.rejects(
    rpc('api_update_subject_request', [
      id(154),
      id(100),
      version,
      'close',
      'Prior verification attempted closure',
    ]),
    /current identity verification/,
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select text from notes where id=$1', [id(60)])).rows[0].text,
    'Changed before closure',
  );
  assert.equal(
    (await db.query('select "dataUrl" from documents where id=$1', [id(61)])).rows[0].dataUrl,
    'secret-bytes',
  );
  await db.exec(
    `insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"auditedDocumentAccess":true,"auditedCandidateExports":true}'); select set_config('request.jwt.claim.aal','aal2',false);`,
  );
  await act(1);
  await rpc('api_set_privileged_mfa', [true]);
  await db.exec("select set_config('request.jwt.claim.aal','aal1',false)");
  await assert.rejects(rpc('api_erasure_review', [id(100)]), /Verify your authenticator/);
  await assert.rejects(
    rpc('api_capture_erasure_scope', [id(155), id(100), version, 'MFA guarded scope capture']),
    /Verify your authenticator/,
  );
  await db.exec("reset role;select set_config('request.jwt.claim.aal','aal2',false)");
  await db.exec(
    `insert into notes(id,workspace_id,"candidateId",text) select gen_random_uuid(),'${id(11)}','${id(50)}','record-limit-fixture' from generate_series(1,2001);`,
  );
  await act(1);
  await assert.rejects(
    rpc('api_capture_erasure_scope', [
      id(155),
      id(100),
      version,
      'Bounded record inventory reference',
    ]),
    /Record scope exceeds/,
  );
  await db.exec('reset role');
  assert.equal(
    (
      await db.query('select count(*)::int n from ecod_private.erasure_reviews where id=$1', [
        id(155),
      ])
    ).rows[0].n,
    0,
  );
  await db.exec(`delete from notes where text='record-limit-fixture';
    insert into candidates(id,workspace_id,name,email,"mergedInto") select gen_random_uuid(),'${id(11)}','Limit retired identity','limit-'||g::text||'@example.com','${id(50)}' from generate_series(1,100)g;`);
  await act(1);
  await assert.rejects(
    rpc('api_capture_erasure_scope', [
      id(156),
      id(100),
      version,
      'Bounded identity inventory reference',
    ]),
    /Identity scope exceeds/,
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select version from ecod_private.subject_requests where id=$1', [id(100)]))
      .rows[0].version,
    version,
  );
});
