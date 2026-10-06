// Phase 1.5 (§5 search layers) — semantic-flavoured retrieval computed entirely in the
// browser: a TF-IDF vector-space model over the same text the Boolean search uses
// (profile + extracted CV text + concept expansion). No external embedding vendor; a
// hosted embedding index can replace this module later without touching the UI.
import { candidateSearchText } from './domain.js';
import { allSkills, allAliases, scanSkills, SKILL_DOMAINS, domainOf } from './taxonomy.js';

const STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'is',
  'are',
  'or',
  'as',
  'by',
  'be',
  'this',
  'that',
  'it',
  'from',
  'was',
  'were',
  'has',
  'have',
  'had',
  'not',
  'but',
  'his',
  'her',
  'their',
  'our',
  'your',
  'who',
  'whom',
  'which',
  'will',
  'would',
  'can',
  'could',
  'should',
]);

export const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .match(/[a-z0-9+#.]{2,}/g)
    ?.filter((t) => !STOP.has(t) && !/^\d+$/.test(t)) || [];

export function buildVectors(candidates, documents) {
  const texts = new Map(
    candidates.map((c) => [
      c.id,
      tokenize(candidateSearchText(c, documents, { includeIdentity: false })),
    ]),
  );
  const df = new Map();
  for (const tokens of texts.values())
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
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
  for (const [t, w] of small.v) {
    const wb = big.v.get(t);
    if (wb) dot += w * wb;
  }
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
  const { vec } = buildVectors(candidates, documents);
  const me = vec.get(candidate.id);
  if (!me) return [];
  return candidates
    .filter((c) => c.id !== candidate.id && !c.mergedInto)
    .map((c) => ({ candidate: c, score: Math.round(cosine(me, vec.get(c.id)) * 100) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function sharedSkills(a, b) {
  return (a.skills || []).filter((s) => (b.skills || []).includes(s));
}

// Relevance ordering for the repository: cosine of the query vector against each
// profile's vector. Zero-score rows keep their original (filter-passing) order.
export function rankByRelevance(query, rows, documents) {
  const tokens = tokenize(query).filter((t) => !t.startsWith('-'));
  if (!tokens.length) return rows;
  const { vec, idf } = buildVectors(rows, documents);
  const q = vectorFor(tokens, idf);
  return rows
    .map((c, i) => ({ c, i, s: cosine(q, vec.get(c.id)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ c }) => c);
}

// ---- Batch 13: natural-language query parsing — deterministic, with a visible interpretation. ----
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const TITLE_TERMS = [
  'architect',
  'engineer',
  'consultant',
  'developer',
  'manager',
  'lead',
  'analyst',
  'scientist',
  'specialist',
  'admin',
];
const SENIORITY = [
  { re: /\bsenior\b|\bsr\.?\b/i, minExp: 7 },
  { re: /\blead\b|\bprincipal\b|\bstaff\b/i, minExp: 8 },
  { re: /\bjunior\b|\bjr\.?\b/i, maxExp: 4 },
];
const NL_STOP = new Set([
  'who',
  'has',
  'built',
  'with',
  'experience',
  'in',
  'the',
  'and',
  'for',
  'a',
  'an',
  'of',
  'to',
  'at',
  'on',
  'knowing',
  'knows',
  'worked',
  'working',
  'strong',
  'good',
  'hands',
  'plus',
  'candidate',
  'people',
  'profiles',
  'find',
  'show',
  'me',
  'any',
  'all',
]);

export function allSkillDomains() {
  const set = new Set(Object.values(SKILL_DOMAINS));
  for (const s of allSkills()) set.add(domainOf(s));
  return [...set].filter(Boolean);
}
export function skillsUnder(domain) {
  const d = String(domain || '').toLowerCase();
  return allSkills().filter((s) => domainOf(s).toLowerCase() === d);
}

export function parseTalentQuery(text) {
  const raw = String(text || '').trim();
  const out = {
    phrases: [],
    exclusions: [],
    terms: [],
    skills: [],
    domains: [],
    titleTerms: [],
    minExp: null,
    maxExp: null,
    maxNotice: null,
    mode: '',
    engagement: '',
    interpretation: [],
    used: false,
  };
  if (!raw) return out;
  const note = (s) => out.interpretation.push(s);
  // quoted phrases
  for (const m of raw.matchAll(/"([^"]+)"/g)) {
    out.phrases.push(m[1].trim());
    note(`Exact phrase: “${m[1].trim()}”`);
  }
  const bare = raw.replaceAll(/"[^"]+"/g, ' ');
  // exclusions
  for (const m of bare.matchAll(/(?:^|\s)-([\w.+#/-]+)/g)) {
    if (!NL_STOP.has(m[1].toLowerCase())) {
      out.exclusions.push(m[1].toLowerCase());
      note(`Excluding: ${m[1]}`);
    }
  }
  const spoken = bare.replaceAll(/(?:^|\s)-[\w.+#/-]+/g, ' ');
  // skills (canonical + aliases, e.g. 'genie' → Databricks Genie)
  const found = scanSkills(spoken);
  for (const sk of found) {
    out.skills.push(sk);
    const alias = Object.entries(allAliases()).find(
      ([, v]) => v === sk && new RegExp(`(^|[^a-z])${escapeRe(v)}`, 'i').test(spoken),
    );
    note(`Skill: ${sk}${alias ? ` (from “${alias[0]}”)` : ''}`);
  }
  // domains mentioned by name → expand to their skills
  for (const d of allSkillDomains()) {
    if (new RegExp(`(^|[^a-z])${escapeRe(d)}([^a-z]|$)`, 'i').test(spoken)) {
      out.domains.push(d);
      for (const sk of skillsUnder(d)) if (!out.skills.includes(sk)) out.skills.push(sk);
      note(`Domain “${d}” → ${skillsUnder(d).join(', ')}`);
    }
  }
  // seniority / experience
  const yrs = spoken.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i);
  if (yrs) {
    out.minExp = Number(yrs[1]);
    note(`At least ${yrs[1]} years' experience`);
  }
  for (const s of SENIORITY) {
    if (s.re.test(spoken)) {
      if (s.minExp) {
        out.minExp = Math.max(out.minExp ?? 0, s.minExp);
        note(`Seniority: ${s.minExp}+ years`);
      }
      if (s.maxExp) {
        out.maxExp = s.maxExp;
        note(`Up to ${s.maxExp} years (junior)`);
      }
    }
  }
  // notice
  const notice =
    spoken.match(/(\d{1,3})\s*[-\s]?\s*day\s*(?:\w+\s+)?notice/i) ||
    spoken.match(/notice[^0-9]{0,12}(\d{1,3})/i);
  if (notice) {
    out.maxNotice = Number(notice[1]);
    note(`Notice period up to ${notice[1]} days`);
  }
  if (/\bimmediate\b/i.test(spoken)) {
    out.maxNotice = 7;
    note('Immediate joiner (≤7 days notice)');
  }
  // work mode / engagement / title
  const mode = spoken.match(/\b(remote|hybrid|onsite)\b/i);
  if (mode) {
    out.mode = mode[1][0].toUpperCase() + mode[1].slice(1).toLowerCase();
    note(`Work mode: ${out.mode}`);
  }
  const eng = spoken.match(/\b(permanent|contract|c2h|subcontract)\b/i);
  if (eng) {
    out.engagement = ['c2h', 'subcontract'].includes(eng[1].toLowerCase())
      ? eng[1].toUpperCase()
      : eng[1][0].toUpperCase() + eng[1].slice(1).toLowerCase();
    note(`Engagement: ${out.engagement}`);
  }
  for (const t of TITLE_TERMS)
    if (new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i').test(spoken)) {
      out.titleTerms.push(t);
      note(`Role word: ${t}`);
    }
  // remaining meaningful words → plain terms
  for (const w of spoken.toLowerCase().split(/[^a-z0-9.+#]+/)) {
    if (!w || w.length < 3 || NL_STOP.has(w)) continue;
    if (found.some((sk) => sk.toLowerCase().includes(w))) continue;
    if (
      out.titleTerms.includes(w) ||
      [
        'years',
        'yrs',
        'notice',
        'day',
        'days',
        'senior',
        'junior',
        'lead',
        'principal',
        'staff',
        'immediate',
        'remote',
        'hybrid',
        'onsite',
        'permanent',
        'contract',
      ].includes(w)
    )
      continue;
    if (!out.terms.includes(w)) out.terms.push(w);
  }
  out.used = Boolean(
    out.phrases.length ||
      out.exclusions.length ||
      out.skills.length ||
      out.domains.length ||
      out.titleTerms.length ||
      out.minExp != null ||
      out.maxExp != null ||
      out.maxNotice != null ||
      out.mode ||
      out.engagement ||
      out.terms.length,
  );
  return out;
}

// Pure predicate: does a candidate satisfy the parsed interpretation?
export function matchesSemantic(c, parsed, searchText) {
  if (!parsed || !parsed.used) return true;
  const text = String(searchText || '').toLowerCase();
  if (parsed.phrases.some((p) => !text.includes(p.toLowerCase()))) return false;
  if (parsed.exclusions.some((x) => text.includes(x))) return false;
  if (parsed.terms.some((t) => !text.includes(t))) return false;
  if (
    parsed.titleTerms.some(
      (t) =>
        !String(c.title || '')
          .toLowerCase()
          .includes(t) && !text.includes(t),
    )
  )
    return false;
  if (parsed.skills.length && !parsed.skills.every((sk) => (c.skills || []).includes(sk)))
    return false;
  if (parsed.minExp != null && !(c.experience != null && c.experience >= parsed.minExp))
    return false;
  if (parsed.maxExp != null && !(c.experience != null && c.experience <= parsed.maxExp))
    return false;
  if (parsed.maxNotice != null && !(c.notice != null && c.notice <= parsed.maxNotice)) return false;
  if (parsed.mode && c.mode !== parsed.mode) return false;
  if (
    parsed.engagement &&
    String(c.engagement || '').toLowerCase() !== parsed.engagement.toLowerCase()
  )
    return false;
  return true;
}
