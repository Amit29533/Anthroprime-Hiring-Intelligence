import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('MFA gates privileged RPCs and policy downgrades using trusted claims, preserving recruiters and opt-out', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const f of files) await db.exec(await readFile(new URL(f, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_privileged_mfa.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com');
    insert into workspaces(id,name) values('${id(11)}','One');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter');
    insert into candidates(id,workspace_id,name,email) values('${id(50)}','${id(11)}','Candidate','a@example.com');
    insert into settings(id,workspace_id,custom) values('workspace','${id(11)}','{}');
    insert into documents(id,workspace_id,"candidateId",name,size,hash,"storagePath","storageProvider",stored) values('${id(99)}','${id(11)}','${id(50)}','cv.pdf',10,'hash','${id(11)}/cv.pdf','supabase',true);`);
  const act = async (n, claims) => {
    await db.exec('reset role');
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id(n), JSON.stringify(claims)],
    );
    await db.exec('set role authenticated');
  };
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(1, {});
  assert.equal((await rpc('api_privileged_mfa_status')).enabled, false);
  const create = [id(200), id(50), 'access', 'Review candidate access request', 'email'];
  await rpc('api_create_subject_request', create);
  await assert.rejects(rpc('api_set_privileged_mfa', [true]), /Verify your authenticator/);
  await act(1, { aal: 'aal2' });
  await assert.rejects(rpc('api_set_privileged_mfa', [true]), /Enable audited/);
  await db.query('update settings set custom=$1', [
    JSON.stringify({ auditedDocumentAccess: true, auditedCandidateExports: true }),
  ]);
  assert.equal((await rpc('api_set_privileged_mfa', [true])).enabled, true);
  await act(1, { user_metadata: { aal: 'aal2' } });
  assert.equal((await rpc('api_privileged_mfa_status')).enabled, true);
  for (const [name, args] of [
    ['api_create_subject_request', create],
    ['api_subject_request_detail', [id(200)]],
    ['api_update_subject_request', [id(201), id(200), 1, 'verify', 'Verified contact reference']],
    ['api_set_subject_outbound_hold', [id(202), id(200), 1, true, 'Reviewed hold reference']],
    ['api_prepare_candidate_export', [[id(50)]]],
    ['api_begin_document_access', [id(99)]],
  ]) {
    await assert.rejects(rpc(name, args), /Verify your authenticator/);
  }
  await assert.rejects(db.query("update settings set custom='{}'"), /Verify your authenticator/);
  await assert.rejects(db.query('delete from settings'), /permission denied/);
  await act(2, {});
  assert.equal((await rpc('api_prepare_candidate_export', [[id(50)]])).allowed, true);
  await assert.rejects(rpc('api_set_privileged_mfa', [false]), /Administrator/);
  await act(1, { aal: 'aal2' });
  assert.equal((await rpc('api_subject_request_detail', [id(200)])).case.id, id(200));
  assert.equal((await rpc('api_prepare_candidate_export', [[id(50)]])).allowed, true);
  await assert.rejects(
    db.query("update settings set custom=custom-'auditedDocumentAccess'"),
    /Enable audited/,
  );
  assert.equal((await rpc('api_begin_document_access', [id(99)])).enforced, true);
  await rpc('api_set_privileged_mfa', [false]);
  await act(1, {});
  assert.equal((await rpc('api_prepare_candidate_export', [[id(50)]])).allowed, true);
  await assert.rejects(
    db.query('select ecod_private.mfa_export_base($1)', [[id(50)]]),
    /permission denied/,
  );
});
