import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('access packages require explicit disclosure review, preserve retries and reject stale scope', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    await readFile(new URL('20261007064426_reviewed_subject_access_packages.sql', path), 'utf8'),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com'),('${id(5)}','second@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Other');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin'),('${id(5)}','${id(11)}','admin');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Candidate','a@example.com'),('${id(51)}','${id(12)}','Other','b@example.com');
    insert into notes(id,workspace_id,"candidateId",text) values('${id(60)}','${id(11)}','${id(50)}','Third party confidential comment'),('${id(61)}','${id(12)}','${id(51)}','Other workspace secret');
    insert into documents(id,workspace_id,"candidateId",name,"dataUrl",extracted) values('${id(62)}','${id(11)}','${id(50)}','Resume.txt','private-inline-document-bytes','Private raw CV extraction');`);
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
    'access',
    'Candidate requests access to records',
    'email',
  ]);
  await assert.rejects(
    rpc('api_start_subject_access_review', [id(110), id(100), 1, 'Identity review reference']),
    /verified access/,
  );
  await rpc('api_update_subject_request', [
    id(101),
    id(100),
    1,
    'verify',
    'Verified through existing contact',
  ]);
  await rpc('api_update_subject_request', [
    id(102),
    id(100),
    2,
    'start',
    'Access review started by administrator',
  ]);
  const start = [id(110), id(100), 3, 'Identity verification reviewed'];
  assert.equal((await rpc('api_start_subject_access_review', start)).version, 4);
  assert.equal((await rpc('api_start_subject_access_review', start)).version, 4);
  const page = await rpc('api_subject_access_page', [id(100)]);
  assert.equal(page.review.state, 'draft');
  assert.ok(page.pending >= 2);
  assert.equal(
    page.rows.find((r) => r.category === 'notes').data.text,
    'Third party confidential comment',
  );
  assert.equal(page.rows.find((r) => r.category === 'documents').data.name, 'Resume.txt');
  assert.doesNotMatch(
    JSON.stringify(page),
    /Other workspace secret|storagePath|dataUrl|extracted|source_hash|private-inline-document-bytes|Private raw CV/,
  );
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(112),
      id(100),
      4,
      id(110),
      'Reviewed disclosure reference',
    ]),
    /Review every record/,
  );
  const note = page.rows.find((r) => r.category === 'notes');
  await assert.rejects(
    rpc('api_review_subject_access_rows', [
      id(111),
      id(100),
      4,
      id(110),
      [
        {
          category: note.category,
          id: note.id,
          decision: 'redact',
          data: { fakeField: 'injected' },
        },
      ],
      'Reviewed disclosure reference',
    ]),
    /cannot introduce/,
  );
  const decisions = page.rows.map((r) => ({
    category: r.category,
    id: r.id,
    decision:
      r.category === 'notes' ? 'redact' : r.category === 'candidates' ? 'include' : 'withhold',
    ...(r.category === 'notes' ? { data: { text: '[third-party information removed]' } } : {}),
  }));
  const review = [id(111), id(100), 4, id(110), decisions, 'Reviewed disclosure reference'];
  assert.equal((await rpc('api_review_subject_access_rows', review)).version, 5);
  assert.equal((await rpc('api_review_subject_access_rows', review)).version, 5);
  const prepare = [id(112), id(100), 5, id(110), 'Reviewed package preparation reference'];
  const receipt = await rpc('api_prepare_subject_access_package', prepare);
  assert.equal(receipt.version, 6);
  assert.equal(receipt.sha256, createHash('sha256').update(receipt.content).digest('hex'));
  assert.doesNotMatch(receipt.content, /Third party confidential comment|Other workspace secret/);
  assert.equal(JSON.parse(receipt.content).records.length, 2);
  assert.deepEqual(await rpc('api_prepare_subject_access_package', prepare), receipt);
  await assert.rejects(
    rpc('api_review_subject_access_rows', [
      id(113),
      id(100),
      6,
      id(110),
      decisions,
      'Change prepared disclosure review',
    ]),
    /Prepared reviews cannot/,
  );
  await assert.rejects(
    rpc('api_start_subject_access_review', [id(114), id(100), 5, 'Stale case version reference']),
    /Case changed/,
  );
  await act(5);
  await assert.rejects(rpc('api_prepare_subject_access_package', prepare), /identifier conflict/);
  for (const n of [2, 3]) {
    await act(n);
    await assert.rejects(rpc('api_subject_access_page', [id(100)]), /Administrator/);
  }
  await act(4);
  await assert.rejects(rpc('api_subject_access_page', [id(100)]), /not found/);
  await act(0, 'anon');
  await assert.rejects(rpc('api_subject_access_page', [id(100)]), /permission denied/);
  await act(1);
  await assert.rejects(
    db.query('select * from ecod_private.subject_access_rows'),
    /permission denied/,
  );
  await assert.rejects(rpc('worker_purge_subject_access_reviews'), /permission denied/);
  await assert.rejects(
    rpc('ecod_private.subject_access_inventory', [id(11), id(50)]),
    /permission denied/,
  );
  await db.exec('reset role');
  await db.query('update notes set text=$1 where id=$2', ['Changed candidate note', id(60)]);
  await act(1);
  await assert.rejects(
    rpc('api_prepare_subject_access_package', prepare),
    /Candidate data changed/,
  );
  const fresh = await rpc('api_start_subject_access_review', [
    id(114),
    id(100),
    6,
    'New source snapshot review reference',
  ]);
  assert.equal(fresh.version, 7);
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(115),
      id(100),
      7,
      id(110),
      'Old source snapshot reference',
    ]),
    /expired or superseded/,
  );
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from ecod_private.subject_access_rows where review_id=$1',
        [id(110)],
      )
    ).rows[0].n,
    0,
  );
  await db.query(
    "update ecod_private.subject_access_reviews set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [id(114)],
  );
  await act(1);
  assert.equal((await rpc('api_subject_access_page', [id(100)])).review.state, 'unavailable');
  assert.deepEqual((await rpc('api_subject_access_page', [id(100)])).rows, []);
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(115),
      id(100),
      7,
      id(114),
      'Expired review preparation reference',
    ]),
    /expired or superseded/,
  );
  await act(0, 'service_role');
  assert.equal((await rpc('worker_purge_subject_access_reviews')).purged, 1);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select count(*)::int n from ecod_private.subject_access_rows')).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('select count(*)::int n from ecod_private.subject_access_packages')).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query('select text from notes where id=$1', [id(60)])).rows[0].text,
    'Changed candidate note',
  );
  await act(1);
  assert.equal(
    (
      await rpc('api_record_subject_access_delivery', [
        id(116),
        id(100),
        7,
        id(112),
        'Delivered using approved secure channel reference',
      ])
    ).version,
    8,
  );
  // Oversized source rows cannot create or leave partial review copies.
  await db.exec('reset role');
  await db.query('update notes set text=$1 where id=$2', ['x'.repeat(83000), id(60)]);
  await act(1);
  await assert.rejects(
    rpc('api_start_subject_access_review', [
      id(117),
      id(100),
      8,
      'Large source snapshot review reference',
    ]),
    /safe size limit/,
  );
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from ecod_private.subject_access_reviews where id=$1',
        [id(117)],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('select version from ecod_private.subject_requests where id=$1', [id(100)]))
      .rows[0].version,
    8,
  );
  await db.query('update notes set text=$1 where id=$2', ['Safe restored note', id(60)]);
  await act(1);
  // A new review must retain the same verification boundary after close/reopen.
  await rpc('api_start_subject_access_review', [
    id(118),
    id(100),
    8,
    'Fresh bounded review reference',
  ]);
  const next = await rpc('api_subject_access_page', [id(100)]);
  const safe = next.rows.map((r) => ({
    category: r.category,
    id: r.id,
    decision: r.category === 'candidates' ? 'include' : 'withhold',
  }));
  await rpc('api_review_subject_access_rows', [
    id(119),
    id(100),
    9,
    id(118),
    safe,
    'Records reviewed before disclosure',
  ]);
  for (let n = 0; n < 4; n++)
    await rpc('api_prepare_subject_access_package', [
      id(120 + n),
      id(100),
      10 + n,
      id(118),
      'Approved package generation reference',
    ]);
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(124),
      id(100),
      14,
      id(118),
      'Approved package generation reference',
    ]),
    /limit reached/,
  );
  await db.exec('reset role');
  await db.exec(
    `insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{"auditedDocumentAccess":true,"auditedCandidateExports":true}');select set_config('request.jwt.claim.aal','aal2',false);`,
  );
  await act(1);
  await rpc('api_set_privileged_mfa', [true]);
  await db.exec("select set_config('request.jwt.claim.aal','aal1',false)");
  await assert.rejects(rpc('api_subject_access_page', [id(100)]), /Verify your authenticator/);
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(120),
      id(100),
      10,
      id(118),
      'Approved package generation reference',
    ]),
    /Verify your authenticator/,
  );
  await db.exec("select set_config('request.jwt.claim.aal','aal2',false)");
  assert.equal((await rpc('api_subject_access_page', [id(100)])).review.state, 'prepared');
  await rpc('api_update_subject_request', [
    id(130),
    id(100),
    14,
    'close',
    'Manual fulfillment reviewed by administrator',
  ]);
  assert.deepEqual((await rpc('api_subject_access_page', [id(100)])).rows, []);
  await rpc('api_update_subject_request', [
    id(131),
    id(100),
    15,
    'reopen',
    'Candidate submitted a new access request',
  ]);
  await rpc('api_update_subject_request', [
    id(132),
    id(100),
    16,
    'verify',
    'Identity verified for the reopened request',
  ]);
  await rpc('api_update_subject_request', [
    id(133),
    id(100),
    17,
    'start',
    'New access scope review started',
  ]);
  assert.equal((await rpc('api_subject_access_page', [id(100)])).review.state, 'unavailable');
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(134),
      id(100),
      18,
      id(118),
      'Prior verification disclosure reference',
    ]),
    /expired or superseded/,
  );
  await db.exec('reset role');
  await db.exec(`insert into notes(id,workspace_id,"candidateId",text)
    select gen_random_uuid(),'${id(11)}','${id(50)}','bulk-limit-fixture' from generate_series(1,2001);`);
  await act(1);
  await assert.rejects(
    rpc('api_start_subject_access_review', [
      id(140),
      id(100),
      18,
      'Record count bound review reference',
    ]),
    /safe size limit/,
  );
  await db.exec('reset role');
  await db.exec(`delete from notes where text='bulk-limit-fixture';
    insert into notes(id,workspace_id,"candidateId",text)
    select gen_random_uuid(),'${id(11)}','${id(50)}',repeat('large-package-fixture ',3200) from generate_series(1,31);`);
  await act(1);
  await rpc('api_start_subject_access_review', [
    id(141),
    id(100),
    18,
    'Large package snapshot review reference',
  ]);
  let version = 19;
  for (const offset of [0, 25]) {
    const batch = await rpc('api_subject_access_page', [id(100), offset]);
    assert.ok(batch.rows.length > 0 && batch.rows.length <= 25);
    await rpc('api_review_subject_access_rows', [
      id(142 + offset),
      id(100),
      version++,
      id(141),
      batch.rows.map((r) => ({ category: r.category, id: r.id, decision: 'include' })),
      'Reviewed large disclosure records',
    ]);
  }
  assert.equal((await rpc('api_subject_access_page', [id(100)])).pending, 0);
  await act(5); // Different administrator has no daily packages; exercise the byte bound.
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(170),
      id(100),
      version,
      id(141),
      'Bounded response preparation reference',
    ]),
    /download size limit/,
  );
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from ecod_private.subject_access_packages where id=$1',
        [id(170)],
      )
    ).rows[0].n,
    0,
  );
  await db.exec(`insert into candidates(id,workspace_id,name,email) values('${id(52)}','${id(11)}','Survivor','survivor@example.com');
    update candidates set "mergedInto"='${id(52)}' where id='${id(50)}';`);
  await act(1);
  assert.equal((await rpc('api_subject_access_page', [id(100)])).review.state, 'unavailable');
  await assert.rejects(
    rpc('api_prepare_subject_access_package', [
      id(171),
      id(100),
      version,
      id(141),
      'Merged candidate disclosure reference',
    ]),
    /Candidate changed or merged/,
  );
});
