import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFieldDefinition,
  validateCustomValues,
  customFieldsFor,
} from '../src/customFields.js';
const fields = [
  { name: 'Budget category', type: 'select', options: ['A', 'B'] },
  { name: 'Headcount', type: 'number' },
  { name: 'Renewal', type: 'date' },
];
const data = { settings: [{ id: 'workspace', custom: { customFields: { clients: fields } } }] };
test('definitions reject duplicates, unsafe keys, invalid choices and excessive fields', () => {
  assert.match(
    validateFieldDefinition({ name: 'headcount', type: 'text' }, fields),
    /already exists/,
  );
  for (const name of ['__proto__', 'constructor', 'prototype'])
    assert.ok(validateFieldDefinition({ name, type: 'text' }));
  assert.match(
    validateFieldDefinition({ name: 'Region', type: 'select', options: ['East', 'east'] }),
    /unique/,
  );
  assert.match(validateFieldDefinition({ name: 'Region', type: 'select', options: [] }), /choices/);
  assert.equal(
    validateFieldDefinition({ name: 'Region', type: 'select', options: ['East', 'West'] }),
    '',
  );
});
test('custom values reject invalid date rollovers and choices without coercing blank numbers', () => {
  assert.equal(validateCustomValues(data, 'clients', { Headcount: '', Renewal: '2024-02-29' }), '');
  assert.equal(validateCustomValues(data, 'clients', { Headcount: 0, 'Budget category': 'A' }), '');
  for (const value of ['0', NaN, Infinity])
    assert.match(validateCustomValues(data, 'clients', { Headcount: value }), /number/);
  assert.match(validateCustomValues(data, 'clients', { Renewal: '2025-02-29' }), /date/);
  assert.match(validateCustomValues(data, 'clients', { 'Budget category': 'C' }), /choices/);
  assert.match(validateCustomValues(data, 'clients', []), /object/);
});
test('archiving hides inputs while preserving values for history and restoration', () => {
  const archived = {
    settings: [
      {
        id: 'workspace',
        custom: { customFields: { clients: [{ name: 'Legacy', type: 'text', archived: true }] } },
      },
    ],
  };
  assert.deepEqual(customFieldsFor(archived, 'clients'), []);
  assert.equal(customFieldsFor(archived, 'clients', { includeArchived: true }).length, 1);
  assert.equal(validateCustomValues(archived, 'clients', { Legacy: 'Historic value' }), '');
});
