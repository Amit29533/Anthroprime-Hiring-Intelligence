import {
  linkedinProfile,
  linkedinLookup,
  pdlCandidateDraft,
  sessionCandidateDraft,
} from '../../../src/linkedin.js';
import { httpError } from './responses.js';
import { boundedProviderJson } from './controlled-workflows.js';
export function linkedinConfiguration(env = process.env) {
  return {
    key: env.PEOPLEDATALABS_API_KEY || '',
    enabled: env.LINKEDIN_ENRICHMENT_ENABLED === 'true',
  };
}
export async function enrichLinkedin(
  profile,
  { configuration = linkedinConfiguration(), fetcher = fetch } = {},
) {
  const input = linkedinLookup(profile);
  if (!configuration.key || !configuration.enabled)
    throw httpError(
      409,
      'LinkedIn lookup is not configured. Use pasted profile text or ask your administrator to configure it.',
    );
  const url = new URL('https://api.peopledatalabs.com/v5/person/enrich');
  url.searchParams.set(input.id ? 'lid' : 'profile', input.id || input.profile);
  url.searchParams.set('min_likelihood', '6');
  url.searchParams.set('include_if_matched', 'true');
  url.searchParams.set(
    'data_include',
    'full_name,work_email,mobile_phone,job_title,job_company_name,location_name,skills,linkedin_url,linkedin_id',
  );
  let response;
  try {
    response = await fetcher(url.href, {
      headers: { 'X-Api-Key': configuration.key, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw httpError(502, 'LinkedIn enrichment provider is unavailable.');
  }
  if (response.status === 404)
    throw httpError(404, 'No matching profile found. Paste profile text instead.');
  if (response.status === 429)
    throw httpError(429, 'Enrichment provider quota reached. Try later or paste profile text.');
  if ([401, 403].includes(response.status))
    throw httpError(409, 'Enrichment provider rejected the configured key or plan permissions.');
  if (!response.ok) throw httpError(502, 'LinkedIn enrichment provider is unavailable.');
  try {
    const body = response.body?.getReader
      ? await boundedProviderJson(response)
      : await response.json();
    if (Buffer.byteLength(JSON.stringify(body)) > 65536)
      throw Error('Provider response exceeds its limit.');
    if (
      body.status !== 200 ||
      !Number.isInteger(body.likelihood) ||
      body.likelihood < 6 ||
      body.likelihood > 10 ||
      !Array.isArray(body.matched) ||
      !body.matched.includes(input.id ? 'lid' : 'profile') ||
      (input.id && String(body.data?.linkedin_id) !== input.id)
    )
      throw new Error('Unmatched profile');
    return {
      draft: pdlCandidateDraft(
        body.data,
        input.profile || linkedinProfile(body.data?.linkedin_url),
      ),
      provider: 'People Data Labs',
      likelihood: body.likelihood,
      lookedUpAt: new Date().toISOString(),
    };
  } catch {
    throw httpError(
      502,
      'Provider returned an incomplete or mismatched profile. Paste profile text instead.',
    );
  }
}
export function sessionScraperConfiguration(env = process.env) {
  const url = env.LINKEDIN_SESSION_WORKER_URL || '';
  const token = env.LINKEDIN_WORKER_TOKEN || '';
  return { url, token, enabled: Boolean(url && token.length >= 32) };
}
// Calls the self-hosted worker that holds the test-account cookie. The cookie is
// never available to this function; only the worker URL and a shared token are.
export async function scrapeLinkedinSession(
  profile,
  { configuration = sessionScraperConfiguration(), fetcher = fetch } = {},
) {
  const input = linkedinLookup(profile);
  if (!input.profile)
    throw httpError(400, 'Session lookup needs a profile URL or handle, not a numeric ID.');
  if (!configuration.enabled)
    throw httpError(409, 'The LinkedIn session worker is not configured.');
  let endpoint;
  try {
    endpoint = new URL('/profile', configuration.url);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw Error('Bad worker URL');
  } catch {
    throw httpError(409, 'The LinkedIn session worker URL is invalid.');
  }
  let response;
  try {
    response = await fetcher(endpoint.href, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profile: input.profile }),
      redirect: 'error',
      signal: AbortSignal.timeout(24000),
    });
  } catch {
    throw httpError(502, 'The LinkedIn session worker is unavailable.');
  }
  if (response.status === 429)
    throw httpError(
      429,
      'The session worker is rate limited. Try again shortly or paste profile text.',
    );
  if (response.status === 409)
    throw httpError(409, 'LinkedIn requires the test-account session to be refreshed manually.');
  if (!response.ok) throw httpError(502, 'The LinkedIn session worker could not read the profile.');
  try {
    const body = response.body?.getReader
      ? await boundedProviderJson(response)
      : await response.json();
    if (Buffer.byteLength(JSON.stringify(body)) > 65536)
      throw Error('Worker response exceeds its limit.');
    return {
      draft: sessionCandidateDraft(body, input.profile),
      provider: 'LinkedIn test-account session',
      lookedUpAt: new Date().toISOString(),
    };
  } catch {
    throw httpError(
      502,
      'The session worker returned an incomplete or mismatched profile. Paste profile text instead.',
    );
  }
}
