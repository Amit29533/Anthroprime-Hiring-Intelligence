// Blueprint §3 stage 4 — the gap map. Compares candidate evidence against demand requirements
// and classifies every gap: critical (skill absent), trainable (present but below the required
// proficiency), contextual (present but stale or unvalidated evidence). Status derives from
// linked enrichment plans and recent assessments — gaps are computed, never fabricated.
import { age, skillList } from './domain.js';

const STALE_MONTHS = 12;
export function deriveGaps(candidate, demand, match, { assessments = [], enrichment = [] } = {}) {
  const required = skillList(demand.skills || []);
  const minFor = (s) =>
    (demand.skillMinimums && demand.skillMinimums[s]) || demand.minProficiency || 'Working';
  const details = candidate.skillsDetail || [];
  const gaps = [];
  for (const skill of required) {
    const present = (candidate.skills || []).includes(skill);
    const passing = match.matched.includes(skill);
    if (passing) {
      const detail = details.find((x) => (x.skill || '') === skill);
      const stale = detail?.lastUsed && age(`${detail.lastUsed}-01`) > (365 * STALE_MONTHS) / 12;
      if (stale || (detail && !detail.validated))
        gaps.push(
          gapRow(
            candidate,
            demand,
            skill,
            'contextual',
            'contextual evidence',
            detail,
            assessments,
            enrichment,
          ),
        );
      continue;
    }
    const detail = details.find((x) => (x.skill || '') === skill);
    const severity = present ? 'trainable' : 'critical';
    gaps.push(
      gapRow(
        candidate,
        demand,
        skill,
        severity,
        present ? `below ${minFor(skill)} proficiency` : 'skill not on profile',
        detail,
        assessments,
        enrichment,
      ),
    );
  }
  return gaps;
}
function gapRow(candidate, demand, skill, severity, cause, detail, assessments, enrichment) {
  const closed = assessments.some(
    (a) =>
      a.candidateId === candidate.id &&
      a.skill === skill &&
      (!a.demandId || a.demandId === demand.id) &&
      age(a.date) <= 180,
  );
  const planned = enrichment.some(
    (e) =>
      e.candidateId === candidate.id &&
      e.gapSkill === skill &&
      (e.demandId || null) === (demand.id || null) &&
      !['Complete', 'Validated'].includes(e.status),
  );
  const status = closed ? 'Closed' : planned ? 'Enrichment planned' : 'Open';
  return {
    candidateId: candidate.id,
    demandId: demand.id,
    skill,
    severity,
    cause,
    status,
    lastUsed: detail?.lastUsed || null,
    proficiency: detail?.proficiency || null,
  };
}
export const GAP_SEVERITIES = ['critical', 'trainable', 'contextual'];
