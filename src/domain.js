import { meetsLevel, skillList, scanSkills } from './taxonomy.js';
export { skillList, canonical, scanSkills } from './taxonomy.js';
export const STAGES = ['Identified', 'Contacted', 'Assessed', 'Enrichment', 'Submitted', 'Interview', 'Offer', 'Deployed', 'Rejected', 'Withdrawn'];
export const WEIGHTS = { skills: 35, experience: 20, readiness: 20, availability: 10, budget: 10, location: 5 };
export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);
export const age = date => date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) : Infinity;
export const freshness = date => age(date) <= 60 ? 'Fresh' : age(date) <= 120 ? 'Aging' : 'Stale';
export const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0]).join('');
export const money = value => value == null || value === '' ? 'Not provided' : `₹${Number(value).toLocaleString('en-IN')} LPA`;
export const normalizeEmail = email => String(email || '').trim().toLowerCase();
export const normalizePhone = phone => String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
export const normalizeLinkedIn = url => String(url || '').trim().toLowerCase().replace(/\/+$/, '');
export function duplicate(candidate, people) {
  return people.find(p => p.id !== candidate.id && ((normalizeEmail(candidate.email) && normalizeEmail(p.email) === normalizeEmail(candidate.email)) || (normalizePhone(candidate.phone) && normalizePhone(p.phone) === normalizePhone(candidate.phone)) || (normalizeLinkedIn(candidate.linkedin) && normalizeLinkedIn(p.linkedin) === normalizeLinkedIn(candidate.linkedin))));
}
export function matchCandidate(c, d, assessments = []) {
  const required = skillList(d.skills || []);
  const niceToHave = skillList(d.niceToHave || []);
  const candidateSkills = skillList(c.skills || []);
  const skillRows = c.skillsDetail || [];
  const levelOf = s => skillRows.find(x => (x.skill || '') === s);
  const minFor = s => (d.skillMinimums && d.skillMinimums[s]) || d.minProficiency || 'Working';
  const matched = required.filter(s => candidateSkills.includes(s) && meetsLevel(levelOf(s)?.proficiency, minFor(s)));
  const missing = required.filter(s => !matched.includes(s));
  const niceMatched = niceToHave.filter(s => candidateSkills.includes(s));
  const recentAssessments = assessments.filter(a => a.candidateId === c.id && (!a.demandId || a.demandId === d.id) && age(a.date) <= 180);
  const latest = recentAssessments.sort((a, b) => b.date.localeCompare(a.date))[0];
  const relevant = c.relevantExperience == null ? null : Number(c.relevantExperience);
  const compatibleLocation = d.mode === 'Remote' || d.location.toLowerCase() === c.location.toLowerCase();
  const compatibleMode = !c.mode || c.mode === 'Flexible' || c.mode === d.mode;
  const engagementType = d.engagementType || 'Any';
  const compatibleEngagement = engagementType === 'Any' || !c.engagement || c.engagement === engagementType;
  const scores = {
    skills: required.length ? matched.length / required.length : 1,
    experience: relevant === null ? 0 : d.minExperience > 0 ? Math.min(1, relevant / d.minExperience) : 1,
    readiness: latest ? latest.score / 100 : 0,
    availability: c.notice == null ? 0 : c.notice <= d.maxNotice ? 1 : Math.max(0, 1 - (c.notice - d.maxNotice) / 90),
    budget: c.expected == null ? 0 : c.expected <= d.budget ? 1 : d.budget > 0 ? Math.max(0, 1 - (c.expected - d.budget) / d.budget) : 0,
    location: compatibleLocation && compatibleMode ? 1 : 0
  };
  const weights = { ...WEIGHTS, ...(d.weights || {}) };
  const denominator = Object.values(weights).reduce((a,b) => a + Number(b), 0) || 100;
  const score = Math.round(Object.keys(scores).reduce((s,k) => s + scores[k] * Number(weights[k]), 0) / denominator * 100);
  const blockers = [missing.length && `Missing ${missing.join(', ')}`, relevant !== null && relevant < d.minExperience && `Below ${d.minExperience} relevant years`, c.notice != null && c.notice > d.maxNotice && `${c.notice}-day notice exceeds ${d.maxNotice} days`, c.expected != null && c.expected > d.budget && 'Expected CTC above budget', !compatibleLocation && 'Location mismatch', !compatibleMode && 'Work mode mismatch', !compatibleEngagement && `Engagement mismatch: candidate is ${c.engagement}, demand needs ${engagementType}`].filter(Boolean);
  if(c.status === 'Unavailable') blockers.push('Candidate is currently unavailable');
  const unknowns = [c.notice == null && 'Notice period unknown', c.expected == null && 'Expected CTC unknown', relevant === null && 'Relevant experience unverified', !latest && 'No recent assessment', freshness(c.verified) === 'Stale' && 'Profile needs revalidation'].filter(Boolean);
  const details = {
    skills: `${matched.length} of ${required.length} must-have skills`,
    experience: relevant === null ? 'Relevant experience unverified' : `${relevant} relevant years · ${d.minExperience}+ required`,
    readiness: latest ? `${latest.score}/100 · assessed ${latest.date}` : 'No assessment within 180 days',
    availability: c.notice == null ? 'Notice period unknown' : `${c.notice} days · maximum ${d.maxNotice}`,
    budget: c.expected == null ? 'Expected CTC unknown' : `${money(c.expected)} · budget ${money(d.budget)}`,
    location: `${c.location} · ${c.mode || 'Mode unverified'}`
  };
  return { score, matched, missing, blockers, unknowns, scores, weights, details, niceCoverage:{ matched:niceMatched, missing:niceToHave.filter(s => !niceMatched.includes(s)) }, eligible: blockers.length === 0 && unknowns.length === 0 };
}
export function extractJD(text) {
  const skills = scanSkills(text);
  const years = text.match(/(\d{1,2})(?:\s*[-–+]\s*\d{0,2})?\s*(?:years|yrs)/i);
  const notice = text.match(/(\d+)\s*[- ]?day(?:s)?\s*(?:notice|join)/i);
  return { skills, ...(years ? { minExperience: Number(years[1]) } : {}), ...(notice ? { maxNotice: Number(notice[1]) } : {}) };
}
export function searchCandidate(c, query) {
  const text = [c.name,c.title,c.company,c.location,c.email,c.summary,...c.skills].join(' ').toLowerCase();
  const tokens = query.toLowerCase().match(/"[^"]+"|\S+/g) || [];
  return tokens.filter(t => t !== 'and').every(t => t.startsWith('-') ? !text.includes(t.slice(1).replaceAll('"','')) : text.includes(t.replaceAll('"','')));
}
export function validateCandidate(c) {
  if (!c.name?.trim()) return 'Full name is required.';
  if (!c.email && !c.phone) return 'Provide an email address or phone number.';
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'Enter a valid email address.';
  if (c.phone && (!/^\+?[\d\s().-]+$/.test(c.phone) || normalizePhone(c.phone).length < 7 || normalizePhone(c.phone).length > 15)) return 'Enter a valid phone number with country code (7–15 digits).';
  for (const key of ['experience','relevantExperience','notice','expected','current']) if (c[key] != null && (!Number.isFinite(Number(c[key])) || Number(c[key]) < 0)) return `${key} must be a non-negative number.`;
  if (c.experience != null && c.relevantExperience != null && Number(c.relevantExperience) > Number(c.experience)) return 'Relevant experience cannot exceed total experience.';
  return null;
}
