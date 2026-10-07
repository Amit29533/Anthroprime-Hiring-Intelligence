# Phase D6 — Reviewed access packages

The [Phase N2.1 contact slice](PHASE_N2_CANDIDATE_CONTACTS.md) adds alternate-contact records and private verification/operation history. The 18-category access package excludes them explicitly; arrange separate approved disclosure review. Regenerate previously prepared packages after that migration because the revised scope notice changes their bytes/checksums. Do not treat earlier copies as current complete fulfillment.

This slice extends administrator data-subject access cases with a bounded disclosure review and JSON download. It does not fulfill an entire access request automatically. Original files, raw CV extraction, opaque custom fields, retired merged identities, provider/job tables, raw history snapshots and third-party commercial records require separate approved review. The package carries this scope notice. Erasure, mailbox delivery and portal intake remain pending.

## Workflow

In Settings or the candidate request panel, record identity verification and start an access case review. Enter an access review reference, then create a fresh snapshot. The server collects allowlisted fields from 18 direct candidate record categories, including profile, employment/availability/compensation history, skills/evidence, assessments, enrichment, notes, consents, recruiting stages and original-file metadata. Metadata includes file names, never object locators or original bytes. Notes and feedback can contain third-party information and must be reviewed before disclosure.

Every row starts pending. Choose Include, Redact or Withhold explicitly; save up to 25 decisions per action. Redaction can remove fields or replace existing text, but cannot introduce fields or change non-text facts. All records must have a decision and at least one must be included before package preparation. The package contains approved records and a withheld-record count. Review references are retained in the case history rather than included in the recipient's package.

Preparation produces a server timestamp, package ID and SHA-256 receipt. The browser checks the exact bytes against the checksum, checks the case and workspace, then downloads JSON. Unchanged retries reuse the operation UUID and return byte-identical content; another actor or changed inputs cannot replay that receipt. Record delivery separately using an approved channel/reference. This records the administrator's assertion; it does not send a message, prove receipt or close the case.

## Boundaries and retention

- Private review tables have RLS enabled and browser table access revoked. Only current-workspace administrators can use the public RPCs. The existing optional privileged MFA policy applies to all reads/actions. Anonymous, recruiter, viewer and other-workspace calls are denied.
- Case version locks reject concurrent stale edits. Source hashes include the full source rows, so preparation and acknowledgement retries fail after source changes. Candidate merges, closed cases and a new verification after reopening invalidate old copies.
- A snapshot contains at most 2,000 rows, 5 MiB of projected data and 80 KiB per row. Prepared JSON is limited to 2 MiB before response encoding for Netlify. Each administrator can prepare five packages per workspace per rolling 24 hours; unchanged retries do not consume another slot.
- Review copies expire seven days after capture. Reads and preparation deny expired copies immediately. The hourly Netlify scheduled function purges up to 20 expired review copies per run; scheduler outages or backlog delay physical purge. A fresh snapshot clears older review rows immediately. Copies are private scratch data; purging them preserves canonical candidates/files and minimal package/case receipts. Copies downloaded to an operator's device require the organization's approved handling process.
- Package receipts and case history do not store package content or copied profile data. The private scratch rows retain originals and reviewed data until clearing/purge. Database backups may retain those rows according to the deployment's backup policy; this worker does not purge backups.

## Deployment and acceptance

1. Apply migrations in filename order through `20261007064426_reviewed_subject_access_packages.sql`. Deploy the frontend and Netlify functions. This adds one hourly function and requires the existing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` server configuration; no new provider or paid package is needed. Never put the service key in Vite variables.
2. Verify synthetic cases in two hosted workspaces: all roles, optional AAL2 policy, source changes between capture/download, concurrent case edits, lost acknowledgements, JSON checksums, redaction, snapshot/package limits, reopened cases and merged candidates.
3. Verify the hourly scheduled function and service-only cleanup RPC. Exercise an expired synthetic copy and confirm canonical records remain. Monitor failed runs and backlog; adjust operations if more than 20 copies expire per hour. Do not claim automatic seven-day physical deletion until scheduler acceptance is complete.
4. Run hosted security/performance advisors and include `ecod_private` in database backup/restore verification. This slice has no destructive down-migration. Roll back the frontend while retaining receipts and continue cleanup or an approved manual purge process.

Missing RPCs show an actionable migration error and offer no local disclosure fallback. No hosted migration, provider activation, external delivery or deployment was performed in this development slice.

## Validation

Database tests apply the full migration chain and repeat D6; exercise explicit decisions/redaction, tenant/role/MFA isolation, private-table/helper/worker grants, actor-bound retries, stale versions/source hashes, prepared-review immutability, size/quota limits, reopened verification, expiry and cleanup preservation. Browser tests exercise actual decisions, invalid redaction JSON, lost acknowledgements, downloads, delivery references, paging and missing migrations. Unit checks verify checksum rejection and workspace changes during RPC or hashing. All 756 Node tests passed with zero failures, cancellations or skips (329.8 seconds), plus four Python OCR tests. The final expanded migration test also passed with record-count, package-byte and merge guards. ESLint, changed-file Prettier and Git whitespace checks passed. The Netlify offline production build packaged all 14 functions, recognized the hourly cleanup schedule and passed the 100 KiB entry budget at 65.0 KiB. Local advisors could not connect to PostgreSQL on port 54322; hosted advisors and authenticated deployment acceptance remain required.
