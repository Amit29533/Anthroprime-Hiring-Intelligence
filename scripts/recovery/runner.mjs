// Explicit operator tool. Never invoked by Netlify or the browser.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rm, open } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { executionClient } from '../../netlify/functions/_shared/execution.js';
import { r2Configuration } from '../../netlify/functions/_shared/r2.js';
import { recoveryKey, encryptStream, decryptFile, digestFile } from './codec.mjs';
export const baselineSql = `set timezone='UTC';set datestyle='ISO, YMD';set bytea_output='hex';set extra_float_digits=3;create function pg_temp.recovery_inventory()returns jsonb language plpgsql as $$declare r record;n bigint;h text;v jsonb;tables jsonb:='[]';seq jsonb:='[]';begin
for r in select schemaname,tablename from pg_tables where schemaname in('public','auth','storage','supabase_migrations','vault')or schemaname like 'ecod%private'order by schemaname,tablename loop
 execute format($q$select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),''order by md5(to_jsonb(t)::text)),''))from %I.%I t$q$,r.schemaname,r.tablename)into n,h;tables:=tables||jsonb_build_array(jsonb_build_object('schema',r.schemaname,'table',r.tablename,'rows',n,'fingerprint',h));end loop;
for r in select sequence_schema,sequence_name from information_schema.sequences where sequence_schema in('public','auth','storage','supabase_migrations','vault')or sequence_schema like 'ecod%private'order by 1,2 loop execute format($q$select jsonb_build_object('last_value',last_value,'is_called',is_called)from %I.%I$q$,r.sequence_schema,r.sequence_name)into v;seq:=seq||jsonb_build_array(jsonb_build_object('schema',r.sequence_schema,'sequence',r.sequence_name,'state',v));end loop;
return jsonb_build_object('tables',tables,'sequences',seq,'schemas',(select jsonb_agg(nspname order by nspname)from pg_namespace where nspname in('public','auth','storage')or nspname like 'ecod%private'),'roles',(select jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig)order by rolname)from pg_roles where rolname not like 'pg_%'and rolname<>'postgres'),'roleMemberships',(select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,to_jsonb(m)->'inherit_option',to_jsonb(m)->'set_option')order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]')from pg_auth_members m where pg_get_userbyid(roleid)not like 'pg_%'and pg_get_userbyid(member)not like 'pg_%'));end$$;select pg_temp.recovery_inventory();`;
const refs = /^[A-Za-z0-9:_-]{1,100}$/;
export function validateConfig(c) {
  if (
    !c ||
    !refs.test(c.sourceRef) ||
    !refs.test(c.destinationRef) ||
    !refs.test(c.keyRef) ||
    !refs.test(c.sourceService) ||
    !isAbsolute(c.directory) ||
    !Array.isArray(c.workspaces) ||
    c.workspaces.length < 1 ||
    c.workspaces.length > 50 ||
    c.workspaces.some((x) => !/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x)) ||
    new Set(c.workspaces).size !== c.workspaces.length ||
    c.offsiteConfirmed !== true
  )
    throw Error(
      'Configure explicit custody, off-site destination, source service and 1–50 workspaces',
    );
  return c;
}
export function pgEnvironment(service) {
  if (!refs.test(service)) throw Error('Invalid PostgreSQL service reference');
  const env = { PGSERVICE: service, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'anthroprime-recovery' };
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'HOME',
    'USERPROFILE',
    'PGSERVICEFILE',
    'PGPASSFILE',
    'PGSSLMODE',
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
export function command(name, args, service, { stream = false } = {}) {
  const child = spawn(name, args, {
    shell: false,
    windowsHide: true,
    env: pgEnvironment(service),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => child.kill(), 1800000);
  let stderr = false;
  child.stderr.on('data', () => {
    stderr = true;
  });
  const done = new Promise((accept, reject) => {
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('PostgreSQL operator tool unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 && !stderr
        ? accept()
        : reject(Error('PostgreSQL tool failed or warned; acceptance incomplete'));
    });
  });
  if (stream) {
    done.catch(() => {});
    return { source: child.stdout, done, abort: () => child.kill() };
  }
  const chunks = [];
  let size = 0;
  child.stdout.on('data', (x) => {
    size += x.length;
    if (size > 16777216) child.kill();
    else chunks.push(x);
  });
  return done.then(() => {
    if (size > 16777216) throw Error('Inventory response bound exceeded');
    return Buffer.concat(chunks).toString('utf8');
  });
}
async function inventory(service, run = command) {
  return JSON.parse(
    (
      await run(
        'psql',
        ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', baselineSql],
        service,
      )
    ).trim(),
  );
}
// A target with views, sequences, custom routines or event triggers is not empty.
// Preprovisioned extension-owned objects are permitted on a compatible isolated host.
export const emptyTargetSql = `select count(*)from(
select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname!~'^pg_'and n.nspname<>'information_schema'and c.relkind in('r','p','S','v','m','f')and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
union all select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname!~'^pg_'and n.nspname<>'information_schema'and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
union all select oid from pg_event_trigger)operator_target_objects`;
const identitySql =
  "select current_database()||'@'||coalesce(inet_server_addr()::text,'local')||':'||coalesce(inet_server_port()::text,'local')";
async function operator(client, action, payload) {
  const { data, error } = await client.rpc('worker_processing_recovery', {
    p_action: action,
    p_payload: payload,
  });
  if (error) throw Error('Operator control unavailable');
  return data;
}
async function reportFailure(c, client, component) {
  for (const workspace of c.workspaces) {
    try {
      const cfg = await operator(client, 'configuration', { workspace, kind: 'recovery' });
      if (!cfg.configured || cfg.keyRef !== c.keyRef || cfg.destinationRef !== c.destinationRef)
        continue;
      await operator(client, 'evidence', {
        workspace,
        kind: 'recovery',
        generation: cfg.generation,
        id: randomUUID(),
        component,
        status: 'unavailable',
        body: {
          digest: '0'.repeat(64),
          keyRef: c.keyRef,
          destinationRef: c.destinationRef,
          sourceRef: c.sourceRef,
          durationSeconds: 0,
          code: component + '-acceptance-incomplete',
        },
      });
    } catch {
      /* Failed reporting must never fabricate evidence or expose diagnostics. */
    }
  }
}
export async function capture(
  c,
  {
    client = executionClient(5000),
    storage = r2Configuration,
    key = recoveryKey(),
    run = command,
  } = {},
) {
  validateConfig(c);
  try {
    const id = randomUUID(),
      root = join(c.directory, id);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const files = [],
      objects = [];
    const started = Date.now();
    const locked = await operator(client, 'lockdown', {
      reason: 'Encrypted complete recovery capture; resume explicitly after review',
    });
    if (!locked.paused) throw Error('Lockdown was not acknowledged');
    // Drain all pre-issued uploads/downloads and already-started workers before snapshotting.
    if (c.drainConfirmed !== true)
      throw Error(
        'Drain signed URLs/active workers and rerun with drainConfirmed=true; application remains paused',
      );
    const sourceIdentity = (
      await run(
        'psql',
        ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', identitySql],
        c.sourceService,
      )
    ).trim();
    const baseline = await inventory(c.sourceService, run);
    if (
      !baseline.schemas.includes('auth') ||
      !baseline.schemas.includes('ecod_processing_private') ||
      !baseline.schemas.includes('ecod_delivery_private')
    )
      throw Error('Full private/Auth schema inventory required');
    async function save(name, source, maxBytes) {
      const proof = await encryptStream(source, join(root, name), key, id + ':' + name, {
        maxBytes,
      });
      files.push({ name, ...proof });
      return name;
    }
    for (const [name, exe, args] of [
      ['database.enc', 'pg_dump', ['--format=custom', '--no-password']],
      ['roles.enc', 'pg_dumpall', ['--roles-only', '--no-role-passwords', '--no-password']],
    ]) {
      const task = run(exe, args, c.sourceService, { stream: true });
      try {
        await save(name, task.source, name === 'roles.enc' ? 16777216 : 10737418240);
        await task.done;
      } catch (e) {
        task.abort();
        throw e;
      }
    }
    const references = JSON.parse(
      (
        await run(
          'psql',
          [
            '-X',
            '-q',
            '-A',
            '-t',
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            `select coalesce(jsonb_agg(x),'[]')from(select 'r2'provider,storage_path key,hash,size,etag from ecod_private.cv_scan_verdicts union select coalesce(nullif("storageProvider",''),'supabase'),"storagePath",hash,size,null::text from public.documents where stored and coalesce("storagePath",'')<>'' union select 'r2',storage_path,hash,size,null::text from public."importFiles"where state<>'uploading' union select 'r2',storage_path,hash,size,null::text from public."documentJobs"where uploaded)x`,
          ],
          c.sourceService,
        )
      ).trim(),
    );
    const referenceIndex = new Map();
    for (const r of references) {
      const k = r.provider + ':' + r.key;
      referenceIndex.set(k, [...(referenceIndex.get(k) || []), r]);
    }
    const { client: r2, bucket } = storage();
    let cursor;
    const seen = new Set();
    do {
      const page = await r2.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor, MaxKeys: 1000 }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      for (const object of page.Contents || []) {
        if (
          objects.length >= 100000 ||
          !object.Key ||
          seen.has(object.Key) ||
          !object.ETag ||
          object.Size < 0 ||
          object.Size > 5242880
        )
          throw Error('Object inventory bound or identity mismatch');
        seen.add(object.Key);
        const result = await r2.send(
          new GetObjectCommand({ Bucket: bucket, Key: object.Key, IfMatch: object.ETag }),
          { abortSignal: AbortSignal.timeout(15000) },
        );
        try {
          if (result.ETag !== object.ETag || result.ContentLength !== object.Size)
            throw Error('Object changed during capture');
          const chunks = [];
          let bytes = 0;
          const hash = createHash('sha256');
          for await (const part of result.Body) {
            bytes += part.length;
            if (bytes > object.Size) throw Error('Object bound exceeded');
            hash.update(part);
            chunks.push(Buffer.from(part));
          }
          const fingerprint = hash.digest('hex');
          if (
            bytes !== object.Size ||
            (referenceIndex.get('r2:' + object.Key) || []).some(
              (r) =>
                (r.hash && r.hash !== fingerprint) ||
                r.size !== bytes ||
                (r.etag && r.etag !== object.ETag),
            )
          )
            throw Error('Retained scan proof mismatch');
          const name = 'object-' + String(objects.length).padStart(6, '0') + '.enc';
          await save(name, Readable.from(chunks), 5242880);
          objects.push({
            provider: 'r2',
            bucket,
            key: object.Key,
            etag: object.ETag,
            hash: fingerprint,
            size: bytes,
            file: name,
          });
        } finally {
          result.Body?.destroy?.();
        }
      }
      if (
        page.IsTruncated &&
        (!page.NextContinuationToken || page.NextContinuationToken === cursor)
      )
        throw Error('Nonprogressing object cursor');
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
    if (references.some((r) => r.provider === 'r2' && !seen.has(r.key)))
      throw Error('A retained original is absent');
    // Supabase originals must be captured too; do not certify an R2-only bundle when they exist.
    const buckets = await client.storage.listBuckets();
    if (buckets.error) throw Error('Supabase Storage inventory unavailable');
    for (const b of buckets.data || []) {
      const queue = [''],
        folders = new Set(['']);
      while (queue.length) {
        const prefix = queue.shift();
        let offset = 0;
        for (;;) {
          const page = await client.storage
            .from(b.id)
            .list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
          if (page.error || !Array.isArray(page.data))
            throw Error('Private Storage listing unavailable');
          for (const item of page.data) {
            if (
              typeof item.name !== 'string' ||
              !item.name ||
              item.name === '.' ||
              item.name === '..' ||
              item.name.includes('/')
            )
              throw Error('Invalid Storage inventory name');
            const path = prefix ? prefix + '/' + item.name : item.name;
            if (!item.id) {
              if (folders.size >= 100000 || folders.has(path)) throw Error('Folder bound exceeded');
              folders.add(path);
              queue.push(path);
              continue;
            }
            if (objects.length >= 100000) throw Error('Object bound exceeded');
            const response = await client.storage.from(b.id).download(path);
            if (response.error || !response.data || response.data.size > 5242880)
              throw Error('Private Storage copy unavailable');
            const bytes = Buffer.from(await response.data.arrayBuffer());
            const fingerprint = createHash('sha256').update(bytes).digest('hex');
            if (
              (referenceIndex.get('supabase:' + path) || []).some(
                (r) => (r.hash && r.hash !== fingerprint) || r.size !== bytes.length,
              )
            )
              throw Error('Private Storage reference mismatch');
            const name = 'object-' + String(objects.length).padStart(6, '0') + '.enc';
            await save(name, Readable.from([bytes]), 5242880);
            objects.push({
              provider: 'supabase',
              bucket: b.id,
              key: path,
              size: bytes.length,
              hash: createHash('sha256').update(bytes).digest('hex'),
              file: name,
            });
          }
          if (page.data.length < 1000) break;
          offset += 1000;
        }
      }
    }
    if (
      references.some(
        (r) =>
          r.provider === 'supabase' &&
          !objects.some((o) => o.provider === 'supabase' && o.key === r.key),
      )
    )
      throw Error('Missing private Storage original');
    const after = await inventory(c.sourceService, run);
    if (JSON.stringify(after) !== JSON.stringify(baseline))
      throw Error('Database changed during capture; no complete manifest issued');
    const manifest = {
      version: 1,
      id,
      sourceRef: c.sourceRef,
      sourceIdentity,
      destinationRef: c.destinationRef,
      keyRef: c.keyRef,
      baseline,
      objects,
      files,
      createdAt: new Date().toISOString(),
      coverage: {
        database: true,
        rolesAuth: true,
        privateJournals: true,
        sequences: true,
        objects: true,
        encrypted: true,
        paused: true,
      },
      limitations: [
        'Current immutable originals and observed versions; missing/replaced retained proofs fail capture.',
        'External server credentials/keys and historical deleted objects require separate custody.',
      ],
    };
    await encryptStream(
      Readable.from([Buffer.from(JSON.stringify(manifest))]),
      join(root, 'manifest.enc'),
      key,
      id + ':manifest',
      { maxBytes: 16777216 },
    );
    await writeFile(join(root, 'envelope.json'), JSON.stringify({ version: 1, id }), {
      flag: 'wx',
      mode: 0o600,
    });
    await verify(root, key);
    const digest = await digestFile(join(root, 'manifest.enc'));
    for (const workspace of c.workspaces) {
      const cfg = await operator(client, 'configuration', { workspace, kind: 'recovery' });
      if (!cfg.configured || cfg.keyRef !== c.keyRef || cfg.destinationRef !== c.destinationRef)
        throw Error('Configure matching recovery custody before reporting');
      await operator(client, 'evidence', {
        workspace,
        kind: 'recovery',
        generation: cfg.generation,
        id: randomUUID(),
        component: 'backup',
        status: 'passed',
        body: {
          ...manifest.coverage,
          digest,
          keyRef: c.keyRef,
          destinationRef: c.destinationRef,
          sourceRef: c.sourceRef,
          durationSeconds: Math.ceil((Date.now() - started) / 1000),
        },
      });
    }
    return { root, digest, objects: objects.length, paused: true };
  } catch (error) {
    await reportFailure(c, client, 'backup');
    throw error;
  }
}
export async function verify(root, key = recoveryKey(), { stageDirectory } = {}) {
  if ((await stat(join(root, 'envelope.json'))).size > 256) throw Error('Envelope bound exceeded');
  const envelope = JSON.parse(await readFile(join(root, 'envelope.json'), 'utf8'));
  if (envelope.version !== 1 || !/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(envelope.id))
    throw Error('Invalid backup envelope');
  if ((await stat(join(root, 'manifest.enc'))).size > 16777252)
    throw Error('Manifest bound exceeded');
  const stage = stageDirectory || join(root, '.verify-' + randomUUID());
  await mkdir(stage, { mode: 0o700 });
  try {
    await decryptFile(
      join(root, 'manifest.enc'),
      join(stage, 'manifest.json'),
      key,
      envelope.id + ':manifest',
    );
    const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8'));
    if (
      !manifest.baseline ||
      !Array.isArray(manifest.baseline.schemas) ||
      !refs.test(manifest.sourceRef) ||
      !refs.test(manifest.keyRef) ||
      !refs.test(manifest.destinationRef) ||
      typeof manifest.sourceIdentity !== 'string' ||
      !manifest.sourceIdentity ||
      manifest.version !== 1 ||
      manifest.id !== envelope.id ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > 100002 ||
      !Array.isArray(manifest.objects) ||
      manifest.objects.length > 100000 ||
      ['database.enc', 'roles.enc'].some((n) => !manifest.files.some((f) => f.name === n)) ||
      new Set(manifest.files.map((f) => f.name)).size !== manifest.files.length
    )
      throw Error('Incomplete backup manifest');
    const objectIndex = new Map(manifest.objects.map((o) => [o.file, o]));
    const fileIndex = new Map(manifest.files.map((f) => [f.name, f]));
    if (
      manifest.objects.some(
        (o) =>
          !/^object-\d{6}\.enc$/.test(o.file) ||
          !['r2', 'supabase'].includes(o.provider) ||
          typeof o.bucket !== 'string' ||
          !o.bucket ||
          typeof o.key !== 'string' ||
          !o.key ||
          !Number.isSafeInteger(o.size) ||
          o.size < 0 ||
          o.size > 5242880 ||
          !/^[a-f0-9]{64}$/.test(o.hash),
      ) ||
      objectIndex.size !== manifest.objects.length ||
      Object.values(manifest.coverage || {}).some((v) => v !== true) ||
      [
        'database',
        'rolesAuth',
        'privateJournals',
        'sequences',
        'objects',
        'encrypted',
        'paused',
      ].some((k) => manifest.coverage?.[k] !== true)
    )
      throw Error('Incomplete declared coverage');
    for (const file of manifest.files) {
      if (
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes >
          (file.name === 'database.enc'
            ? 10737418240
            : file.name === 'roles.enc'
              ? 16777216
              : 5242880) ||
        !/^(database|roles|object-\d{6})\.enc$/.test(file.name) ||
        !/^[a-f0-9]{64}$/.test(file.digest) ||
        (await digestFile(join(root, file.name))) !== file.digest
      )
        throw Error('Backup asset identity mismatch');
      const out = join(stage, file.name + '.plain');
      await decryptFile(join(root, file.name), out, key, envelope.id + ':' + file.name);
      if (
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        (await stat(out)).size !== file.bytes
      )
        throw Error('Backup asset size mismatch');
      const object = objectIndex.get(file.name);
      if (file.name === 'database.enc') {
        const fd = await open(out, 'r');
        try {
          const signature = Buffer.alloc(5);
          await fd.read(signature, 0, 5, 0);
          if (!signature.equals(Buffer.from('PGDMP')))
            throw Error('Native database archive required');
        } finally {
          await fd.close();
        }
      }
      if (file.name.startsWith('object-') && !object) throw Error('Missing object manifest entry');
      if (
        object &&
        ((await digestFile(out)) !== object.hash || (await stat(out)).size !== object.size)
      )
        throw Error('Object fingerprint mismatch');
      if (!stageDirectory) await rm(out);
    }
    if (manifest.objects.some((o) => !fileIndex.has(o.file))) throw Error('Missing object asset');
    return { manifest, digest: await digestFile(join(root, 'manifest.enc')), stage };
  } finally {
    if (!stageDirectory) await rm(stage, { recursive: true, force: true });
  }
}
export async function restore(
  root,
  c,
  { key = recoveryKey(), client = executionClient(5000), run = command } = {},
) {
  validateConfig(c);
  if (
    c.isolatedConfirmed !== true ||
    !refs.test(c.targetService) ||
    !refs.test(c.targetRef) ||
    c.targetService === c.sourceService ||
    c.targetRef === c.sourceRef ||
    !isAbsolute(c.stageDirectory)
  )
    throw Error('Explicit distinct isolated target and private staging directory required');
  try {
    const started = Date.now(),
      { manifest, digest } = await verify(root, key, { stageDirectory: c.stageDirectory });
    if (
      c.sourceRef !== manifest.sourceRef ||
      c.destinationRef !== manifest.destinationRef ||
      c.keyRef !== manifest.keyRef
    )
      throw Error('Recovery custody mismatch');
    const targetIdentity = (
      await run(
        'psql',
        ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', identitySql],
        c.targetService,
      )
    ).trim();
    if (targetIdentity === manifest.sourceIdentity)
      throw Error('Restore cannot target source database');
    const tables = Number(
      (
        await run(
          'psql',
          ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', emptyTargetSql],
          c.targetService,
        )
      ).trim(),
    );
    if (tables !== 0) throw Error('Restore requires an empty isolated database');
    const list = await run(
      'pg_restore',
      ['--list', join(c.stageDirectory, 'database.enc.plain')],
      c.targetService,
    );
    if (manifest.baseline.schemas.some((schema) => !list.includes(schema)))
      throw Error('Database archive scope incomplete');
    const roles = (await readFile(join(c.stageDirectory, 'roles.enc.plain'), 'utf8'))
      .replace(/^(?:CREATE|ALTER) ROLE (?:postgres|"postgres")[^\n]*;$/gm, '')
      .replace(/^CREATE ROLE (.+);$/gm, (_, identifier) => {
        const delimiter = '$anthro_role_' + randomUUID().replaceAll('-', '') + '$';
        return `DO ${delimiter} BEGIN CREATE ROLE ${identifier}; EXCEPTION WHEN duplicate_object THEN NULL; END ${delimiter};`;
      });
    await writeFile(join(c.stageDirectory, 'roles-restore.sql'), roles, {
      mode: 0o600,
      flag: 'wx',
    });
    await run(
      'psql',
      ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(c.stageDirectory, 'roles-restore.sql')],
      c.targetService,
    );
    await run(
      'pg_restore',
      [
        '--single-transaction',
        '--exit-on-error',
        '--dbname',
        'service=' + c.targetService,
        join(c.stageDirectory, 'database.enc.plain'),
      ],
      c.targetService,
    );
    const restored = await inventory(c.targetService, run);
    if (JSON.stringify(restored) !== JSON.stringify(manifest.baseline))
      throw Error('Restored tables, private journals, Auth, roles or sequence state mismatch');
    const paused = (
      await run(
        'psql',
        [
          '-X',
          '-q',
          '-A',
          '-t',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          'select paused from ecod_processing_private.lockdown',
        ],
        c.targetService,
      )
    ).trim();
    if (paused !== 't') throw Error('Restored database is not paused');
    // Originals remain in the private isolated staging area. Never write restored objects to the live bucket.
    const receipt = {
      ...manifest.coverage,
      digest,
      keyRef: c.keyRef,
      destinationRef: c.destinationRef,
      sourceRef: c.sourceRef,
      targetRef: c.targetRef,
      backupDigest: digest,
      durationSeconds: Math.ceil((Date.now() - started) / 1000),
    };
    for (const workspace of c.workspaces) {
      const cfg = await operator(client, 'configuration', { workspace, kind: 'recovery' });
      await operator(client, 'evidence', {
        workspace,
        kind: 'recovery',
        generation: cfg.generation,
        id: randomUUID(),
        component: 'restore',
        status: 'passed',
        body: receipt,
      });
    }
    await writeFile(
      join(c.stageDirectory, 'restore-receipt.json'),
      JSON.stringify({
        digest,
        paused: true,
        objects: manifest.objects.length,
        durationSeconds: receipt.durationSeconds,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    return { digest, paused: true, objects: manifest.objects.length };
  } catch (error) {
    await reportFailure(c, client, 'restore');
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, path, configPath] = process.argv.slice(2);
    if (action === 'verify') {
      const result = await verify(resolve(path));
      console.log(
        JSON.stringify({
          verified: true,
          digest: result.digest,
          objects: result.manifest.objects.length,
        }),
      );
    } else {
      const c = JSON.parse(await readFile(configPath || path, 'utf8'));
      if (action === 'capture') console.log(JSON.stringify(await capture(c)));
      else if (action === 'restore') console.log(JSON.stringify(await restore(resolve(path), c)));
      else if (action === 'unlock') {
        if (c.operatorResumeConfirmed !== true) throw Error('Explicit operator resume required');
        console.log(
          JSON.stringify(
            await operator(executionClient(5000), 'unlock', {
              reason: 'Reviewed capture/drill ended; feature policies remain paused',
            }),
          ),
        );
      } else
        throw Error(
          'Use capture <config>, verify <bundle>, restore <bundle> <config>, or unlock <config>',
        );
    }
  } catch {
    console.error(
      'Recovery operation incomplete. Keep source/target paused; inspect private operator artifacts.',
    );
    process.exitCode = 1;
  }
}
