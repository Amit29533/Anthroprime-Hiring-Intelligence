// Blueprint §7 — append, don't overwrite: capture dated history rows when volatile facts change.
import { today } from './domain.js';
const num = v => v == null || v === '' ? null : Number(v);
const changed = (a, b) => (a ?? null) !== (b ?? null);
export function captureChanges(prev, next) {
  const out = { employmentHistory:[], compensationHistory:[], availabilityHistory:[] };
  if (!prev || !next || prev.id !== next.id) return out;
  if (changed(prev.company || '', next.company || '') || changed(prev.title || '', next.title || ''))
    out.employmentHistory.push({ id:crypto.randomUUID(), candidateId:next.id, company:next.company || '', title:next.title || '', employmentType:next.engagement || '', startDate:null, endDate:null, location:next.location || '', source:'Profile edit', verified:today(), created:new Date().toISOString() });
  if (changed(num(prev.current), num(next.current)))
    out.compensationHistory.push({ id:crypto.randomUUID(), candidateId:next.id, kind:'current', amount:num(next.current), currency:'INR', basis:'Annual', source:'Profile edit', verified:today() });
  if (changed(num(prev.expected), num(next.expected)))
    out.compensationHistory.push({ id:crypto.randomUUID(), candidateId:next.id, kind:'expected', amount:num(next.expected), currency:'INR', basis:'Annual', source:'Profile edit', verified:today() });
  if (changed(num(prev.notice), num(next.notice)) || changed(prev.earliestStart || null, next.earliestStart || null) || changed(prev.activeStatus || 'Active', next.activeStatus || 'Active'))
    out.availabilityHistory.push({ id:crypto.randomUUID(), candidateId:next.id, notice:num(next.notice), earliestStart:next.earliestStart || null, status:next.activeStatus || 'Active', mode:next.mode || '', captured:today() });
  return out;
}
