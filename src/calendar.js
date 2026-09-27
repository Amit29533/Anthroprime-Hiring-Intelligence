// One-way calendar export (F6/F7 groundwork): interviews as RFC 5545 .ics events that
// open natively in Google Calendar, Outlook and Apple Calendar. Two-way sync needs a
// server-side OAuth integration and is honestly out of scope here.
const pad = n => String(n).padStart(2, '0');
export const icsStamp = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const esc = text => String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = line => line.length <= 74 ? line : line.match(/.{1,74}/g).join('\r\n ');

function vevent(iv, candidate, demand) {
  const start = icsStamp(iv.scheduledAt);
  if (!start) return null;
  const end = icsStamp(new Date(new Date(iv.scheduledAt).getTime() + (iv.durationMins || 45) * 60000).toISOString());
  const who = candidate ? candidate.name : 'Candidate';
  const what = demand ? demand.title : 'Interview';
  const summary = `Interview: ${who} — ${what} (${iv.round}, ${iv.mode})`;
  const description = [`Panel: ${(iv.interviewers || []).join(', ') || 'TBD'}`, demand && demand.client ? `Client: ${demand.client}` : '', iv.notes || ''].filter(Boolean).join('\n');
  const status = iv.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED';
  return ['BEGIN:VEVENT', `UID:${iv.id}@ecod.anthroprime`, `DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(iv.mode === 'Video' ? 'Video call' : iv.mode === 'Phone' ? 'Phone call' : iv.mode)}`,
    `STATUS:${status}`, 'END:VEVENT'].map(fold).join('\r\n');
}

export function icsFor(interviews, candidates, demands) {
  const events = (interviews || [])
    .filter(iv => iv.status === 'Scheduled' || iv.status === 'Cancelled')
    .map(iv => vevent(iv, (candidates || []).find(c => c.id === iv.candidateId), (demands || []).find(d => d.id === iv.demandId)))
    .filter(Boolean);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AnthroPrime//ECOD Talent Intelligence//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

export const icsForInterview = (iv, candidate, demand) => icsFor([iv], candidate ? [candidate] : [], demand ? [demand] : []);
