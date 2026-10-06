import { scanSkills } from './taxonomy.js';
import { extractCvEvidence } from './cvEvidence.js';

// Blueprint §11 — heuristic parse into a reviewable draft. Never auto-saved.
export function parseCVText(text) {
  const clean = String(text || '').replace(/\r/g, '');
  if (!clean.trim())
    return {
      name: '',
      email: '',
      phone: '',
      linkedin: '',
      title: '',
      skills: [],
      experience: null,
      summary: '',
    };
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const email = (clean.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
  const phone = (clean.match(/\+?\d[\d\s().-]{7,}\d/) || [''])[0].trim();
  const linkedin = (clean.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9._-]+/i) || [
    '',
  ])[0];
  const years = clean.match(/(\d{1,2})\+?\s*(?:years|yrs)\b/i);
  const name =
    lines
      .slice(0, 6)
      .find(
        (l) =>
          /^[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){1,3}$/.test(l) &&
          !l.includes('@') &&
          !/\d/.test(l),
      ) || '';
  const title =
    lines
      .slice(0, 8)
      .find(
        (l) =>
          l.length < 60 &&
          /engineer|architect|developer|consultant|analyst|manager|lead|specialist|scientist/i.test(
            l,
          ) &&
          !l.includes('@'),
      ) || '';
  return {
    name,
    email: email.toLowerCase(),
    phone,
    linkedin,
    title,
    skills: scanSkills(clean),
    experience: years ? Number(years[1]) : null,
    summary: lines.slice(0, 3).join(' ').slice(0, 240),
    cvEvidence: extractCvEvidence(clean),
  };
}
