# Phase C4: structured CV section evidence

Implemented locally on 6 October 2026. This slice adds reviewable employment, education, certification and project excerpts to CV import. It runs in the existing browser/text worker/private OCR paths without an external parsing API or new dependency. It is not deployed.

## Behavior

- The deterministic parser recognizes explicit English section headings and captures non-empty source lines beneath them. Each entry has a section, editable label, explicitly quoted year range where present, source excerpt and extracted-text line number. It does not infer employers, degrees, date precision, employment duration or credential validity. Unrecognized layouts may yield no excerpts; line grouping and normalized career/education entities remain future parser work.
- Excerpts are bounded to 16 items, 400 characters per quote, 160 per label and 80 per period. The extractor also limits UTF-8 bytes so Unicode content fits durable payload limits. Omitted/truncated lines produce a visible message; recruiters must inspect the original.
- Both the local CV review and cloud Saved imports show excerpts grouped by section. Each needs explicit confirmation against the original or removal. Changing a label or period clears its confirmation. Unreviewed excerpts prevent inclusion; database triggers also reject unreviewed included rows, approval transitions and candidate writes.
- Durable CV review checks each quote against the recorded extracted line, including the line number, so direct API edits cannot invent a source citation. Text extraction and optional OCR remain behind the existing antivirus gate. Quotes are evidence from extracted text, not a claim that OCR correctly represents the original image.
- Reviewed evidence is saved in candidate `cvEvidence` with candidate creation, original-document linkage and the import receipt in the same transaction. Failed writes roll back; retries retain existing idempotency and duplicate checks. Anthro-ID allocation and tenant/role permissions remain unchanged.
- Candidate 360's **Employment** tab displays the reviewed section evidence alongside the existing employment history. Excerpts do not automatically become verified employment records, assessments or skills. They remain recruiter-reviewed notes; later authorized candidate edits can change them and use the existing candidate history/audit behavior.

Existing candidates get an empty JSON object; old CVs are not reparsed or assigned invented evidence. Existing reviewers can remove all excerpts and import the remaining draft. Spreadsheet imports retain their existing behavior.

## Netlify deployment

1. Back up the database and apply all previous migrations, then `20261006134846_structured_cv_evidence.sql` last. It adds the candidate column, private validators/review triggers and updated CV/import RPC bodies. Keep the existing scanner/OCR activation gates in place.
2. Deploy the frontend and Netlify functions together. The PDF thread's deployment assets now include `src/cvEvidence.js`; the private worker Docker image and build allowlist include it too. Rebuild that image when private OCR is used.
3. Check local and saved CV review with representative text/scanned CVs, missing headings, long/Unicode excerpts, corrections, exclusions and direct RPC bypass attempts. Verify candidate evidence survives reload and paged Candidate 360 reads, viewers can read but cannot write, and other workspaces cannot access it.
4. For rollback, revert the UI/parser and leave the additive column/schema intact. Finish or reopen in-flight reviews deliberately; do not overwrite newer worker definitions by reapplying older migrations out of order.

See [Netlify deployment](NETLIFY_DEPLOYMENT.md) and [private attachment/OCR acceptance](PHASE_C_ATTACHMENTS_AND_OCR.md). Hosted Auth/PostgREST/R2 and native scanner/OCR acceptance remain required; local PostgreSQL-compatible tests do not replace them.

## Verification

All 706 Node tests passed, including the new parser, React review and full-migration integration tests. Lint, changed-code formatting and whitespace checks passed. Netlify CLI's offline production build packaged all 11 functions with the new parser included. The extracted function archive contains no symlinks; real packaged TXT/PDF thread parsing passed. No hosted deployment was performed. Local Supabase advisors could not connect to `127.0.0.1:54322`; hosted advisor checks remain a deployment requirement.

Next scope: legacy document backfill with scan-bound previews, retention review/cleanup policy, richer entity grouping and representative CV quality evaluation; then Phase D access/audit/governance. No automatic original deletion or external transmission was added.
