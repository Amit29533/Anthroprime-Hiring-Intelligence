import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Badge } from './ui.jsx';
import { cloud, getRole, canWriteForRole } from './repository.js';
import { repositoryRead } from './pagedRepository.js';
import { rubricScore } from './assessmentTemplates.js';
import { today } from './domain.js';

export function CandidateScorecards({
  candidateId,
  rpc = repositoryRead,
  enabled = cloud,
  editable = canWriteForRole(getRole()),
}) {
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [templatesOffset, setTemplatesOffset] = useState(0),
    [template, setTemplate] = useState(null),
    [scores, setScores] = useState({}),
    [date, setDate] = useState(today()),
    [evidence, setEvidence] = useState('');
  const operation = useRef(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPage(null);
    setError('');
    if (!enabled) return undefined;
    Promise.resolve()
      .then(() =>
        rpc('api_candidate_scorecards', {
          p_candidate: candidateId,
          p_offset: offset,
          p_templates_offset: templatesOffset,
        }),
      )
      .then((value) => {
        if (
          !value?.candidateId ||
          !Array.isArray(value.rows) ||
          value.rows.length > 50 ||
          !Array.isArray(value.templates) ||
          value.templates.length > 50
        )
          throw new Error('Scorecards returned an invalid page.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [candidateId, rpc, enabled, revision, offset, templatesOffset]);
  function choose(next) {
    setTemplate(next || null);
    setScores({});
    setError('');
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const args = {
      p_candidate: page.candidateId,
      p_template: template.id,
      p_template_version: template.version,
      p_scores: Object.fromEntries(template.rubric.map((c) => [c.id, Number(scores[c.id])])),
      p_date: date,
      p_evidence: evidence.trim(),
    };
    const signature = JSON.stringify(args);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await rpc('api_record_candidate_scorecard', {
        ...args,
        p_operation: operation.current.id,
      });
      if (result?.id !== operation.current.id || typeof result.score !== 'number')
        throw new Error('Scorecard returned an invalid receipt.');
      if (live.current) {
        operation.current = null;
        setTemplate(null);
        setScores({});
        setEvidence('');
        setOffset(0);
        setRevision((n) => n + 1);
      }
    } catch (err) {
      if (live.current) setError(err.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  if (!enabled)
    return (
      <p>
        Sealed scorecards require a cloud workspace. Existing assessments remain available in demo
        mode.
      </p>
    );
  const score = template ? rubricScore(template.rubric, scores) : null;
  const current = page?.templates.find((t) => t.id === template?.id);
  return (
    <section aria-label="Candidate scorecards">
      <h3>Rubric scorecards</h3>
      <p>
        Record a general assessment using a frozen rubric version. Authorship and recording time are
        assigned by the server. Submitted scores and evidence are sealed; record a reassessment to
        correct them. Readiness still needs a separate administrator decision.
      </p>
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p role="status">Loading scorecards…</p>}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => setRevision((n) => n + 1)}
      >
        Refresh scorecards
      </Button>
      {page && (
        <>
          {editable && (
            <form aria-label="Record candidate scorecard" onSubmit={submit}>
              <Field label="Scorecard rubric">
                <select
                  aria-label="Scorecard rubric"
                  required
                  disabled={busy}
                  value={template ? `${template.id}:${template.version}` : ''}
                  onChange={(e) =>
                    choose(page.templates.find((t) => `${t.id}:${t.version}` === e.target.value))
                  }
                >
                  <option value="">Choose a rubric</option>
                  {page.templates.map((t) => (
                    <option key={t.id} value={`${t.id}:${t.version}`}>
                      {t.name} · v{t.version}
                    </option>
                  ))}
                </select>
              </Field>
              {!page.templates.length && (
                <p>
                  No active rubrics on this page. Administrators can create one in Settings →
                  Assessment templates.
                </p>
              )}
              <Button
                type="button"
                disabled={busy || templatesOffset === 0}
                onClick={() => setTemplatesOffset((n) => Math.max(0, n - 50))}
              >
                Previous rubric page
              </Button>
              <Button
                type="button"
                disabled={busy || !page.templatesMore}
                onClick={() => setTemplatesOffset((n) => n + 50)}
              >
                Next rubric page
              </Button>
              {template && (
                <>
                  <h4>
                    Draft rubric: {template.name} · v{template.version}
                  </h4>
                  <p>{template.description}</p>
                  {current && current.version !== template.version && (
                    <>
                      <p>
                        Rubric version changed. Review the new version and score every criterion
                        again.
                      </p>
                      <Button type="button" disabled={busy} onClick={() => choose(current)}>
                        Reload current rubric
                      </Button>
                    </>
                  )}
                  {template.rubric.map((c) => (
                    <Field
                      key={c.id}
                      label={`${c.label} (0–${c.maxScore})`}
                      hint={`${c.weight}% of the total score`}
                    >
                      <input
                        aria-label={`Score ${c.label}`}
                        type="number"
                        min="0"
                        max={c.maxScore}
                        step="0.01"
                        required
                        disabled={busy}
                        value={scores[c.id] ?? ''}
                        onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })}
                      />
                    </Field>
                  ))}
                  <p>
                    Weighted preview: {score === null ? 'Score every criterion' : `${score}/100`} ·
                    Validity: {template.validityDays} days
                  </p>
                  <Field label="Assessment date">
                    <input
                      aria-label="Assessment date"
                      type="date"
                      max={today()}
                      required
                      disabled={busy}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Scorecard evidence">
                    <textarea
                      aria-label="Scorecard evidence"
                      minLength={10}
                      maxLength={5000}
                      required
                      disabled={busy}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={
                      busy ||
                      score === null ||
                      evidence.trim().length < 10 ||
                      (current && current.version !== template.version)
                    }
                  >
                    Submit sealed scorecard
                  </Button>
                </>
              )}
            </form>
          )}
          <h4>Submitted scorecards</h4>
          {!page.rows.length && (
            <p>No sealed scorecards recorded. Earlier assessments remain in Assessments.</p>
          )}
          {page.rows.map((row) => (
            <article key={row.id}>
              <h4>
                {row.title} <Badge>v{row.templateSnapshot?.version}</Badge> · {row.score}/100
              </h4>
              <p>
                Assessed {row.date} · Valid through {row.validUntil} · Recorded {row.recordedAt} ·
                Author {row.recordedBy || 'System'}
              </p>
              <ul>
                {row.templateSnapshot?.rubric?.map((c) => (
                  <li key={c.id}>
                    {c.label}: {row.rubricScores?.[c.id]}/{c.maxScore} · {c.weight}%
                  </li>
                ))}
              </ul>
              <p>{row.evidence}</p>
            </article>
          ))}
          <Button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous scorecard page
          </Button>
          <Button
            type="button"
            disabled={busy || !page.more}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next scorecard page
          </Button>
        </>
      )}
    </section>
  );
}
