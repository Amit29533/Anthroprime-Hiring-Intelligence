import React, { useState } from 'react';
import { Button, Field, PanelHeading, Badge } from './ui.jsx';
import { getRole } from './repository.js';
import {
  CUSTOM_MODULES,
  FIELD_TYPES,
  customFieldsFor,
  validateFieldDefinition,
} from './customFields.js';

export function CustomFieldInputs({ data, module, values = {}, onChange }) {
  return customFieldsFor(data, module).map((field) => (
    <Field key={field.name} label={field.name}>
      {field.type === 'select' ? (
        <select
          value={Object.hasOwn(values, field.name) ? (values[field.name] ?? '') : ''}
          onChange={(event) => onChange({ ...values, [field.name]: event.target.value })}
        >
          <option value="">Choose…</option>
          {(field.options || []).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          type={FIELD_TYPES.includes(field.type) && field.type !== 'select' ? field.type : 'text'}
          step={field.type === 'number' ? 'any' : undefined}
          value={Object.hasOwn(values, field.name) ? (values[field.name] ?? '') : ''}
          maxLength={field.type === 'text' ? 2000 : undefined}
          onChange={(event) =>
            onChange({
              ...values,
              [field.name]:
                field.type === 'number' && event.target.value !== ''
                  ? Number(event.target.value)
                  : event.target.value,
            })
          }
        />
      )}
    </Field>
  ));
}

export function CustomFieldValues({ data, module, values = {} }) {
  const fields = customFieldsFor(data, module, { includeArchived: true }).filter(
    (field) =>
      Object.hasOwn(values, field.name) && values[field.name] != null && values[field.name] !== '',
  );
  if (!fields.length) return null;
  return (
    <dl className="client-meta custom-field-values">
      {fields.map((field) => (
        <div key={field.name}>
          <dt>
            {field.name}
            {field.archived ? ' (archived)' : ''}
          </dt>
          <dd>{String(values[field.name])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CustomFieldsPanel({ data, onSave, notify }) {
  const [module, setModule] = useState('candidates');
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (getRole() !== 'admin') return null;
  const fields = customFieldsFor(data, module, { includeArchived: true });
  async function persist(nextFields) {
    const row = data.settings?.find((item) => item.id === 'workspace') || {
      id: 'workspace',
      custom: {},
    };
    setBusy(true);
    setError('');
    try {
      const saved = await onSave('settings', [
        {
          ...row,
          custom: {
            ...row.custom,
            customFields: { ...row.custom?.customFields, [module]: nextFields },
          },
        },
      ]);
      if (!saved) {
        setError('The fields could not be saved. Try again.');
        return false;
      }
      notify?.('Custom fields updated.');
      return true;
    } catch (failure) {
      setError(failure.message || 'The fields could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add(event) {
    event.preventDefault();
    const field = {
      name: name.trim(),
      type,
      ...(type === 'select'
        ? {
            options: options
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    };
    const problem = validateFieldDefinition(field, fields);
    if (problem) return setError(problem);
    if (await persist([...fields, field])) {
      setName('');
      setOptions('');
    }
  }
  return (
    <section className="panel custom-fields-panel">
      <PanelHeading
        title="Custom fields"
        subtitle="Adapt profiles and client records to the information your team needs."
      />
      <div className="settings-body">
        <Field label="Field module">
          <select
            value={module}
            disabled={busy}
            onChange={(event) => {
              setModule(event.target.value);
              setError('');
            }}
          >
            {Object.entries(CUSTOM_MODULES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <p className="supporting-text">
          These fields are visible to workspace members. Use the dedicated compensation and
          commercial fields for restricted information. Archiving preserves previously recorded
          values.
        </p>
        <ul className="custom-field-list">
          {fields.map((field) => (
            <li key={field.name}>
              <div>
                <strong>{field.name}</strong>
                <small>
                  {field.type}
                  {field.type === 'select' ? ` · ${(field.options || []).join(', ')}` : ''}
                </small>
              </div>
              {field.archived && <Badge tone="gray">Archived</Badge>}
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={`${field.archived ? 'Restore' : 'Archive'} field ${field.name}`}
                onClick={() =>
                  persist(
                    fields.map((item) =>
                      item.name === field.name ? { ...item, archived: !item.archived } : item,
                    ),
                  )
                }
              >
                {field.archived ? 'Restore' : 'Archive'}
              </Button>
            </li>
          ))}
        </ul>
        {!fields.length && (
          <p className="supporting-text">No custom fields configured for this module.</p>
        )}
        <form onSubmit={add} className="custom-field-form">
          <Field label="New field name">
            <input
              value={name}
              maxLength={60}
              required
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Account region"
            />
          </Field>
          <Field label="Field type">
            <select value={type} disabled={busy} onChange={(event) => setType(event.target.value)}>
              {FIELD_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          {type === 'select' && (
            <Field label="Choices" hint="One choice per line.">
              <textarea
                rows={3}
                value={options}
                required
                disabled={busy}
                onChange={(event) => setOptions(event.target.value)}
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Add custom field'}
          </Button>
        </form>
      </div>
    </section>
  );
}
