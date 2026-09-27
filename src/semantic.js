// Phase 1.5 (§5 search layers) — semantic-flavoured retrieval computed entirely in the
// browser: a TF-IDF vector-space model over the same text the Boolean search uses
// (profile + extracted CV text + concept expansion). No external embedding vendor; a
// hosted embedding index can replace this module later without touching the UI.
import {candidateSearchText} from './domain.js';

const STOP = new Set(['and','the','for','with','a','an','of','to','in','on','at','is','are','or','as','by','be','this','that','it','from','was','were','has','have','had','not','but','his','her','their','our','your','who','whom','which','will','would','can','could','should']);

export const tokenize = text => String(text || '').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.filter(t => !STOP.has(t) && !/^\d+$/.test(t)) || [];

export function buildVectors(candidates, documents) {
  const texts = new Map(candidates.map(c => [c.id, tokenize(candidateSearchText(c, documents))]));
  const df = new Map();
  for (const tokens of texts.values()) for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(candidates.length, 1);
  const idf = new Map([...df].map(([t, d]) => [t, Math.log((n + 1) / (d + 1)) + 1]));
  const vec = new Map();
  for (const [id, tokens] of texts) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map([...tf].map(([t, f]) => [t, (1 + Math.log(f)) * (idf.get(t) || 1)]));
    const norm = Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;
    vec.set(id, { v, norm });
  }
  return { vec, idf };
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  const [small, big] = a.v.size <= b.v.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.v) { const wb = big.v.get(t); if (wb) dot += w * wb; }
  return dot / (a.norm * b.norm);
}

export function vectorFor(tokens, idf) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const v = new Map([...tf].map(([t, f]) => [t, (1 + Math.log(f)) * (idf.get(t) || 1)]));
  const norm = Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;
  return { v, norm };
}

export function similarCandidates(candidate, candidates, documents, k = 5) {
  if (!candidate) return [];
  const { vec, idf } = buildVectors(candidates, documents);
  const me = vec.get(candidate.id);
  if (!me) return [];
  return candidates
    .filter(c => c.id !== candidate.id && !c.mergedInto)
    .map(c => ({ candidate: c, score: Math.round(cosine(me, vec.get(c.id)) * 100) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function sharedSkills(a, b) {
  return (a.skills || []).filter(s => (b.skills || []).includes(s));
}

// Relevance ordering for the repository: cosine of the query vector against each
// profile's vector. Zero-score rows keep their original (filter-passing) order.
export function rankByRelevance(query, rows, documents) {
  const tokens = tokenize(query).filter(t => !t.startsWith('-'));
  if (!tokens.length) return rows;
  const { vec, idf } = buildVectors(rows, documents);
  const q = vectorFor(tokens, idf);
  return rows.map((c, i) => ({ c, i, s: cosine(q, vec.get(c.id)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ c }) => c);
}
