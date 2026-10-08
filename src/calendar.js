import { resolveZonedTime } from './schedulingTime.js';
// Manual RFC 5545 fallback; authorized two-way Google synchronization lives in GoogleWorkspace.
const pad = (n) => String(n).padStart(2, '0');
export const icsStamp = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const esc = (text) =>
  String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
const fold = (line) => {
  const encoder = new TextEncoder();
  let segment = '',
    bytes = 0;
  const parts = [];
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 74) {
      parts.push(segment);
      segment = '';
      bytes = 1;
    }
    segment += char;
    bytes += size;
  }
  parts.push(segment);
  return parts.join('\r\n ');
};

function vevent(iv, candidate, demand) {
  const start = icsStamp(iv.scheduledAt);
  if (!start) return null;
  const end = icsStamp(
    new Date(new Date(iv.scheduledAt).getTime() + (iv.durationMins || 45) * 60000).toISOString(),
  );
  const who = candidate ? candidate.name : 'Candidate';
  const what = demand ? demand.title : 'Interview';
  const summary = `Interview: ${who} — ${what} (${iv.round}, ${iv.mode})`;
  const description = [
    `Panel: ${(iv.interviewers || []).join(', ') || 'TBD'}`,
    demand && demand.client ? `Client: ${demand.client}` : '',
    iv.notes || '',
  ]
    .filter(Boolean)
    .join('\n');
  const status = iv.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED';
  return [
    'BEGIN:VEVENT',
    `UID:${iv.id}@ecod.anthroprime`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(iv.mode === 'Video' ? 'Video call' : iv.mode === 'Phone' ? 'Phone call' : iv.mode)}`,
    `STATUS:${status}`,
    'END:VEVENT',
  ]
    .map(fold)
    .join('\r\n');
}

export function icsFor(interviews, candidates, demands) {
  const events = (interviews || [])
    .filter((iv) => iv.status === 'Scheduled' || iv.status === 'Cancelled')
    .map((iv) =>
      vevent(
        iv,
        (candidates || []).find((c) => c.id === iv.candidateId),
        (demands || []).find((d) => d.id === iv.demandId),
      ),
    )
    .filter(Boolean);
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AnthroPrime//ECOD Talent Intelligence//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

export const icsForInterview = (iv, candidate, demand) =>
  icsFor([iv], candidate ? [candidate] : [], demand ? [demand] : []);

// --- Batch 10: inbound one-way sync — parse an external .ics file into interview drafts.
function icsDate(v) {
  v = String(v || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/.exec(v);
  if (m) {
    const [, Y, M, D, h, mi, s, tz] = m;
    const iso =
      tz === 'Z' || !tz
        ? `${Y}-${M}-${D}T${h}:${mi}:${s}Z`
        : `${Y}-${M}-${D}T${h}:${mi}:${s}${tz.slice(0, 3)}:${tz.slice(3)}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00Z`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
const icsUnescape = (s) =>
  String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
export function parseICS(text) {
  if (
    String(text || '').length > 1048576 ||
    new TextEncoder().encode(String(text || '')).length > 1048576
  )
    throw Error('Calendar import exceeds 1 MiB. Split the file before review.');
  const raw = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const lines = [];
  for (const ln of raw) {
    if ((ln.startsWith(' ') || ln.startsWith('\t')) && lines.length)
      lines[lines.length - 1] += ln.slice(1);
    else lines.push(ln);
  }
  const events = [];
  let cur = null;
  for (const ln of lines) {
    if (ln.trim() === 'BEGIN:VEVENT') {
      cur = {
        uid: '',
        summary: '',
        start: null,
        end: null,
        location: '',
        description: '',
        status: '',
      };
      continue;
    }
    if (ln.trim() === 'END:VEVENT') {
      if (cur) {
        if (events.length >= 1000)
          throw Error('Calendar import exceeds 1000 events. Split the file before review.');
        events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const c = ln.indexOf(':');
    if (c < 0) continue;
    const property = ln.slice(0, c),
      name = property.split(';')[0].trim().toUpperCase();
    const val = ln.slice(c + 1).trim();
    if (name === 'UID') cur.uid = val;
    else if (name === 'SUMMARY') cur.summary = icsUnescape(val);
    else if (name === 'DTSTART' || name === 'DTEND') {
      const tzid = property.match(/;TZID="?([^;"\r\n]+)"?/i)?.[1];
      let date = icsDate(val);
      if (tzid && /^\d{8}T\d{6}$/.test(val)) {
        const local = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T${val.slice(9, 11)}:${val.slice(11, 13)}`;
        try {
          const minute = resolveZonedTime(local, tzid);
          const seconds = Number(val.slice(13, 15));
          if (seconds > 59) throw Error('Invalid seconds');
          date = new Date(Date.parse(minute) + seconds * 1000).toISOString();
        } catch (e) {
          date = null;
          cur.timeIssue = e.message;
        }
      }
      if (name === 'DTSTART') cur.start = date;
      else cur.end = date;
    } else if (name === 'LOCATION') cur.location = icsUnescape(val);
    else if (name === 'DESCRIPTION') cur.description = icsUnescape(val);
    else if (name === 'STATUS') cur.status = val;
  }
  return events;
}
// Best-effort mapping: an event belongs to the candidate whose name appears in its summary/description.
export function interviewDraftFromEvent(ev, candidates) {
  if (!ev || !ev.start) return { ev, candidateId: null, demandId: null };
  const hay = `${ev.summary} ${ev.description}`.toLowerCase();
  const cand = (candidates || []).find((c) => c.name && hay.includes(String(c.name).toLowerCase()));
  return { ev, candidateId: cand ? cand.id : null, demandId: null };
}
