export function validatePool(pool, pools = []) {
  const name = String(pool?.name || '').trim();
  if (!name || name.length > 120) return 'Use a pool name between 1 and 120 characters.';
  if (
    pools.some((row) => row.id !== pool.id && row.name.trim().toLowerCase() === name.toLowerCase())
  )
    return 'A pool with that name already exists.';
  return '';
}

export function staticPoolMembers(data, poolId) {
  const ids = new Set(
    (data.poolMembers || [])
      .filter((row) => row.poolId === poolId && row.active !== false)
      .map((row) => row.candidateId),
  );
  return data.candidates.filter((person) => ids.has(person.id));
}
