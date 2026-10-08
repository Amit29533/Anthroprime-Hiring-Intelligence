import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { prepareSubjectAccess } from './subjectAccess.js';

export function SubjectAccessReview({
  caseRecord,
  rpc,
  onChanged,
  busy: externalBusy = false,
  onBusyChange,
}) {
  const [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [choices, setChoices] = useState({}),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const active = ['in_review', 'awaiting_action'].includes(caseRecord.status);
  useEffect(() => {
    let mounted = true;
    setPage(null);
    setChoices({});
    setError('');
    if (!active)
      return () => {
        mounted = false;
      };
    Promise.resolve()
      .then(() => rpc('api_subject_access_page', { p_id: caseRecord.id, p_offset: offset }))
      .then((value) => {
        if (!Array.isArray(value?.rows) || !Number.isInteger(value.total))
          throw new Error('Access review is unavailable. Apply the access-package migration.');
        if (mounted) setPage(value);
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      });
    return () => {
      mounted = false;
    };
  }, [caseRecord.id, caseRecord.version, offset, rpc, active]);
  const disabled = busy || externalBusy || note.trim().length < 10;
  async function mutate(name, extra = {}) {
    if (busy || externalBusy) return;
    setError('');
    setBusy(true);
    onBusyChange?.(true);
    try {
      const args = {
        p_id: caseRecord.id,
        p_version: caseRecord.version,
        p_note: note.trim(),
        ...extra,
      };
      const fingerprint = JSON.stringify([name, args]);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      args.p_operation = pending.current.id;
      const result =
        name === 'api_prepare_subject_access_package'
          ? await prepareSubjectAccess(args, { rpc })
          : await rpc(name, args);
      if (result?.id !== caseRecord.id || !Number.isInteger(result.version))
        throw new Error('Access review receipt is incomplete. Retry this action.');
      pending.current = null;
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  function save() {
    try {
      const decisions = page.rows
        .filter((row) => choices[`${row.category}:${row.id}`]?.decision)
        .map((row) => {
          const choice = choices[`${row.category}:${row.id}`];
          return {
            category: row.category,
            id: row.id,
            decision: choice.decision,
            ...(choice.decision === 'redact' ? { data: JSON.parse(choice.text) } : {}),
          };
        });
      if (!decisions.length) throw new Error('Choose at least one record decision.');
      void mutate('api_review_subject_access_rows', {
        p_review: page.review.id,
        p_decisions: decisions,
      });
    } catch {
      setError('Choose record decisions and provide valid JSON for every redaction.');
    }
  }
  return (
    <section aria-label="Reviewed access package">
      <h4>Reviewed access package</h4>
      <p>
        Review each record for third-party information before disclosure. This package covers direct
        candidate records only. Original files, raw CV extraction, custom fields and retired merged
        identities need separate review. Preparation does not confirm delivery or complete the
        request.
      </p>
      {error && <p role="alert">{error}</p>}
      {!active ? (
        <p>Verify identity and start the access case review to prepare a package.</p>
      ) : (
        <>
          <Field label="Access review reference">
            <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button disabled={disabled} onClick={() => mutate('api_start_subject_access_review')}>
            Create fresh access snapshot
          </Button>
          <p>A fresh snapshot clears earlier review copies. Copies expire after seven days.</p>
          {page?.review && (
            <>
              <p>
                {page.review.state} · {page.pending} pending of {page.total} records · expires{' '}
                {page.review.expiresAt}
              </p>
              {page.rows.map((row) => {
                const key = `${row.category}:${row.id}`,
                  choice = choices[key] || {
                    decision: '',
                    text: JSON.stringify(row.approved || row.data, null, 2),
                  };
                return (
                  <fieldset
                    key={key}
                    disabled={busy || externalBusy || page.review.state !== 'draft'}
                  >
                    <legend>
                      {row.category} · {row.id} · {row.decision}
                    </legend>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(row.data, null, 2)}
                    </pre>
                    <Field label={`Decision for ${row.category} ${row.id}`}>
                      <select
                        value={choice.decision}
                        onChange={(e) =>
                          setChoices((v) => ({
                            ...v,
                            [key]: { ...choice, decision: e.target.value },
                          }))
                        }
                      >
                        <option value="">Choose a decision</option>
                        <option value="include">Include</option>
                        <option value="redact">Redact</option>
                        <option value="withhold">Withhold</option>
                      </select>
                    </Field>
                    {choice.decision === 'redact' && (
                      <Field label={`Redacted JSON for ${row.category} ${row.id}`}>
                        <textarea
                          value={choice.text}
                          onChange={(e) =>
                            setChoices((v) => ({
                              ...v,
                              [key]: { ...choice, text: e.target.value },
                            }))
                          }
                        />
                      </Field>
                    )}
                  </fieldset>
                );
              })}
              {page.review.state === 'draft' && (
                <Button
                  disabled={disabled || !Object.values(choices).some((c) => c.decision)}
                  onClick={save}
                >
                  Save record decisions
                </Button>
              )}
              <Button
                disabled={
                  disabled ||
                  page.pending !== 0 ||
                  !['draft', 'prepared'].includes(page.review.state)
                }
                onClick={() =>
                  mutate('api_prepare_subject_access_package', { p_review: page.review.id })
                }
              >
                Prepare and download JSON package
              </Button>
              <div>
                <Button
                  disabled={busy || externalBusy || offset === 0}
                  onClick={() => setOffset((n) => Math.max(0, n - 25))}
                >
                  Previous access records
                </Button>
                <Button
                  disabled={
                    busy ||
                    externalBusy ||
                    offset + 25 >= page.total ||
                    page.review.state === 'unavailable'
                  }
                  onClick={() => setOffset((n) => n + 25)}
                >
                  Next access records
                </Button>
              </div>
              {(page.packages || []).map((p) => (
                <div key={p.id}>
                  <p>
                    Package {p.id} · {p.preparedAt} · {p.included} included · {p.withheld} withheld
                    · SHA-256 {p.sha256}
                  </p>
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      mutate('api_record_subject_access_delivery', { p_package: p.id })
                    }
                  >
                    Record delivery reference for {p.id}
                  </Button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
