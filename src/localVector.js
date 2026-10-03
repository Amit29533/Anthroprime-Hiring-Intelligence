// Deterministic feature hashing shared by the browser and private index worker.
export function localVector(text) {
  const vector = Array(384).fill(0);
  const words =
    String(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}+#.]+/gu) || [];
  for (const word of words) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    vector[(hash >>> 0) % 384] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}
