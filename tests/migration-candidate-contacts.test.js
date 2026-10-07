import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('alternate contacts preserve provenance and history, protect primary writes and survive merges', async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const path = new URL('../supabase/migrations/', import.meta.url),
    files = (await readdir(path)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(
    await readFile(
      new URL(
        files.find((n) => n.endsWith('_candidate_contacts_verification.sql')),
        path,
      ),
      'utf8',
    ),
  );
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','other@e.com');
    insert into workspaces(id,name) values('${id(11)}','One'),('${id(12)}','Two');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');
    insert into candidates(id,workspace_id,name,email,phone,verified) values
    ('${id(101)}','${id(11)}','One','one@e.com','9876543210','2026-09-01'),('${id(102)}','${id(11)}','Two','two@e.com','9876543211','2026-09-01'),
    ('${id(103)}','${id(11)}','Survivor','survivor@e.com','','2026-09-01'),('${id(104)}','${id(12)}','Other','other@e.com','','2026-09-01');`);
  const act = (n, role = 'authenticated') =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ''}',false);set role ${role};`,
    );
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args))
      .rows[0].result;
  const read = (n = 101, offset = 0, eventOffset = 0) =>
    rpc('api_candidate_contacts', [id(n), offset, eventOffset]);
  const change = (action, contact, version, details, op = contact + 1000, n = 101) =>
    rpc('api_change_candidate_contact', [id(n), id(op), action, id(contact), version, details]);
  await act(2);
  assert.equal((await read()).rows.length, 0);
  await db.exec('reset role');
  const scopeBefore = (
    await db.query(`select ecod_private.erasure_inventory('${id(11)}','${id(101)}') as scope`)
  ).rows[0].scope;
  await act(2);
  const addDetails = {
    kind: 'email',
    value: ' Alt@Example.com ',
    label: 'Personal',
    source: 'Candidate call',
  };
  const first = await change('add', 201, 0, addDetails);
  assert.equal(first.version, 1);
  assert.equal((await change('add', 201, 0, addDetails)).replayed, true);
  let page = await read();
  assert.equal(page.rows[0].verified_at, null);
  assert.equal(page.rows[0].preferred, false);
  assert.equal(page.events.length, 1);
  await db.exec('reset role');
  const scopeAfter = (
    await db.query(`select ecod_private.erasure_inventory('${id(11)}','${id(101)}') as scope`)
  ).rows[0].scope;
  assert.notEqual(scopeBefore.fingerprint, scopeAfter.fingerprint);
  assert.equal(scopeAfter.counts.find((c) => c.category === 'contactRecords').count, 1);
  assert.equal(scopeAfter.counts.find((c) => c.category === 'contactEvents').count, 1);
  assert.equal(scopeAfter.counts.find((c) => c.category === 'contactReceipts').count, 1);
  assert.equal(JSON.stringify(scopeAfter).includes('Alt@Example.com'), false);
  await act(2);
  await assert.rejects(
    change('add', 201, 0, { ...addDetails, label: 'Changed' }),
    /operation conflict/,
  );
  await assert.rejects(
    change('add', 202, 0, { ...addDetails, value: 'ALT@example.com' }),
    /already linked/,
  );
  await assert.rejects(
    change('add', 202, 0, { ...addDetails, value: 'two@e.com' }),
    /already linked/,
  );
  await assert.rejects(
    change('add', 202, 0, { kind: 'phone', value: '123', source: 'Call' }),
    /phone/,
  );
  await assert.rejects(change('add', 202, 0, { ...addDetails, value: 'invalid' }), /email/);
  await assert.rejects(
    change('prefer', 201, 1, { reason: 'Candidate selected this contact' }, 2100),
    /Confirm/,
  );
  await assert.rejects(change('verify', 201, 1, { reason: 'yes' }, 2100), /evidence/);
  await assert.rejects(
    change('verify', 201, 1, { reason: 'Candidate confirmed on a call', verified_by: id(1) }, 2100),
    /detail/,
  );
  await change('verify', 201, 1, { reason: 'Candidate confirmed on a call' }, 2100);
  page = await read();
  assert.equal(page.rows[0].verified_by, id(2));
  assert.equal(page.rows[0].version, 2);
  await assert.rejects(
    change('retire', 201, 1, { reason: 'Incorrect stale version' }, 2101),
    /changed/,
  );
  await change('prefer', 201, 2, { reason: 'Candidate selected personal email' }, 2102);
  page = await read();
  assert.equal(page.rows[0].preferred, true);
  assert.equal(page.primaryEmail, 'one@e.com', 'preferred alternate never changes portal email');
  assert.equal(
    (await rpc('api_candidate_section', [id(101), 'profile'])).candidate.verified,
    '2026-09-01',
  );
  await change('add', 203, 0, {
    kind: 'phone',
    value: '+91 98765 43210',
    source: 'Candidate call',
  });
  await assert.rejects(
    db.exec(`update candidates set email='alt@example.com' where id='${id(102)}'`),
    /another candidate/,
  );
  await assert.rejects(
    db.exec(
      `insert into candidates(id,workspace_id,name,email) values('${id(110)}','${id(11)}','Duplicate','alt@example.com')`,
    ),
    /another candidate/,
  );
  await act(3);
  assert.equal((await read()).rows.length, 2);
  await assert.rejects(
    change('verify', 201, 3, { reason: 'Not allowed for viewer' }, 2200),
    /Editor/,
  );
  await assert.rejects(
    db.query('select * from ecod_contacts_private.contacts'),
    /permission denied/,
  );
  await assert.rejects(
    db.exec('delete from ecod_contacts_private.contact_events'),
    /permission denied/,
  );
  await act(4);
  await assert.rejects(read(), /not found/);
  await change('add', 204, 0, { ...addDetails, value: 'alt@example.com' }, 2201, 104);
  assert.equal(
    (await read(104)).rows.length,
    1,
    'same contact in another workspace remains isolated',
  );
  await act(2);
  await db.exec(
    `update candidates set "mergedInto"='${id(103)}',email='',phone='' where id='${id(101)}';`,
  );
  page = await read(101);
  assert.equal(page.candidateId, id(103));
  assert.equal(page.rows.length, 2);
  assert.equal(page.rows.find((c) => c.id === id(201)).preferred, false);
  assert.equal(page.rows.find((c) => c.id === id(201)).verified_by, id(2));
  assert.equal(page.events.filter((e) => e.action === 'merged').length, 2);
  await assert.rejects(
    change('verify', 201, 4, { reason: 'Old merged identity change' }, 2300),
    /not found/,
  );
  const email = page.rows.find((c) => c.id === id(201));
  await change(
    'retire',
    201,
    email.version,
    { reason: 'Candidate withdrew this address' },
    2301,
    103,
  );
  await assert.rejects(
    change(
      'verify',
      201,
      email.version + 1,
      { reason: 'Cannot reconfirm retired contact' },
      2302,
      103,
    ),
    /Retired/,
  );
  await db.exec(`update candidates set email='alt@example.com' where id='${id(102)}';`);
  assert.equal((await read(103)).rows.find((c) => c.id === id(201)).active, false);
  for (const contact of [301, 302]) {
    await change(
      'add',
      contact,
      0,
      { kind: 'email', value: `choice${contact}@example.com`, source: 'Candidate interview' },
      contact + 3000,
      103,
    );
    await change(
      'verify',
      contact,
      1,
      { reason: 'Candidate confirmed during interview' },
      contact + 4000,
      103,
    );
    await change(
      'prefer',
      contact,
      2,
      { reason: 'Candidate requested this preferred address' },
      contact + 5000,
      103,
    );
  }
  page = await read(103);
  assert.equal(page.rows.find((c) => c.id === id(301)).preferred, false);
  assert.equal(page.rows.find((c) => c.id === id(301)).version, 4);
  assert.equal(page.rows.find((c) => c.id === id(302)).preferred, true);
  assert.equal(page.events.filter((e) => e.action === 'preference_replaced').length, 1);
  for (let contact = 400; contact < 427; contact++) {
    await change(
      'add',
      contact,
      0,
      { kind: 'email', value: `limit${contact}@example.com`, source: 'Candidate interview' },
      contact + 6000,
      103,
    );
  }
  await assert.rejects(
    change(
      'add',
      427,
      0,
      { kind: 'email', value: 'overlimit@example.com', source: 'Candidate interview' },
      6427,
      103,
    ),
    /Contact limit/,
  );
  assert.equal((await read(103)).rows.filter((c) => c.active).length, 30);
  await assert.rejects(read(103, -1), /page/);
  await act(0, 'anon');
  await assert.rejects(read(103), /permission denied/);
  await act(0);
  await assert.rejects(read(103), /membership/);
});
