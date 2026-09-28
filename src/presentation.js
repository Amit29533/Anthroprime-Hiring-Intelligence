// Branded, client-ready candidate presentation (Zoho Recruit E6).
//
// This is the artefact a staffing agency actually sends: the candidate's story on the agency's
// letterhead, with the facts a client needs and nothing else. It is deliberately NOT a copy of
// the internal dossier (`templates.js → dossierHtml`), which exists for audit and contains
// everything. The two must not converge — that is the whole point of this module.
//
// Three rules are enforced here rather than left to whoever clicks the button:
//
//   1. CONSENT GATES THE DOCUMENT. Without a current profile-sharing consent there is no
//      presentation to generate — not a watermarked one, not a partial one. The function refuses.
//   2. CONTACT DETAILS ARE WITHHELD BY DEFAULT. Sending a client a candidate's mobile number is
//      how an agency loses its fee. Revealing them is an explicit, recorded choice.
//   3. INTERNAL COMMERCIALS ARE NEVER PRESENTABLE. Current CTC and expectations are admin-only
//      and, even for an admin, off by default — a client should be quoted a rate, not shown the
//      candidate's salary.
import { consentForProfileSharing, submissionConsentState } from './submissions.js';

export const DEFAULT_BRANDING = {
  agencyName: 'AnthroPrime',
  tagline: 'ECOD Talent Intelligence',
  accent: '#1f6f5c',
  footer: 'Submitted in confidence. Please do not forward outside the hiring panel.',
  contactLine: '',
};

export const brandingFor = (data) => ({
  ...DEFAULT_BRANDING,
  ...((data?.settings || []).find((r) => r && r.id === 'workspace')?.custom?.branding || {}),
});

/** Presentation choices. The defaults are the safe ones; every disclosure is opt-in. */
export const DEFAULT_OPTIONS = {
  anonymise: false,
  showContact: false,
  showCurrentEmployer: false,
  showCompensation: false,
  showAssessments: true,
  showInterviews: false,
  showEmployment: true,
  showEvidence: true,
};

const clean = (v) => String(v ?? '').trim();

/** Initials for an anonymised presentation: "Aarav Sharma" → "A. S." */
export function initialsOf(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Candidate';
  return parts.map((p) => `${p[0].toUpperCase()}.`).join(' ');
}

/** Years, formatted without pretending to a precision the record does not have. */
const years = (value) => (value == null || value === '' ? null : `${value} years`);

const noticeLabel = (notice) =>
  notice == null || notice === ''
    ? 'Not verified'
    : Number(notice) === 0
      ? 'Immediate'
      : `${notice} days`;

/**
 * Build the presentation model. Returns `{ blocked, reason }` when it must not be produced, so
 * the caller cannot accidentally render a document that should not exist.
 */
export function buildPresentation(candidate, demand, data, options = {}, context = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { isAdmin = false, now = new Date() } = context;
  if (!candidate) return { blocked: true, reason: 'No candidate selected.' };

  const consent = submissionConsentState(data?.consents || [], candidate.id);
  const record = consentForProfileSharing(data?.consents || [], candidate.id);
  // `consentForProfileSharing` returns the latest consent *record*, which is truthy even when it
  // is a revocation. The gate must be the evaluated state, not the presence of a row.
  if (!consent.ok)
    return {
      blocked: true,
      reason: `Profile sharing consent is ${consent.label.toLowerCase()}. A client-ready profile cannot be generated until the candidate has consented.`,
      consent,
    };

  const brand = brandingFor(data);
  // Compensation needs both the role and the explicit choice. A recruiter cannot reveal it at all.
  const compensationShown = opts.showCompensation && isAdmin;
  const withheld = [];
  if (!opts.showContact) withheld.push('contact details');
  if (!opts.showCurrentEmployer) withheld.push('current employer');
  if (opts.showCompensation && !isAdmin) withheld.push('compensation (admin only)');
  else if (!compensationShown) withheld.push('compensation');

  const skillsDetail = (candidate.skillsDetail || []).length
    ? candidate.skillsDetail
    : (candidate.skills || []).map((s) => ({ skill: s }));

  const skills = skillsDetail.map((s) => ({
    name: s.skill,
    proficiency: s.proficiency || 'Working',
    years: s.years ?? null,
    evidence: opts.showEvidence && s.evidence && s.evidence !== 'Unverified' ? s.evidence : '',
    validated: !!s.validated,
  }));

  const employment = opts.showEmployment
    ? (data?.employmentHistory || [])
        .filter((h) => h.candidateId === candidate.id)
        .map((h) => ({
          // The current employer is the one with no end date; anonymising a candidate means
          // hiding it, otherwise the client can identify them from the role and the company.
          company:
            !opts.showCurrentEmployer && !h.endDate ? 'Confidential (current employer)' : h.company,
          title: h.title,
          start: h.startDate || '',
          end: h.endDate || 'Present',
          verified: h.verified || '',
        }))
        .sort((a, b) => String(b.start).localeCompare(String(a.start)))
    : [];

  const assessments = opts.showAssessments
    ? (data?.assessments || [])
        .filter((a) => a.candidateId === candidate.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 3)
        .map((a) => ({
          title: a.title || 'Assessment',
          score: a.score,
          date: a.date || '',
          assessor: a.assessor || '',
          evidence: clean(a.evidence).slice(0, 220),
        }))
    : [];

  const interviews = opts.showInterviews
    ? (data?.interviews || [])
        .filter(
          (iv) =>
            iv.candidateId === candidate.id &&
            iv.status === 'Completed' &&
            (!demand || iv.demandId === demand.id),
        )
        .map((iv) => ({
          round: iv.round || 'Interview',
          mode: iv.mode || '',
          recommendation: iv.recommendation || 'Pending',
          date: iv.scheduledAt ? String(iv.scheduledAt).slice(0, 10) : '',
        }))
    : [];

  const facts = [
    ['Location', candidate.location],
    [
      'Relevant experience',
      years(candidate.relevantExperience ?? candidate.experience) || 'Not recorded',
    ],
    ['Notice period', noticeLabel(candidate.notice)],
    ['Work mode', candidate.mode || 'Flexible'],
    ['Engagement', candidate.engagement || 'Open'],
    ['Profile verified', candidate.verified || 'Not verified'],
  ];
  if (compensationShown)
    facts.push(['Expected', candidate.expected ? `₹${candidate.expected} LPA` : 'On request']);
  if (opts.showContact) {
    if (candidate.email) facts.push(['Email', candidate.email]);
    if (candidate.phone) facts.push(['Phone', candidate.phone]);
  }
  if (opts.showCurrentEmployer && candidate.company)
    facts.push(['Current employer', candidate.company]);

  // Facts a client might reasonably assume are checked, but which carry no verification date.
  const unverified = [];
  if (!candidate.verified) unverified.push('profile has never been verified');
  if (candidate.notice == null || candidate.notice === '')
    unverified.push('notice period unconfirmed');
  if (!skills.some((s) => s.validated))
    unverified.push('no skill has been independently validated');

  return {
    blocked: false,
    brand,
    consent: { ...consent, date: record?.date || '' },
    options: opts,
    reference: `${
      brand.agencyName
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 4)
        .toUpperCase() || 'CAND'
    }-${String(candidate.id).slice(0, 8).toUpperCase()}`,
    generatedAt: now instanceof Date ? now.toISOString() : String(now),
    displayName: opts.anonymise ? initialsOf(candidate.name) : candidate.name,
    anonymised: opts.anonymise,
    headline: candidate.title || 'Candidate profile',
    role: demand ? { title: demand.title, client: demand.client, location: demand.location } : null,
    summary: clean(candidate.summary),
    facts,
    skills,
    employment,
    assessments,
    interviews,
    withheld,
    unverified,
  };
}

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Printable HTML. The browser's "Print → Save as PDF" is the PDF path; nothing is uploaded. */
export function presentationHtml(doc) {
  if (!doc || doc.blocked) return '';
  const row = (label, value) =>
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';
  const section = (title, body) => (body ? `<h2>${esc(title)}</h2>${body}` : '');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(doc.displayName)} — ${esc(doc.brand.agencyName)}</title>
<style>
:root{--accent:${esc(doc.brand.accent)}}
body{font-family:Georgia,'Times New Roman',serif;max-width:780px;margin:34px auto;padding:0 18px;color:#17242a;line-height:1.6}
header{border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:flex-end;gap:18px}
.brand{font-size:20px;font-weight:700;color:var(--accent);letter-spacing:-.3px}
.brand small{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7b8f8a;font-weight:400;margin-top:3px}
.ref{font-size:11px;color:#7b8f8a;text-align:right}
h1{font-size:27px;margin:0 0 4px}
.headline{color:#4a635e;font-size:15px;margin:0 0 6px}
.role{background:#f3f7f6;border-left:3px solid var(--accent);padding:9px 14px;font-size:13px;margin:16px 0}
h2{font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:var(--accent);border-bottom:1px solid #dfe8e5;padding-bottom:5px;margin:26px 0 10px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:5px 9px;font-size:13.5px;vertical-align:top}
th{width:180px;color:#4a635e;font-weight:600;background:#f7faf9}
ul{margin:6px 0;padding-left:20px}li{font-size:13.5px;margin:4px 0}
.chip{display:inline-block;border:1px solid #cfdedb;border-radius:11px;padding:1px 9px;font-size:11px;color:#4a635e;margin-left:5px}
.note{background:#fdf7ec;border:1px solid #efe0c6;color:#8a6d38;padding:10px 14px;font-size:12px;border-radius:5px;margin:18px 0}
footer{margin-top:34px;border-top:1px solid #dfe8e5;padding-top:12px;font-size:11.5px;color:#7b8f8a}
@media print{body{margin:0;max-width:none}.note{border-color:#ddd}}
</style></head><body>
<header>
  <div class="brand">${esc(doc.brand.agencyName)}<small>${esc(doc.brand.tagline)}</small></div>
  <div class="ref">Ref ${esc(doc.reference)}<br>${esc(doc.generatedAt.slice(0, 10))}</div>
</header>
<h1>${esc(doc.displayName)}</h1>
<p class="headline">${esc(doc.headline)}</p>
${doc.role ? `<div class="role"><strong>Submitted for:</strong> ${esc(doc.role.title)} — ${esc(doc.role.client)}${doc.role.location ? ` · ${esc(doc.role.location)}` : ''}</div>` : ''}
${doc.summary ? `<p>${esc(doc.summary)}</p>` : ''}
${section('Profile', `<table>${doc.facts.map(([l, v]) => row(l, v)).join('')}</table>`)}
${section(
  'Skills',
  doc.skills.length
    ? `<table>${doc.skills
        .map(
          (s) =>
            `<tr><th>${esc(s.name)}</th><td>${esc(s.proficiency)}${s.years != null ? ` · ${esc(s.years)} yrs` : ''}${s.evidence ? `<span class="chip">${esc(s.evidence)}</span>` : ''}${s.validated ? '<span class="chip">validated</span>' : ''}</td></tr>`,
        )
        .join('')}</table>`
    : '',
)}
${section(
  'Experience',
  doc.employment.length
    ? `<table>${doc.employment
        .map(
          (h) =>
            `<tr><th>${esc(h.company)}</th><td>${esc(h.title || '')}<br><span style="font-size:12px;color:#7b8f8a">${esc(h.start)} → ${esc(h.end)}${h.verified ? ` · verified ${esc(h.verified)}` : ''}</span></td></tr>`,
        )
        .join('')}</table>`
    : '',
)}
${section(
  'Assessments',
  doc.assessments.length
    ? `<ul>${doc.assessments
        .map(
          (a) =>
            `<li><strong>${esc(a.title)}</strong> — ${esc(a.score)}/100${a.date ? ` · ${esc(a.date)}` : ''}${a.assessor ? ` · ${esc(a.assessor)}` : ''}${a.evidence ? `<br><span style="font-size:12px;color:#5f746f">${esc(a.evidence)}</span>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '',
)}
${section(
  'Interview outcomes',
  doc.interviews.length
    ? `<ul>${doc.interviews.map((i) => `<li>${esc(i.round)}${i.mode ? ` (${esc(i.mode)})` : ''} — ${esc(i.recommendation)}${i.date ? ` · ${esc(i.date)}` : ''}</li>`).join('')}</ul>`
    : '',
)}
${doc.unverified.length ? `<div class="note"><strong>What is not verified:</strong> ${esc(doc.unverified.join('; '))}. Stated as-is rather than implied to be checked.</div>` : ''}
<footer>
  ${esc(doc.brand.footer)}${doc.brand.contactLine ? `<br>${esc(doc.brand.contactLine)}` : ''}
  <br>${doc.withheld.length ? `Withheld from this document: ${esc(doc.withheld.join(', '))}. ` : ''}Consent for profile sharing recorded${doc.consent?.date ? ` on ${esc(String(doc.consent.date).slice(0, 10))}` : ''}.
</footer>
</body></html>`;
}

/** Plain-text equivalent, for pasting into an email body. */
export function presentationText(doc) {
  if (!doc || doc.blocked) return '';
  const out = [
    `${doc.brand.agencyName.toUpperCase()} — CANDIDATE PROFILE`,
    `Ref ${doc.reference} · ${doc.generatedAt.slice(0, 10)}`,
    '',
    doc.displayName,
    doc.headline,
  ];
  if (doc.role) out.push('', `Submitted for: ${doc.role.title} — ${doc.role.client}`);
  if (doc.summary) out.push('', doc.summary);
  out.push('', 'PROFILE');
  for (const [label, value] of doc.facts) if (value) out.push(` ${label}: ${value}`);
  if (doc.skills.length) {
    out.push('', 'SKILLS');
    for (const s of doc.skills)
      out.push(
        ` • ${s.name} — ${s.proficiency}${s.years != null ? ` (${s.years} yrs)` : ''}${s.evidence ? `, ${s.evidence}` : ''}`,
      );
  }
  if (doc.employment.length) {
    out.push('', 'EXPERIENCE');
    for (const h of doc.employment)
      out.push(` • ${h.company}${h.title ? ` — ${h.title}` : ''} (${h.start} → ${h.end})`);
  }
  if (doc.assessments.length) {
    out.push('', 'ASSESSMENTS');
    for (const a of doc.assessments)
      out.push(` • ${a.title}: ${a.score}/100${a.date ? ` · ${a.date}` : ''}`);
  }
  if (doc.interviews.length) {
    out.push('', 'INTERVIEW OUTCOMES');
    for (const i of doc.interviews) out.push(` • ${i.round}: ${i.recommendation}`);
  }
  if (doc.unverified.length) out.push('', `NOT VERIFIED: ${doc.unverified.join('; ')}.`);
  out.push('', doc.brand.footer);
  if (doc.withheld.length) out.push(`Withheld: ${doc.withheld.join(', ')}.`);
  return out.join('\n');
}

export const presentationFilename = (doc, ext = 'html') =>
  `${(doc?.displayName || 'candidate').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${(doc?.reference || '').toLowerCase()}.${ext}`;

/** Branding form validation. */
export function validateBranding(form) {
  const errors = {};
  if (!clean(form.agencyName)) errors.agencyName = 'The document needs an agency name.';
  if (form.accent && !/^#[0-9a-f]{3,8}$/i.test(clean(form.accent)))
    errors.accent = 'Use a hex colour such as #1f6f5c.';
  return errors;
}
