import { randomUUID } from 'node:crypto';
import { scanPrivateBytes } from './clamd.js';
import { executionClient } from '../netlify/functions/_shared/execution.js';
const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
export async function probeScan(scan = scanPrivateBytes) {
  try {
    const clean = await scan(Buffer.from('Anthroprime fictional acceptance'));
    const blocked = await scan(eicar);
    if (
      clean.status !== 'clean' ||
      blocked.status !== 'infected' ||
      clean.engine !== blocked.engine ||
      !clean.engine ||
      clean.engine.length > 200
    )
      throw Error('Incomplete smoke');
    return {
      status: 'passed',
      body: { clean: true, blocked: true, engine: clean.engine, code: 'native-smoke' },
    };
  } catch {
    return { status: 'unavailable', body: { code: 'scan-smoke-unavailable' } };
  }
}
export async function probeOcr({ send = fetch, token = process.env.OCR_SHARED_TOKEN } = {}) {
  try {
    if (typeof token !== 'string' || token.length < 32) throw Error('Missing token');
    const response = await send('http://ocr:8080/smoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) throw Error('Unavailable');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4096) throw Error('Oversized');
      chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      value.fixture !== true ||
      typeof value.engine !== 'string' ||
      !value.engine ||
      value.engine.length > 200
    )
      throw Error('Invalid native evidence');
    return {
      status: 'passed',
      body: { fixture: true, engine: value.engine, code: 'image-only-native-smoke' },
    };
  } catch {
    return { status: 'unavailable', body: { code: 'ocr-smoke-unavailable' } };
  }
}
export async function reportProcessingHealth({
  workspaces = process.env.PROCESSING_WORKSPACES || '',
  client = executionClient(5000),
  scan = probeScan,
  ocr = probeOcr,
} = {}) {
  const ids = workspaces
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    ids.length > 50 ||
    new Set(ids).size !== ids.length ||
    ids.some((x) => !/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x))
  )
    throw Error('Configure up to 50 distinct workspace UUIDs');
  if (!ids.length) return { reported: 0 };
  const configurations = [];
  for (const workspace of ids) {
    const { data, error } = await client.rpc('worker_processing_recovery', {
      p_action: 'configuration',
      p_payload: { workspace, kind: 'processing' },
    });
    if (error) throw Error('Health configuration unavailable');
    if (data?.configured) configurations.push({ workspace, ...data });
  }
  if (!configurations.length) return { reported: 0 };
  const scanning = await scan();
  const extraction = configurations.some((x) => x.requireOcr) ? await ocr() : null;
  let reported = 0;
  for (const cfg of configurations) {
    for (const [component, value] of [
      ['scan', scanning],
      ...(cfg.requireOcr ? [['ocr', extraction]] : []),
    ]) {
      const { error } = await client.rpc('worker_processing_recovery', {
        p_action: 'evidence',
        p_payload: {
          workspace: cfg.workspace,
          kind: 'processing',
          generation: cfg.generation,
          id: randomUUID(),
          component,
          ...value,
        },
      });
      if (error) throw Error('Health receipt unavailable');
      reported++;
    }
  }
  return { reported };
}
