import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2, Download, BarChart3, Info } from 'lucide-react';
import { PageHeader, PanelHeading, Button, Field, Badge } from './ui.jsx';
import { uid, today } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import { downloadFile } from './downloads.js';
import { DemandReadinessReport } from './DemandJourney.jsx';
import { cloud } from './repository.js';
import {
  ENTITIES,
  ENTITY_LABELS,
  MEASURES,
  OPERATORS,
  fieldsFor,
  findField,
  blankReport,
  runReport,
  validateReport,
  validateReportName,
  suggestValues,
  reportCsv,
} from './reports.js';

const NO_VALUE = new Set(['is empty', 'is not empty']);
const show = (value) => (value === null ? 'No data' : String(value));

/**
 * Custom report builder (Zoho K2). Definitions are saved; results never are, so a report always
 * reflects the repository as it is now. Everything renders through the reader's own permissions.
 */
export function Reports({ data, onSave, onDelete, notify, audit, busy, role = getRole() }) {
  const isAdmin = role === 'admin';
  const canEdit = canWriteForRole(role);
  const saved = useMemo(
    () => [...(data.reports || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [data.reports],
  );
  const [draft, setDraft] = useState(() => blankReport('demands'));
  const [nameError, setNameError] = useState('');

  const fields = fieldsFor(draft.entity, { isAdmin });
  const config = draft.config;
  const result = useMemo(() => runReport(data, draft, { isAdmin }), [data, draft, isAdmin]);
  const problems = validateReport(draft, { isAdmin });

  const setConfig = (patch) => setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
  const setFilter = (index, patch) =>
    setConfig({
      filters: config.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });

  function pickEntity(entity) {
    // Fields do not carry across record types, so a change of subject starts a clean definition.
    setDraft((d) => ({ ...d, entity, config: blankReport(entity).config }));
  }

  function load(report) {
    setDraft({ ...report, config: { ...blankReport(report.entity).config, ...report.config } });
    setNameError('');
  }

  async function save() {
    const problem = validateReportName(draft, saved, draft.id || null);
    setNameError(problem);
    if (problem) return;
    if (problems.length) return notify?.(problems[0]);
    const row = {
      ...draft,
      name: draft.name.trim(),
      id: draft.id || uid(),
      created: draft.created || today(),
    };
    if (!(await onSave('reports', [row]))) return;
    setDraft(row);
    notify?.(`Saved “${row.name}”.`);
    audit?.({ entityType: 'reports', entityId: row.id, action: 'saved', detail: row.name });
  }

  async function remove(report) {
    if (
      !window.confirm(
        `Delete the report “${report.name}”? The records it reports on are untouched.`,
      )
    )
      return;
    if (!(await onDelete('reports', [report.id]))) return;
    if (draft.id === report.id) setDraft(blankReport(draft.entity));
    notify?.(`Deleted “${report.name}”.`);
  }

  function exportCsv() {
    if (result.error) return notify?.(result.error);
    downloadFile(
      reportCsv(draft, result, { actor: role }),
      `${(draft.name || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`,
    );
    audit?.({
      entityType: 'reports',
      entityId: draft.id || null,
      action: 'exported',
      detail: `${draft.name || 'Ad-hoc report'} (${result.considered} records)`,
    });
    notify?.('Report exported.');
  }

  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="Ask your own questions."
        description="Build a report over any record type, save it for the team, and export the answer."
      >
        <Button variant="secondary" icon={Plus} onClick={() => setDraft(blankReport(draft.entity))}>
          New report
        </Button>
      </PageHeader>

      {cloud && <DemandReadinessReport demands={data.demands || []} role={role} />}

      <div className="report-layout">
        <section className="panel">
          <PanelHeading title="Saved reports" subtitle="Shared with everyone in this workspace." />
          {saved.length === 0 ? (
            <p className="supporting-text">
              Nothing saved yet. Build a question on the right and save it for the team.
            </p>
          ) : (
            <ul className="client-list">
              {saved.map((r) => (
                <li key={r.id}>
                  <div>
                    <button className="text-link" onClick={() => load(r)}>
                      <strong>{r.name}</strong>
                    </button>
                    <small>
                      {ENTITY_LABELS[r.entity] || r.entity}
                      {r.description ? ` · ${r.description}` : ''}
                    </small>
                  </div>
                  <span className="member-actions">
                    {draft.id === r.id && <Badge tone="blue">Open</Badge>}
                    {canEdit && (
                      <Button
                        variant="secondary"
                        icon={Trash2}
                        onClick={() => remove(r)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <PanelHeading
            title="Report builder"
            subtitle="Results are calculated live — nothing is cached, so a saved report is never stale."
          />
          <div className="settings-body">
            <div className="form-grid">
              <Field label="About">
                <select
                  aria-label="About"
                  value={draft.entity}
                  onChange={(e) => pickEntity(e.target.value)}
                >
                  {ENTITIES.map((e) => (
                    <option key={e} value={e}>
                      {ENTITY_LABELS[e]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Group by" hint="Leave blank for a single total.">
                <select
                  aria-label="Group by"
                  value={config.groupBy}
                  onChange={(e) => setConfig({ groupBy: e.target.value })}
                >
                  <option value="">No grouping</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Measure">
                <select
                  aria-label="Measure"
                  value={config.measure}
                  onChange={(e) => setConfig({ measure: e.target.value, measureField: '' })}
                >
                  {Object.entries(MEASURES).map(([key, m]) => (
                    <option key={key} value={key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              {MEASURES[config.measure]?.needsField && (
                <Field label="Measure field">
                  <select
                    aria-label="Measure field"
                    value={config.measureField}
                    onChange={(e) => setConfig({ measureField: e.target.value })}
                  >
                    <option value="">Choose a field…</option>
                    {fields
                      .filter((f) =>
                        config.measure === 'distinct count'
                          ? true
                          : ['number', 'date'].includes(f.type),
                      )
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="Sort">
                <select
                  aria-label="Sort"
                  value={config.sort}
                  onChange={(e) => setConfig({ sort: e.target.value })}
                >
                  <option value="value">Highest first</option>
                  <option value="ascending">Lowest first</option>
                  <option value="label">By name</option>
                </select>
              </Field>
              <Field label="Show at most">
                <input
                  type="number"
                  min="1"
                  max="200"
                  aria-label="Show at most"
                  value={config.limit}
                  onChange={(e) => setConfig({ limit: Number(e.target.value) })}
                />
              </Field>
            </div>

            <h3 className="member-subheading">Filters</h3>
            {config.filters.length === 0 && (
              <p className="supporting-text">No filters — every record is included.</p>
            )}
            {config.filters.map((f, i) => {
              const meta = findField(draft.entity, f.field);
              const operators = Object.entries(OPERATORS).filter(
                ([, o]) => !meta || o.types.includes(meta.type),
              );
              return (
                <div className="report-filter" key={i}>
                  <select
                    aria-label={`Filter ${i + 1} field`}
                    value={f.field}
                    onChange={(e) => setFilter(i, { field: e.target.value, value: '' })}
                  >
                    <option value="">Choose a field…</option>
                    {fields.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Filter ${i + 1} comparison`}
                    value={f.operator}
                    onChange={(e) => setFilter(i, { operator: e.target.value })}
                  >
                    {operators.map(([key, o]) => (
                      <option key={key} value={key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {!NO_VALUE.has(f.operator) && (
                    <>
                      <input
                        aria-label={`Filter ${i + 1} value`}
                        list={`report-values-${i}`}
                        value={f.value ?? ''}
                        onChange={(e) => setFilter(i, { value: e.target.value })}
                      />
                      <datalist id={`report-values-${i}`}>
                        {(f.field
                          ? suggestValues(data, draft.entity, f.field, 40, { isAdmin })
                          : []
                        ).map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    </>
                  )}
                  <Button
                    variant="secondary"
                    icon={Trash2}
                    onClick={() => setConfig({ filters: config.filters.filter((_, x) => x !== i) })}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() =>
                setConfig({
                  filters: [...config.filters, { field: '', operator: 'is', value: '' }],
                })
              }
            >
              Add filter
            </Button>

            <div className="form-grid report-save">
              <Field label="Report name" hint={nameError}>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Open roles by client"
                  aria-invalid={!!nameError}
                />
              </Field>
              <Field label="Description">
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="What this answers"
                />
              </Field>
            </div>
            <div className="approval-actions">
              {canEdit && (
                <Button icon={Save} onClick={save} disabled={busy}>
                  {draft.id ? 'Save changes' : 'Save report'}
                </Button>
              )}
              <Button
                variant="secondary"
                icon={Download}
                onClick={exportCsv}
                disabled={!!result.error}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </section>
      </div>

      <ReportResult result={result} problems={problems} />
    </>
  );
}

export function ReportResult({ result, problems = [] }) {
  if (problems.length)
    return (
      <section className="panel">
        <PanelHeading title="Result" />
        <div className="settings-body">
          <p className="form-error">{problems[0]}</p>
        </div>
      </section>
    );
  if (result.error)
    return (
      <section className="panel">
        <PanelHeading title="Result" />
        <div className="settings-body">
          <p className="form-error">{result.error}</p>
        </div>
      </section>
    );

  return (
    <section className="panel">
      <PanelHeading
        title="Result"
        subtitle={`${result.considered} record${result.considered === 1 ? '' : 's'} considered`}
        action={<Badge tone="blue">{result.measureLabel}</Badge>}
      />
      <div className="settings-body">
        {result.droppedFilters?.length > 0 && (
          <p className="constraint-warning">
            <strong>Some filters were skipped.</strong> This report filters on{' '}
            {result.droppedFilters.join(', ')}, which your role cannot see. The numbers below are
            for the unfiltered population.
          </p>
        )}
        {result.groups.length === 0 ? (
          <div className="report-total">
            <strong>{show(result.total)}</strong>
            <span>{result.measureLabel}</span>
            {result.total === null && (
              <small>
                <Info size={13} /> No record in this population has a value to measure, so there is
                no answer — not zero.
              </small>
            )}
          </div>
        ) : (
          <>
            <div className="horizontal-chart">
              {result.groups.map((g) => (
                <div key={g.key}>
                  <span>{g.key}</span>
                  <div>
                    <i style={{ width: `${Math.round(g.share * 100)}%` }} />
                  </div>
                  <strong>{show(g.value)}</strong>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{result.groupLabel}</th>
                    <th>{result.measureLabel}</th>
                    <th>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {result.groups.map((g) => (
                    <tr key={g.key}>
                      <td>{g.key}</td>
                      <td>{show(g.value)}</td>
                      <td>{g.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.truncated > 0 && (
              <p className="supporting-text">
                <BarChart3 size={13} /> {result.truncated} more group
                {result.truncated === 1 ? '' : 's'} not shown — raise the limit to include them.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
