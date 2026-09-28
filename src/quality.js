// Blueprint §10 — data-quality queues: profiles needing attention before they can be trusted for submission.
import { freshness, today } from './domain.js';
export const QUEUES = [
  { id: 'no-email', label: 'Missing email address', test: (c) => !c.email },
  { id: 'no-phone', label: 'Missing phone number', test: (c) => !c.phone },
  {
    id: 'unverified-skills',
    label: 'No validated skill evidence',
    test: (c) => !(c.skillsDetail || []).some((s) => s.validated),
  },
  {
    id: 'stale-comp',
    label: 'Expected CTC unverified or stale',
    test: (c) => c.expected == null || freshness(c.verified) !== 'Fresh',
  },
  {
    id: 'stale-availability',
    label: 'Availability unverified or stale',
    test: (c) => c.notice == null || freshness(c.verified) !== 'Fresh',
  },
];
export const queueById = (id) => QUEUES.find((q) => q.id === id);
export function qualityQueues(data) {
  return QUEUES.map((q) => ({ ...q, candidates: data.candidates.filter(q.test) }));
}

// Blueprint §12 — retention review and anonymisation. Anonymisation keeps the profile's
// aggregate value (skills, experience band) while stripping identity and contact data.
export function retentionCutoff(months, ref = today()) {
  return new Date(new Date(ref).getTime() - months * 30.4375 * 86400000).toISOString().slice(0, 10);
}
export function retentionDue(candidates, months = 12, ref = today()) {
  const cutoff = retentionCutoff(months, ref);
  return candidates.filter((c) => !c.anonymized && c.verified && c.verified < cutoff);
}
export function anonymizeCandidate(c) {
  return {
    ...c,
    name: 'Anonymized',
    email: '',
    phone: '',
    summary: '',
    linkedin: '',
    title: '',
    company: '',
    status: 'Unavailable',
    anonymized: true,
    verified: today(),
  };
}
