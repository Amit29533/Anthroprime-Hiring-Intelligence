// Batch 12 — document templates (Zoho-style mail merge, client-side).
// Admin-managed letter templates with {{Section.field}} merge tokens; unknown tokens are
// left visible so a typo shows up in the preview instead of silently vanishing. Also
// hosts the printable candidate dossier (an internal, recruiter-facing document).
import { money } from './domain.js';

export const MERGE_FIELD_CATALOG = [
  ['Candidate', 'name'],
  ['Candidate', 'email'],
  ['Candidate', 'phone'],
  ['Candidate', 'title'],
  ['Candidate', 'company'],
  ['Candidate', 'location'],
  ['Candidate', 'status'],
  ['Candidate', 'notice'],
  ['Candidate', 'expected'],
  ['Candidate', 'mode'],
  ['Candidate', 'engagement'],
  ['Candidate', 'earliestStart'],
  ['Candidate', 'activeStatus'],
  ['Candidate', 'summary'],
  ['Offer', 'role'],
  ['Offer', 'location'],
  ['Offer', 'ctc'],
  ['Offer', 'joining'],
  ['Offer', 'status'],
  ['Demand', 'title'],
  ['Demand', 'client'],
  ['Demand', 'location'],
  ['Demand', 'mode'],
  ['Demand', 'engagementType'],
  ['Workspace', 'name'],
  ['Today', 'date'],
];

const longDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export function mergeContext({
  candidate = null,
  offer = null,
  demand = null,
  workspaceName = 'AnthroPrime',
} = {}) {
  const c = { ...candidate };
  if (c.notice != null) c.notice = `${c.notice} days`;
  if (c.expected != null && c.expected !== '') c.expected = money(c.expected);
  if (c.earliestStart) c.earliestStart = longDate(c.earliestStart);
  const o = { ...offer };
  if (o && o.ctc != null && o.ctc !== '') o.ctc = money(o.ctc);
  if (o) o.joining = longDate(o.joining);
  return {
    Candidate: c,
    Offer: o || {},
    Demand: demand || {},
    Workspace: { name: workspaceName },
    Today: {
      date: new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    },
  };
}

function resolve(path, ctx) {
  let cur = ctx;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function renderTemplate(body, ctx) {
  return String(body || '').replace(/\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g, (token, path) => {
    const v = resolve(path, ctx);
    return v === undefined || v === null ? token : String(v);
  });
}

export const DEFAULT_DOCUMENT_TEMPLATES = [
  {
    id: '94000000-0000-4000-8000-000000000001',
    name: 'Offer letter',
    body: '{{Today.date}}\n\nDear {{Candidate.name}},\n\nWe are pleased to offer you the position of {{Offer.role}} ({{Demand.client}}) in {{Offer.location}}, at a package of {{Offer.ctc}}, joining on {{Offer.joining}}.\n\nThis offer is subject to our standard background verification and reference checks.\n\nWith best regards,\n{{Workspace.name}} — Talent Acquisition\nAuthorised signatory',
  },
  {
    id: '94000000-0000-4000-8000-000000000002',
    name: 'Application acknowledgement',
    body: '{{Today.date}}\n\nDear {{Candidate.name}},\n\nThank you for your interest in {{Demand.title}} with {{Demand.client}}. Your profile is with our talent team — we will be in touch about next steps.\n\n{{Workspace.name}} — Talent Acquisition',
  },
];

export function documentTemplatesFor(settings) {
  const row = (settings || []).find((r) => r && r.id === 'workspace');
  const list =
    row && row.custom && Array.isArray(row.custom.documentTemplates)
      ? row.custom.documentTemplates
      : [];
  return list.length ? list : DEFAULT_DOCUMENT_TEMPLATES;
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const rows = (pairs) =>
  pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');

// Printable candidate dossier — an internal document (includes current CTC and notes):
// open the downloaded file in a browser and print to PDF. The provenance stamp marks it
// as an audited export; handle per the workspace retention policy.
export function dossierHtml(candidate, data, workspaceName = 'AnthroPrime') {
  const c = candidate || {};
  const d = data || {};
  const find = (t, id) => (d[t] || []).find((x) => x.id === id) || null;
  const assessments = (d.assessments || []).filter((a) => a.candidateId === c.id);
  const interviews = (d.interviews || []).filter((i) => i.candidateId === c.id);
  const applications = (d.considerations || [])
    .filter((k) => k.candidateId === c.id)
    .map((k) => {
      const dm = find('demands', k.demandId);
      return `${dm ? dm.title : '—'} (${dm ? dm.client : ''}) — ${k.stage}`;
    });
  const notes = (d.notes || []).filter((n) => n.candidateId === c.id);
  const docs = (d.documents || []).filter((x) => x.candidateId === c.id);
  const consents = (d.consents || []).filter((x) => x.candidateId === c.id);
  const emp = (d.employmentHistory || []).filter((h) => h.candidateId === c.id);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Candidate dossier — ${esc(c.name)}</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:32px auto;color:#17242a;padding:0 16px}
h1{margin:0;font-size:26px}h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #d8e2df;padding-bottom:4px;margin:28px 0 10px;color:#40605c}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:5px 8px;font-size:13.5px;vertical-align:top}
th{width:170px;color:#40605c;font-weight:600;background:#f3f7f6}ul{margin:6px 0;padding-left:20px}li{font-size:13.5px;margin:3px 0}
.small{color:#5a726d;font-size:12px}.stamp{margin-top:34px;border:1px solid #d8e2df;padding:10px 14px;font-size:12px;color:#40605c;background:#f3f7f6}
.badge{display:inline-block;border:1px solid #40605c;border-radius:10px;padding:1px 10px;font-size:12px;margin-right:6px}</style></head><body>
<h1>${esc(c.name)}</h1><p class="small">${esc(c.title)}${c.company ? ` · ${esc(c.company)}` : ''} · ${esc(workspaceName)} internal dossier</p>
<p><span class="badge">${esc(c.status || '')}</span><span class="badge">${esc(c.mode || '')}</span>${c.activeStatus ? `<span class="badge">${esc(c.activeStatus)}</span>` : ''}</p>
<h2>Profile</h2><table>${rows([
    ['Email', c.email],
    ['Phone', c.phone],
    ['Location', c.location],
    ['Total experience', c.experience != null ? `${c.experience} years` : ''],
    ['Relevant experience', c.relevantExperience != null ? `${c.relevantExperience} years` : ''],
    ['Notice period', c.notice != null && c.notice !== '' ? `${c.notice} days` : ''],
    ['Current CTC', c.current != null && c.current !== '' ? money(c.current) : ''],
    ['Expected', c.expected != null && c.expected !== '' ? money(c.expected) : ''],
    ['Engagement', c.engagement],
    ['Earliest start', c.earliestStart],
    ['Timezone', c.timezone],
    ['Source', c.source],
    ['Owner', c.owner],
    ['Last verified', c.verified],
  ])}</table>
${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
<h2>Skills</h2>${(c.skills || []).length ? `<table>${rows((c.skillsDetail || []).length ? c.skillsDetail.map((s) => [s.skill, `${s.proficiency || 'Working'}${s.years != null ? ` · ${s.years} yrs` : ''}${s.evidence ? ` · ${s.evidence}` : ''}${s.validated ? ' · validated' : ''}`]) : (c.skills || []).map((s) => [s, '']))}</table>` : '<p class="small">None recorded.</p>'}
${emp.length ? `<h2>Employment history</h2><table>${rows(emp.map((h) => [`${h.company || ''}${h.title ? ` — ${h.title}` : ''}`, `${h.startDate || '?'} → ${h.endDate || 'present'}${h.verified ? ` (verified ${h.verified})` : ''}`]))}</table>` : ''}
<h2>Assessments</h2>${assessments.length ? `<table>${rows(assessments.map((a) => [`${a.title || 'Assessment'} — score ${a.score}`, `${a.date || ''}${a.assessor ? ` · ${a.assessor}` : ''}${a.evidence ? ` · ${a.evidence}` : ''}`]))}</table>` : '<p class="small">None recorded.</p>'}
<h2>Interviews</h2>${interviews.length ? `<table>${rows(interviews.map((i) => [`${i.round} · ${i.mode}`, `${i.scheduledAt ? String(i.scheduledAt).slice(0, 10) : ''} · ${i.status}${i.recommendation ? ` · ${i.recommendation}` : ''}`]))}</table>` : '<p class="small">None recorded.</p>'}
<h2>Applications</h2>${applications.length ? `<ul>${applications.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="small">None.</p>'}
${notes.length ? `<h2>Interaction notes</h2><table>${rows(notes.slice(0, 15).map((n) => [n.date ? String(n.date).slice(0, 10) : '', `${n.text}${n.author ? ` — ${n.author}` : ''}`]))}</table>` : ''}
${docs.length ? `<h2>Documents</h2><ul>${docs.map((x) => `<li>${esc(x.name)} — v${x.version}${x.hash ? ` · sha256 ${esc(String(x.hash).slice(0, 12))}…` : ''}</li>`).join('')}</ul>` : ''}
${consents.length ? `<h2>Consents</h2><table>${rows(consents.map((x) => [x.purpose, `${x.status}${x.date ? ` · ${String(x.date).slice(0, 10)}` : ''}${x.noticeVersion ? ` · ${x.noticeVersion}` : ''}`]))}</table>` : ''}
<div class="stamp">Generated from ECOD Talent Intelligence (${esc(workspaceName)}) on ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}. This export is recorded in the workspace audit trail and contains personal data — store it only where the retention policy allows.</div>
</body></html>`;
}
