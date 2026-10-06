export const CV_SECTIONS = ['employment', 'education', 'certifications', 'projects'];
const headings = {
  employment: /^(?:work|professional|employment|career)\s+(?:experience|history)$|^experience$/i,
  education: /^(?:education|academic(?: qualifications| background)?|qualifications)$/i,
  certifications:
    /^(?:certifications?|certificates?|licenses?(?: and certifications)?|professional certifications)$/i,
  projects: /^(?:(?:selected|personal|professional|key)\s+)?projects?$/i,
};
const otherHeading =
  /^(?:skills|technical skills|summary|profile|objective|achievements|awards|interests|languages|references|contact(?: details)?)$/i;

// Preserve cited lines; do not infer employers, qualifications, dates or credentials.
export function extractCvEvidence(text) {
  const items = [];
  let section = null,
    truncated = false;
  const lines = String(text || '')
    .replace(/\r/g, '')
    .slice(0, 40000)
    .split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    const heading = raw.replace(/[:：]\s*$/, '').trim();
    const matched = CV_SECTIONS.find((key) => headings[key].test(heading));
    if (matched) {
      section = matched;
      continue;
    }
    if (otherHeading.test(heading)) {
      section = null;
      continue;
    }
    if (!section || !raw) continue;
    if (items.length >= 16) {
      truncated = true;
      continue;
    }
    const evidence = raw.slice(0, 400);
    if (raw.length > 400) truncated = true;
    const period = (raw.match(
      /\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)\b/i,
    ) || [''])[0];
    const item = {
      section,
      label: evidence.replace(/^[•*-]\s*/, '').slice(0, 160),
      period,
      evidence,
      sourceLine: index + 1,
      reviewed: false,
    };
    if (!item.label.trim()) continue;
    if (new TextEncoder().encode(JSON.stringify([...items, item])).length > 9000) {
      truncated = true;
      continue;
    }
    items.push(item);
  }
  return { version: 1, items, truncated };
}

export function evidenceReady(value) {
  if (value?.items === undefined) return true;
  return Array.isArray(value.items) && value.items.every((item) => item?.reviewed === true);
}
