// Skills intelligence (blueprint §6, §7, §14 entities Skill / PersonSkill / SkillEvidence).
//
// The rules here mirror migration 025 exactly, and there is a test that fails if they drift.
// Two principles run through it:
//
//   * Evidence is append-only. Nothing in this module ever edits or removes an observation;
//     correcting the record means adding to it. The database revokes UPDATE and DELETE on
//     `skillEvidence` so this is a property of the system, not a convention.
//   * A derived value is always derived. Current proficiency, confidence and validation are
//     conclusions drawn from the evidence — never something a caller asserts.
import { PROFICIENCY_LEVELS } from './taxonomy.js';

/** What each kind of evidence is worth. Must match `public.skill_evidence_weight`. */
export const EVIDENCE_WEIGHT = {
  Assessment: 100,
  Certification: 90,
  'Client interview': 80,
  'Recruiter-verified': 70,
  Project: 60,
  CV: 30,
  'Self-declared': 10,
};
export const EVIDENCE_TYPES = Object.keys(EVIDENCE_WEIGHT);

/** Evidence at or above this weight means a human stood behind the claim. */
export const VALIDATED_WEIGHT = 70;

/** Beyond this, an observation is old enough that it should be re-checked before being relied on. */
export const STALE_AFTER_DAYS = 365;

export const weightOf = (type) => EVIDENCE_WEIGHT[type] ?? 0;
export const proficiencyRank = (level) => PROFICIENCY_LEVELS.indexOf(level);

const dayjs = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const skillById = (data, id) => (data?.skills || []).find((s) => s.id === id) || null;
export const skillName = (data, id) => skillById(data, id)?.name || 'Unknown skill';

/** Canonical skill lookup by name or alias, the way §6 describes normalisation. */
export function findSkillByName(data, name) {
  const wanted = String(name || '')
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  const list = data?.skills || [];
  return (
    list.find(
      (s) =>
        String(s.name || '')
          .trim()
          .toLowerCase() === wanted,
    ) ||
    list.find((s) =>
      (s.aliases || []).some(
        (a) =>
          String(a || '')
            .trim()
            .toLowerCase() === wanted,
      ),
    ) ||
    null
  );
}

export const evidenceFor = (data, personSkillId) =>
  (data?.skillEvidence || [])
    .filter((e) => e.personSkillId === personSkillId)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

/**
 * The evidence that currently decides the derived view: strongest first, recency as the
 * tie-break. Blueprint §5 — "a recent validated assessment should outrank self-declared skill".
 */
export function decidingEvidence(rows) {
  if (!rows?.length) return null;
  return [...rows].sort(
    (a, b) =>
      weightOf(b.evidenceType) - weightOf(a.evidenceType) ||
      String(b.date || '').localeCompare(String(a.date || '')),
  )[0];
}

/**
 * Recompute a person-skill from its evidence. Mirrors `public.refresh_person_skill`; the
 * database is authoritative, this exists so the UI can show the consequence before saving.
 */
export function derivePersonSkill(personSkill, rows) {
  if (!rows?.length)
    return {
      ...personSkill,
      confidence: 0,
      validated: false,
      evidenceCount: 0,
      lastEvidence: null,
    };
  const best = decidingEvidence(rows);
  const years = rows.map((r) => Number(r.years)).filter((n) => Number.isFinite(n));
  const lastUsed = rows
    .map((r) => r.lastUsed)
    .filter(Boolean)
    .sort();
  const dates = rows
    .map((r) => r.date)
    .filter(Boolean)
    .sort();
  return {
    ...personSkill,
    proficiency: best.proficiency,
    years: years.length ? Math.max(...years) : (personSkill?.years ?? null),
    lastUsed: lastUsed.length ? lastUsed[lastUsed.length - 1] : (personSkill?.lastUsed ?? null),
    confidence: Math.min(100, weightOf(best.evidenceType) + Math.min(10, (rows.length - 1) * 5)),
    validated: rows.some((r) => weightOf(r.evidenceType) >= VALIDATED_WEIGHT),
    evidenceCount: rows.length,
    lastEvidence: dates.length ? String(dates[dates.length - 1]).slice(0, 10) : null,
  };
}

/** Days since the most recent observation, or null when there has never been one. */
export function evidenceAgeDays(personSkill, now = Date.now()) {
  const last = dayjs(personSkill?.lastEvidence);
  if (!last) return null;
  return Math.max(0, Math.round((now - last.getTime()) / 86400000));
}

/**
 * Is this claim stale? Returns null — not false — when there is no evidence at all, because
 * "never evidenced" and "evidenced recently" are different states and must not be conflated.
 */
export function isStale(personSkill, now = Date.now()) {
  const age = evidenceAgeDays(personSkill, now);
  if (age === null) return null;
  return age > STALE_AFTER_DAYS;
}

/** The skills held by one candidate, strongest and best-evidenced first. */
export function skillsForCandidate(data, candidateId) {
  return (data?.personSkills || [])
    .filter((p) => p.candidateId === candidateId)
    .map((p) => ({
      ...p,
      skill: skillById(data, p.skillId),
      name: skillName(data, p.skillId),
      evidence: evidenceFor(data, p.id),
      stale: isStale(p),
      ageDays: evidenceAgeDays(p),
    }))
    .sort(
      (a, b) =>
        proficiencyRank(b.proficiency) - proficiencyRank(a.proficiency) ||
        b.confidence - a.confidence ||
        a.name.localeCompare(b.name),
    );
}

/** Everyone who holds a skill, best first — the "who can do X" question. */
export function candidatesWithSkill(
  data,
  skillId,
  { minProficiency = '', validatedOnly = false } = {},
) {
  const floor = minProficiency ? proficiencyRank(minProficiency) : -1;
  return (data?.personSkills || [])
    .filter(
      (p) =>
        p.skillId === skillId &&
        proficiencyRank(p.proficiency) >= floor &&
        (!validatedOnly || p.validated),
    )
    .map((p) => ({
      ...p,
      candidate: (data?.candidates || []).find((c) => c.id === p.candidateId) || null,
      stale: isStale(p),
    }))
    .sort(
      (a, b) =>
        proficiencyRank(b.proficiency) - proficiencyRank(a.proficiency) ||
        b.confidence - a.confidence,
    );
}

/**
 * Workspace skill inventory (blueprint §17 "Skill inventory & gap heatmap"): how many people
 * hold each skill, how many are actually evidenced, and how much of it has gone stale.
 */
export function skillInventory(data) {
  return (data?.skills || [])
    .map((skill) => {
      const held = (data?.personSkills || []).filter((p) => p.skillId === skill.id);
      const validated = held.filter((p) => p.validated);
      const stale = held.filter((p) => isStale(p) === true);
      const unevidenced = held.filter((p) => (p.evidenceCount || 0) === 0);
      return {
        skill,
        people: held.length,
        validated: validated.length,
        stale: stale.length,
        unevidenced: unevidenced.length,
        // A share of nothing is not 0% — it is unknown, and the UI must say so.
        validatedShare: held.length ? Math.round((validated.length / held.length) * 100) : null,
        averageConfidence: held.length
          ? Math.round(held.reduce((n, p) => n + (p.confidence || 0), 0) / held.length)
          : null,
      };
    })
    .sort((a, b) => b.people - a.people || a.skill.name.localeCompare(b.skill.name));
}

/** Claims that need a human to look at them — the §10 data-quality queue for skills. */
export function unverifiedClaims(data, { limit = 50 } = {}) {
  return (data?.personSkills || [])
    .filter((p) => !p.validated || isStale(p) === true)
    .map((p) => ({
      ...p,
      name: skillName(data, p.skillId),
      candidate: (data?.candidates || []).find((c) => c.id === p.candidateId) || null,
      reason: !p.evidenceCount
        ? 'No evidence recorded'
        : !p.validated
          ? 'Only self-declared or CV evidence'
          : 'Evidence has gone stale',
    }))
    .sort((a, b) => (a.confidence || 0) - (b.confidence || 0))
    .slice(0, limit);
}

export const blankEvidence = (personSkillId, proficiency = 'Working') => ({
  personSkillId,
  evidenceType: 'Recruiter-verified',
  proficiency,
  years: '',
  lastUsed: '',
  evidenceRef: '',
  assessor: '',
  note: '',
});

export function validateEvidence(form) {
  const errors = {};
  if (!form?.personSkillId) errors.personSkillId = 'Choose the skill this evidence is about.';
  if (!EVIDENCE_TYPES.includes(form?.evidenceType))
    errors.evidenceType = 'Choose an evidence type.';
  if (!PROFICIENCY_LEVELS.includes(form?.proficiency))
    errors.proficiency = 'Choose the proficiency this evidence demonstrates.';
  if (form?.years !== '' && form?.years != null) {
    const n = Number(form.years);
    if (!Number.isFinite(n) || n < 0 || n > 60)
      errors.years = 'Enter a number of years between 0 and 60.';
  }
  // An assessment or client interview without an assessor is an unattributable claim.
  if (
    ['Assessment', 'Client interview'].includes(form?.evidenceType) &&
    !String(form?.assessor || '').trim()
  )
    errors.assessor = 'Record who carried this out — unattributed evidence cannot be relied on.';
  return errors;
}

/** Build the row to insert, with the numeric coercion the column expects. */
export function evidenceRow(form, { id, now = new Date() } = {}) {
  return {
    id,
    personSkillId: form.personSkillId,
    evidenceType: form.evidenceType,
    proficiency: form.proficiency,
    years: form.years === '' || form.years == null ? null : Number(form.years),
    lastUsed: form.lastUsed || null,
    evidenceRef: String(form.evidenceRef || '').trim(),
    assessor: String(form.assessor || '').trim(),
    note: String(form.note || '').trim(),
    date: now.toISOString(),
  };
}
