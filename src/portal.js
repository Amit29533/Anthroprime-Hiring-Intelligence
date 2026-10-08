import { uid, MAX_NOTICE_DAYS } from './domain.js';
import { anthroIdFor } from './anthroId.js';

// Batch 11 — candidate portal core (pure, unit-tested). The projection is deliberately
// curated: applications, interviews, offers and consents only — never internal notes,
// owner/source metadata or the internal current-CTC figure.
/** Slots a candidate may still choose from: theirs, open, and in the future. */
export const bookableSlots = (candidateId, data, now = Date.now()) =>
  (data?.interviewSlots || [])
    .filter(
      (s) =>
        s.candidateId === candidateId &&
        s.status === 'Open' &&
        new Date(s.startsAt).getTime() > now,
    )
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));

/**
 * The rows a booking writes, mirroring `api_portal_book_slot` so demo mode behaves like cloud.
 * Returns `{ error }` when the slot is no longer available — the same single message the RPC
 * uses, so a candidate cannot tell "taken" from "not yours".
 */
export function bookSlotRows(candidateId, slotId, data, now = Date.now()) {
  const slot = bookableSlots(candidateId, data, now).find((s) => s.id === slotId);
  if (!slot) return { error: 'that time is no longer available' };
  const interviewId = uid();
  return {
    interview: {
      id: interviewId,
      candidateId,
      demandId: slot.demandId || null,
      round: slot.round,
      mode: slot.mode,
      scheduledAt: slot.startsAt,
      durationMins: slot.durationMins,
      status: 'Scheduled',
      interviewers: slot.interviewer ? [slot.interviewer] : [],
      notes: 'Booked by the candidate from the portal',
      created: new Date(now).toISOString(),
    },
    // Choosing one time withdraws the other offers for that round, exactly as the RPC does.
    slots: [
      { ...slot, status: 'Booked', bookedAt: new Date(now).toISOString(), interviewId },
      ...bookableSlots(candidateId, data, now)
        .filter((s) => s.id !== slotId && s.round === slot.round)
        .map((s) => ({ ...s, status: 'Cancelled' })),
    ],
  };
}

export function portalOverview(c, data) {
  return {
    profile: {
      id: c.id,
      anthroId: anthroIdFor(c),
      name: c.name,
      title: c.title,
      location: c.location,
      mode: c.mode,
      engagement: c.engagement,
      notice: c.notice,
      earliestStart: c.earliestStart,
      activeStatus: c.activeStatus,
      expected: c.expected,
      preferredLocations: c.preferredLocations,
      timezone: c.timezone,
      skills: c.skills || [],
      skillsDetail: c.skillsDetail || [],
      summary: c.summary || '',
    },
    slots: bookableSlots(c.id, data),
    applications: (data.considerations || [])
      .filter((k) => k.candidateId === c.id)
      .map((k) => {
        const d = (data.demands || []).find((x) => x.id === k.demandId);
        return {
          demand: d?.title || '',
          client: d?.client || '',
          stage: k.stage,
          updated: k.updated,
        };
      }),
    submissions: (data.submissions || [])
      .filter((s) => s.candidateId === c.id)
      .map((s) => {
        const d = (data.demands || []).find((x) => x.id === s.demandId);
        return {
          demand: d?.title || '',
          client: d?.client || '',
          status: s.clientStatus,
          submittedOn: s.submittedOn,
        };
      }),
    interviews: (data.interviews || [])
      .filter((i) => i.candidateId === c.id)
      .map((i) => ({ round: i.round, mode: i.mode, scheduledAt: i.scheduledAt, status: i.status })),
    offers: (data.offers || [])
      .filter((o) => o.candidateId === c.id)
      .map((o) => ({ role: o.role, status: o.status, ctc: o.ctc, joining: o.joining })),
    consents: (data.consents || [])
      .filter((x) => x.candidateId === c.id)
      .map((x) => ({ id: x.id, purpose: x.purpose, status: x.status, date: x.date })),
  };
}
// The only fields the portal may write. Everything else is recruiter-owned.
export const PORTAL_EDITABLE = [
  'notice',
  'earliestStart',
  'activeStatus',
  'mode',
  'engagement',
  'preferredLocations',
  'expected',
];

export function validatePortalPayload(payload = {}) {
  if (
    payload.notice != null &&
    (!Number.isInteger(Number(payload.notice)) ||
      Number(payload.notice) < 0 ||
      Number(payload.notice) > MAX_NOTICE_DAYS)
  )
    return `Notice period must be a whole number from 0 to ${MAX_NOTICE_DAYS} days.`;
  if (
    payload.expected != null &&
    (!Number.isFinite(Number(payload.expected)) || Number(payload.expected) < 0)
  )
    return 'Expected CTC must be a non-negative number.';
  if (payload.activeStatus != null && !['Active', 'Passive'].includes(payload.activeStatus))
    return 'Choose Active or Passive availability status.';
  if (payload.mode != null && !['Flexible', 'Remote', 'Hybrid', 'Onsite'].includes(payload.mode))
    return 'Choose a valid work mode.';
  if (payload.earliestStart != null) {
    const value = String(payload.earliestStart);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      return 'Choose a valid earliest start date.';
  }
  return null;
}
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
    .map((s) => ({
      ...s,
      client: ((demands || []).find((d) => d.id === s.demandId) || {}).client || '',
    }))
    .filter(
      (s) =>
        s.candidateId === candidateId &&
        clientName &&
        String(s.client).toLowerCase() === String(clientName).toLowerCase() &&
        s.clientStatus === 'Rejected',
    )
    .map((s) => {
      const when = s.decidedOn || String(s.submittedOn || '').slice(0, 10);
      const ago = Math.floor((new Date(ref) - new Date(when)) / 86400000);
      return { when, daysAgo: ago };
    })
    .filter((x) => x.when && x.daysAgo >= 0 && x.daysAgo <= days)
    .sort((a, b) => b.daysAgo - a.daysAgo)[0];
  return hit ? { blocked: true, when: hit.when, daysAgo: hit.daysAgo } : { blocked: false };
}
