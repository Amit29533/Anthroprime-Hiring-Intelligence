import { AttachmentProcessing } from './AttachmentProcessing.jsx';
import React, { useState } from 'react';
import { FileText, Upload, Archive, RotateCcw } from 'lucide-react';
import { Button, PanelHeading, Badge, Empty, Field } from './ui.jsx';
import { cloud, getRole } from './repository.js';
import {
  classifyFile,
  contentSignatureOk,
  sha256,
  buildDocumentRecord,
  persistBinary,
  signedUrlFor,
} from './documents.js';

export default function ClientDocuments({ client, data, onSave, busy, uploadedBy }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('Agreement');
  const [archived, setArchived] = useState(false);
  if (getRole() !== 'admin')
    return (
      <section className="panel client-documents">
        <PanelHeading
          title="Agreements and documents"
          subtitle="Administrator access is required to view client agreements and commercial documents."
        />
      </section>
    );
  const rows = (data.documents || [])
    .filter((d) => d.clientId === client.id && (archived || !d.removed))
    .sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || pending || busy) return;
    setError('');
    const type = classifyFile(file);
    if (!type.ok) return setError(type.error);
    if (!cloud && file.size > 1024 * 1024)
      return setError(
        'Demo attachments must be 1 MB or smaller. Cloud storage supports files up to 5 MB.',
      );
    setPending(true);
    try {
      if (!(await contentSignatureOk(file, type.ext)))
        throw new Error('The file content does not match its file type.');
      const record = buildDocumentRecord({
        file,
        ext: type.ext,
        hash: await sha256(await file.arrayBuffer()),
        clientId: client.id,
        kind,
        uploadedBy,
      });
      await persistBinary(record, file);
      if (!(await onSave('documents', [record])))
        throw new Error('Could not save the attachment record. Please try again.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }
  async function open(record) {
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await signedUrlFor(record);
      if (!url) throw new Error('The original file is unavailable.');
      if (!tab) throw new Error('Allow pop-ups to open the attachment.');
      tab.location.href = url;
    } catch (failure) {
      tab?.close();
      setError(failure.message);
    }
  }
  async function archive(record) {
    setError('');
    if (!(await onSave('documents', [{ ...record, removed: !record.removed }])))
      setError('Could not update the attachment.');
  }
  return (
    <section className="panel client-documents">
      <PanelHeading
        title="Agreements and documents"
        subtitle="Private, administrator-only client files. Archiving keeps the original and audit history."
      />
      <div className="client-document-toolbar">
        <Field label="Document type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option>Agreement</option>
            <option>NDA</option>
            <option>Statement of work</option>
            <option>Other</option>
          </select>
        </Field>
        <label className={`button secondary${pending || busy ? ' disabled' : ''}`}>
          <Upload size={16} />
          {pending ? 'Uploading…' : 'Attach client document'}
          <input
            aria-label="Attach client document"
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.csv"
            disabled={pending || busy || !onSave}
            onChange={upload}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!rows.length && (
        <Empty
          title="No client documents"
          text="Attach agreements, NDAs and statements of work to this account."
        />
      )}
      {rows.map((record) => (
        <article className="document-row" key={record.id}>
          <FileText size={20} />
          <div className="document-info">
            <strong>{record.name}</strong>
            <AttachmentProcessing record={record} onSave={onSave} />
            <small className="block">
              {record.kind} · {(record.size / 1024).toFixed(0)} KB ·{' '}
              {String(record.uploaded).slice(0, 10)} · {record.uploadedBy}
            </small>
          </div>
          {record.removed && <Badge>Archived</Badge>}
          <Button
            variant="secondary"
            className="small"
            onClick={() => open(record)}
            disabled={record.removed}
          >
            Open document
          </Button>
          <Button
            variant="ghost"
            className="small"
            icon={record.removed ? RotateCcw : Archive}
            disabled={busy || pending || !onSave}
            onClick={() => archive(record)}
          >
            {record.removed ? 'Restore document' : 'Archive document'}
          </Button>
        </article>
      ))}
    </section>
  );
}
