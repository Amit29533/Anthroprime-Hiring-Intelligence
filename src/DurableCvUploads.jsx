import React, { useState, useEffect } from 'react';
import { Button } from './ui.jsx';
import { uid } from './domain.js';
import { importRpc } from './durableImports.js';
import { cvManifest, uploadSavedCv } from './durableCv.js';

// The durable manifest is saved before any binary PUT; reopening it requires no browser state.
export function DurableCvUploads({ rpc = importRpc, upload = uploadSavedCv, onSaved }) {
  const [batch, setBatch] = useState(''),
    [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function run(work) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh(id = batch) {
    const result = await rpc('api_cv_files', { p_batch: id });
    if (!Array.isArray(result))
      throw new Error('CV status returned an invalid response. Check the CV staging migration.');
    setFiles(result);
  }
  return (
    <section className="panel">
      <div className="settings-body">
        <h3>Save CVs for background extraction</h3>
        <p>
          Private originals are saved before parsing. Review the resulting rows in Saved imports
          before approval. Originals remain quarantined until private antivirus scanning succeeds.
          Image-only PDFs need private OCR enabled or manual entry.
        </p>
        {error && <p role="alert">{error}</p>}
        <label className="file-drop">
          <strong>Choose CV files to save</strong>
          <span>Up to 20 files · PDF, DOCX, TXT, MD or CSV · 5 MB each</span>
          <input
            aria-label="Save CV files"
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv"
            disabled={busy}
            onChange={(e) => {
              const chosen = [...e.target.files];
              e.target.value = '';
              if (!chosen.length) return;
              const id = uid();
              setBatch(id);
              setFiles([]);
              run(async () => {
                await rpc('api_create_cv_import', { p_id: id, p_files: await cvManifest(chosen) });
                await refresh(id);
                for (let i = 0; i < chosen.length; i++) await upload(id, i + 1, chosen[i], { rpc });
                await refresh(id);
                onSaved?.();
              });
            }}
          />
        </label>
        {batch && (
          <>
            <Button disabled={busy} onClick={() => run(() => refresh())}>
              Refresh CV processing
            </Button>
            <p role="status">
              {busy
                ? 'Saving original CVs…'
                : 'You can close this page once files are queued. Refresh Saved imports after extraction to review drafts.'}
            </p>
            {files.map((file) => (
              <p key={file.id}>
                {file.name} · {file.state} · scan: {file.scan_status || 'pending'}{' '}
                {file.parserMethod === 'ocr' ? ' · OCR text: verify extracted fields.' : ''}{' '}
                {file.warning}
                {['uploading', 'failed'].includes(file.state) && (
                  <label>
                    {' '}
                    Retry with original file{' '}
                    <input
                      aria-label={`Retry ${file.name}`}
                      type="file"
                      disabled={busy}
                      onChange={(e) => {
                        const original = e.target.files?.[0];
                        e.target.value = '';
                        if (original)
                          run(async () => {
                            await upload(batch, file.row_no, original, { rpc });
                            await refresh();
                            onSaved?.();
                          });
                      }}
                    />
                  </label>
                )}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

export function SavedCvFiles({ batch, rpc = importRpc, upload = uploadSavedCv, onChanged }) {
  const [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFiles([]);
    setError('');
    Promise.resolve()
      .then(() => rpc('api_cv_files', { p_batch: batch.id }))
      .then((result) => {
        if (!Array.isArray(result)) throw new Error('CV status returned an invalid response.');
        if (active) setFiles(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [batch.id, batch.version, rpc, revision]);
  return (
    <div>
      <p>
        CV originals: review extracted fields before saving each included row. Files marked manual
        need typed details. Quarantined files cannot be extracted, approved or downloaded.
      </p>
      {error && <p role="alert">{error}</p>}
      {files.map((file) => (
        <p key={file.id}>
          {file.name} · {file.state} · scan: {file.scan_status || 'pending'}{' '}
          {file.parserMethod === 'ocr' ? ' · OCR text: verify extracted fields.' : ''}{' '}
          {file.warning}
          {batch.status === 'draft' && ['error', 'scanning'].includes(file.scan_status) && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await rpc('api_retry_cv_scan', { p_batch: batch.id, p_row: file.row_no });
                  setRevision((n) => n + 1);
                  onChanged?.();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry scan {file.name}
            </Button>
          )}
          {batch.status === 'draft' && ['uploading', 'failed'].includes(file.state) && (
            <label>
              {' '}
              Resume with original file{' '}
              <input
                aria-label={`Resume CV ${file.name}`}
                type="file"
                disabled={busy}
                onChange={async (e) => {
                  const original = e.target.files?.[0];
                  e.target.value = '';
                  if (!original) return;
                  setBusy(true);
                  setError('');
                  try {
                    await upload(batch.id, file.row_no, original, { rpc });
                    setRevision((n) => n + 1);
                    onChanged?.();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          )}
        </p>
      ))}
    </div>
  );
}
