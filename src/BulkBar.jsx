import React, { useMemo, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import { Button, Badge } from './ui.jsx';
import { getRole } from './repository.js';
import { BULK_ACTIONS, planBulk, describePlan, skipSummary } from './bulk.js';

/**
 * Bulk actions over the current selection.
 *
 * The flow is deliberately two-step: choose an action, see exactly what it will do, then commit.
 * A bulk operation that silently no-ops on half the selection is worse than one that refuses,
 * because the user walks away believing it worked.
 */
export function BulkBar({
  data,
  selected,
  onSave,
  notify,
  onClear,
  onUndoReady,
  busy,
  role = getRole(),
}) {
  const [action, setAction] = useState('owner');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(false);

  const spec = BULK_ACTIONS[action];
  const plan = useMemo(
    () => planBulk(data, { action, ids: selected, value, role }),
    [data, action, selected, value, role],
  );
  const skips = skipSummary(plan);

  async function apply() {
    if (plan.blocked || !plan.changes.length) return;
    for (const [table, rows] of Object.entries(plan.writes))
      if (!(await onSave(table, rows))) return;
    notify?.(
      `${plan.changes.length} record${plan.changes.length === 1 ? '' : 's'} updated${
        plan.skipped.length ? `, ${plan.skipped.length} skipped` : ''
      }.`,
    );
    // Applying clears the selection, which unmounts this bar. The undo payload is therefore
    // handed to the parent — otherwise the affordance would vanish at exactly the moment a
    // user is most likely to want it.
    onUndoReady?.(plan.undoable ? plan.undo : null);
    setPreview(false);
    setValue('');
    onClear?.();
  }

  return (
    <div className="bulk-bar">
      <span>{selected.length} selected</span>

      <select
        aria-label="Bulk action"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setValue('');
          setPreview(false);
        }}
      >
        {Object.entries(BULK_ACTIONS).map(([key, s]) => (
          <option key={key} value={key}>
            {s.label}
          </option>
        ))}
      </select>

      {spec.needs === 'choice' && (
        <select aria-label="Bulk value" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose…</option>
          {spec.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {spec.needs === 'demand' && (
        <select aria-label="Bulk value" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose a demand…</option>
          {(data.demands || [])
            .filter((d) => d.status === 'Open')
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} — {d.client}
              </option>
            ))}
        </select>
      )}
      {spec.needs === 'text' && (
        <input
          aria-label="Bulk value"
          value={value}
          placeholder={spec.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      )}

      {!preview ? (
        <Button
          className="small"
          disabled={!!plan.blocked || busy}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
      ) : (
        <>
          <Button className="small" disabled={!plan.changes.length || busy} onClick={apply}>
            Apply to {plan.changes.length}
          </Button>
          <Button className="small" variant="secondary" onClick={() => setPreview(false)}>
            Cancel
          </Button>
        </>
      )}

      <span className="bulk-summary">{describePlan(plan)}</span>

      {preview && (
        <div className="bulk-preview">
          {plan.changes.length > 0 && (
            <ul>
              {plan.changes.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> <span>{c.summary}</span>
                </li>
              ))}
              {plan.changes.length > 6 && (
                <li className="muted">…and {plan.changes.length - 6} more</li>
              )}
            </ul>
          )}
          {skips.length > 0 && (
            <p className="bulk-skips">
              {skips.map((s) => (
                <Badge key={s.reason} tone="gray">
                  {s.count} {s.reason.toLowerCase()}
                </Badge>
              ))}
            </p>
          )}
        </div>
      )}

      <button className="bulk-clear" onClick={onClear} aria-label="Clear selection">
        <X size={15} />
      </button>
    </div>
  );
}

/**
 * The undo affordance for the bulk change just applied. Lives outside BulkBar because applying
 * clears the selection, which unmounts the bar.
 */
export function UndoBar({ undo, onSave, notify, onDismiss, busy }) {
  if (!undo) return null;
  return (
    <div className="bulk-bar">
      <span>Change applied</span>
      <Button
        className="small"
        variant="secondary"
        icon={Undo2}
        disabled={busy}
        onClick={async () => {
          for (const [table, rows] of Object.entries(undo))
            if (!(await onSave(table, rows))) return;
          notify?.('Change undone.');
          onDismiss?.();
        }}
      >
        Undo
      </Button>
      <button className="bulk-clear" onClick={onDismiss} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
