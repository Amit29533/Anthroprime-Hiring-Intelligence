import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedinProfile, pastedLinkedinDraft, pdlCandidateDraft } from '../src/linkedin.js';
import { enrichLinkedin } from '../netlify/functions/_shared/linkedin.js';
import { createLinkedinHandler } from '../netlify/functions/linkedin-candidate.js';
const profile = 'https://www.linkedin.com/in/priya-sharma';
const config = { key: 'private-key', enabled: true };
const person = {
  full_name: 'Priya Sharma',
  linkedin_url: 'linkedin.com/in/priya-sharma',
  job_title: 'Software Engineer',
  job_company_name: 'Example',
  location_name: 'Pune',
  work_email: 'priya@example.com',
  skills: ['Python'],
  birth_date: '1990-01-01',
  salary: 999,
};
test('LinkedIn normalization accepts public handles and strips tracking but rejects alternate hosts and non-member paths', () => {
  for (const input of ['Priya-Sharma', 'linkedin.com/in/priya-sharma/', `${profile}?trk=123#about`])
    assert.equal(linkedinProfile(input), profile);
  for (const input of [
    'https://linkedin.com.evil/in/priya-sharma',
    'https://evil@linkedin.com/in/priya-sharma',
    'file:///in/priya-sharma',
    'https://www.linkedin.com/company/example',
    '//localhost/in/abc',
    'https://linkedin.com:444/in/priya-sharma',
  ])
    assert.throws(() => linkedinProfile(input));
  const draft = pastedLinkedinDraft(
    'priya-sharma',
    'Priya Sharma\nSoftware Engineer\npriya@example.com\nPython',
  );
  assert.equal(draft.name, 'Priya Sharma');
  assert.equal(draft.linkedin, profile);
  assert.throws(
    () => pastedLinkedinDraft(profile, 'Priya Sharma\nhttps://linkedin.com/in/someone-else'),
    /different/,
  );
  assert.equal(pdlCandidateDraft(person, profile).company, 'Example');
  assert.equal(pdlCandidateDraft(person, profile).birth_date, undefined);
});
test('provider lookup uses a fixed endpoint, header key and bounded field projection, rejecting weak or mismatched profiles', async () => {
  const result = await enrichLinkedin('priya-sharma', {
    configuration: config,
    fetcher: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.peopledatalabs.com');
      assert.equal(parsed.searchParams.get('profile'), profile);
      assert.equal(parsed.searchParams.get('min_likelihood'), '6');
      assert.equal(parsed.searchParams.get('api_key'), null);
      assert.equal(options.headers['X-Api-Key'], config.key);
      assert.equal(options.redirect, 'error');
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 200, likelihood: 9, matched: ['profile'], data: person }),
      };
    },
  });
  assert.equal(result.draft.name, 'Priya Sharma');
  assert.equal(result.draft.salary, undefined);
  for (const body of [
    { likelihood: 2, matched: ['profile'], data: person },
    { likelihood: 8, matched: ['name'], data: person },
    {
      likelihood: 9,
      matched: ['profile'],
      data: { ...person, linkedin_url: 'linkedin.com/in/wrong-person' },
    },
  ])
    await assert.rejects(
      enrichLinkedin(profile, {
        configuration: config,
        fetcher: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ status: 200, ...body }),
        }),
      }),
      /mismatched/,
    );
  await assert.rejects(
    enrichLinkedin(profile, { configuration: { key: '', enabled: false } }),
    /not configured/,
  );
});
test('Netlify lookup requires editor membership, workspace opt-in and quota before calling provider', async () => {
  let calls = 0,
    allowed = { enabled: false, allowed: false },
    role = 'recruiter';
  const handler = createLinkedinHandler({
    configuration: () => config,
    authorize: async () => ({
      membership: { role },
      supabase: { rpc: async () => ({ data: allowed, error: null }) },
    }),
    lookup: async () => {
      calls++;
      return { draft: person };
    },
  });
  const event = { httpMethod: 'POST', body: JSON.stringify({ action: 'lookup', profile }) };
  assert.equal((await handler(event)).statusCode, 409);
  assert.equal(calls, 0);
  allowed = { enabled: true, allowed: false };
  assert.equal((await handler(event)).statusCode, 429);
  assert.equal(calls, 0);
  role = 'viewer';
  assert.equal((await handler(event)).statusCode, 403);
  role = 'recruiter';
  allowed.allowed = true;
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal(calls, 1);
  assert.equal((await handler({ ...event, httpMethod: 'GET' })).statusCode, 405);
});
test('numeric LinkedIn IDs use the provider lid parameter and require the returned ID to match', async () => {
  const lookup = (returnedId) =>
    enrichLinkedin('123456789', {
      configuration: config,
      fetcher: async (url) => {
        assert.equal(new URL(url).searchParams.get('lid'), '123456789');
        assert.equal(new URL(url).searchParams.has('profile'), false);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            likelihood: 9,
            matched: ['lid'],
            data: { ...person, linkedin_id: returnedId },
          }),
        };
      },
    });
  assert.equal((await lookup('123456789')).draft.linkedin, profile);
  await assert.rejects(lookup('999999999'), /mismatched/);
  assert.throws(
    () => pastedLinkedinDraft('123456789', 'Priya Sharma\nSoftware Engineer'),
    /Numeric IDs require/,
  );
});
