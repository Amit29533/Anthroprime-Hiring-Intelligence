import { httpError } from './responses.js';

export function virusTotalConfiguration(env = process.env) {
  return {
    key: env.VIRUSTOTAL_API_KEY || '',
    licensed: env.VIRUSTOTAL_USAGE_TIER === 'commercial',
  };
}

// Reputation lookup only. Never upload CV bytes, names, URLs or signed storage links.
export async function lookupVirusTotal(
  hash,
  { configuration = virusTotalConfiguration(), fetcher = fetch, now = Date.now() } = {},
) {
  if (!/^[a-f0-9]{64}$/i.test(hash || ''))
    throw httpError(400, 'Document has no valid SHA-256 hash.');
  if (!configuration.key || !configuration.licensed)
    throw httpError(
      409,
      'Configure VIRUSTOTAL_API_KEY and confirm a commercial-use license with VIRUSTOTAL_USAGE_TIER=commercial.',
    );
  let response;
  try {
    response = await fetcher(`https://www.virustotal.com/api/v3/files/${hash.toLowerCase()}`, {
      headers: { 'x-apikey': configuration.key, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw httpError(502, 'VirusTotal lookup is temporarily unavailable.');
  }
  if (response.status === 404) return { status: 'unknown', checkedAt: new Date(now).toISOString() };
  if (response.status === 429) throw httpError(429, 'VirusTotal quota reached. Try again later.');
  if ([401, 403].includes(response.status))
    throw httpError(409, 'VirusTotal rejected the configured key or account permissions.');
  if (!response.ok) throw httpError(502, 'VirusTotal lookup is temporarily unavailable.');
  let body;
  try {
    body = await response.json();
  } catch {
    throw httpError(502, 'VirusTotal returned an invalid report.');
  }
  if (body?.data?.id !== hash.toLowerCase() || body.data.type !== 'file')
    throw httpError(502, 'VirusTotal returned an invalid report.');
  const attrs = body.data.attributes || {};
  const raw = attrs.last_analysis_stats;
  const names = [
    'malicious',
    'suspicious',
    'harmless',
    'undetected',
    'timeout',
    'confirmed-timeout',
    'failure',
    'type-unsupported',
  ];
  const valid =
    raw &&
    names.every(
      (key) =>
        raw[key] == null || (Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 10000),
    );
  const stats = Object.fromEntries(names.map((key) => [key, valid ? raw[key] || 0 : 0]));
  const detections = stats.malicious + stats.suspicious;
  const completed = detections + stats.harmless + stats.undetected;
  const date = attrs.last_analysis_date;
  const validDate = Number.isInteger(date) && date > 0 && date * 1000 <= now;
  const stale = !validDate || now - date * 1000 > 30 * 86400000;
  const status = !valid
    ? 'incomplete'
    : detections > 0
      ? 'detections'
      : !completed
        ? 'incomplete'
        : stale
          ? 'stale'
          : 'no_known_detections';
  return {
    status,
    detections,
    completedEngines: completed,
    stale,
    analysedAt: validDate ? new Date(date * 1000).toISOString() : null,
    checkedAt: new Date(now).toISOString(),
  };
}
