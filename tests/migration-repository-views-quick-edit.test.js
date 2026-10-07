import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('personal views, sorted cursors and quick edits enforce scope, quotas, replay and conflicts', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  const migration = files.find((f) => f.endsWith('_repository_views_and_quick_edit.sql'));
  await db.exec(await readFile(new URL(migration, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((f) => f.endsWith('_candidate_profile_edit.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,skills,tags,experience,notice,verified,owner,"nextAction")
    select ('30000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'${id(11)}','Same name','p'||i||'@e.com',array['React'],array['Bench'],
      case when i=70 then null else i%10 end,case when i=70 then null else i%30 end,date '2026-09-01'+i,'Owner','Call next'
    from generate_series(1,70) i;
    insert into candidates(id,workspace_id,name,email) values('${id(500)}','${id(12)}','Other','other-person@e.com');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  await act(2);
  assert.deepEqual((await rpc('api_repository_views')).views, []);
  const filters = { minExperience: '7', maxExperience: '9', tag: 'Bench', sort: 'experience' };
  const saved = await rpc('api_repository_views', ['save', id(600), 'Experienced bench', filters]);
  assert.equal(saved.views.length, 1);
  assert.deepEqual(saved.views[0].filters, filters);
  assert.equal(
    (await rpc('api_repository_views', ['save', id(600), 'Experienced bench', filters])).views
      .length,
    1,
  );
  await assert.rejects(
    rpc('api_repository_views', ['save', id(600), 'Different', filters]),
    /conflict/,
  );
  await assert.rejects(
    rpc('api_repository_views', ['save', id(601), 'Bad', { maxExpected: 20 }]),
    /administrator/,
  );
  await assert.rejects(
    rpc('api_repository_views', ['save', id(601), 'Bad', { query: [] }]),
    /filter value/,
  );
  await assert.rejects(
    rpc('api_repository_views', ['save', id(601), 'Bad', { minExperience: 9, maxExperience: 7 }]),
    /experience range/,
  );
  await assert.rejects(rpc('api_repository_page', [{ sort: 'injected' }]), /sort/);
  const ranged = await rpc('api_repository_page', [filters]);
  assert.ok(ranged.rows.length > 0);
  assert.ok(ranged.rows.every((p) => p.experience >= 7 && p.experience <= 9));
  for (const sort of ['name', 'verified', 'experience', 'notice']) {
    let cursor = null;
    const rows = [];
    do {
      const page = await rpc('api_repository_page', [{ sort }, cursor, 17]);
      rows.push(...page.rows);
      cursor = page.next;
    } while (cursor);
    assert.equal(rows.length, 70);
    assert.equal(new Set(rows.map((p) => p.id)).size, 70);
    if (sort === 'verified') assert.equal(rows[0].id, id(170));
    if (sort === 'experience') {
      assert.equal(rows[0].experience, 9);
      assert.equal(rows.at(-1).experience, null);
    }
    if (sort === 'notice') {
      assert.equal(rows[0].notice, 0);
      assert.equal(rows.at(-1).notice, null);
    }
    const page = await rpc('api_repository_page', [{ sort }, null, 17]);
    await assert.rejects(
      rpc('api_repository_page', [{ sort, tag: 'Bench' }, page.next, 17]),
      /Cursor/,
    );
    assert.equal(rows[0].email, undefined);
    assert.equal(rows[0].cursor_value, undefined);
  }
  await act(3);
  assert.equal((await rpc('api_repository_views')).views.length, 0);
  await rpc('api_repository_views', ['delete', id(600)]);
  await assert.rejects(rpc('api_candidate_quick_context', [id(101)]), /Editor/);
  await assert.rejects(
    rpc('api_candidate_quick_edit', [id(101), 'a'.repeat(32), '', '']),
    /Editor/,
  );
  await assert.rejects(
    db.query('select * from ecod_repository_private.repository_views'),
    /permission denied/,
  );
  await act(2);
  assert.equal((await rpc('api_repository_views')).views.length, 1);
  await db.exec(`reset role;insert into memberships values('${id(2)}','${id(12)}','recruiter');`);
  await act(2);
  await rpc('api_switch_workspace', [id(12)]);
  assert.equal((await rpc('api_repository_views')).views.length, 0);
  await rpc('api_repository_views', ['delete', id(600)]);
  await assert.rejects(rpc('api_candidate_quick_context', [id(101)]), /not found/);
  await rpc('api_switch_workspace', [id(11)]);
  assert.equal((await rpc('api_repository_views')).views.length, 1);
  const before = await rpc('api_candidate_quick_context', [id(101)]);
  const after = await rpc('api_candidate_quick_edit', [
    id(101),
    before.token,
    'New owner',
    'Schedule assessment',
  ]);
  assert.equal(after.owner, 'New owner');
  assert.equal(after.nextAction, 'Schedule assessment');
  assert.notEqual(after.token, before.token);
  const replay = await rpc('api_candidate_quick_edit', [
    id(101),
    before.token,
    'New owner',
    'Schedule assessment',
  ]);
  assert.deepEqual(replay, after);
  await assert.rejects(
    rpc('api_candidate_quick_edit', [id(101), before.token, 'Stale owner', 'Overwrite']),
    /changed/,
  );
  const profile = (await rpc('api_candidate_section', [id(101), 'profile'])).candidate;
  assert.equal(profile.verified, '2026-09-02');
  assert.equal(
    (await rpc('api_candidate_section', [id(101), 'history'])).rows.filter(
      (r) => r.action === 'Profile updated',
    ).length,
    1,
  );
  await assert.rejects(rpc('api_candidate_quick_context', [id(500)]), /not found/);
  await act(4);
  assert.equal((await rpc('api_repository_views')).views.length, 0);
  await assert.rejects(
    rpc('api_repository_views', ['save', id(600), 'Experienced bench', filters]),
    /conflict/,
  );
  await act(1);
  await rpc('api_repository_views', ['save', id(602), 'Compensation', { maxExpected: '30' }]);
  await db.exec(`reset role;update memberships set role='recruiter' where user_id='${id(1)}';`);
  await act(1);
  const restricted = (await rpc('api_repository_views')).views[0];
  assert.equal(restricted.restricted, true);
  assert.equal(restricted.filters.maxExpected, undefined);
  await act(2);
  for (let i = 0; i < 49; i++)
    await rpc('api_repository_views', ['save', id(700 + i), `View ${i}`, {}]);
  await assert.rejects(
    rpc('api_repository_views', ['save', id(800), 'Overflow', {}]),
    /50 personal/,
  );
  assert.equal((await rpc('api_repository_views', ['delete', id(600)])).views.length, 49);
  assert.equal((await rpc('api_repository_views', ['delete', id(600)])).views.length, 49);
  const facts = await rpc('api_candidate_profile_context', [id(101)]);
  const wanted = {
    ...facts.fields,
    name: 'Updated candidate',
    company: 'New employer',
    experience: 5.5,
    relevantExperience: 4,
    notice: 0,
  };
  const changed = await rpc('api_candidate_profile_edit', [id(101), facts.token, wanted]);
  assert.equal(changed.fields.notice, 0);
  assert.equal(changed.fields.experience, 5.5);
  assert.deepEqual(
    await rpc('api_candidate_profile_edit', [id(101), facts.token, wanted]),
    changed,
  );
  await assert.rejects(
    rpc('api_candidate_profile_edit', [id(101), facts.token, { ...wanted, name: 'Lost change' }]),
    /changed/,
  );
  for (const bad of [
    { ...wanted, verified: '2030-01-01' },
    { ...wanted, notice: -1 },
    { ...wanted, notice: 0.5 },
    { ...wanted, experience: '5' },
    { ...wanted, name: ' ' },
    { ...wanted, relevantExperience: 99 },
    { ...wanted, summary: null },
  ]) {
    await assert.rejects(rpc('api_candidate_profile_edit', [id(101), changed.token, bad]));
  }
  const history = (await rpc('api_candidate_section', [id(101), 'history'])).rows;
  assert.equal(history.filter((r) => r.action === 'Profile updated').length, 2);
  await db.exec('reset role');
  const snapshot = (
    await db.query(
      'select snapshot from public.history where "entityId"=$1 and snapshot->>\'name\'=$2',
      [id(101), facts.fields.name],
    )
  ).rows;
  assert.ok(snapshot.some((row) => row.snapshot.company === facts.fields.company));
  await act(2);
  const preserved = (await rpc('api_candidate_section', [id(101), 'profile'])).candidate;
  assert.equal(preserved.verified, '2026-09-02');
  assert.equal(preserved.anthroId, profile.anthroId);
  const unknown = await rpc('api_candidate_profile_edit', [
    id(101),
    changed.token,
    { ...wanted, experience: null, relevantExperience: null, notice: null },
  ]);
  assert.equal(unknown.fields.notice, null);
  await assert.rejects(rpc('api_candidate_profile_context', [id(500)]), /not found/);
  await act(3);
  await assert.rejects(rpc('api_candidate_profile_context', [id(101)]), /Editor/);
  await assert.rejects(
    rpc('api_candidate_profile_edit', [id(101), unknown.token, wanted]),
    /Editor/,
  );
  await act(0, 'anon');
  await assert.rejects(rpc('api_candidate_profile_context', [id(101)]), /permission denied/);
  await assert.rejects(rpc('api_repository_views'), /permission denied/);
  await act(0);
  await assert.rejects(rpc('api_repository_views'), /membership/);
});
