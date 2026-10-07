import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
const labels = {
  records: 'Profiles and linked records',
  originals: 'Original files and extracted text',
  history: 'Linked history and audit records',
  integrations: 'Mappings, vectors and jobs',
  platform_records: 'Private imports, governance and provider receipts',
  external_copies: 'Unlinked applications, referrals, provider systems and downloaded copies',
  backups: 'Backups and restore handling',
};
export function ErasureReview({
  caseRecord,
  rpc,
  onChanged,
  busy: externalBusy = false,
  onBusyChange,
}) {
  const [page, setPage] = useState(null),
    [note, setNote] = useState(''),
    [choices, setChoices] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(null);
  const active = ['in_review', 'awaiting_action'].includes(caseRecord.status);
  useEffect(() => {
    let mounted = true;
    setPage(null);
    setChoices({});
    setError('');
    if (active)
      Promise.resolve()
        .then(() => rpc('api_erasure_review', { p_id: caseRecord.id }))
        .then((value) => {
          if (!Array.isArray(value?.rows))
            throw new Error('Erasure review is unavailable. Apply the erasure-scope migration.');
          if (mounted) setPage(value);
        })
        .catch((e) => {
          if (mounted) setError(e.message);
        });
    return () => {
      mounted = false;
    };
  }, [active, caseRecord.id, caseRecord.version, rpc]);
  const disabled = busy || externalBusy || note.trim().length < 10;
  async function mutate(name, fields = {}) {
    if (busy || externalBusy) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const args = {
        p_id: caseRecord.id,
        p_version: caseRecord.version,
        p_note: note.trim(),
        ...fields,
      };
      const fingerprint = JSON.stringify([name, args]);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      const receipt = await rpc(name, { ...args, p_operation: pending.current.id });
      if (receipt?.id !== caseRecord.id || !Number.isInteger(receipt.version))
        throw new Error('Review receipt is incomplete. Retry the same action.');
      pending.current = null;
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <section aria-label="Erasure impact review">
      <h4>Erasure impact and fulfillment review</h4>
      <p>
        Capture counts for the current identity and its retired merged identities. Record approved
        work evidence or a retention-policy reference for each area. These are administrator
        attestations; this workflow does not delete data or confirm provider cleanup.
      </p>
      {error && <p role="alert">{error}</p>}
      {!active ? (
        <p>Verify identity and start the erasure case review first.</p>
      ) : (
        <>
          <Field label="Erasure evidence or retention reference">
            <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button disabled={disabled} onClick={() => mutate('api_capture_erasure_scope')}>
            Capture current erasure scope
          </Button>
          <p>
            Each capture resets all seven decisions. After manual work changes data, capture the
            final scope and reconcile evidence again. Once a checklist exists, pending decisions or
            changed database scope block closure.
          </p>
          {page?.review && (
            <>
              <p>
                Captured {page.review.createdAt} · {page.review.inventory.identities} identities ·{' '}
                {page.review.inventory.total} identified database records
              </p>
              {!page.review.currentVerification && (
                <p>Capture scope for the current verification before recording outcomes.</p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Record category</th>
                    <th>Count at capture</th>
                  </tr>
                </thead>
                <tbody>
                  {page.review.inventory.counts.map((r) => (
                    <tr key={r.category}>
                      <td>{r.category}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Counts cover identified database links only. Private platform records, unlinked
                records, external copies and backups require manual inventory. File counts describe
                metadata, not verified object existence or deletion.
              </p>
              {page.rows.map((row) => (
                <fieldset
                  key={row.area}
                  disabled={busy || externalBusy || !page.review.currentVerification}
                >
                  <legend>{labels[row.area] || row.area}</legend>
                  <p>
                    {row.decision}
                    {row.reference ? ` · ${row.reference}` : ''}
                  </p>
                  <Field label={`Outcome for ${row.area}`}>
                    <select
                      value={choices[row.area] || ''}
                      onChange={(e) => setChoices((v) => ({ ...v, [row.area]: e.target.value }))}
                    >
                      <option value="">Choose an outcome</option>
                      <option value="completed">Work completed — evidence recorded</option>
                      <option value="retained">Retained — policy reference recorded</option>
                      <option value="not_applicable">Not applicable — rationale recorded</option>
                    </select>
                  </Field>
                  <Button
                    disabled={disabled || !choices[row.area]}
                    onClick={() =>
                      mutate('api_review_erasure_area', {
                        p_review: page.review.id,
                        p_area: row.area,
                        p_decision: choices[row.area],
                      })
                    }
                  >
                    Record outcome for {row.area}
                  </Button>
                </fieldset>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
