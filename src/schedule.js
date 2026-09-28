// Scheduling: a calendar view of interviews, and interviewer availability (Phase C).
//
// Recruiters think in days and weeks — "what does Thursday look like?" — and the product only
// had a list. This module turns interviews and published slots into a week grid, and finds the
// clashes a list hides.
//
// Times are handled in the viewer's own timezone throughout. Interviews are stored as
// timestamptz, so the same record legitimately falls on different days for people in different
// places; pretending otherwise by formatting in UTC would put an 8pm IST interview on the wrong
// day for the recruiter who booked it.

export const SLOT_MODES = ['Video', 'Phone', 'In person'];
export const DEFAULT_DURATION = 45;

const asDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Midnight at the start of the given day, in local time. */
export function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monday of the week containing `value`. Weeks start on Monday for a working calendar. */
export function startOfWeek(value) {
  const d = startOfDay(value);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

export const addDays = (value, n) => {
  const d = new Date(value);
  d.setDate(d.getDate() + n);
  return d;
};

export const sameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();

/** Minutes from midnight — what a day column needs to position an entry. */
export const minutesInDay = (value) => {
  const d = asDate(value);
  return d ? d.getHours() * 60 + d.getMinutes() : 0;
};

const endOf = (entry) =>
  new Date(
    asDate(entry.startsAt).getTime() + (Number(entry.durationMins) || DEFAULT_DURATION) * 60000,
  );

/** Normalise interviews and published slots into one comparable shape. */
export function scheduleEntries(data, { includeSlots = true } = {}) {
  const entries = [];
  for (const i of data?.interviews || []) {
    const at = asDate(i.scheduledAt);
    if (!at || i.status === 'Cancelled') continue;
    const candidate = (data.candidates || []).find((c) => c.id === i.candidateId);
    const demand = (data.demands || []).find((d) => d.id === i.demandId);
    entries.push({
      kind: 'interview',
      id: i.id,
      startsAt: at,
      durationMins: Number(i.durationMins) || DEFAULT_DURATION,
      title: candidate?.name || 'Interview',
      subtitle: [i.round, demand?.title].filter(Boolean).join(' · '),
      people: i.interviewers || [],
      mode: i.mode,
      status: i.status,
      candidateId: i.candidateId,
    });
  }
  if (includeSlots)
    for (const s of data?.interviewSlots || []) {
      const at = asDate(s.startsAt);
      // A booked slot already has an interview; showing both would double-book the view.
      if (!at || s.status !== 'Open') continue;
      const candidate = (data.candidates || []).find((c) => c.id === s.candidateId);
      entries.push({
        kind: 'slot',
        id: s.id,
        startsAt: at,
        durationMins: Number(s.durationMins) || DEFAULT_DURATION,
        title: candidate ? `Offered to ${candidate.name}` : 'Open slot',
        subtitle: [s.round, s.interviewer].filter(Boolean).join(' · '),
        people: s.interviewer ? [s.interviewer] : [],
        mode: s.mode,
        status: s.status,
        candidateId: s.candidateId,
      });
    }
  return entries.sort((a, b) => a.startsAt - b.startsAt);
}

/** Two entries clash when they overlap in time AND share a person. */
export function overlaps(a, b) {
  return asDate(a.startsAt) < endOf(b) && asDate(b.startsAt) < endOf(a);
}

const sharedPerson = (a, b) => {
  const names = new Set(
    (a.people || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean),
  );
  if (a.candidateId && b.candidateId && a.candidateId === b.candidateId) return true;
  return (b.people || []).some((p) => names.has(String(p).trim().toLowerCase()));
};

/**
 * Ids of entries that clash with another. A list view hides these completely — two interviews
 * at 3pm on different rows look fine until somebody misses one.
 */
export function findConflicts(entries) {
  const clashing = new Set();
  for (let i = 0; i < entries.length; i += 1)
    for (let j = i + 1; j < entries.length; j += 1) {
      if (!overlaps(entries[i], entries[j])) continue;
      if (!sharedPerson(entries[i], entries[j])) continue;
      clashing.add(entries[i].id);
      clashing.add(entries[j].id);
    }
  return clashing;
}

/** Seven day-columns from the Monday of the given week, each with its entries. */
export function weekGrid(data, anchor = new Date(), options = {}) {
  const start = startOfWeek(anchor);
  const entries = scheduleEntries(data, options);
  const conflicts = findConflicts(entries);
  const days = [];
  for (let n = 0; n < 7; n += 1) {
    const date = addDays(start, n);
    const dayEntries = entries
      .filter((e) => sameDay(e.startsAt, date))
      .map((e) => ({ ...e, conflict: conflicts.has(e.id) }));
    days.push({
      date,
      isToday: sameDay(date, new Date()),
      entries: dayEntries,
      conflicts: dayEntries.filter((e) => e.conflict).length,
    });
  }
  return { start, end: addDays(start, 6), days, total: entries.length, conflicts: conflicts.size };
}

export const formatTime = (value) =>
  asDate(value)?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) || '';

export const formatDayLabel = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

// ------------------------------------------------------------------ publishing availability

export const blankSlot = (candidateId = null, demandId = null) => ({
  candidateId,
  demandId,
  interviewer: '',
  round: 'Round 1',
  mode: 'Video',
  location: '',
  startsAt: '',
  durationMins: DEFAULT_DURATION,
  status: 'Open',
  note: '',
});

export function validateSlot(form, existing = [], id = null) {
  const errors = {};
  if (!form.candidateId) errors.candidateId = 'Choose who this time is offered to.';
  if (!String(form.interviewer || '').trim()) errors.interviewer = 'Who is interviewing?';
  const at = asDate(form.startsAt);
  if (!at) errors.startsAt = 'Choose a date and time.';
  else if (at.getTime() <= Date.now()) errors.startsAt = 'Choose a time in the future.';
  const mins = Number(form.durationMins);
  if (!Number.isFinite(mins) || mins < 5 || mins > 480)
    errors.durationMins = 'Length must be between 5 and 480 minutes.';
  if (!SLOT_MODES.includes(form.mode)) errors.mode = 'Choose how the interview happens.';

  // Mirrors the partial unique index: the same interviewer cannot be free twice at one moment.
  if (at && !errors.interviewer) {
    const clash = existing.find(
      (s) =>
        s.id !== id &&
        s.status !== 'Cancelled' &&
        String(s.interviewer || '')
          .trim()
          .toLowerCase() === String(form.interviewer).trim().toLowerCase() &&
        asDate(s.startsAt)?.getTime() === at.getTime(),
    );
    if (clash) errors.startsAt = 'That interviewer is already published as free at that time.';
  }
  return errors;
}

/** Generate a run of slots — publishing one at a time is the actual friction. */
export function generateSlots(base, { count = 1, everyMins = 60 } = {}) {
  const start = asDate(base.startsAt);
  if (!start || count < 1) return [];
  return Array.from({ length: count }, (_, n) => ({
    ...base,
    startsAt: new Date(start.getTime() + n * everyMins * 60000).toISOString(),
  }));
}

/** Slots offered to one candidate, soonest first. */
export const slotsForCandidate = (data, candidateId) =>
  (data?.interviewSlots || [])
    .filter((s) => s.candidateId === candidateId && s.status === 'Open')
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));

/** Headline numbers for the scheduling screen. */
export function scheduleTotals(data, anchor = new Date()) {
  const grid = weekGrid(data, anchor);
  const open = (data?.interviewSlots || []).filter((s) => s.status === 'Open');
  const awaiting = new Set(open.map((s) => s.candidateId).filter(Boolean));
  return {
    thisWeek: grid.days.reduce(
      (n, d) => n + d.entries.filter((e) => e.kind === 'interview').length,
      0,
    ),
    slotsOpen: open.length,
    awaitingChoice: awaiting.size,
    conflicts: grid.conflicts,
  };
}
