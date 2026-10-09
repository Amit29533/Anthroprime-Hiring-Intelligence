import { scanSkills } from './taxonomy.js';
import { extractCvEvidence } from './cvEvidence.js';

// Keep phone candidates on one line and exclude date ranges and calendar dates.
export function cvPhone(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const match of line.matchAll(/\+?\(?\d[\d \t().-]{5,}\d/g)) {
      const value = match[0].trim();
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      if (/^(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}$/.test(value)) continue;
      if (/^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(value)) continue;
      return value;
    }
  }
  return '';
}

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
  const phone = cvPhone(clean);
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
