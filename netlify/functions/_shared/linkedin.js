import { linkedinProfile, linkedinLookup, pdlCandidateDraft } from '../../../src/linkedin.js';
import { httpError } from './responses.js';
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
    const body = await response.json();
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
