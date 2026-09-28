import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Play, TriangleAlert, Route } from 'lucide-react';
import { PanelHeading, Button, Field, Modal, Badge, Empty } from './ui.jsx';
import { uid, today } from './domain.js';
import { getRole } from './repository.js';
import {
  ASSIGNABLE,
  OPS,
  blankRule,
  validateRule,
  dryRun,
  knownOwners,
  ownerIsUnknown,
} from './assignment.js';

export function AssignmentRuleForm({ rule, data, onClose, onSave, busy }) {
  const [form, setForm] = useState(rule || blankRule('candidates'));
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const fields = ASSIGNABLE[form.entity]?.fields || [];
  const preview = useMemo(
    () =>
      validateRule(form, data.assignmentRules, rule?.id || null).value
        ? null
        : dryRun(data, form.entity, { ...form, id: rule?.id || 'preview' }),
    [data, form, rule],
  );
  const unknownOwner = ownerIsUnknown(data, form.assignTo);

  async function submit(e) {
    e.preventDefault();
    const found = validateRule(form, data.assignmentRules, rule?.id || null);
    setErrors(found);
    if (Object.keys(found).length) return;
    const row = {
      ...form,
      name: form.name.trim(),
      assignTo: form.assignTo.trim(),
      priority: Number(form.priority) || 100,
      id: rule?.id || uid(),
      created: rule?.created || today(),
    };
    if (!(await onSave('assignmentRules', [row]))) return;
    onClose();
  }

  return (
    <Modal
      title={rule ? `Edit “${rule.name}”` : 'New assignment rule'}
      subtitle="Fills the owner on new records. It never reassigns work somebody already holds."
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Rule name" wide hint={errors.name}>
            <input
              value={form.name}
              onChange={set('name')}
              aria-invalid={!!errors.name}
              placeholder="Referrals to Amit"
            />
          </Field>
          <Field label="Applies to" hint={errors.entity}>
            <select
              value={form.entity}
              onChange={(e) =>
                setForm({
                  ...form,
                  entity: e.target.value,
                  field: ASSIGNABLE[e.target.value].fields[0].key,
                })
              }
            >
              {Object.entries(ASSIGNABLE).map(([key, spec]) => (
                <option key={key} value={key}>
                  {spec.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="When field" hint={errors.field}>
            <select value={form.field} onChange={set('field')}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Comparison" hint={errors.op}>
            <select value={form.op} onChange={set('op')}>
              {Object.entries(OPS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value" hint={errors.value || (form.op === 'any' ? 'Comma separated.' : '')}>
            <input value={form.value} onChange={set('value')} aria-invalid={!!errors.value} />
          </Field>
          <Field
            label="Assign to"
            hint={
              errors.assignTo ||
              (unknownOwner ? 'No existing record is owned by that name — check the spelling.' : '')
            }
          >
            <input
              value={form.assignTo}
              onChange={set('assignTo')}
              list="known-owners"
              aria-invalid={!!errors.assignTo}
            />
            <datalist id="known-owners">
              {knownOwners(data).map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>
          <Field label="Order" hint={errors.priority || 'Lower runs first. The first match wins.'}>
            <input
              type="number"
              min="1"
              max="999"
              value={form.priority}
              onChange={set('priority')}
            />
          </Field>
        </div>

        {preview && (
          <div className="constraint-warning">
            <strong>If this rule were on today</strong>
            {preview.wouldAssign.length === 0
              ? ' it would change nothing — no unowned record matches.'
              : ` it would assign ${preview.wouldAssign.length} existing record${preview.wouldAssign.length === 1 ? '' : 's'}: ${preview.byOwner.map((o) => `${o.count} to ${o.owner}`).join(', ')}.`}
            {preview.alreadyOwned > 0 &&
              ` ${preview.alreadyOwned} already have an owner and are left alone.`}
          </div>
        )}

        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Assignment rules, with a dry run against records already in the workspace. */
export function AssignmentPanel({
  data,
  onSave,
  onDelete,
  onNew,
  onEdit,
  notify,
  busy,
  role = getRole(),
}) {
  const [ran, setRan] = useState(null);
  const isAdmin = role === 'admin';
  const rules = [...(data.assignmentRules || [])].sort(
    (a, b) => (a.priority || 0) - (b.priority || 0) || String(a.name).localeCompare(String(b.name)),
  );

  async function applyNow(entity) {
    const preview = dryRun(data, entity);
    if (!preview.wouldAssign.length)
      return notify?.('Nothing to assign — every unowned record already matches no rule.');
    const rows = (data[entity] || [])
      .filter((r) => preview.wouldAssign.some((w) => w.id === r.id))
      .map((r) => ({ ...r, owner: preview.wouldAssign.find((w) => w.id === r.id).owner }));
    if (!(await onSave(entity, rows))) return;
    notify?.(`${rows.length} record${rows.length === 1 ? '' : 's'} assigned.`);
    setRan(null);
  }

  return (
    <section className="panel">
      <PanelHeading
        title="Assignment rules"
        subtitle="Fill the owner on new candidates and demands automatically."
        action={
          isAdmin ? (
            <Button variant="secondary" icon={Plus} onClick={onNew}>
              New rule
            </Button>
          ) : null
        }
      />
      <div className="settings-body">
        {rules.length === 0 ? (
          <Empty
            title="No assignment rules"
            text="New candidates and demands arrive unowned until somebody assigns them. A rule can do that for you."
          />
        ) : (
          <ul className="client-list">
            {rules.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>
                    {r.name} {!r.enabled && <Badge tone="gray">Paused</Badge>}
                  </strong>
                  <small>
                    <Route size={13} />
                    {ASSIGNABLE[r.entity]?.label} ·{' '}
                    {ASSIGNABLE[r.entity]?.fields.find((f) => f.key === r.field)?.label} {OPS[r.op]}{' '}
                    “{r.value}” → {r.assignTo} · order {r.priority}
                  </small>
                  {ownerIsUnknown(data, r.assignTo) && (
                    <small className="text-amber">
                      <TriangleAlert size={13} /> Nothing is owned by that name — work may be routed
                      nowhere.
                    </small>
                  )}
                </div>
                {isAdmin && (
                  <span className="member-actions">
                    <Button
                      variant="secondary"
                      onClick={() => onSave('assignmentRules', [{ ...r, enabled: !r.enabled }])}
                      disabled={busy}
                    >
                      {r.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button variant="secondary" onClick={() => onEdit(r)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      icon={Trash2}
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Delete the rule “${r.name}”? Records already assigned keep their owner.`,
                          )
                        )
                          return;
                        if (await onDelete('assignmentRules', [r.id])) notify?.('Rule deleted.');
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && rules.length > 0 && (
          <>
            <h3 className="member-subheading">Apply to records already here</h3>
            <p className="careers-publish-hint">
              Rules only run when a record is created or saved. Use this to catch up on what is
              already in the workspace — it is previewed first, and never touches a record that
              already has an owner.
            </p>
            <div className="approval-actions">
              {Object.entries(ASSIGNABLE).map(([entity, spec]) => (
                <Button
                  key={entity}
                  variant="secondary"
                  icon={Play}
                  onClick={() => setRan({ entity, ...dryRun(data, entity) })}
                >
                  Preview {spec.label.toLowerCase()}
                </Button>
              ))}
            </div>
            {ran && (
              <div className="constraint-warning">
                <strong>
                  {ran.wouldAssign.length} of {ran.total}{' '}
                  {ASSIGNABLE[ran.entity].label.toLowerCase()} would be assigned.
                </strong>
                {ran.byOwner.length > 0 &&
                  ` ${ran.byOwner.map((o) => `${o.count} to ${o.owner}`).join(', ')}.`}
                {` ${ran.alreadyOwned} already owned, ${ran.noMatch} match no rule.`}
                {ran.wouldAssign.length > 0 && (
                  <div className="approval-actions">
                    <Button onClick={() => applyNow(ran.entity)} disabled={busy}>
                      Assign {ran.wouldAssign.length}
                    </Button>
                    <Button variant="secondary" onClick={() => setRan(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {!isAdmin && (
          <p className="supporting-text">Only an administrator can change how work is routed.</p>
        )}
      </div>
    </section>
  );
}
