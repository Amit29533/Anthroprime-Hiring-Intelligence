// Stage 7 Deliver — client submission packs (§3, §16 exit condition "run a real client
// demand end-to-end"). The pack is an honest, compiled summary of what the workspace
// already knows; it deliberately EXCLUDES internal-only data (current CTC, commercials,
// internal notes) and is gated on the profile-sharing consent ledger (§12).
import { freshness } from './domain.js';
import { anthroIdFor } from './anthroId.js';
import { overallOf } from './feedback.js';

export const SUBMISSION_METHODS = ['Email', 'Portal', 'Manual'];

export const PROFILE_SHARING = 'profile-sharing';

export function consentForProfileSharing(consents = [], candidateId) {
  return (
    (consents || [])
      .filter((c) => c.candidateId === candidateId && c.purpose === PROFILE_SHARING)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null
  );
}

export function submissionConsentState(consents = [], candidateId) {
  const latest = consentForProfileSharing(consents, candidateId);
  if (!latest)
    return { ok: false, state: 'missing', label: 'No profile-sharing consent on record' };
  if (latest.status === 'granted')
    return {
      ok: true,
      state: 'granted',
      label: `Profile sharing granted (${latest.noticeVersion || 'v1'})`,
    };
  if (latest.status === 'revoked')
    return { ok: false, state: 'revoked', label: 'Profile sharing revoked — do not submit' };
  return { ok: false, state: latest.status, label: `Consent ${latest.status}` };
}

// Internal-only fields that must never appear in a client-facing pack.
const INTERNAL_FACTS = ['current', 'email', 'phone', 'linkedin', 'externalId'];

export function buildSubmissionPack(candidate, demand, data) {
  const c = candidate,
    d = demand;
  const assessments = (data.assessments || [])
    .filter((a) => a.candidateId === c.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const interviews = (data.interviews || []).filter(
    (iv) => iv.candidateId === c.id && iv.status === 'Completed' && (!d || iv.demandId === d.id),
  );
  const consent = submissionConsentState(data.consents || [], c.id);
  const skills = (c.skillsDetail || []).length
    ? c.skillsDetail.map(
        (s) =>
          `${s.skill} — ${s.proficiency || 'Working'}${s.years ? ` (${s.years} yrs)` : ''}${s.evidence ? `, evidence: ${s.evidence}` : ''}`,
      )
    : (c.skills || []).map((s) => `${s} — proficiency per profile`);
  const lines = [];
  lines.push(`CANDIDATE SUBMISSION — ${d ? d.title : c.title}`);
  lines.push(`Anthro-ID: ${anthroIdFor(c)}`);
  if (d)
    lines.push(
      `${d.client}${d.businessUnit ? ` · ${d.businessUnit}` : ''} · ${d.location} · ${d.mode}`,
    );
  lines.push('');
  lines.push(
    `Profile: ${c.name}, ${c.title}${c.company ? ` at ${c.company}` : ''} (${c.location})`,
  );
  lines.push(
    `Experience: ${c.relevantExperience ?? c.experience ?? 'n/a'} years relevant · Notice: ${c.notice == null ? 'unverified' : c.notice === 0 ? 'immediate' : `${c.notice} days`} · Expected: ${c.expected ? `₹${c.expected} LPA` : 'on request'} · Profile freshness: ${freshness(c.verified)}`,
  );
  if (c.summary) {
    lines.push('');
    lines.push(`Summary: ${c.summary}`);
  }
  lines.push('');
  lines.push('Skills & evidence:');
  for (const s of skills) lines.push(` • ${s}`);
  if (assessments.length) {
    lines.push('');
    lines.push('Assessments (ECOD readiness):');
    for (const a of assessments.slice(0, 2))
      lines.push(
        ` • ${a.title}: ${a.score}/100 — ${a.date}${a.evidence ? ` — ${String(a.evidence).slice(0, 140)}` : ''}`,
      );
  }
  if (interviews.length) {
    lines.push('');
    lines.push('Interview outcomes:');
    for (const iv of interviews) {
      const overall = overallOf(iv.feedback);
      lines.push(
        ` • ${iv.round} (${iv.mode}): ${iv.recommendation || 'pending'}${overall != null ? ` — overall ${overall}/5` : ''}${iv.notes ? ` — ${String(iv.notes).slice(0, 120)}` : ''}`,
      );
    }
  }
  lines.push('');
  lines.push(
    consent.ok
      ? 'Consent: the candidate has approved profile sharing for client submission.'
      : `Consent: ${consent.label}.`,
  );
  return {
    consent,
    assessments: assessments.length,
    interviews: interviews.length,
    packText: lines.join('\n'),
    facts: Object.fromEntries(
      Object.entries(c).filter(
        ([k]) => !INTERNAL_FACTS.includes(k) && k !== 'skillsDetail' && k !== 'custom',
      ),
    ),
  };
}

export function submissionMailHref(pack, candidate, demand, to) {
  const subject = `Candidate submission — ${candidate?.name || 'Profile'} for ${demand ? demand.title : 'your role'}`;
  return `mailto:${to || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(pack.packText)}`;
}
