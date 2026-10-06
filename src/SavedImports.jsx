import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { cloud } from './repository.js';
import { importRpc } from './durableImports.js';
import { Button, PanelHeading } from './ui.jsx';
import { exportSensitiveFile } from './downloads.js';
import { SavedCvFiles } from './DurableCvUploads.jsx';
import { CvEvidenceReview } from './CvEvidenceReview.jsx';
import { evidenceReady } from './cvEvidence.js';
const EXTRA_FIELDS = [
  'title',
  'company',
  'location',
  'linkedin',
  'experience',
  'relevantExperience',
  'notice',
  'current',
  'expected',
  'skills',
  'status',
  'mode',
  'source',
  'engagement',
];
const NUMERIC_FIELDS = ['experience', 'relevantExperience', 'notice', 'current', 'expected'];

export function SavedImports({ isCloud = cloud, rpc = importRpc, onReload, notify, onResume }) {
  const [editingRow, setEditingRow] = useState(null);
  const [batches, setBatches] = useState([]),
    [total, setTotal] = useState(0);
  const [listOffset, setListOffset] = useState(0),
    [selected, setSelected] = useState(''),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setError('');
    setPage(null);
    Promise.resolve()
      .then(() =>
        rpc('api_import_page', {
          p_batch: selected || null,
          p_offset: selected ? offset : listOffset,
        }),
      )
      .then((value) => {
        if (!active) return;
        if (
          selected
            ? !value?.batch || !Array.isArray(value.rows) || !value.counts
            : !Array.isArray(value?.batches)
        )
          throw new Error(
            'Saved imports returned an invalid response. Refresh or check the database migration.',
          );
        if (selected) setPage(value);
        else {
          setBatches(value.batches);
          setTotal(value.total);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [isCloud, rpc, selected, offset, listOffset, refresh]);
  if (!isCloud) return null;
  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setEditingRow(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function action(value) {
    await rpc('api_import_action', {
      p_batch: selected,
      p_version: page.batch.version,
      p_action: value,
    });
  }
  async function exportErrors() {
    const rows = [];
    for (let start = 0; start < page.batch.total; start += 50) {
      const value = await rpc('api_import_page', { p_batch: selected, p_offset: start });
      for (const row of value.rows.filter((r) =>
        ['failed', 'duplicate', 'excluded'].includes(r.status),
      ))
        rows.push({ sourceLine: row.sourceLine, status: row.status, error: row.error });
    }
    exportSensitiveFile(
      Papa.unparse(rows, { escapeFormulae: true }),
      'ecod-saved-import-errors.csv',
      'text/csv;charset=utf-8',
      notify,
    );
  }
  return (
    <section className="panel">
      <PanelHeading
        title="Saved imports"
        subtitle="Resume review or check background import progress"
      />
      <div className="settings-body">
        <div className="section-toolbar">
          <Button disabled={busy || editingRow !== null} onClick={() => setRefresh((n) => n + 1)}>
            Refresh saved imports
          </Button>
          {selected && (
            <Button
              disabled={busy || editingRow !== null}
              variant="secondary"
              onClick={() => {
                setSelected('');
                setOffset(0);
              }}
            >
              Back to imports
            </Button>
          )}
          {onReload && (
            <Button
              disabled={busy || editingRow !== null}
              variant="secondary"
              onClick={() => run(onReload)}
            >
              Refresh repository
            </Button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {!selected && (
          <>
            {batches.length === 0 && !error && <p>No saved imports.</p>}
            {batches.map((b) => (
              <p key={b.id}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSelected(b.id);
                    setOffset(0);
                  }}
                >
                  {b.name}
                </Button>{' '}
                · {b.status} · {b.total} rows
              </p>
            ))}
            <Button
              disabled={listOffset === 0 || busy}
              onClick={() => setListOffset((n) => Math.max(0, n - 10))}
            >
              Previous imports
            </Button>
            <Button
              disabled={listOffset + 10 >= total || busy}
              onClick={() => setListOffset((n) => n + 10)}
            >
              Next imports
            </Button>
          </>
        )}
        {selected && !page && !error && <p role="status">Loading saved review…</p>}
        {page && (
          <>
            <p>
              <strong>{page.batch.name}</strong> · {page.batch.status} · {page.saved} /{' '}
              {page.batch.total} rows saved
            </p>
            {page.batch.mapping?._kind === 'cv' && (
              <SavedCvFiles
                batch={page.batch}
                rpc={rpc}
                onChanged={() => setRefresh((n) => n + 1)}
              />
            )}
            <p>
              {Object.entries(page.counts)
                .map(([state, n]) => `${state}: ${n}`)
                .join(' · ')}
            </p>
            {page.saved < page.batch.total && (
              <p>
                Upload was interrupted before every draft was saved. Return to the original import
                review to retry saving; this incomplete batch cannot be approved.
              </p>
            )}
            {page.batch.status === 'draft' && page.saved < page.batch.total && onResume && (
              <Button disabled={busy || editingRow !== null} onClick={() => onResume(page.batch)}>
                Resume staging this spreadsheet
              </Button>
            )}
            {editingRow !== null && (
              <p role="status">Save edited row {editingRow} before approving or changing pages.</p>
            )}
            {page.batch.status === 'queued' && (
              <p>
                Approved rows run in the background. You can close this page. Refresh to see
                progress.
              </p>
            )}
            {page.batch.status === 'paused' && (
              <p>
                The approving user no longer has editor access. An editor must reopen, review and
                approve the batch.
              </p>
            )}
            {page.rows.map((row) => (
              <div className="cv-review-card" key={row.row}>
                <p>
                  Source line {row.sourceLine} · {row.status}
                  {row.error && ` · ${row.error}`}
                </p>
                <div className="form-grid">
                  {['name', 'email', 'phone'].map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        aria-label={`${field} for saved row ${row.row}`}
                        value={row.candidate[field] || ''}
                        disabled={
                          busy ||
                          (editingRow !== null && editingRow !== row.row) ||
                          page.batch.status !== 'draft' ||
                          !['draft', 'excluded', 'failed'].includes(row.status)
                        }
                        onChange={(e) => {
                          setEditingRow(row.row);
                          setPage({
                            ...page,
                            rows: page.rows.map((r) =>
                              r.row === row.row
                                ? { ...r, candidate: { ...r.candidate, [field]: e.target.value } }
                                : r,
                            ),
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <details>
                  <summary>Other imported fields</summary>
                  <div className="form-grid">
                    {EXTRA_FIELDS.map((field) => (
                      <label key={field}>
                        {field}
                        <input
                          aria-label={`${field} for saved row ${row.row}`}
                          type={NUMERIC_FIELDS.includes(field) ? 'number' : 'text'}
                          step={field === 'notice' ? '1' : 'any'}
                          value={
                            field === 'skills'
                              ? (Array.isArray(row.candidate.skills)
                                  ? row.candidate.skills
                                  : []
                                ).join(', ')
                              : (row.candidate[field] ?? '')
                          }
                          disabled={
                            busy ||
                            (editingRow !== null && editingRow !== row.row) ||
                            page.batch.status !== 'draft' ||
                            !['draft', 'excluded', 'failed'].includes(row.status)
                          }
                          onChange={(e) => {
                            setEditingRow(row.row);
                            const value =
                              field === 'skills'
                                ? e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                : NUMERIC_FIELDS.includes(field)
                                  ? e.target.value === ''
                                    ? null
                                    : Number(e.target.value)
                                  : e.target.value;
                            setPage({
                              ...page,
                              rows: page.rows.map((r) =>
                                r.row === row.row
                                  ? { ...r, candidate: { ...r.candidate, [field]: value } }
                                  : r,
                              ),
                            });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <CvEvidenceReview
                  value={row.candidate.cvEvidence}
                  label={`Row ${row.row}`}
                  disabled={
                    busy ||
                    (editingRow !== null && editingRow !== row.row) ||
                    page.batch.status !== 'draft' ||
                    !['draft', 'excluded', 'failed'].includes(row.status)
                  }
                  onChange={
                    page.batch.status === 'draft'
                      ? (value) => {
                          setEditingRow(row.row);
                          setPage({
                            ...page,
                            rows: page.rows.map((r) =>
                              r.row === row.row
                                ? { ...r, candidate: { ...r.candidate, cvEvidence: value } }
                                : r,
                            ),
                          });
                        }
                      : undefined
                  }
                />
                {!evidenceReady(row.candidate.cvEvidence) && (
                  <p>Confirm or remove every CV excerpt before including this row.</p>
                )}
                {page.batch.status === 'draft' &&
                  ['draft', 'excluded', 'failed'].includes(row.status) && (
                    <Button
                      disabled={
                        busy ||
                        !evidenceReady(row.candidate.cvEvidence) ||
                        (editingRow !== null && editingRow !== row.row)
                      }
                      onClick={() =>
                        run(async () => {
                          await rpc('api_stage_import', {
                            p_batch: selected,
                            p_version: page.batch.version,
                            p_rows: [{ ...row, error: '', candidate: row.candidate }],
                          });
                        })
                      }
                    >
                      Save corrected row {row.row}
                    </Button>
                  )}
                {page.batch.mapping?._kind === 'cv' &&
                  page.batch.status === 'draft' &&
                  ['draft', 'excluded', 'failed'].includes(row.status) && (
                    <Button
                      variant="secondary"
                      disabled={busy || editingRow !== null}
                      onClick={() =>
                        run(() =>
                          rpc('api_stage_import', {
                            p_batch: selected,
                            p_version: page.batch.version,
                            p_rows: [{ ...row, error: 'Excluded by reviewer.' }],
                          }),
                        )
                      }
                    >
                      Exclude CV row {row.row}
                    </Button>
                  )}
              </div>
            ))}
            <div className="section-toolbar">
              <Button
                disabled={busy || editingRow !== null || offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                Previous import rows
              </Button>
              <Button
                disabled={busy || editingRow !== null || offset + 50 >= page.saved}
                onClick={() => setOffset((n) => n + 50)}
              >
                Next import rows
              </Button>
              {page.batch.status === 'draft' && (
                <Button
                  disabled={busy || editingRow !== null || page.saved !== page.batch.total}
                  onClick={() => run(() => action('approve'))}
                >
                  Approve background import
                </Button>
              )}
              {['completed', 'paused'].includes(page.batch.status) && (
                <Button
                  disabled={busy || !(page.counts.failed || page.counts.pending)}
                  onClick={() => run(() => action('reopen'))}
                >
                  Reopen failed rows
                </Button>
              )}
              {['draft', 'queued', 'paused'].includes(page.batch.status) && (
                <Button
                  disabled={busy || editingRow !== null}
                  variant="secondary"
                  onClick={() => run(() => action('cancel'))}
                >
                  Cancel remaining import
                </Button>
              )}
              <Button
                disabled={busy || editingRow !== null}
                variant="secondary"
                onClick={() => run(exportErrors)}
              >
                Download saved error report
              </Button>
            </div>
            <p>
              Completed candidates are kept when a batch is cancelled or reopened. Drafts are not
              imported until explicitly approved. Duplicate rows are skipped; nothing is merged
              automatically.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
