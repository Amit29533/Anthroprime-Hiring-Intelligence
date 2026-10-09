import { parseCVText } from './cvParser.js';

// Public handles are distinct from partner API Person IDs. Only normalized
// LinkedIn member URLs are passed to the enrichment provider.
export function linkedinProfile(value) {
  if (typeof value !== 'string' || value.length > 500)
    throw new Error('Enter a LinkedIn profile URL or public handle.');
  let input = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(input))
    input = `https://www.linkedin.com/in/${input}`;
  else if (/^(www\.)?linkedin\.com\//i.test(input)) input = `https://${input}`;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a LinkedIn profile URL or public handle.');
  }
  const match = url.pathname.match(/^\/in\/([A-Za-z0-9][A-Za-z0-9._-]{2,99})\/?$/);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    !match
  )
    throw new Error('Use a LinkedIn member profile, such as linkedin.com/in/priya-sharma.');
  return `https://www.linkedin.com/in/${match[1].toLowerCase()}`;
}
export function linkedinLookup(value) {
  if (typeof value === 'string' && /^\d{5,20}$/.test(value.trim()))
    return { id: value.trim(), profile: null };
  return { id: null, profile: linkedinProfile(value) };
}
export function pastedLinkedinDraft(profile, text) {
  if (linkedinLookup(profile).id)
    throw new Error(
      'For pasted text, enter the public profile URL or handle. Numeric IDs require provider lookup.',
    );
  const linkedin = linkedinProfile(profile);
  if (typeof text !== 'string' || text.trim().length < 10 || text.length > 50000)
    throw new Error('Paste 10–50,000 characters of profile text to extract.');
  const parsed = parseCVText(text);
  if (parsed.linkedin && linkedinProfile(parsed.linkedin) !== linkedin)
    throw new Error(
      'The pasted text contains a different LinkedIn profile. Check the profile URL.',
    );
  return {
    name: parsed.name || '',
    email: parsed.email || '',
    phone: parsed.phone || '',
    title: parsed.title || '',
    company: '',
    location: '',
    skills: parsed.skills || [],
    linkedin,
    summary: parsed.summary || '',
  };
}
const value = (input, limit = 200) =>
  typeof input === 'string' ? input.trim().slice(0, limit) : '';
export function pdlCandidateDraft(data, profile) {
  const linkedin = linkedinProfile(profile);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Provider returned an invalid candidate.');
  if (!data.linkedin_url || linkedinProfile(data.linkedin_url) !== linkedin)
    throw new Error('Provider returned a different LinkedIn profile.');
  const name = value(data.full_name);
  if (!name) throw new Error('Provider returned no candidate name.');
  return {
    name,
    email: value(data.work_email, 254).toLowerCase(),
    phone: value(data.mobile_phone, 40),
    title: value(data.job_title),
    company: value(data.job_company_name),
    location: value(data.location_name),
    skills: Array.isArray(data.skills)
      ? [
          ...new Set(
            data.skills
              .filter((s) => typeof s === 'string')
              .map((s) => value(s, 80))
              .filter(Boolean),
          ),
        ].slice(0, 50)
      : [],
    linkedin,
    summary: '',
  };
}
// Draft from the self-hosted session worker. The worker returns only profile text
// fields; contact details are not on the public profile view, so email/phone stay
// blank for the recruiter to supply during review.
export function sessionCandidateDraft(data, profile) {
  const linkedin = linkedinProfile(profile);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Session worker returned an invalid profile.');
  if (!data.profile || linkedinProfile(data.profile) !== linkedin)
    throw new Error('Session worker returned a different LinkedIn profile.');
  const name = value(data.name);
  if (!name) throw new Error('Session worker returned no candidate name.');
  const headline = value(data.headline);
  const split = headline.split(/\s+(?:at|@)\s+/i);
  const latest =
    Array.isArray(data.experience) && Array.isArray(data.experience[0]) ? data.experience[0] : [];
  const experienceCompany = typeof latest[1] === 'string' ? latest[1].split('·')[0] : '';
  return {
    name,
    email: '',
    phone: '',
    title: value(split.length > 1 ? split[0] : headline || latest[0]),
    company: value(split.length > 1 ? split.slice(1).join(' at ') : experienceCompany),
    location: value(data.location),
    skills: Array.isArray(data.skills)
      ? [
          ...new Set(
            data.skills
              .filter((s) => typeof s === 'string')
              .map((s) => value(s, 80))
              .filter(Boolean),
          ),
        ].slice(0, 50)
      : [],
    linkedin,
    summary: value(data.about, 1500),
  };
}
