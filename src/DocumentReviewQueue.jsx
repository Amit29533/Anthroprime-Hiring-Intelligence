import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { uid } from './domain.js';
import { Button, PanelHeading } from './ui.jsx';
async function reviewRpc(name, args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || 'Document review is unavailable.');
  return data;
}
export function DocumentReviewQueue({ isCloud = cloud, rpc = reviewRpc, onReload }) {
  const [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [deferred, setDeferred] = useState(false);
  const [selected, setSelected] = useState(''),
    [decision, setDecision] = useState('keep'),
    [note, setNote] = useState(''),
    [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState(null);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setPage(null);
    setError('');
    Promise.resolve()
      .then(() => rpc('api_document_review_queue', { p_offset: offset, p_deferred: deferred }))
      .then((value) => {
        if (!Array.isArray(value?.rows) || !Number.isInteger(value.total))
          throw new Error('Invalid document review response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [isCloud, rpc, offset, revision, deferred]);
  if (!isCloud) return null;
  async function run(work) {
    setBusy(true);
    setError('');
    try {
      await work();
      setSelected('');
      setPending(null);
      setRevision((n) => n + 1);
      await onReload?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const row = page?.rows.find((r) => r.id === selected);
  return (
    <section className="panel">
      <PanelHeading
        title="Document safety and retention review"
        subtitle="Administrator review of legacy originals and due retention decisions"
      />
      <div className="settings-body">
        <p>
          Adopting an eligible R2 original removes current text/inline previews and blocks downloads
          until scanning succeeds. Refresh open tabs afterward. Supabase, inline, unsupported or
          incomplete originals need re-upload through private processing. Archive is reversible; no
          file deletion is performed.
        </p>
        {!page?.privateDocuments && (
          <p>
            Legacy adoption requires private document processing and a working scanner. Keep the
            flag off until deployment acceptance.
          </p>
        )}
        <Button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Refresh document reviews
        </Button>
        {error && <p role="alert">{error}</p>}
        <label>
          <input
            type="checkbox"
            aria-label="Include scheduled document reviews"
            checked={deferred}
            disabled={busy}
            onChange={(event) => {
              setDeferred(event.target.checked);
              setOffset(0);
              setSelected('');
            }}
          />
          Include scheduled reviews
        </label>
        {page && (
          <p>
            {page.total} documents {deferred ? 'in review inventory' : 'due for review'}
          </p>
        )}
        {page?.rows.map((record) => (
          <article key={record.id}>
            <strong>{record.name}</strong>
            <p>
              {record.owner} · {record.provider} · {record.scan} ·{' '}
              {record.removed ? 'archived' : 'active'}
              {record.decision ? ` · last decision: ${record.decision}` : ''}
            </p>
            {record.note && <p>Last reason: {record.note}</p>}
            {record.eligible && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(() => rpc('api_adopt_legacy_document', { p_document: record.id }))
                }
              >
                Quarantine legacy original {record.name}
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                setSelected(record.id);
                setDecision(record.decision === 'hold' ? 'hold' : 'keep');
                setNote('');
                setDays(30);
                setPending(null);
              }}
            >
              Review retention {record.name}
            </Button>
          </article>
        ))}
        {row && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const args = {
                  p_document: row.id,
                  p_decision: decision,
                  p_note: note,
                  p_days: Number(days),
                };
                const same = pending && JSON.stringify(pending.args) === JSON.stringify(args);
                const request = same ? pending.request : uid();
                setPending({ args, request });
                await rpc('api_review_document_retention', { ...args, p_request: request });
              });
            }}
          >
            <h3>Retention: {row.name}</h3>
            {row.decision === 'hold' && (
              <p>
                A hold remains active until an administrator records keep to release it. A review
                due date does not expire the hold.
              </p>
            )}
            <label>
              Decision
              <select
                aria-label="Retention decision"
                value={decision}
                disabled={busy}
                onChange={(event) => setDecision(event.target.value)}
              >
                <option value="keep">Keep / release hold</option>
                <option value="hold">Hold</option>
                <option value="archive" disabled={row.decision === 'hold'}>
                  Archive
                </option>
              </select>
            </label>
            <label>
              Reason
              <textarea
                aria-label="Retention reason"
                value={note}
                required
                maxLength={1000}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <label>
              Review again in days
              <input
                aria-label="Retention review days"
                type="number"
                value={days}
                min={1}
                max={3650}
                required
                disabled={busy}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !note.trim()}>
              Record retention decision
            </Button>
          </form>
        )}
        <div className="section-toolbar">
          <Button
            disabled={busy || offset === 0}
            onClick={() => {
              setSelected('');
              setOffset((n) => Math.max(0, n - 50));
            }}
          >
            Previous document reviews
          </Button>
          <Button
            disabled={busy || !page || offset + 50 >= page.total}
            onClick={() => {
              setSelected('');
              setOffset((n) => n + 50);
            }}
          >
            Next document reviews
          </Button>
        </div>
      </div>
    </section>
  );
}
