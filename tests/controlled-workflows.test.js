import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  baselineDraft,
  validateHighlights,
  controlledProvider,
  runControlledWorkflow,
  verifyFixtureCallback,
} from '../netlify/functions/_shared/controlled-workflows.js';
import { createControlledRunner } from '../netlify/functions/controlled-workflow-run.js';
import { createControlledCallback } from '../netlify/functions/controlled-workflow-callback.js';
import { createIntelligenceHandler } from '../netlify/functions/intelligence.js';
import { evaluateProfessionalDrafts, evaluationCases } from '../scripts/stage4-evaluation.mjs';
const id = '79000000-0000-4000-8000-000000000021';
const source = {
  fields: { title: 'Engineer', skills: 'React, SQL', experience: '5', mode: 'Remote' },
  candidate: id,
};
const gate = {
  id,
  kind: 'ai',
  source,
  policy: { mode: 'fixture', providerVersion: 'fixture-model' },
};
test('fixtures use the deterministic professional baseline without credentials or external calls', async () => {
  let network = 0,
    gates = 0;
  const r = await controlledProvider(gate, {
    fetcher: () => {
      network++;
    },
    before: async () => {
      gates++;
    },
  });
  assert.equal(network, 0);
  assert.equal(gates, 1);
  assert.equal(r.fixture, true);
  assert.equal(r.highlights.length, 4);
  assert.equal(validateHighlights(r, source), r);
  assert.throws(
    () => validateHighlights({ ...r, highlights: [{ field: 'title', quote: 'CEO' }] }, source),
    /attribution/,
  );
  assert.throws(
    () => validateHighlights({ ...r, fields: { name: 'Forbidden' } }, source, 'enrichment'),
    /Forbidden/,
  );
  assert.throws(() => baselineDraft({ fields: {} }), /No permitted/);
});
test('OpenAI request sends only professional source fields and rejects invented/refused/incomplete or wrong-version results', async () => {
  let sent;
  const live = { ...gate, policy: { mode: 'live', providerVersion: 'accepted-model-snapshot' } };
  const draft = baselineDraft(source);
  const fetcher = async (url, p) => {
    sent = { url, ...JSON.parse(p.body) };
    return Response.json({
      status: 'completed',
      model: live.policy.providerVersion,
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }],
    });
  };
  assert.deepEqual(
    await controlledProvider(live, { env: { OPENAI_API_KEY: 'fixture-secret' }, fetcher }),
    draft,
  );
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(JSON.parse(sent.input), source.fields);
  assert.ok(!sent.input.includes(id));
  for (const body of [
    { status: 'incomplete', model: live.policy.providerVersion },
    { status: 'completed', model: 'unexpected' },
    {
      status: 'completed',
      model: live.policy.providerVersion,
      output: [{ content: [{ type: 'refusal' }] }],
    },
  ]) {
    await assert.rejects(
      controlledProvider(live, {
        env: { OPENAI_API_KEY: 'secret' },
        fetcher: async () => Response.json(body),
      }),
      /Incomplete/,
    );
  }
  await assert.rejects(
    controlledProvider(live, {
      env: { OPENAI_API_KEY: 'secret' },
      fetcher: async () =>
        Response.json({
          status: 'completed',
          model: live.policy.providerVersion,
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    ...draft,
                    highlights: [{ field: 'title', quote: 'CEO' }],
                  }),
                },
              ],
            },
          ],
        }),
    }),
    /attribution/,
  );
});
test('licensed enrichment minimizes requested fields and drops contact/identity/financial provider data', async () => {
  let query;
  const g = {
    ...gate,
    kind: 'enrichment',
    policy: { mode: 'live', providerVersion: 'pdl-v5' },
    source: { ...source, profile: 'https://www.linkedin.com/in/fictional' },
  };
  const r = await controlledProvider(g, {
    env: { PEOPLEDATALABS_API_KEY: 'fixture', LINKEDIN_ENRICHMENT_ENABLED: 'true' },
    fetcher: async (url) => {
      query = new URL(url);
      return Response.json({
        status: 200,
        likelihood: 8,
        matched: ['profile'],
        data: {
          job_title: 'Provider engineer',
          skills: ['React'],
          full_name: 'Do not disclose',
          work_email: 'private@example.invalid',
          salary: 12345,
        },
      });
    },
  });
  assert.ok(!query.searchParams.get('data_include').includes('email'));
  assert.equal(query.searchParams.get('include_if_matched'), 'true');
  assert.ok(!JSON.stringify(r).includes('private'));
  assert.deepEqual(r.fields, { title: 'Provider engineer', skills: 'React' });
  await assert.rejects(
    controlledProvider(g, {
      env: {},
      fetcher: () => {
        throw Error('Unexpected network');
      },
    }),
    /configuration/,
  );
});
test('job and signing contracts never post externally or treat fixture completion as legal signing', async () => {
  let calls = 0;
  const fetcher = () => {
    calls++;
  };
  const job = await controlledProvider(
    {
      ...gate,
      kind: 'publishing',
      policy: { mode: 'live' },
      source: { fields: { title: 'Public job' } },
    },
    { fetcher },
  );
  assert.equal(job.fixture, false);
  assert.equal(calls, 0);
  const signing = await controlledProvider({ ...gate, kind: 'signing' }, { fetcher });
  assert.equal(signing.envelope, id);
  assert.equal(signing.fixture, true);
  await assert.rejects(
    controlledProvider({ ...gate, kind: 'signing', policy: { mode: 'live' } }, { fetcher }),
    /permitted signing provider/,
  );
  assert.equal(calls, 0);
});
test('provider bodies are bounded and gates precede network requests', async () => {
  let calls = 0;
  const live = { ...gate, policy: { mode: 'live', providerVersion: 'accepted' } };
  await assert.rejects(
    controlledProvider(live, {
      env: { OPENAI_API_KEY: 'secret' },
      before: async () => {
        throw Error('Revoked');
      },
      fetcher: () => {
        calls++;
      },
    }),
    /Revoked/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    controlledProvider(live, {
      env: { OPENAI_API_KEY: 'secret' },
      fetcher: async () => new Response('x'.repeat(65537), { status: 200 }),
    }),
    /too large/,
  );
});
test('unknown acknowledgements and expired final gates never invoke a second provider request', async () => {
  let providers = 0,
    claims = 0,
    finishes = 0;
  const client = {
    rpc: async (n, p) => {
      if (p.p_action === 'claim')
        return {
          data:
            ++claims === 1
              ? { status: 'Running', id, lease: id, generation: 1 }
              : { status: 'Unknown', id },
        };
      if (p.p_action === 'gate') return { data: gate };
      if (p.p_action === 'finish') {
        finishes++;
        return { error: { message: 'Lost acknowledgement' } };
      }
    },
  };
  const provider = async () => {
    providers++;
    return baselineDraft(source);
  };
  assert.match((await runControlledWorkflow(client, { id }, { provider })).status, /Unknown/);
  assert.equal(finishes, 2);
  assert.equal((await runControlledWorkflow(client, { id }, { provider })).status, 'Unknown');
  assert.equal(providers, 1);
  const revoked = {
    rpc: async (n, p) =>
      p.p_action === 'claim'
        ? { data: { status: 'Running', id, lease: id, generation: 1 } }
        : { error: {} },
  };
  await runControlledWorkflow(revoked, { id }, { provider });
  assert.equal(providers, 1);
});
test('fixture callback verifies exact raw bytes, bounded timestamp, generation and payload schema', () => {
  const secret = 'fixture-secret-'.repeat(3),
    now = 1791450000000;
  const body = JSON.stringify({ id, event: id, envelope: id, generation: 1, state: 'completed' }),
    stamp = String(now);
  const event = {
    body,
    headers: {
      'X-Anthro-Fixture-Timestamp': stamp,
      'X-Anthro-Fixture-Signature': createHmac('sha256', secret)
        .update(stamp + '.' + body)
        .digest('hex'),
    },
  };
  assert.equal(verifyFixtureCallback(event, secret, now).state, 'completed');
  assert.throws(
    () => verifyFixtureCallback({ ...event, body: body + ' ' }, secret, now),
    /signature/,
  );
  assert.throws(() => verifyFixtureCallback(event, secret, now + 300001), /authentication/);
  assert.throws(
    () => verifyFixtureCallback({ ...event, isBase64Encoded: true }, secret, now),
    /unavailable/,
  );
});
test('run endpoint authorizes exact reviewed dispatch and redacts provider failures', async () => {
  let calls = 0;
  const handler = createControlledRunner({
    authorize: async () => ({
      supabase: {
        rpc: async (n, p) => {
          assert.equal(n, 'api_controlled_workflows');
          assert.deepEqual(p.p_payload, { id });
          return { data: { id, actor: id, workspace: id } };
        },
      },
    }),
    service: () => ({}),
    run: async () => {
      calls++;
      return { status: 'Fixture prepared' };
    },
  });
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ id, operation: id, head: 'reviewed' }),
  };
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(
    (await handler({ ...event, body: JSON.stringify({ id, url: 'https://untrusted.invalid' }) }))
      .statusCode,
    409,
  );
  assert.equal(calls, 1);
  assert.equal((await createControlledCallback({ secret: () => '' })(event)).statusCode, 403);
});
test('legacy freeform draft generation is disabled before any provider call', async () => {
  let calls = 0;
  const handler = createIntelligenceHandler({
    authorize: async () => ({ supabase: {} }),
    provider: async () => {
      calls++;
    },
  });
  const r = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'draft', candidateId: id }),
  });
  assert.equal(r.statusCode, 409);
  assert.equal(calls, 0);
  assert.match(r.body, /Stage 4/);
});
test('evaluation grades deidentified literal grounding without inventing human utility or live performance', () => {
  const report = evaluateProfessionalDrafts();
  assert.equal(report.cases, 12);
  assert.equal(report.groundingPercent, 100);
  assert.equal(report.baselineUtility, null);
  assert.equal(report.manualUtilityReviewRequired, true);
  const results = evaluationCases.map((s) => baselineDraft(s));
  results[0].highlights[0].quote = 'Invented CEO';
  const failed = evaluateProfessionalDrafts(evaluationCases, results);
  assert.equal(failed.safetyFailures, 1);
  assert.ok(failed.groundingPercent < 100);
});
