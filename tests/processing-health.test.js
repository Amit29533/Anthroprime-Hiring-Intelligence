import test from 'node:test';
import assert from 'node:assert/strict';
import { probeScan, probeOcr, reportProcessingHealth } from '../scanner/health.js';
test('native scanner acceptance requires harmless clean and EICAR blocked with the same engine', async () => {
  const inputs = [];
  const passed = await probeScan(async (bytes) => {
    inputs.push(bytes);
    return { status: inputs.length === 1 ? 'clean' : 'infected', engine: 'ClamAV fixture' };
  });
  assert.equal(passed.status, 'passed');
  assert.equal(inputs[1].length, 68);
  assert.match(inputs[1].toString(), /EICAR/);
  for (const scan of [
    async () => ({ status: 'clean', engine: 'fixture' }),
    async () => {
      throw Error('secret daemon host');
    },
    async () => ({ status: 'infected', engine: 'fixture' }),
  ])
    assert.deepEqual(await probeScan(scan), {
      status: 'unavailable',
      body: { code: 'scan-smoke-unavailable' },
    });
});
test('OCR smoke uses a fixed private endpoint, authentication and bounded evidence without leaking errors', async () => {
  let calls = 0;
  const token = 't'.repeat(32);
  const result = await probeOcr({
    token,
    send: async (url, request) => {
      calls++;
      assert.equal(url, 'http://ocr:8080/smoke');
      assert.equal(request.headers.Authorization, 'Bearer ' + token);
      assert.equal(request.headers['Content-Length'], '0');
      return new Response(JSON.stringify({ fixture: true, engine: 'Tesseract fixture' }));
    },
  });
  assert.equal(result.status, 'passed');
  assert.equal(calls, 1);
  for (const payload of [
    { fixture: false, engine: 'fixture' },
    { fixture: true, engine: '' },
    'x'.repeat(5000),
  ])
    assert.equal(
      (
        await probeOcr({
          token,
          send: async () =>
            new Response(typeof payload === 'string' ? payload : JSON.stringify(payload)),
        })
      ).status,
      'unavailable',
    );
  assert.equal(
    (
      await probeOcr({
        token: 'short',
        send: () => assert.fail('Missing credentials reached network'),
      })
    ).status,
    'unavailable',
  );
});
test('health reporting scopes current generations and never probes arbitrary workspace input', async () => {
  const workspace = '00000000-0000-0000-0000-000000000011';
  const writes = [];
  let scans = 0,
    ocrs = 0;
  const client = {
    rpc: async (_, args) => {
      if (args.p_action === 'configuration')
        return { data: { configured: true, generation: 9, requireOcr: true } };
      writes.push(args.p_payload);
      return {};
    },
  };
  assert.deepEqual(
    await reportProcessingHealth({
      workspaces: workspace,
      client,
      scan: async () => {
        scans++;
        return { status: 'passed', body: { engine: 'fixture', clean: true, blocked: true } };
      },
      ocr: async () => {
        ocrs++;
        return { status: 'unavailable', body: { code: 'fixture-outage' } };
      },
    }),
    { reported: 2 },
  );
  assert.equal(scans, 1);
  assert.equal(ocrs, 1);
  assert.deepEqual(
    writes.map((x) => [x.workspace, x.generation, x.component]),
    [
      [workspace, 9, 'scan'],
      [workspace, 9, 'ocr'],
    ],
  );
  assert.notEqual(writes[0].id, writes[1].id);
  for (const ids of ['https://secret.invalid', workspace + ',' + workspace])
    await assert.rejects(reportProcessingHealth({ workspaces: ids, client }), /distinct workspace/);
});
