// Public five-digit identity is allocated centrally in cloud mode and persisted locally in demo mode.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ANTHRO_NUMBER = 99999;
export const anthroNumberFrom = (value) => {
  const match = /^ANTHRO-(\d{5})$/i.exec(String(value || '').trim());
  const number = match ? Number(match[1]) : null;
  return number >= 1 && number <= MAX_ANTHRO_NUMBER ? number : null;
};
export function anthroIdFor(candidate) {
  const number =
    typeof candidate === 'number'
      ? candidate
      : (candidate?.anthroNumber ?? anthroNumberFrom(candidate?.anthroId));
  return Number.isInteger(number) && number >= 1 && number <= MAX_ANTHRO_NUMBER
    ? 'ANTHRO-' + String(number).padStart(5, '0')
    : '';
}
export function legacyAnthroIdFor(candidate) {
  const id = typeof candidate === 'object' ? candidate?.id : candidate;
  return id ? 'ANTHRO-' + String(id).toUpperCase() : '';
}
export function candidateIdFromAnthroId(value, candidates = []) {
  const text = String(value || '')
    .trim()
    .toUpperCase();
  if (anthroNumberFrom(text))
    return (
      candidates.find((c) => anthroIdFor(c) === text || (c.anthroAliases || []).includes(text))
        ?.id || null
    );
  const id = text.replace(/^ANTHRO-/i, '');
  return /^ANTHRO-/i.test(text) && UUID.test(id) ? id.toLowerCase() : null;
}
// Preserve existing allocations and allocate new numbers without truncation or wrapping.
export function assignAnthroIds(candidates) {
  const used = new Set();
  let maximum = 0;
  const rows = candidates.map((c) => {
    const number = c.anthroNumber ?? anthroNumberFrom(c.anthroId);
    if (number != null) {
      if (!Number.isInteger(number) || number < 1 || number > MAX_ANTHRO_NUMBER)
        throw new Error('Anthro-ID must be between ANTHRO-00001 and ANTHRO-99999.');
      if (used.has(number)) throw new Error('Duplicate Anthro-ID in candidate data.');
      used.add(number);
      maximum = Math.max(maximum, number);
    }
    return { ...c, ...(number != null ? { anthroNumber: number } : {}) };
  });
  for (const row of rows
    .filter((c) => c.anthroNumber == null)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (maximum >= MAX_ANTHRO_NUMBER)
      throw new Error('The five-digit Anthro-ID capacity of 99,999 has been reached.');
    row.anthroNumber = ++maximum;
  }
  return rows.map((c) => ({ ...c, anthroId: anthroIdFor(c) }));
}

export function candidateLabel(candidate) {
  return candidate
    ? `${candidate.name} · ${anthroIdFor(candidate) || 'Anthro-ID pending'}`
    : 'Unknown candidate';
}

export function candidateIdentityText(candidate) {
  return [anthroIdFor(candidate), ...(candidate?.anthroAliases || [])].join(' ');
}

// Retain merge tombstones in storage/backups while keeping repository lists clean.
export function allCandidateRows(data) {
  const byId = new Map();
  for (const row of [...(data?.mergedCandidates || []), ...(data?.candidates || [])])
    if (row?.id) byId.set(row.id, row);
  return [...byId.values()];
}

export function resolveCandidateId(id, candidates) {
  const byId = candidates instanceof Map ? candidates : new Map(candidates.map((c) => [c.id, c]));
  const visited = new Set();
  while (byId.get(id)?.mergedInto) {
    if (visited.has(id)) return null;
    visited.add(id);
    id = byId.get(id).mergedInto;
  }
  return byId.has(id) ? id : null;
}
