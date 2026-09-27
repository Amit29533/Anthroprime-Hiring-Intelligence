// Blueprint §17 — conversion and rediscovery metrics computed from records that already exist.
// These are current-record measures, not fabricated historical conversion rates.
import { matchCandidate } from './domain.js';
export function timeToReady(candidates, assessments) {
  const rows = [];
  for (const c of candidates.filter(x => x.status === 'Ready')) {
    const dates = assessments.filter(a => a.candidateId === c.id && a.date).map(a => a.date).sort();
    if (c.created && dates.length) rows.push(Math.max(0, Math.round((new Date(dates[dates.length - 1]) - new Date(c.created)) / 86400000)));
  }
  return rows.length ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : null;
}
export function sourceConversion(candidates) {
  const map = {};
  for (const c of candidates) {
    const s = c.source || 'Unknown';
    map[s] = map[s] || { total: 0, ready: 0 };
    map[s].total++;
    if (c.status === 'Ready') map[s].ready++;
  }
  return Object.entries(map).map(([source, v]) => ({ source, ...v, pct: Math.round(v.ready / v.total * 100) })).sort((a, b) => b.pct - a.pct || b.total - a.total);
}
export function rediscoveryRate(considerations) {
  const byCandidate = {};
  for (const a of considerations) byCandidate[a.candidateId] = (byCandidate[a.candidateId] || 0) + 1;
  const multi = Object.values(byCandidate).filter(n => n >= 2).length;
  const total = Object.keys(byCandidate).length;
  return { multi, total, pct: total ? Math.round(multi / total * 100) : 0 };
}
export const marginPct = (budget, cost) => budget > 0 && cost != null ? Math.round((budget - cost) / budget * 100) : null;

export function usableProfiles(candidates) {
  const fresh = c => c.verified && Math.round((Date.now() - new Date(c.verified)) / 86400000) <= 120;
  return candidates.filter(c => ((c.email || c.phone) && fresh(c) && (c.skills || []).length)).length;
}
export function demandCoverage(candidates, demands, assessments = []) {
  return demands.filter(d => d.status === 'Open').map(d => {
    let ready = 0, near = 0;
    for (const c of candidates) {
      const m = matchCandidate(c, d, assessments);
      if (m.eligible) ready++;
      else if (m.score >= 70) near++;
    }
    return { demand:d, ready, near, missing: Math.max(0, d.positions - ready) };
  });
}
export function upliftConversion(candidates, assessments, enrichment) {
  const assessed = new Set(assessments.map(a => a.candidateId));
  const enriched = new Set(enrichment.map(e => e.candidateId));
  const ready = new Set(candidates.filter(c => c.status === 'Ready').map(c => c.id));
  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
  return {
    assessed: assessed.size,
    enriched: [...enriched].filter(id => assessed.has(id)).length,
    readyAfter: [...enriched].filter(id => assessed.has(id) && ready.has(id)).length,
    assessedToEnriched: pct([...enriched].filter(id => assessed.has(id)).length, assessed.size),
    enrichedToReady: pct([...enriched].filter(id => ready.has(id)).length, enriched.size)
  };
}
export function clientFunnel(considerations) {
  return ['Submitted','Interview','Offer','Deployed'].map(stage => ({ stage, count: considerations.filter(a => a.stage === stage).length }));
}
