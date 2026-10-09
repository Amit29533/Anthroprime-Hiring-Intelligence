import './completion.css';
import React from 'react';
import {
  CV_SECTIONS,
  groupCvEvidence,
  mergeCvRecords,
  validateCvRecords,
  duplicateCvRecords,
  readableCvExcerpt,
  readableCvRecords,
} from './cvEvidence.js';

export function CvEvidenceReview({ value, onChange, disabled = false, label = 'CV' }) {
  if (!Array.isArray(value?.items) || !value.items.length) return null;
  if (!value.items.every(readableCvExcerpt))
    return (
      <p role="alert">
        {label} excerpts have an invalid structure. Re-extract the original before review.
      </p>
    );
  const editable = Boolean(onChange);
  const hasRecords = value.records !== undefined;
  const recordsReadable = readableCvRecords(value);
  function update(index, patch) {
    onChange({
      ...value,
      ...(patch.reviewed === false && recordsReadable
        ? { records: value.records.map((record) => ({ ...record, reviewed: false })) }
        : {}),
      items: value.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  return (
    <details className="cv-record-review">
      <summary>
        Structured {label} evidence ({value.items.length})
      </summary>
      <p>
        These are section excerpts, not verified employment or credentials. Check each against the
        original. Edit its label or period, then confirm it, or remove it before import.
      </p>
      {value.truncated && (
        <p role="status">
          Only bounded excerpts were captured. Check the original for omitted lines.
        </p>
      )}
      {editable && !hasRecords && (
        <button type="button" disabled={disabled} onClick={() => onChange(groupCvEvidence(value))}>
          Build cited {label} records
        </button>
      )}
      {hasRecords && !recordsReadable && (
        <section aria-label="Invalid CV records">
          <p role="alert">
            {label} records have an invalid structure. Rebuild the grouping from the original
            excerpts before review.
          </p>
          {editable && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(groupCvEvidence(value))}
            >
              Rebuild cited {label} records
            </button>
          )}
        </section>
      )}
      {recordsReadable && (
        <section aria-label={`Cited ${label} records`}>
          <p>
            Merge related lines, then enter only dates stated in the original. Partial dates are
            supported. These remain recruiter-reviewed {label} claims.
          </p>
          {validateCvRecords(value) && <p role="alert">{validateCvRecords(value)}</p>}
          {duplicateCvRecords(value).length > 0 && (
            <p role="status">
              Possible duplicate records: {duplicateCvRecords(value).join(', ')}. Check before
              importing.
            </p>
          )}
          {value.records.map((record, index) => (
            <article key={index}>
              <h4>
                {record.section} record {index + 1}
              </h4>
              <small>Cited text lines {record.sourceLines.join(', ')}</small>
              {value.items
                .filter((item) => record.sourceLines.includes(item.sourceLine))
                .map((item) => (
                  <blockquote key={item.sourceLine}>{item.evidence}</blockquote>
                ))}
              {editable ? (
                <>
                  {['label', 'organization', 'start', 'end'].map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        aria-label={`${label} record ${field} ${index + 1}`}
                        maxLength={field === 'start' || field === 'end' ? 10 : 160}
                        disabled={disabled}
                        value={record[field]}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            records: value.records.map((r, i) =>
                              i === index
                                ? { ...r, [field]: event.target.value, reviewed: false }
                                : r,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  {['ongoing', 'reviewed'].map((field) => (
                    <label key={field}>
                      <input
                        type="checkbox"
                        aria-label={`${label} record ${field} ${index + 1}`}
                        checked={record[field]}
                        disabled={
                          disabled || (field === 'reviewed' && Boolean(validateCvRecords(value)))
                        }
                        onChange={(event) =>
                          onChange({
                            ...value,
                            records: value.records.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    [field]: event.target.checked,
                                    ...(field === 'ongoing' ? { reviewed: false } : {}),
                                  }
                                : r,
                            ),
                          })
                        }
                      />
                      {field === 'reviewed' ? 'Checked record against original' : 'Ongoing'}
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={disabled || value.records[index + 1]?.section !== record.section}
                    onClick={() => onChange(mergeCvRecords(value, index))}
                  >
                    Merge next into record {index + 1}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onChange({ ...value, records: value.records.filter((_, i) => i !== index) })
                    }
                  >
                    Remove record {index + 1}
                  </button>
                </>
              ) : (
                <p>
                  {record.label} · {record.organization || 'Organization unspecified'} ·{' '}
                  {record.start || 'Start unspecified'} –{' '}
                  {record.ongoing ? 'Ongoing' : record.end || 'End unspecified'} ·{' '}
                  {record.reviewed ? 'Recruiter-reviewed claim' : 'Review pending'}
                </p>
              )}
            </article>
          ))}
        </section>
      )}
      {CV_SECTIONS.map(
        (section) =>
          value.items.some((item) => item.section === section) && (
            <section key={section}>
              <h4>{section}</h4>
              {value.items.map(
                (item, index) =>
                  item.section === section && (
                    <article key={index}>
                      <blockquote>{item.evidence}</blockquote>
                      <small>Extracted text line {item.sourceLine}</small>
                      {editable ? (
                        <>
                          <label>
                            Label
                            <input
                              aria-label={`${label} evidence label ${index + 1}`}
                              value={item.label}
                              maxLength={160}
                              disabled={disabled}
                              onChange={(event) =>
                                update(index, { label: event.target.value, reviewed: false })
                              }
                            />
                          </label>
                          <label>
                            Period
                            <input
                              aria-label={`${label} evidence period ${index + 1}`}
                              value={item.period}
                              maxLength={80}
                              disabled={disabled}
                              onChange={(event) =>
                                update(index, { period: event.target.value, reviewed: false })
                              }
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`${label} confirm evidence ${index + 1}`}
                              checked={item.reviewed === true}
                              disabled={disabled}
                              onChange={(event) =>
                                update(index, { reviewed: event.target.checked })
                              }
                            />
                            Checked against original
                          </label>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              onChange({
                                ...value,
                                ...(value.records ? { records: [] } : {}),
                                items: value.items.filter((_, i) => i !== index),
                              })
                            }
                          >
                            Remove excerpt {index + 1}
                          </button>
                        </>
                      ) : (
                        <p>
                          {item.label}
                          {item.period ? ` · ${item.period}` : ''} ·{' '}
                          {item.reviewed === true ? 'Recruiter-reviewed excerpt' : 'Review pending'}
                        </p>
                      )}
                    </article>
                  ),
              )}
            </section>
          ),
      )}
    </details>
  );
}
