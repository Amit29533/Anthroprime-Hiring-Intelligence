# Phase C2/C3: private attachment processing and OCR

Implemented locally on 6 October 2026, following [Phase C1](PHASE_C_PRIVATE_SCANNING.md). These slices have not been deployed. Docker and a local Supabase server are unavailable on this computer; real ClamAV, Poppler/Tesseract, hosted database advisors and representative CV acceptance remain required.

## C2: the existing cloud attachment routes

Enable `settings.custom.privateDocuments` only after the deployment checks below. The value must be JSON boolean `true` on the workspace settings row `id='workspace'`, preserving other custom settings. The flag is off by default.

- Candidate-profile CV/documents and administrator-only client agreements reserve immutable manifests and document IDs before any PUT. Server-owned keys preserve candidate/client ownership. PUTs require `If-None-Match: *`. A lost PUT acknowledgement can be resumed with the exact original name, size and SHA-256.
- Registered originals enter a private scan queue, with the same bounded byte verification, ClamAV definition checks, leases and fail-closed verdicts as C1. Missing originals or scanner errors remain quarantined. Detections cannot be reset through retry.
- Document text, inline bytes, parser state and scan-required markers for registered jobs are derived from server-owned processing state. Browser writes cannot release quarantine or forge extracted text. Originals cannot change identity, tenant, owner, key, provider, hash or size.
- After scanning, the scheduled extraction worker fetches the scanned ETag conditionally, verifies SHA-256 again and creates text evidence. Download signing still checks the matching scan proof and current object metadata.
- Candidate and client document rows show processing status, editor retry and interrupted-upload recovery. Client agreement status, files and extracted text remain administrator-only. Viewers can inspect candidate status but cannot retry or upload. Refresh the workspace after extraction to load the resulting evidence.
- Private document mode automatically enables the saved CV import pipeline. Cloud CV files and forwarded-email originals then use saved review rather than browser CV parsing. Candidate creation still requires explicit review/approval; it is not automatic.

The portal and integration write API currently accept metadata, not binary document uploads. This slice does not introduce binary endpoints for those surfaces. Spreadsheet imports continue to stage metadata rows; their source workbook binaries are not stored as attachments.

## C3: optional private OCR

After successful deployment acceptance, set `settings.custom.ocrDocuments` to JSON boolean `true` in a staging workspace. It requires durable CV staging/private document mode. It is off by default.

- OCR-enabled workspaces use dedicated private-worker claims with 180-second leases. The short Netlify text worker cannot consume those jobs. Workspaces with OCR off continue using the scheduled text worker.
- The private worker first runs verified text extraction. Only manual-fallback PDFs are sent to the fixed `http://ocr:8080/extract` sidecar. No candidate name, storage link or database/storage credential is supplied.
- The sidecar uses Poppler and Tesseract English OCR. It is serial, token-protected, has no published port, runs without root, and joins only an internal Docker network with no internet route. It has a read-only root filesystem, a 128 MiB temporary filesystem, process/CPU/memory limits and sanitized child environments without server credentials.
- Input is at most 5 MiB and 10 pages. Rendering scales pages to a maximum dimension of 1600 pixels. Child tools have bounded runtime and resource limits; total processing is bounded to 80 seconds. Text is capped at 40,000 characters. Unsupported, locked, oversized or unreadable documents produce visible processing failures or manual review, not invented text.
- Original bytes remain unchanged. Parsing method, engine and text fingerprint are recorded privately and exposed as read-only provenance. Changing text cannot keep an unrelated OCR attribution. OCR text and candidate draft fields must be checked against the original before approval.

## Deployment order and acceptance

1. Back up the database. Apply all migrations through `20261006094612_private_cv_quarantine.sql`, then `20261006125833_private_attachment_quarantine.sql`, then `20261006131222_private_ocr_pipeline.sql`. Apply the latest slice last when repeating old migrations; older worker definitions can otherwise replace later claim rules.
2. Deploy the frontend and Netlify functions together, including `document-upload-url`, `document-download-url` and `cv-extract-worker`. Update/rebuild the private scanner worker. Keep the workspace flags off initially.
3. Follow C1's private bucket and scanner credential setup. Use the existing server-only Supabase/R2 environment variables in `scanner/.env`. The worker image now includes PDF.js; its memory limit is 512 MiB. ClamAV remains limited to 4 GiB. No secrets are copied into images/build contexts.
4. For OCR, add a separately generated random `OCR_SHARED_TOKEN` of at least 32 characters to the host's `scanner/.env`. The worker reads it through its environment file; the sidecar receives only this token. Use the explicit `--env-file` argument below so Compose interpolation does not leave the sidecar token blank.

```sh
docker compose --env-file scanner/.env -f scanner/compose.yaml --profile ocr build
docker compose --env-file scanner/.env -f scanner/compose.yaml --profile ocr up -d clamav ocr
docker compose --env-file scanner/.env -f scanner/compose.yaml --profile ocr run --rm worker node scanner/smoke.mjs
docker compose --env-file scanner/.env -f scanner/compose.yaml --profile ocr run --rm ocr python -B smoke.py
docker compose --env-file scanner/.env -f scanner/compose.yaml --profile ocr up -d worker
```

The first smoke command requires real fresh ClamAV definitions and EICAR blocking. The second generates a harmless image-only PDF in temporary storage and requires actual Poppler rendering/Tesseract recognition. Neither smoke command accesses candidate records or makes database/storage requests. Wait for initial definition downloads, and keep flags off if either command fails. Pin reviewed production image digests and keep native tools patched.

5. Enable `privateDocuments` for one staging workspace. Exercise candidate and client attachments, lost PUT receipts, upload recovery, blocked files, scanner outage, retry exhaustion, archived originals, tenant isolation and viewer/client permissions. Confirm no text is available before scanning and a replaced object cannot download or parse.
6. Enable `ocrDocuments` in staging. Check searchable PDFs bypass OCR, image-only PDFs produce reviewable text/provenance, and corrupt/encrypted/over-limit PDFs remain visibly unprocessed. Stop the OCR service and confirm extraction failure/retry while already-scanned original downloads retain their scan gate. Test lease expiry/replay, review edits and document/candidate atomic commit. Evaluate representative real CVs, including contact accuracy and OCR quality, before production activation.
7. Run hosted Supabase security/performance advisors and private-bucket permission checks. Local advisors could not connect to `127.0.0.1:54322` here; this is a remaining deployment check, not a passing result.

Rollback: turn the workspace flags off, keep scan proofs and schema, and stop the OCR service if needed. Flags pause new queue claims; already claimed jobs can finish within their lease. Do not restore a download path that bypasses scan-required records. Previously issued signed URLs last up to five minutes.

## Verification and remaining scope

Final local verification: all 702 Node tests and four Python OCR-service tests passed. ESLint, changed-code formatting and the production build/bundle budget passed. Native engine/container and hosted acceptance remain outstanding.

Local tests execute the SQL migrations/RPCs with PostgreSQL-compatible PGlite, including repeat migrations, direct-write refusal, leases, client/viewer/tenant isolation, recovery, scan/extraction receipts and provenance binding. Node tests exercise worker/storage boundaries and the real React status UI with controlled fake services. Four Python tests exercise OCR signatures, size/page/output limits, fixed tool arguments and temporary-file cleanup with controlled fake tools. These tests do not establish native OCR engine/container acceptance.

Still pending: legacy inline/Supabase/R2 attachment backfill and full legacy preview/text gating; retention/deletion of quarantined originals; richer employment/education/certification/project extraction; multilingual/advanced OCR quality controls; new mailbox, portal or integration binary ingestion; hosted scale and quality acceptance. Legacy records keep their earlier behavior unless already marked scan-required by C1. Demo mode remains browser-local. ClamAV/Tesseract/Poppler are FOSS, but host/storage/network operation is not guaranteed free. VirusTotal remains optional hash reputation only; no CV bytes are uploaded there.
