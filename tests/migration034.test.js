import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('custom field definitions and values enforce roles, types, history, sync and tenant boundaries', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const path = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(path)).filter((name) => /^\d+.*\.sql$/.test(name)).sort())
    await db.exec(await readFile(new URL(file, path), 'utf8'));
  await db.exec(await readFile(new URL('034_custom_fields.sql', path), 'utf8'));
  await db.exec(`insert into auth.users values('${id(1)}','admin@e.com'),('${id(2)}','recruiter@e.com'),('${id(3)}','viewer@e.com'),('${id(4)}','outside@e.com');
    insert into workspaces(id,name) values('${id(11)}','Team'),('${id(12)}','Outside');
    insert into memberships values('${id(1)}','${id(11)}','admin'),('${id(2)}','${id(11)}','recruiter'),('${id(3)}','${id(11)}','viewer'),('${id(4)}','${id(12)}','admin');`);
  const act = (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
    );
  const defs = {
    clients: [
      { name: 'Seats', type: 'number' },
      { name: 'Renewal', type: 'date' },
      { name: 'Region', type: 'select', options: ['East', 'West'] },
    ],
    clientContacts: [{ name: 'Team', type: 'text' }],
  };
  await act(1);
  await db.query(`insert into settings(id,custom) values('workspace',$1::jsonb)`, [
    JSON.stringify({ customFields: defs, retentionDays: 730 }),
  ]);
  await db.exec(
    `insert into clients(id,name,custom) values('${id(21)}','Account','{"Seats":0,"Renewal":"2024-02-29","Region":"East"}');`,
  );
  await assert.rejects(db.exec(`update settings set custom='{}'`), /cannot be removed/);
  await assert.rejects(
    db.exec(`update settings set custom=jsonb_set(custom,'{customFields,clients}','[]')`),
    /cannot be removed/,
  );
  await assert.rejects(
    db.exec(
      `update settings set custom=jsonb_set(custom,'{customFields,clients}','[{"name":"Region","type":"select","options":["East","east"]}]')`,
    ),
    /Duplicate field choice/,
  );
  await act(2);
  await assert.rejects(
    db.exec(`insert into settings(id,custom) values('other','{"customFields":{}}')`),
    /row.level security/,
  );
  for (const custom of ['[]', '{"Seats":"7"}', '{"Renewal":"2025-02-29"}', '{"Region":"North"}']) {
    await assert.rejects(
      db.query(`update clients set custom=$1::jsonb where id=$2`, [custom, id(21)]),
    );
  }
  await db.exec(`update clients set custom=custom||'{"Seats":12}' where id='${id(21)}';
    insert into "clientContacts"(id,"clientId",name,email,custom) values('${id(31)}','${id(21)}','Account lead','lead@example.com','{"Team":"Engineering"}');`);
  const feed = (await db.query(`select api_changes_page(current_date-1,0,100) as result`)).rows[0]
    .result;
  assert.equal(feed.clients[0].custom.Seats, 12);
  assert.equal(feed.clientContacts[0].custom.Team, 'Engineering');
  assert.equal(
    (
      await db.query(
        `select snapshot->'custom'->>'Seats' as seats from jsonb_to_recordset(api_legacy_rows('history')->'rows') as h("entityType" text,"entityId" uuid,action text,snapshot jsonb) where "entityId"='${id(21)}' and action='clients updated'`,
      )
    ).rows[0].seats,
    '0',
  );
  await act(3);
  assert.equal((await db.query(`update clients set custom='{}' returning id`)).rows.length, 0);
  await act(4);
  assert.equal((await db.query('select * from clients')).rows.length, 0);
  await db.exec(
    `insert into clients(name,custom) values('Other account','{"Seats":"Not subject to another workspace definitions"}');`,
  );
  await act(1);
  assert.equal((await db.query('select * from clients')).rows.length, 1);
  await db.exec(
    `update settings set custom=jsonb_set(custom,'{customFields,clients,0,archived}','true');`,
  );
  assert.equal(
    (await db.query(`select custom->>'Seats' as seats from clients`)).rows[0].seats,
    '12',
  );
});
