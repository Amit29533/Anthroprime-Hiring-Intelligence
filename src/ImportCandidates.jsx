import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, Download, ArrowRight } from 'lucide-react';
import { Button, Field, Modal, Badge } from './ui.jsx';
import { uid, today, duplicate } from './domain.js';
import { readCSV, previewImport, sameImportReview, IMPORT_FIELDS } from './import.js';
import { readXLSX, isXlsxName } from './xlsx.js';
import {
  classifyFile,
  extractDocumentText,
  sha256,
  buildDocumentRecord,
  persistBinary,
  parseCVText,
  contentSignatureOk,
} from './documents.js';
import { downloadFile, exportSensitiveFile } from './downloads.js';
import { emailBodyText } from './documents.js';

export function ImportModal({ data, onClose, onSave, busy, notify }) {
  const [raw, setRaw] = useState(null),
    [mapping, setMapping] = useState({}),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(''),
    [text, setText] = useState('');
  const [cvRows, setCvRows] = useState(null),
    [cvBusy, setCvBusy] = useState(false),
    [emailText, setEmailText] = useState('');
  async function pasteEmail() {
    if (!emailText.trim()) return;
    setError('');
    setCvBusy(true);
    try {
      const body = emailBodyText(emailText);
      const parsed = parseCVText(body);
      const hash = await sha256(new TextEncoder().encode(body));
      const record = buildDocumentRecord({
        file: {
          name: `Forwarded email ${new Date().toISOString().slice(0, 10)}.txt`,
          size: body.length,
        },
        ext: 'txt',
        hash,
        extracted: body,
      });
      const dupe =
        parsed.email || parsed.phone || parsed.linkedin
          ? duplicate(
              { id: '', email: parsed.email, phone: parsed.phone, linkedin: parsed.linkedin },
              data.candidates,
            )
          : null;
      setCvRows([
        {
          file: null,
          draft: parsed,
          record,
          error: dupe
            ? `Duplicate of ${dupe.name}; skip or review.`
            : !parsed.name || (!parsed.email && !parsed.phone)
              ? 'Incomplete extraction — review name and contact before import.'
              : null,
          checked: Boolean(parsed.name && (parsed.email || parsed.phone) && !dupe),
          name: 'Forwarded email',
        },
      ]);
      setEmailText('');
    } catch (err) {
      setError(err.message);
    }
    setCvBusy(false);
  }
  async function cvChanged(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setError('');
    setCvBusy(true);
    const rows = [];
    for (const f of files) {
      const cls = classifyFile(f);
      if (!cls.ok) {
        rows.push({
          file: f,
          draft: null,
          record: null,
          error: cls.error,
          checked: false,
          name: f.name,
        });
        continue;
      }
      try {
        if (!(await contentSignatureOk(f, cls.ext)))
          throw new Error(`File content does not look like a real ${cls.ext.toUpperCase()}.`);
        const buffer = await f.arrayBuffer();
        const extraction = await extractDocumentText(buffer, cls.ext);
        const extracted = extraction.text;
        const parsed = parseCVText(extracted);
        const hash = await sha256(buffer);
        const record = buildDocumentRecord({
          file: f,
          ext: cls.ext,
          hash,
          extracted,
          parserStatusHint: extraction.status,
        });
        const dupe =
          parsed.email || parsed.phone || parsed.linkedin
            ? duplicate(
                { id: '', email: parsed.email, phone: parsed.phone, linkedin: parsed.linkedin },
                data.candidates,
              )
            : null;
        rows.push({
          file: f,
          draft: parsed,
          record,
          warning: extraction.warning,
          error: dupe
            ? `Duplicate of ${dupe.name}; skip or review.`
            : !parsed.name || (!parsed.email && !parsed.phone)
              ? 'Incomplete extraction — review name and contact before import.'
              : null,
          checked: Boolean(parsed.name && (parsed.email || parsed.phone) && !dupe),
          name: f.name,
        });
      } catch (err) {
        rows.push({
          file: f,
          draft: null,
          record: null,
          error: err.message,
          checked: false,
          name: f.name,
        });
      }
    }
    setCvRows(rows);
    setCvBusy(false);
  }
  const cvOk = (cvRows || []).filter((r) => r.checked && !r.error);
  function reviewCv(index, field, value) {
    setCvRows((rows) =>
      rows.map((row, i) => {
        if (i !== index || !row.draft) return row;
        const draft = { ...row.draft, [field]: value };
        const dupe = duplicate({ id: '', ...draft }, data.candidates);
        const error = dupe
          ? `Duplicate of ${dupe.name}; skip or review.`
          : !draft.name.trim() || (!draft.email.trim() && !draft.phone.trim())
            ? 'Enter a name and an email or phone before import.'
            : null;
        return { ...row, draft, error, checked: !error };
      }),
    );
  }
  async function importCvs() {
    // Recheck the current repository and this batch immediately before any writes.
    const seen = [...data.candidates];
    for (const row of cvOk) {
      const dupe = duplicate({ id: '', ...row.draft }, seen);
      if (dupe) {
        setError(
          `Duplicate of ${dupe.name}. Correct or deselect the duplicate draft before import.`,
        );
        return;
      }
      seen.push({ id: uid(), ...row.draft });
    }
    const candidates = cvOk.map((r) => ({
      id: uid(),
      name: (r.draft.name || '').trim(),
      email: (r.draft.email || '').trim().toLowerCase(),
      phone: r.draft.phone || '',
      title: r.draft.title || '',
      company: '',
      location: '',
      experience: r.draft.experience == null ? null : Number(r.draft.experience),
      relevantExperience: null,
      notice: null,
      current: null,
      expected: null,
      skills: r.draft.skills || [],
      skillsDetail: (r.draft.skills || []).map((sk) => ({
        skill: sk,
        proficiency: 'Working',
        years: null,
        lastUsed: null,
        evidence: 'CV',
        confidence: null,
        validated: false,
      })),
      status: 'Assessing',
      mode: 'Flexible',
      source: 'CV upload',
      summary: r.draft.summary || '',
      created: today(),
      verified: today(),
      owner: 'Recruiter',
      linkedin: r.draft.linkedin || '',
      engagement: '',
      earliestStart: null,
      activeStatus: 'Active',
    }));
    if (!candidates.length) return;
    if (await onSave('candidates', candidates)) {
      const docs = [];
      for (let i = 0; i < cvOk.length; i++) {
        const record = { ...cvOk[i].record, candidateId: candidates[i].id };
        const file = cvOk[i].file;
        // A forwarded-email draft has no original binary; everything else must actually be
        // stored. Either way the parsed profile is kept, and a storage failure is recorded on
        // the document instead of being swallowed (it used to be a no-op self-assignment).
        if (file) {
          try {
            await persistBinary(record, file);
          } catch (err) {
            record.stored = false;
            record.storageError = err.message || 'Could not store the original file.';
          }
        } else {
          record.stored = false;
        }
        docs.push(record);
      }
      if (docs.length) await onSave('documents', docs);
      onClose();
    }
  }
  /** Accept a parsed sheet from either source and set up the same mapping step. */
  function accept(result, note = '') {
    setRaw(result);
    setMapping(
      Object.fromEntries(
        IMPORT_FIELDS.map((f) => [
          f,
          result.headers.find((h) => h.replace(/[ _]/g, '').toLowerCase() === f.toLowerCase()) ||
            '',
        ]),
      ),
    );
    setError(note);
    setPreview(null);
  }
  function parse(value) {
    try {
      accept(readCSV(value));
    } catch (e) {
      setError(e.message);
    }
  }
  async function fileChanged(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('Choose a file smaller than 5 MB.');
    const name = file.name.toLowerCase();
    if (isXlsxName(name)) {
      try {
        const result = await readXLSX(await file.arrayBuffer());
        // Only the first sheet is read; say so rather than let the user assume otherwise.
        accept(
          result,
          result.sheetCount > 1
            ? `Read “${result.sheet}” only — this workbook has ${result.sheetCount} sheets, and the rest were ignored.`
            : '',
        );
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    if (!name.endsWith('.csv')) return setError('Choose a .csv or .xlsx file.');
    parse(await file.text());
  }
  const valid = preview?.filter((p) => !p.error) || [];
  useEffect(() => {
    if (!raw || !preview || cvRows) return;
    const refreshed = previewImport(raw.rows, mapping, data.candidates, raw.rowNumbers);
    if (!sameImportReview(preview, refreshed)) {
      setPreview(refreshed);
      setError('The repository changed. Review the updated duplicate check.');
    }
  }, [cvRows, data.candidates, mapping, preview, raw]);
  async function importRows() {
    const refreshed = previewImport(raw.rows, mapping, data.candidates, raw.rowNumbers);
    if (!sameImportReview(preview, refreshed)) {
      setPreview(refreshed);
      setError('The repository changed. Review the updated duplicate check.');
      return;
    }
    setError('');
    if (
      await onSave(
        'candidates',
        valid.map((p) => p.candidate),
      )
    )
      onClose();
  }
  return (
    <Modal
      title="Bring your talent into ECOD"
      subtitle="Map your CSV, review duplicates, then import."
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <div className="import-steps">
          <span className={!raw ? 'active' : ''}>1 · Choose data</span>
          <span className={raw && !preview ? 'active' : ''}>2 · Map fields</span>
          <span className={preview ? 'active' : ''}>3 · Review & import</span>
        </div>
        {!raw && !cvRows ? (
          <>
            <label className="file-drop">
              <Upload size={32} />
              <strong>Choose a candidate spreadsheet</strong>
              <span>Excel .xlsx or UTF-8 .csv · up to 5 MB · 5,000 rows</span>
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={fileChanged}
              />
            </label>
            <label className="file-drop">
              <Upload size={32} />
              <strong>Or upload CVs</strong>
              <span>PDF · DOCX · TXT · MD · CSV — parsed into reviewable drafts</span>
              <input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv" onChange={cvChanged} />
            </label>
            <label className="file-drop">
              <Upload size={32} />
              <strong>Or paste a forwarded application email</strong>
              <span>
                Resume-inbox groundwork — the body is extracted and parsed into the same reviewable
                draft
              </span>
            </label>
            <details className="paste-csv">
              <summary>Paste email content</summary>
              <textarea
                rows={5}
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste the forwarded application email here — headers are stripped automatically…"
              />
              <Button
                variant="secondary"
                disabled={!emailText.trim() || cvBusy}
                onClick={pasteEmail}
              >
                {cvBusy ? 'Extracting…' : 'Extract CV from email'}
              </Button>
            </details>
            <Button
              variant="ghost"
              icon={Download}
              onClick={() =>
                downloadFile(
                  'name,email,phone,title,company,location,experience,relevantExperience,notice,current,expected,skills,mode,status,source,engagement\nSample Candidate,sample@example.com,,Data Engineer,Example Company,Bengaluru,6,5,30,20,26,"Python; SQL; Databricks",Hybrid,Assessing,Referral,Permanent\n',
                  'ecod-import-template.csv',
                )
              }
            >
              Download CSV template
            </Button>
            <details className="paste-csv">
              <summary>Or paste CSV data</summary>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="name,email,title,skills…"
              />
              <Button variant="secondary" disabled={!text.trim()} onClick={() => parse(text)}>
                Read pasted CSV
              </Button>
            </details>
          </>
        ) : cvRows ? (
          <>
            <p className="supporting-text">
              {cvRows.length} CV files read. Parsed drafts are suggestions — fix details before
              importing. Originals are stored with each profile.
            </p>
            <div className="cv-review-list">
              {cvRows.map((r, i) => (
                <article className="cv-review-card" key={i}>
                  <div className="cv-review-heading">
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Import ${r.name}`}
                        checked={r.checked}
                        disabled={Boolean(r.error)}
                        onChange={(e) =>
                          setCvRows(
                            cvRows.map((x, j) =>
                              j === i ? { ...x, checked: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      <strong>{r.name}</strong>
                    </label>
                    <Badge tone={r.record?.parserStatus === 'parsed' ? 'green' : 'amber'}>
                      {r.record?.parserStatus === 'parsed' ? 'Text parsed' : 'Manual review'}
                    </Badge>
                  </div>
                  {r.draft && (
                    <div className="cv-review-fields">
                      <Field label="Candidate name">
                        <input
                          aria-label={`Candidate name for ${r.name}`}
                          value={r.draft.name}
                          onChange={(e) => reviewCv(i, 'name', e.target.value)}
                        />
                      </Field>
                      <Field label="Email">
                        <input
                          aria-label={`Email for ${r.name}`}
                          value={r.draft.email}
                          onChange={(e) => reviewCv(i, 'email', e.target.value)}
                        />
                      </Field>
                      <Field label="Phone">
                        <input
                          aria-label={`Phone for ${r.name}`}
                          value={r.draft.phone}
                          onChange={(e) => reviewCv(i, 'phone', e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  {r.draft?.title && <p>{r.draft.title}</p>}
                  {r.draft?.skills?.length > 0 && (
                    <p className="muted">Skills: {r.draft.skills.join(', ')}</p>
                  )}
                  {r.warning && <p className="muted">{r.warning}</p>}
                  {r.error ? (
                    <p className="text-red" role="status">
                      {r.error}
                    </p>
                  ) : (
                    <Badge tone="green">Draft ready</Badge>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : !preview ? (
          <>
            <p className="supporting-text">
              {raw.rows.length} rows detected. Map your columns. Name and an email or phone are
              required.
            </p>
            <div className="form-grid">
              {IMPORT_FIELDS.map((f) => (
                <Field label={f} key={f}>
                  <select
                    value={mapping[f]}
                    onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}
                  >
                    <option value="">Skip this field</option>
                    {raw.headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="import-totals">
              <div>
                <strong>{valid.length}</strong>
                <span>ready to import</span>
              </div>
              <div>
                <strong>{preview.length - valid.length}</strong>
                <span>rows skipped</span>
              </div>
            </div>
            <div className="import-preview table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Candidate</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 100).map((p) => (
                    <tr key={p.row}>
                      <td>{p.row}</td>
                      <td>
                        {p.candidate.name || 'Missing name'}
                        <small className="block">{p.candidate.email}</small>
                      </td>
                      <td>
                        {p.error ? (
                          <span className="text-red">{p.error}</span>
                        ) : (
                          <Badge tone="green">Ready</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length > 100 && (
              <p className="supporting-text">
                Showing the first 100 rows. All {preview.length} rows were validated.
              </p>
            )}
            <p className="supporting-text">
              Duplicates are skipped, never merged automatically. Imported details are marked
              verified today; review the source before importing.
            </p>
            {preview.some((p) => p.error) && (
              <Button
                variant="ghost"
                icon={Download}
                onClick={() =>
                  exportSensitiveFile(
                    Papa.unparse(
                      preview
                        .filter((p) => p.error)
                        .map((p) => ({ row: p.row, name: p.candidate.name, error: p.error })),
                      { escapeFormulae: true },
                    ),
                    'ecod-import-errors.csv',
                    'text/csv;charset=utf-8',
                    notify,
                  )
                }
              >
                Download error report
              </Button>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <Button
          variant="secondary"
          onClick={() => {
            if (cvRows) setCvRows(null);
            else if (preview) setPreview(null);
            else if (raw) setRaw(null);
            else onClose();
          }}
        >
          {raw || cvRows ? 'Back' : 'Cancel'}
        </Button>
        {raw && !preview && (
          <Button
            onClick={() => {
              setPreview(previewImport(raw.rows, mapping, data.candidates, raw.rowNumbers));
              setError('');
            }}
          >
            Review import
            <ArrowRight size={15} />
          </Button>
        )}
        {preview && (
          <Button disabled={!valid.length || busy} onClick={importRows}>
            {busy ? 'Importing…' : `Import ${valid.length} candidates`}
          </Button>
        )}
        {cvRows && (
          <Button disabled={!cvOk.length || busy || cvBusy} onClick={importCvs}>
            {busy || cvBusy
              ? 'Importing…'
              : `Import ${cvOk.length} profile${cvOk.length === 1 ? '' : 's'} with CVs`}
          </Button>
        )}
      </div>
    </Modal>
  );
}
