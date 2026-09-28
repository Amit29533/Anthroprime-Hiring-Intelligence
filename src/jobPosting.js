// Google Jobs / schema.org structured data for the public careers page (Zoho Recruit B6).
//
// Everything here is a pure function over the *public* role projection returned by
// `api_public_open_roles`. That projection is the security boundary: budget, matching weights,
// internal tags, owner, approval state and tenant identifiers are not in it, so they cannot leak
// into a search engine even by accident. There is a test that fails if a field outside the
// allowlist below ever appears in the emitted JSON-LD.
//
// Honest caveat, documented in the README as well: this markup is injected by client-side
// JavaScript. Google does render JS before indexing, but server-rendered or prerendered pages are
// indexed faster and more reliably. Emitting correct JSON-LD is necessary for a Google Jobs rich
// result; on its own it is not sufficient.

/** The only role fields that may ever reach a public page. Mirrors the RPC's projection. */
export const PUBLIC_ROLE_FIELDS = [
  'id',
  'title',
  'client',
  'location',
  'mode',
  'engagementType',
  'positions',
  'description',
  'skills',
  'created',
  'target',
];

/**
 * Default country for `PostalAddress.addressCountry`. The blueprint's workspace is India-based
 * (cities, notice periods in days, CTC in LPA) and the location field is a bare city name, so
 * there is nothing in the data to infer a country from. Change this one constant when deploying
 * elsewhere rather than guessing per role.
 */
export const DEFAULT_COUNTRY = 'IN';

/** schema.org employmentType, mapped from the engagement the recruiter recorded. */
export function employmentType(role) {
  const engagement = String(role?.engagementType || '').toLowerCase();
  if (engagement.includes('contract')) return 'CONTRACTOR';
  if (engagement.includes('part')) return 'PART_TIME';
  if (engagement.includes('intern')) return 'INTERN';
  if (engagement.includes('temp')) return 'TEMPORARY';
  if (engagement.includes('permanent') || engagement.includes('full')) return 'FULL_TIME';
  // 'Any' or unrecorded: state nothing rather than assert full-time employment we cannot support.
  return '';
}

export const isRemote = (role) =>
  String(role?.mode || '')
    .toLowerCase()
    .includes('remote');

/** A date as YYYY-MM-DD, or '' when it is missing or unparseable. Never invents a date. */
export function isoDate(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** Canonical URL for one role, so each posting has its own indexable address. */
export function roleUrl(role, { origin = '', path = '/careers.html', workspace = '' } = {}) {
  const params = new URLSearchParams();
  if (workspace) params.set('ws', workspace);
  params.set('role', role?.id || '');
  return `${origin}${path}?${params.toString()}`;
}

/** A plain-text summary used for the meta description when a role has no description. */
export function roleSummary(role) {
  const bits = [
    role?.client,
    [role?.location, role?.mode].filter(Boolean).join(' · '),
    role?.positions ? `${role.positions} position${role.positions === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const description = String(role?.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (description) return description.length > 300 ? `${description.slice(0, 297)}…` : description;
  return bits.join(' · ');
}

/**
 * schema.org JobPosting for one role. Fields that would require information the workspace does
 * not hold — salary, exact street address, an identifier scheme — are omitted rather than
 * guessed: a wrong `baseSalary` in a Google rich result is worse than an absent one.
 */
export function jobPostingJsonLd(role, options = {}) {
  const {
    origin = '',
    path = '/careers.html',
    workspace = '',
    country = DEFAULT_COUNTRY,
  } = options;
  if (!role?.id || !role?.title) return null;
  const posted = isoDate(role.created);
  const expires = isoDate(role.target);
  const type = employmentType(role);
  const remote = isRemote(role);

  const json = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: role.title,
    description: roleSummary(role) || role.title,
    identifier: {
      '@type': 'PropertyValue',
      name: role.client || 'AnthroPrime',
      value: role.id,
    },
    hiringOrganization: {
      '@type': 'Organization',
      name: role.client || 'AnthroPrime',
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: role.location || '',
        addressCountry: country,
      },
    },
    url: roleUrl(role, { origin, path, workspace }),
    directApply: true,
  };
  if (posted) json.datePosted = posted;
  if (expires) json.validThrough = expires;
  if (type) json.employmentType = type;
  if (Number(role.positions) > 0) json.totalJobOpenings = Number(role.positions);
  if (Array.isArray(role.skills) && role.skills.length) json.skills = role.skills.join(', ');
  if (remote) {
    json.jobLocationType = 'TELECOMMUTE';
    json.applicantLocationRequirements = { '@type': 'Country', name: country };
  }
  return json;
}

/** An ItemList of postings, which is how a listing page describes several roles at once. */
export function jobListJsonLd(roles, options = {}) {
  const items = (roles || [])
    .map((role) => jobPostingJsonLd(role, options))
    .filter(Boolean)
    .map((posting, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: posting.url,
      item: posting,
    }));
  return {
    '@context': 'https://schema.org/',
    '@type': 'ItemList',
    itemListElement: items,
  };
}

/** Title, description, canonical and Open Graph tags for the current view. */
export function pageMeta(role, options = {}) {
  const { origin = '', path = '/careers.html', workspace = '', brand = 'AnthroPrime' } = options;
  if (!role) {
    const url = workspace
      ? `${origin}${path}?ws=${encodeURIComponent(workspace)}`
      : `${origin}${path}`;
    return {
      title: `Open roles — ${brand}`,
      description:
        'Live roles with our client partners. Apply directly — a recruiter reviews every application.',
      canonical: url,
      ogType: 'website',
    };
  }
  const where = [role.location, role.mode].filter(Boolean).join(' · ');
  return {
    title: `${role.title}${where ? ` — ${where}` : ''} | ${brand}`,
    description: roleSummary(role),
    canonical: roleUrl(role, { origin, path, workspace }),
    ogType: 'article',
  };
}

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * A sitemap for the published roles. Generated on demand from the recruiter app rather than at
 * build time, because which roles are published is workspace data and changes daily.
 */
export function sitemapXml(roles, options = {}) {
  const { origin = '', path = '/careers.html', workspace = '' } = options;
  const listing = workspace
    ? `${origin}${path}?ws=${encodeURIComponent(workspace)}`
    : `${origin}${path}`;
  const urls = [
    { loc: listing, lastmod: '' },
    ...(roles || [])
      .filter((role) => role?.id && role?.title)
      .map((role) => ({
        loc: roleUrl(role, { origin, path, workspace }),
        lastmod: isoDate(role.created),
      })),
  ];
  const body = urls
    .map(
      ({ loc, lastmod }) =>
        `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Roles a workspace is currently publishing — the same rule the public RPC applies. */
export const publishedRoles = (data) =>
  (data?.demands || []).filter((d) => d.status === 'Open' && d.careersVisible === true);
