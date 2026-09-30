import React, { useState } from 'react';
import { Plus, Pencil, Archive, ClipboardCheck } from 'lucide-react';
import { Button, Field, Modal, PanelHeading, Badge, Empty } from './ui.jsx';
import { uid, today } from './domain.js';
import { getRole } from './repository.js';
import { blankAssessmentTemplate, validateAssessmentTemplate } from './assessmentTemplates.js';

export function AssessmentTemplatePanel({ data, onSave, busy, role = getRole() }) {
  const [draft, setDraft] = useState(null),
    [error, setError] = useState(''),
    [showArchived, setShowArchived] = useState(false);
  const templates = data.assessmentTemplates || [];
  const admin = role === 'admin';
  const edit = (row) => {
    setDraft(
      row
        ? { ...row, rubric: row.rubric.map((criterion) => ({ ...criterion })) }
        : blankAssessmentTemplate(),
    );
    setError('');
  };
  const update = (index, patch) =>
    setDraft({
      ...draft,
      rubric: draft.rubric.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  async function save(event) {
    event.preventDefault();
    const problem = validateAssessmentTemplate(draft, templates);
    if (problem) return setError(problem);
    const row = {
      ...draft,
      name: draft.name.trim(),
      id: draft.id || uid(),
      created: draft.created || today(),
      version: draft.id ? Number(draft.version) + 1 : 1,
      validityDays: Number(draft.validityDays),
      rubric: draft.rubric.map((c) => ({
        ...c,
        label: c.label.trim(),
        weight: Number(c.weight),
        maxScore: Number(c.maxScore),
      })),
    };
    if (await onSave('assessmentTemplates', [row])) setDraft(null);
  }
  return (
    <div className="template-library">
      <PanelHeading
        title="Assessment templates"
        subtitle="Reusable weighted rubrics. Recorded assessments keep their original version."
        action={
          admin && (
            <Button icon={Plus} disabled={busy} onClick={() => edit(null)}>
              Create template
            </Button>
          )
        }
      />
      <label className="checkbox-label library-filter">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived templates
      </label>
      <div className="template-grid">
        {templates
          .filter((row) => showArchived || !row.archived)
          .map((row) => (
            <article className="template-card" key={row.id}>
              <ClipboardCheck size={23} />
              <h3>{row.name}</h3>
              <p>{row.description}</p>
              <div className="template-meta">
                <Badge>{row.archived ? 'Archived' : `Version ${row.version}`}</Badge>
                <small>
                  {row.rubric.length} criteria · Valid for {row.validityDays} days
                </small>
              </div>
              <ul>
                {row.rubric.map((c) => (
                  <li key={c.id}>
                    {c.label}
                    <strong>{c.weight}%</strong>
                  </li>
                ))}
              </ul>
              {admin && (
                <div className="heading-actions">
                  <Button
                    icon={Pencil}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => edit(row)}
                  >
                    Edit template
                  </Button>
                  <Button
                    icon={Archive}
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      onSave('assessmentTemplates', [{ ...row, archived: !row.archived }])
                    }
                  >
                    {row.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              )}
            </article>
          ))}
      </div>
      {!templates.some((row) => showArchived || !row.archived) && (
        <Empty
          title="Build your first assessment rubric"
          text={
            admin
              ? 'Create a weighted template to give assessors a consistent evaluation structure.'
              : 'An administrator can create assessment templates for your team.'
          }
        />
      )}
      {draft && (
        <Modal
          title={draft.id ? 'Edit assessment template' : 'Create assessment template'}
          subtitle="Weights total 100%. Template changes apply to future assessments."
          onClose={() => !busy && setDraft(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="modal-body">
              <div className="form-grid">
                <Field label="Template name *">
                  <input
                    required
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Validity in days *">
                  <input
                    required
                    type="number"
                    min={1}
                    max={730}
                    value={draft.validityDays}
                    onChange={(e) => setDraft({ ...draft, validityDays: e.target.value })}
                  />
                </Field>
                <Field label="Template description" wide>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Field>
              </div>
              <h3 className="rubric-heading">Evaluation rubric</h3>
              {draft.rubric.map((row, i) => (
                <div className="rubric-editor" key={row.id}>
                  <Field label={`Criterion ${i + 1}`}>
                    <input
                      required
                      value={row.label}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </Field>
                  <Field label={`Weight ${i + 1} (%)`}>
                    <input
                      required
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={row.weight}
                      onChange={(e) => update(i, { weight: e.target.value })}
                    />
                  </Field>
                  <Field label={`Maximum score ${i + 1}`}>
                    <input
                      required
                      type="number"
                      min="1"
                      max="100"
                      value={row.maxScore}
                      onChange={(e) => update(i, { maxScore: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={draft.rubric.length === 1}
                    onClick={() =>
                      setDraft({ ...draft, rubric: draft.rubric.filter((_, j) => j !== i) })
                    }
                  >
                    Remove criterion {i + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                icon={Plus}
                disabled={draft.rubric.length >= 20}
                onClick={() =>
                  setDraft({
                    ...draft,
                    rubric: [...draft.rubric, { id: uid(), label: '', weight: 10, maxScore: 5 }],
                  })
                }
              >
                Add criterion
              </Button>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save template
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
