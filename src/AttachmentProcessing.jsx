import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { persistBinary, sha256 } from './documents.js';
import { Button } from './ui.jsx';
async function rpc(name, args) {
  const client = await getSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error('Document processing status is unavailable.');
  return data;
}
export function AttachmentProcessing({
  record,
  readOnly = false,
  onSave,
  isCloud = cloud,
  read = rpc,
  upload = persistBinary,
}) {
  const [state, setState] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const rows = await read('api_attachment_status', { p_ids: [record.id] });
    if (!Array.isArray(rows)) throw new Error('Invalid attachment status response.');
    setState(rows[0] || null);
  }
  useEffect(() => {
    let active = true;
    setState(null);
    setError('');
    if (isCloud && record.scanRequired) {
      Promise.resolve(read('api_attachment_status', { p_ids: [record.id] }))
        .then((rows) => {
          if (!Array.isArray(rows)) throw new Error('Invalid attachment status response.');
          if (active) setState(rows[0] || null);
        })
        .catch((err) => {
          if (active) setError(err.message);
        });
    }
    return () => {
      active = false;
    };
  }, [isCloud, record.id, record.scanRequired, read]);
  const recoverOriginal =
    !record.scanRequired && record.stored === false && Boolean(record.storageError && record.hash);
  if (!isCloud || (!record.scanRequired && !recoverOriginal)) return null;
  async function run(work) {
    setBusy(true);
    setError('');
    try {
      await work();
      if (record.scanRequired) await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {state && (
        <small className="block">
          Private scan: {state.scan} · text processing: {state.parse}
        </small>
      )}
      {record.parserMethod === 'ocr' && (
        <small className="block">
          OCR via {record.parserEngine}. Verify extracted text against the original.
        </small>
      )}
      {state?.parse === 'parsed' && (
        <small className="block">Refresh the workspace to load the extracted evidence.</small>
      )}
      {state?.scan === 'infected' && (
        <small className="block">File blocked. Archive it and upload a corrected original.</small>
      )}
      {record.scanRequired && (
        <Button
          variant="ghost"
          className="small"
          disabled={busy}
          onClick={() => run(async () => {})}
        >
          Refresh processing {record.name}
        </Button>
      )}
      {!readOnly && state && (state.retryable || state.parse === 'failed') && (
        <Button
          disabled={busy}
          onClick={() => run(() => read('api_retry_attachment', { p_id: record.id }))}
        >
          Retry processing {record.name}
        </Button>
      )}
      {!readOnly && ((state && !state.uploaded) || recoverOriginal) && (
        <label>
          Resume original upload{' '}
          <input
            aria-label={`Resume attachment ${record.name}`}
            type="file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                run(async () => {
                  if (
                    file.name !== record.name ||
                    file.size !== record.size ||
                    (await sha256(await file.arrayBuffer())) !== record.hash
                  )
                    throw new Error(
                      'Choose the original file with the saved name, size and fingerprint.',
                    );
                  const updated = await upload({ ...record }, file);
                  if (onSave && !(await onSave('documents', [updated])))
                    throw new Error(
                      'Original uploaded. Refresh the workspace to recover its saved record.',
                    );
                });
            }}
          />
        </label>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
