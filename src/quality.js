// Blueprint §10 — data-quality queues: profiles needing attention before they can be trusted for submission.
import { freshness } from './domain.js';
export const QUEUES = [
  { id:'no-email', label:'Missing email address', test:c => !c.email },
  { id:'no-phone', label:'Missing phone number', test:c => !c.phone },
  { id:'unverified-skills', label:'No validated skill evidence', test:c => !(c.skillsDetail || []).some(s => s.validated) },
  { id:'stale-comp', label:'Expected CTC unverified or stale', test:c => c.expected == null || freshness(c.verified) !== 'Fresh' },
  { id:'stale-availability', label:'Availability unverified or stale', test:c => c.notice == null || freshness(c.verified) !== 'Fresh' }
];
export const queueById = id => QUEUES.find(q => q.id === id);
export function qualityQueues(data) { return QUEUES.map(q => ({ ...q, candidates:data.candidates.filter(q.test) })); }
