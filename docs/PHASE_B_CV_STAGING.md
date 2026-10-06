# Phase B2 — Durable CV staging and extraction

Implemented locally on 6 October 2026 as an **opt-in staging preview**. The [Phase C1 scan gate](PHASE_C_PRIVATE_SCANNING.md) and [C2/C3 private attachment processing and optional OCR](PHASE_C_ATTACHMENTS_AND_OCR.md) are implemented locally; production activation requires running private services and hosted acceptance. Follow the latest C2/C3 guide for migration order and deployment. The existing default CV importer remains available while both durable CV and private document flags are off.

## Workflow

With `settings.custom.durableCvImports` enabled for the active cloud workspace, **People → Import → Save CVs for background extraction** accepts up to 20 files, 5 MB each. PDF, DOCX, UTF-8 TXT, MD and CSV are supported.

The database manifest and draft rows are saved before any original is uploaded. Private R2 objects use server-generated IDs. Signed PUT requests require `If-None-Match: *`, preventing an upload URL from replacing an original after verification. The server checks actual byte count and full SHA-256 against the saved manifest; client-provided extracted text and storage keys are never trusted.

After upload, a scheduled worker reads one original per invocation. A separate worker thread bounds parsing to 20 seconds and 128 MB of V8 old-generation heap (this is not a complete OS memory limit or a sandbox). PDF.js handles text-based PDFs, capped at 50 pages and 40,000 characters. DOCX reads only `word/document.xml`, with a 1 MB inflated XML limit and support for streaming ZIP data descriptors. No CV bytes are sent to VirusTotal or an AI provider.

Close and reopen the browser after files are queued. Open **Saved imports**, choose **CV upload**, refresh and review extracted suggestions. Every included CV needs a verified original and completed extraction. **Save corrected row** explicitly includes it; **Exclude CV row** explicitly skips it. Approval rejects unreviewed waiting/suggestion rows. Image-only, protected or unreadable PDFs/DOCX become manual-entry drafts with their verified original preserved.

Approve the background import. Candidate insertion, document linkage and completion receipt share one database transaction. Document-write failure rolls back the candidate too. Duplicate contacts are reported without merging or attaching a CV to an existing candidate. Existing UUIDs and compact Anthro-ID allocation continue across downstream modules.

For interrupted uploads, reopen the saved batch and use **Resume with original file**. Filename, size, extension and SHA-256 must match. A successful upload with a lost acknowledgement returns HTTP 412 on repeated conditional PUT; the worker then verifies the existing bytes. Different stored bytes cannot be overwritten: cancel and start a new batch. Failed processing can retry the same original.

Extraction claims have 90-second leases. Expired claims can be reclaimed; stale tokens cannot publish. Three interrupted attempts stop a job until explicit retry resets its attempts. Cancelled batches reject late results. Extraction increments review versions, and results never overwrite recruiter edits. Candidate commits still recheck the approving user's editor access.

## Staging setup and rollback

1. Apply `20261006085425_durable_cv_staging.sql` after `20261006082325_resumable_imports.sql` and earlier migrations. Staging defaults to disabled.
2. Deploy frontend, `cv-upload-url`, scheduled `cv-extract-worker`, `import-worker` and included `cv-extraction-worker.mjs` together. Its `netlify.toml` override includes the runner, parsing sources, complete PDF.js package and installed optional canvas packages for Node support. Keep optional dependencies enabled during installation, and build on the target platform so the canvas binary matches it. Use Node 22.13 or later (PDF.js's minimum).
3. Configure server-only Supabase credentials and existing private R2 credentials/bucket. Add `If-None-Match` alongside `Content-Type` to bucket CORS allowed headers for the exact staging origin. Keep the bucket private. No new npm dependency or paid parsing vendor is needed.
4. In an isolated test workspace, set the `settings` row `id='workspace'` → `custom.durableCvImports` to boolean `true`, preserving other settings. Reload the app. The flag is checked by manifest, extraction and commit functions. Leave it off in production until the implemented scan gate passes live acceptance.
5. Verify actual Netlify packaging, scheduler, R2 conditional writes/CORS, two workspaces and editor/viewer roles using non-sensitive fixtures. Include browser closure, lost receipt, timeout, lease expiry, cancellation, duplicate and document-write failure. Local tests do not replace hosted acceptance or the blueprint's 200-real-CV evaluation.
6. Roll back by setting the flag to `false` and disabling the extraction scheduler. New manifests/extraction stop; pending CV candidate commits fail without partial writes. Existing candidates/documents remain. Preserve tables and private originals for recovery.

## Remaining work

- Private scan/quarantine and download/parse gating for this pipeline are implemented in Phase C1. C2/C3 add new candidate/client attachment processing and optional private OCR. Hosted scanner/OCR acceptance, legacy backfill and richer structured drafts remain Phase C work. VirusTotal remains optional hash reputation with the previously documented eligible commercial-use configuration; no clean verdict is inferred.
- Opt-in [paged startup/browsing and Candidate 360 reads](PHASE_B_PAGED_REPOSITORY.md) are now delivered locally. Legacy editing, matching and report/export workflows still expand to complete snapshots; hosted scale acceptance is pending.
- Draft/object retention, abandoned-upload cleanup and live progress updates remain pending. Duplicate/excluded originals remain private staging objects and can incur storage usage; no automatic deletion is introduced.
- Parsing is heuristic. Structured employment/education/project extraction and evidence validation are not delivered. Pasted forwarded-email drafts retain their existing workflow.

## Verification

Local tests cover migration replay, disabled flag, tenant/viewer boundaries, conflicts, review guards, leases, cancellation, atomic document failure, replay, Anthro-ID, bounded reads, isolated timeout, conditional upload signing, lost acknowledgements, wrong-file rejection and redacted errors. Hosted migration, R2 credentials, VirusTotal key and production deployment have not been exercised. Frontend build and entry-size budget pass.

Full regression: **683 passed, 0 failed** (`artifacts/phase-b2-tests.log`), plus lint and frontend build (63.5 KiB entry / 100 KiB budget). Worker parsing diagnostics are discarded so document strings do not inherit platform logs.

The Netlify bundler also built all functions with the configured include patterns. A real PDF extracted from the unpacked CV worker package using only packaged dependencies (`artifacts/phase-b2-configured-packaging.log`). This local Windows packaging check does not replace a target-platform Linux staging run. Focused worker tests passed again after diagnostic suppression.

Implementation references: [R2 conditional PUT compatibility](https://developers.cloudflare.com/r2/api/s3/api/) and [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
