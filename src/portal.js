// Batch 11 — candidate portal core (pure, unit-tested). The projection is deliberately
// curated: applications, interviews, offers and consents only — never internal notes,
// owner/source metadata or the internal current-CTC figure.
export function portalOverview(c, data) {
  return {
    profile: {
      id: c.id, name: c.name, title: c.title, location: c.location, mode: c.mode,
      engagement: c.engagement, notice: c.notice, earliestStart: c.earliestStart,
      activeStatus: c.activeStatus, expected: c.expected, preferredLocations: c.preferredLocations,
      timezone: c.timezone, skills: c.skills || [], skillsDetail: c.skillsDetail || [], summary: c.summary || ''
    },
    applications: (data.considerations || []).filter(k => k.candidateId === c.id).map(k => {
      const d = (data.demands || []).find(x => x.id === k.demandId);
      return { demand: d?.title || '', client: d?.client || '', stage: k.stage, updated: k.updated };
    }),
    submissions: (data.submissions || []).filter(s => s.candidateId === c.id).map(s => {
      const d = (data.demands || []).find(x => x.id === s.demandId);
      return { demand: d?.title || '', client: d?.client || '', status: s.clientStatus, submittedOn: s.submittedOn };
    }),
    interviews: (data.interviews || []).filter(i => i.candidateId === c.id)
      .map(i => ({ round: i.round, mode: i.mode, scheduledAt: i.scheduledAt, status: i.status })),
    offers: (data.offers || []).filter(o => o.candidateId === c.id)
      .map(o => ({ role: o.role, status: o.status, ctc: o.ctc, joining: o.joining })),
    consents: (data.consents || []).filter(x => x.candidateId === c.id)
      .map(x => ({ id: x.id, purpose: x.purpose, status: x.status, date: x.date }))
  };
}
// The only fields the portal may write. Everything else is recruiter-owned.
export const PORTAL_EDITABLE = ['notice', 'earliestStart', 'activeStatus', 'mode', 'engagement', 'preferredLocations', 'expected'];
export function applyPortalUpdate(candidate, payload) {
  const next = { ...candidate };
  for (const k of PORTAL_EDITABLE) if (payload[k] !== undefined) next[k] = payload[k];
  return next;
}
// H5 cooling-off: warn recruiters before re-submitting a candidate the same client
// rejected inside the configured window. Soft guard — confirms, never silently blocks.
export function coolingOffCheck(candidateId, submissions, demands, clientName, days = 30, refDate) {
  const ref = refDate || new Date().toISOString().slice(0, 10);
  const hit = (submissions || [])
    .map(s => ({ ...s, client: ((demands || []).find(d => d.id === s.demandId) || {}).client || '' }))
    .filter(s => s.candidateId === candidateId && clientName &&
      String(s.client).toLowerCase() === String(clientName).toLowerCase() && s.clientStatus === 'Rejected')
    .map(s => {
      const when = s.decidedOn || String(s.submittedOn || '').slice(0, 10);
      const ago = Math.floor((new Date(ref) - new Date(when)) / 86400000);
      return { when, daysAgo: ago };
    })
    .filter(x => x.when && x.daysAgo >= 0 && x.daysAgo <= days)
    .sort((a, b) => b.daysAgo - a.daysAgo)[0];
  return hit ? { blocked: true, when: hit.when, daysAgo: hit.daysAgo } : { blocked: false };
}
