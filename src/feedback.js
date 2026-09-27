// Interview feedback model — Zoho Recruit F9 equivalent, scoped to what a client-side app
// can honestly provide: configurable rating criteria, a quality bar ("threshold") and
// recommendation outcomes. Fair-evaluation masking needs server-side role rules and is
// intentionally NOT claimed here.
export const RECOMMENDATIONS = ['Strong hire', 'Hire', 'Hold', 'No hire'];
export const RECOMMENDATION_TONES = { 'Strong hire': 'green', 'Hire': 'green', 'Hold': 'amber', 'No hire': 'red' };
export const ROUNDS = ['Round 1', 'Round 2', 'Round 3', 'Final'];
export const MODES = ['Video', 'Phone', 'Onsite'];
export const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No-show'];

export const DEFAULT_CRITERIA = ['Technical depth', 'Communication', 'Problem solving', 'Culture add'];
export const DEFAULT_THRESHOLD = 3.5;

const workspaceCustom = settings => ((settings || []).find(s => s && s.id === 'workspace') || {}).custom || {};

export const criteriaFor = settings => {
  const c = workspaceCustom(settings).feedbackCriteria;
  return Array.isArray(c) && c.length ? c : DEFAULT_CRITERIA;
};

export const thresholdFor = settings => {
  const t = workspaceCustom(settings).feedbackThreshold;
  return typeof t === 'number' && t > 0 ? t : DEFAULT_THRESHOLD;
};

export const overallOf = feedback => {
  const vals = Object.values(feedback || {}).filter(v => typeof v === 'number');
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
};

export const meetsBar = (overall, threshold) => overall != null && overall >= threshold;

export const DEFAULT_TEMPLATES = [
  { name: 'Interview invite', subject: 'Interview invitation — {demand}', body: 'Hi {name},\n\nGreat speaking with you. We would like to invite you to a {mode} interview ({round}) for the {demand} role on {date} at {time} (IST).\n\nPlease reply to confirm, or suggest another slot if this does not work.\n\nWarm regards,\nAnthroPrime Talent Team' },
  { name: 'Follow-up', subject: 'Following up — {demand}', body: 'Hi {name},\n\nJust following up on our conversation about the {demand} role. Is there anything you need from us in the meantime?\n\nWarm regards,\nAnthroPrime Talent Team' },
  { name: 'Rejection', subject: 'Update on your application — {demand}', body: 'Hi {name},\n\nThank you for taking the time to interview for the {demand} role. After careful consideration we have decided not to move forward at this point. We would like to keep your profile on file for future roles that may fit better.\n\nWarm regards,\nAnthroPrime Talent Team' }
];

export const templatesFor = settings => {
  const t = workspaceCustom(settings).emailTemplates;
  return Array.isArray(t) && t.length ? t : DEFAULT_TEMPLATES;
};

export const fillTemplate = (text, ctx) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => (ctx || {})[k] ?? '');
