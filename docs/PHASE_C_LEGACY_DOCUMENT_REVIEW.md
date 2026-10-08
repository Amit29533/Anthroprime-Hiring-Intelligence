# Phase C5: legacy R2 quarantine and retention review

Implemented locally on 6 October 2026. This is the first legacy backfill/retention slice. It adds an administrator queue under **Workspace settings → Document safety and retention review**, using Supabase RPCs and the existing Netlify/private workers. It has not been deployed.

## Legacy adoption

An admin can explicitly quarantine an existing R2 original when private document processing is enabled. Eligibility requires an active stored file, a supported filename extension, a complete 64-character SHA-256, size between 1 byte and 5 MiB, exactly one same-workspace candidate/client owner and a key under that owner's prefix. Unsafe path segments, unsupported metadata, already scan-required records and Supabase/inline originals are excluded.

Adoption registers a server-owned legacy manifest and clears the current document's extracted text/inline bytes. It keeps its ID, ownership, key, hash, size and original bytes unchanged. Downloads then use the existing scan-proof gate. No file is copied, overwritten, deleted or silently certified. Repeated adoption is idempotent.

The private scanner recognizes legacy owner-scoped keys only for server-registered legacy jobs. It still fetches bounded bytes and verifies size/SHA-256 before ClamAV scanning. Extraction checks the clean ETag and bytes again. Lost/missing/changed originals, stale scanner definitions and outages keep processing blocked. Infected files cannot be reset through retry. Corrected originals must be uploaded as new documents; existing manifests cannot be edited to release different bytes.

Supabase Storage, inline, incomplete-hash and unsupported originals need a deliberate re-upload through the current private pipeline. Automatic provider migration/rehashing is not implemented. Existing signed URLs may remain usable for five minutes. Previously loaded data, exports and historical snapshots are not retroactively removed by adoption; reload open tabs after it. Historical text gating and cache revocation remain separate work. Legacy files that have not been adopted retain their previous behavior.

## Retention review

- The admin queue pages 50 records at a time, with due reviews by default and **Include scheduled reviews** for the full inventory. Reviews record keep, hold or reversible archive, a required reason and a next review interval of 1–3650 days.
- Server-owned private receipts retain the actor, timestamp, document identity/hash/key and next review time. Browser roles cannot read or edit the receipt table; the admin RPC exposes only the latest review's note/decision. Request UUIDs make acknowledgement retries idempotent and conflicting reuse fails.
- Hold protects application document archiving/deletion. Its due date schedules another review; it does not expire the hold. An administrator must explicitly record keep to release a hold before archive. Direct authorized document updates cannot bypass it. This is an application hold, not a bucket-level retention lock against privileged storage operators.
- Archive sets existing metadata `removed=true` and retains the private object and review history. Existing app-issued downloads reject archived records. No automatic original deletion, legal erasure workflow, email reminder or jurisdiction-specific retention period is introduced.

## Deployment and rollback

1. Back up the database and apply all migrations through `20261006142030_legacy_document_review.sql` in filename order. The migration is repeatable, adds the private receipt table, bounded admin RPCs, hold trigger, legacy job marker and tenant/document identity index.
2. Deploy the frontend and Netlify functions, and rebuild the existing private scanner/OCR image. Both scan and extraction workers must understand legacy owner-scoped keys before adoption; old workers fail closed on these keys. No new Netlify function or server secret is needed.
3. Keep private document activation behind the existing live-engine/hosted acceptance gates. Use a staging workspace with harmless originals. Verify candidate/client ownership, two workspaces, admin/recruiter/viewer boundaries, stale/missing bytes, processing retry, duplicate adoption, delayed acknowledgements, hold/release/archive and due/full-inventory pagination.
4. Run hosted Supabase advisors and R2/private-bucket checks. Local advisors cannot connect without a running Supabase database here; the database integration tests are not hosted acceptance.
5. Roll back the panel/workers if necessary, retaining manifests, scan proofs and receipts. Do not unset scan-required flags or restore unverified inline previews for adopted records. Private document flags can pause new queue claims; existing quarantine and holds remain enforced.

See [Netlify deployment](NETLIFY_DEPLOYMENT.md), [private attachment/OCR services](PHASE_C_ATTACHMENTS_AND_OCR.md) and [CV evidence review](PHASE_C_STRUCTURED_CV_EVIDENCE.md).

## Verification

All 710 Node tests passed. New PostgreSQL-compatible integration tests exercise repeated migration/adoption, quarantine, immutable originals, tenant/admin boundaries, clean scan/extraction, review idempotency, holds, explicit release and reversible archive. Worker tests verify owner-scoped legacy keys and actual byte fingerprints; React tests cover adoption, delayed acknowledgements and reopening scheduled holds. Lint, changed-code formatting and whitespace checks passed. Netlify CLI's offline production build packaged all 11 functions. Local advisors could not connect to `127.0.0.1:54322`; live engine, hosted database/storage and staging acceptance remain required. No migration or app was deployed to a hosted environment.

Remaining Phase C work: automatic Supabase/inline migration, legacy historical-preview gating, original-object cleanup with an approved retention policy, richer CV entities and hosted quality/scale acceptance. Phase D access/audit/governance follows.
