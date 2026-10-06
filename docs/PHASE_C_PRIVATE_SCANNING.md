# Phase C1: private antivirus gate for durable CV imports

For the current deployment, follow [C2/C3 attachment processing and private OCR](PHASE_C_ATTACHMENTS_AND_OCR.md). It extends this slice, increases worker memory to 512 MiB and requires the C2/C3 migrations after C1. The instructions below describe the original C1 slice.

Implemented locally on 6 October 2026. Covers saved CV import originals and their resulting R2 documents. This has not been deployed or tested against a live ClamAV instance. Keep `settings.custom.durableCvImports` off in production until hosted acceptance passes.

## Behavior

- The saved manifest and conditional `If-None-Match: *` PUT preserve an immutable original before parsing.
- A private worker claims a 90-second lease, downloads at most 5 MiB, verifies length and SHA-256, and streams verified bytes to ClamAV on the private Docker network. VirusTotal remains optional commercial-eligible hash reputation; no CV bytes, names or links are sent there, and its results never release quarantine.
- Definitions must be at most 48 hours old and unchanged between pre/post scan VERSION checks. Timeout, unavailable/stale definitions, incomplete replies, hash mismatch and scanner errors keep files quarantined. Only the exact completed `stream: OK` result releases a file. Detections, including encrypted/limit heuristics, block it.
- A clean receipt records object ETag, engine/definitions version and server time. Extraction claims only clean files, conditionally fetches that ETag, verifies bytes again and uses the existing isolated parser. Database triggers prevent unscanned extraction and approval even through direct APIs. Candidate/document import remains transactional and requires recruiter review.
- Scanned document ID, tenant, key, hash, size and provider are immutable. Browsers cannot disable `scanRequired`. Proofs survive deletion of review batches. Download signing checks current object ETag and size before issuing a five-minute URL.

Keep the bucket private and all app-issued PUTs for these keys conditional. Browsers must have no bucket credentials or overwrite/delete path. Privileged storage operators can replace objects outside the app; restrict those credentials. Previously issued download URLs remain usable up to five minutes; instantaneous revocation is not implemented.

## Recovery

Scan state is independent of extraction: pending, scanning, clean, infected or error. Processing is serial, with bounded reads, five-second definition checks and a 30-second scan timeout. Errors wait one minute; expired leases are reclaimable. Automatic attempts stop at three. Saved imports shows scan state and offers editor retry for errors/expired leases. Retry cannot reset an active lease, clean verdict or infected file. Exclude a blocked row and use a new batch for a corrected original.

Logs contain outcomes only, without CV text, detection strings or credentials. Infected objects remain private; retention/deletion policy is a later slice.

## Deployment order

1. Back up the database, apply preceding migrations and then `20261006094612_private_cv_quarantine.sql`. Reapplying an older CV migration restores its old worker body, so reapply C1 last. Keep the CV workspace flag off.
2. Deploy frontend and Netlify functions together. The download function requires the new document column; scheduled extraction now waits for a clean scan.
3. Provision a Linux Docker host. Compose sets a 4 GiB ClamAV memory limit and a 256 MiB worker limit. ClamAV is free/open source; host, storage and network costs depend on the provider. The scanner runs separately from Netlify functions.
4. Copy `scanner/.env.example` to `scanner/.env` on the host and set the server-only Supabase service-role and R2 credentials. Restrict file permissions and never commit this file or use `VITE_` secrets. Credentials are excluded from the build context/image.
5. From the repository root:

```sh
docker compose -f scanner/compose.yaml up -d clamav
docker compose -f scanner/compose.yaml build worker
docker compose -f scanner/compose.yaml run --rm worker node scanner/smoke.mjs
```

Wait for FreshClam's initial download. The live smoke check requires fresh definitions, a clean result for harmless text and a blocked result for the standardized EICAR test string. It holds test bytes in memory and makes no database/storage calls. Do not enable imports if it fails.

6. Start the worker with `docker compose -f scanner/compose.yaml up -d worker`. Enable `durableCvImports` in staging first. The daemon has no published port, updates signatures twelve times daily and persists them on a volume. Its configuration alerts on encrypted files and scan limits.
7. Accept in staging: benign CV through scan/extraction/review/approval/download; harmless EICAR original blocked before parsing/approval/download; scanner outage/recovery; stale definitions; expired leases; browser closure; tenant/viewer denial; stale receipts; changed object versions; privacy of logs. Evaluate representative CVs and throughput before production.

The example uses official `clamav/clamav:1.4_base`. Use a reviewed digest for production and keep the supported feature release patched. See [official image guidance](https://docs.clamav.net/manual/Installing/Docker.html) and [daemon networking/scanning guidance](https://docs.clamav.net/manual/Usage/Scanning.html).

Rollback: disable durable CV imports and stop the worker. Retain the migration, proofs and download gate. Reverting the gate would reopen unverified originals.

## Verification and remaining scope

Local tests cover TCP framing against a controlled fake daemon, strict verdict/definition handling, byte verification, parser/download refusal, database leases, permissions, retries and immutable retained proofs. Database tests execute all migrations and repeat C1. Docker is unavailable on this computer; these tests do not establish real engine/container acceptance. The smoke command is the explicit deployment-host check.

Final local regression: **693 tests passed**, zero failures (`artifacts/phase-c1-full-tests-final.log`). Lint, production build/bundle budget, changed-file formatting and whitespace checks passed. Scanner imports also resolved with its minimal packaged dependencies. Full-repository formatting still reports existing style issues in unrelated files; those files were not reformatted. The known large PDF engine chunk warning remains.

C2 extends quarantine to new candidate-profile/client uploads and routes cloud CV imports through saved review when private document mode is enabled. C3 implements optional private Poppler/Tesseract OCR. Still pending: legacy attachment backfill and gated legacy preview/text retrieval, richer structured CV drafts, new portal/integration binary ingestion and hosted operational acceptance. Legacy files retain their prior behavior. These local slices do not establish ecosystem-wide antivirus completion or production activation.
