// Reusable rubrics are copied into each assessment so later edits cannot rewrite evidence.
const clean = (value) => String(value ?? '').trim();
export const blankAssessmentTemplate = () => ({
  name: '',
  description: '',
  validityDays: 180,
  version: 1,
  archived: false,
  rubric: [
    { id: 'technical', label: 'Technical capability', weight: 70, maxScore: 5 },
    { id: 'communication', label: 'Communication', weight: 30, maxScore: 5 },
  ],
});

export function validateAssessmentTemplate(template, templates = []) {
  if (!clean(template.name)) return 'Give the template a name.';
  if (clean(template.name).length > 120) return 'Template names must be at most 120 characters.';
  if (
    templates.some(
      (row) =>
        row.id !== template.id &&
        clean(row.name).toLowerCase() === clean(template.name).toLowerCase(),
    )
  )
    return 'A template with that name already exists.';
  if (
    !Number.isInteger(Number(template.validityDays)) ||
    template.validityDays < 1 ||
    template.validityDays > 730
  )
    return 'Validity must be between 1 and 730 days.';
  const rubric = template.rubric;
  if (!Array.isArray(rubric) || !rubric.length || rubric.length > 20)
    return 'Add between 1 and 20 rubric criteria.';
  if (new Set(rubric.map((row) => row.id)).size !== rubric.length)
    return 'Each criterion needs a unique ID.';
  if (
    rubric.some(
      (row) =>
        !clean(row.id) ||
        !clean(row.label) ||
        !Number.isFinite(Number(row.weight)) ||
        row.weight <= 0 ||
        row.weight > 100 ||
        !Number.isFinite(Number(row.maxScore)) ||
        row.maxScore < 1 ||
        row.maxScore > 100,
    )
  )
    return 'Each criterion needs a label, positive weight and maximum score of 1–100.';
  if (Math.abs(rubric.reduce((sum, row) => sum + Number(row.weight), 0) - 100) > 0.001)
    return 'Rubric weights must add up to 100%.';
  return '';
}

export function rubricScore(rubric, scores) {
  if (!rubric?.length) return null;
  let total = 0;
  for (const row of rubric) {
    const raw = scores?.[row.id];
    if (raw === '' || raw === null || raw === undefined) return null;
    const score = Number(raw);
    if (!Number.isFinite(score) || score < 0 || score > Number(row.maxScore)) return null;
    total += (score / Number(row.maxScore)) * Number(row.weight);
  }
  return Math.round(total * 100) / 100;
}

export function assessmentExpiry(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export function assessmentTemplateFields(template, scores, date) {
  const problem = validateAssessmentTemplate(template);
  if (problem) throw new Error(problem);
  const score = rubricScore(template.rubric, scores);
  if (score === null) throw new Error('Score every criterion within its permitted range.');
  const validUntil = assessmentExpiry(date, template.validityDays);
  if (!validUntil) throw new Error('Enter a valid assessment date.');
  return {
    templateId: template.id,
    templateSnapshot: {
      name: template.name,
      description: template.description,
      version: template.version,
      validityDays: Number(template.validityDays),
      rubric: template.rubric.map((row) => ({ ...row })),
    },
    rubricScores: Object.fromEntries(
      template.rubric.map((row) => [row.id, Number(scores[row.id])]),
    ),
    validUntil,
    score,
  };
}
