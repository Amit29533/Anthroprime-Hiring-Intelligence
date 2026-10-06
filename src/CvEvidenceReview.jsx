import React from 'react';
import { CV_SECTIONS } from './cvEvidence.js';

export function CvEvidenceReview({ value, onChange, disabled = false, label = 'CV' }) {
  if (!Array.isArray(value?.items) || !value.items.length) return null;
  const editable = Boolean(onChange);
  function update(index, patch) {
    onChange({
      ...value,
      items: value.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  return (
    <details>
      <summary>Structured CV evidence ({value.items.length})</summary>
      <p>
        These are section excerpts, not verified employment or credentials. Check each against the
        original. Edit its label or period, then confirm it, or remove it before import.
      </p>
      {value.truncated && (
        <p role="status">
          Only bounded excerpts were captured. Check the original for omitted lines.
        </p>
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
