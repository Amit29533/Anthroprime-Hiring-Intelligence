import test from 'node:test';
import assert from 'node:assert/strict';
import { cvPhone, parseCVText } from '../src/cvParser.js';
import { stage1Database, id } from './stage1-harness.js';
import { localVector } from '../src/intelligence.js';
import { sendOriginal } from '../src/documents.js';

test('private upload network failures give actionable feedback without exposing signed URLs', async () => {
  await assert.rejects(
    sendOriginal('https://private.example/file?secret=hidden', {}, async () => {
      throw new TypeError('Failed to fetch');
    }),
    (error) =>
      /CORS.*Content-Type.*If-None-Match/.test(error.message) && !error.message.includes('hidden'),
  );
  const response = { status: 412, ok: false };
  assert.equal(
    await sendOriginal('https://private.example/file', {}, async () => response),
    response,
  );
});

test('CV phone extraction excludes education dates and never joins separate lines', () => {
  for (const text of ['Education\n2018 - 2022', 'Updated 2026-10-09', '2022\n2026'])
    assert.equal(cvPhone(text), '');
  assert.equal(cvPhone('2018 - 2022\nPhone: +91 98765 43210'), '+91 98765 43210');
  assert.equal(cvPhone('Phone: (415) 555-0123'), '(415) 555-0123');
  assert.equal(parseCVText('Mira Testcandidate\nEducation\n2018 - 2022').phone, '');
});

test('hosted demand stage configuration saves with tenant protections and shared search returns Anthro-ID', async (t) => {
  const { db, act, rpc } = await stage1Database(t);
  await act(1);
  await db.query(
    `insert into demands(id,title,client,"stageSet",skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)
     values($1,$2,$3,$4,array['React'],2,30,35,'Bengaluru','Hybrid',1,'High','2026-11-01',
     '{"skills":35,"experience":20,"readiness":20,"availability":10,"budget":10,"location":5}')`,
    [id(31), 'Test React developer', 'Example client', ['Identified', 'Interview']],
  );
  assert.deepEqual(
    (await db.query('select "stageSet" from demands where id=$1', [id(31)])).rows[0].stageSet,
    ['Identified', 'Interview'],
  );
  await assert.rejects(
    db.query('update demands set "stageSet"=$1 where id=$2', [['Unknown'], id(31)]),
    /demands_stage_set_allowed/,
  );
  await act(3);
  await assert.rejects(
    db
      .query('update demands set title=$1 where id=$2 returning id', ['Viewer demand', id(31)])
      .then((result) => {
        if (!result.rows.length) throw new Error('permission denied');
      }),
    /row-level security|permission denied/,
  );
  await act(4);
  assert.equal((await db.query('select id from demands where id=$1', [id(31)])).rows.length, 0);
  await act(1);
  await db.query('update candidates set title=$1,skills=$2 where id=$3', [
    'React Developer',
    ['React'],
    id(21),
  ]);
  const rows = await rpc('api_index_candidates');
  const row = rows.find((r) => r.id === id(21));
  await rpc('api_index_candidate', [row.id, row.fingerprint, localVector(row.text)]);
  const matches = await rpc('api_hosted_search', [localVector('React')]);
  assert.equal(matches[0].id, id(21));
  assert.match(matches[0].anthroId, /^ANTHRO-\d{5}$/);
  assert.ok(Number.isInteger(matches[0].anthroNumber));
  await act(4);
  assert.deepEqual(await rpc('api_hosted_search', [localVector('React')]), []);
  await act(null, 'anon');
  await assert.rejects(
    rpc('api_hosted_search', [localVector('React')]),
    /permission denied|membership/,
  );
});
