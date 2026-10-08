// Resolve a wall-clock minute explicitly. Never let Date silently select a DST occurrence.
export function zonedCandidates(local, zone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || ''))
    throw Error('Enter a local date and time to the minute.');
  const nominal = Date.parse(local + ':00Z');
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 16) !== local)
    throw Error('Invalid local date or time.');
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw Error('Choose an IANA timezone, such as Asia/Kolkata.');
  }
  const render = (instant) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const offsets = new Set();
  // Sample both sides of timezone transitions; derive offsets from the zone, including half/quarter hours.
  for (let hour = -36; hour <= 36; hour += 6) {
    const instant = nominal + hour * 3600000;
    offsets.add(Date.parse(render(instant) + ':00Z') - instant);
  }
  return [...offsets]
    .map((offset) => nominal - offset)
    .filter((instant) => render(instant) === local)
    .sort((a, b) => a - b)
    .map((instant) => new Date(instant).toISOString());
}
export function resolveZonedTime(local, zone, choice) {
  const choices = zonedCandidates(local, zone);
  if (!choices.length)
    throw Error(
      'This local time does not exist because the clock moves forward. Choose another time.',
    );
  if (choices.length > 1 && !choices.includes(choice))
    throw Error('This local time occurs twice. Choose the earlier or later UTC occurrence.');
  return choices.length === 1 ? choices[0] : choice;
}
