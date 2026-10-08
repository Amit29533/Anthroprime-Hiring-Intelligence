// Field names remain stable so archiving never loses values already attached to records.
export const CUSTOM_MODULES = {
  candidates: 'Candidates',
  demands: 'Demands',
  clients: 'Clients',
  clientContacts: 'Client contacts',
  interviews: 'Interviews',
  assessments: 'Assessments',
  enrichment: 'Enrichment plans',
  placements: 'Placements',
};
export const FIELD_TYPES = ['text', 'number', 'date', 'select'];
const unsafeNames = new Set(['__proto__', 'constructor', 'prototype']);
export function customFieldsFor(data, module, { includeArchived = false } = {}) {
  const fields = data.settings?.find((row) => row.id === 'workspace')?.custom?.customFields?.[
    module
  ];
  return (Array.isArray(fields) ? fields : []).filter(
    (field) => field && !unsafeNames.has(field.name) && (includeArchived || !field.archived),
  );
}
export function validateFieldDefinition(field, existing = []) {
  const name = String(field.name || '').trim();
  if (!name || name.length > 60 || unsafeNames.has(name))
    return 'Use a field name between 1 and 60 characters.';
  if (existing.some((item) => item.name.toLowerCase() === name.toLowerCase()))
    return 'A field with this name already exists, including archived fields.';
  if (!FIELD_TYPES.includes(field.type)) return 'Choose a supported field type.';
  if (existing.length >= 40) return 'Each module supports up to 40 fields.';
  if (field.type === 'select') {
    const options = field.options || [];
    if (
      !options.length ||
      options.length > 50 ||
      options.some((o) => typeof o !== 'string' || !o.trim() || o.length > 100)
    )
      return 'Provide 1–50 choices, each up to 100 characters.';
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
      return 'Choices must be unique.';
  }
  return '';
}
export function validateCustomValues(data, module, custom = {}) {
  if (!custom || typeof custom !== 'object' || Array.isArray(custom))
    return 'Custom fields must be an object.';
  for (const field of customFieldsFor(data, module)) {
    const value = Object.hasOwn(custom, field.name) ? custom[field.name] : undefined;
    if (value == null || value === '') continue;
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      return `${field.name}: enter a valid number.`;
    if (field.type !== 'number' && typeof value !== 'string')
      return `${field.name}: enter a text value.`;
    if (
      field.type === 'date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      return `${field.name}: enter a valid date.`;
    if (field.type === 'select' && !field.options?.includes(value))
      return `${field.name}: select one of the configured choices.`;
    if (typeof value === 'string' && value.length > 2000)
      return `${field.name}: use no more than 2000 characters.`;
  }
  return '';
}
