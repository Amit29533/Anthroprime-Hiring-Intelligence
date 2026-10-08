# Stage 2 Dependent Milestone — private processing and recovery

Implemented locally on 8 October 2026, extending Stage 1 commit `af63000`. The admin controls, native health reporting, quarantine gates, encrypted recovery runner, isolated restore checks, UI wiring and regression tests are built. **Real worker-host and off-site/native PostgreSQL acceptance remains pending**: this workstation has no Docker, ClamAV, Tesseract, `psql`, `pg_dump` or `pg_restore`. Local fixtures cannot establish their operational availability. No hosted migration, service activation, external message or GitHub push is part of this milestone.

## Build contract and result

| Stage 2 feature | Implementation and evidence | Live acceptance |
| --- | --- | --- |
| Versioned private processing controls | Settings → Integrations and Work hub → Private processing and recovery; current workspace admin/MFA, owner, purpose, cost/quota decision, references, generation and reviewed operation receipts | Apply full migration chain and verify real Auth/PostgREST denial boundaries |
| Fresh scan/definitions evidence | Existing real scanner validates definitions ≤48 hours old, unchanged VERSION, harmless clean text and standardized EICAR blocked; private runner reports every five minutes | Run native ClamAV smoke on reviewed patched image/signatures |
| Native OCR evidence | Authenticated fixed private `/smoke` runs an image-only PDF through real Poppler and Tesseract; `/health` reports availability without claiming fixture acceptance | Run container smoke and representative English CV evaluation; multilingual OCR remains a later configured model/language choice |
| Outages, retries and current objects | Strict ≤15-minute generation health gates on all six scan/extraction claim paths and clean/extracted completions; reuse 90/180-second leases, three bounded automatic attempts, reviewed retries, conditional ETag reads and SHA-256 proof | Exercise outage, stale definitions, expired leases and replaced-original scenarios on staging |
| Complete encrypted capture | Custom native database archive, global role definitions, private journals/Auth/storage metadata, sequences and all current R2/Supabase originals; per-file AES-256-GCM, bounded copies, manifest and cipher digests; capture fails on missing originals or drift | Privileged native DB access, off-site writable custody, external key recovery and a quiescent source |
| Isolated restore drill | Verify and stage all original bytes; restore roles/database into a distinct empty DB, compare every inventoried table/role/sequence, require copied lockdown and measured RTO, bind receipt to the verified backup digest | Compatible native PostgreSQL/extensions and an isolated target; staged originals must be hydrated into isolated private storage before an application recovery/promote exercise |
| Recovery suspension | Server-only global lockdown freezes all public/application-private table writes and journals, pauses catalog controls and adds a processing suspension while preserving quarantine flags; unlock never automatically resumes capabilities | Drain existing calls and five-minute signed URLs; stop private workers and managed Auth/storage writers before capture |
| Privacy and recovery visibility | Safe bounded 25-row evidence pages, exact lost-response retries, role/scope isolation, no key/file entry in browser; all private schemas included in recovery inventory | Operator ACLs, off-site retention/deletion and external credential custody |

Additive migration: [20261008055723_dependent_stage2_processing_recovery.sql](../supabase/migrations/20261008055723_dependent_stage2_processing_recovery.sql). It creates private policies, evidence, operation receipts and lockdown, with RLS and revoked raw browser grants. Public invoker RPCs call guarded private functions: `api_processing_recovery` for authenticated administrators; `worker_processing_recovery` only for the existing service role. There is no new Netlify function, dependency package or public native endpoint. Existing **21 functions** remain the deployment set.

## Processing operations

1. Apply every migration in order through Stage 2, then deploy frontend/functions together. Do not reapply earlier worker migrations after Stage 2: doing so can overwrite the added claim gates. Leave production processing flags off until staging passes.
2. Reuse [scanner compose](../scanner/compose.yaml), [scanner server environment](../scanner/.env.example) and [private scan guide](PHASE_C_PRIVATE_SCANNING.md). Add `PROCESSING_WORKSPACES` as at most 50 distinct workspace UUIDs. Native health is scoped explicitly; there is no browser-supplied endpoint or secret.
3. An administrator configures processing, specifying whether OCR is required. Configuration adopts the strict gate immediately. New uploads retain their normal quarantine-required behavior; missing health never switches them to legacy unsigned processing. Existing unconfigured workspaces keep their established opt-in behavior for a compatible rollout.
4. Start the private worker with OCR profile if required. The worker runs shared native probes before acquiring jobs and records generation-specific results. A failed probe replaces the previous passing status; missing reports expire after 15 minutes. A failed control-plane write does not fabricate an unavailable receipt: existing evidence expires normally.
5. Refresh server evidence, explicitly accept the current generation, then enable. Both decisions recheck fresh passing probes and current administrator ownership; enable requires acceptance ≤7 days old. Configure/revoke invalidates old-generation evidence. Runtime access/health failures close processing even if stored state still says enabled.

Run on the actual Linux host:

```sh
docker compose -f scanner/compose.yaml up -d clamav
docker compose -f scanner/compose.yaml build worker
docker compose -f scanner/compose.yaml run --rm worker node scanner/smoke.mjs
docker compose -f scanner/compose.yaml --profile ocr build ocr
docker compose -f scanner/compose.yaml --profile ocr run --rm --no-deps ocr python /app/smoke.py
docker compose -f scanner/compose.yaml --profile ocr up -d worker ocr
```

Acceptance requires benign CV scan/extract/review/download, EICAR blocking, image-only extraction, stale signatures, missing OCR token, worker/service outage, bounded retries, revoked owners and current-object replacement denial. Keep manual reviewed profile entry usable. VirusTotal remains optional licensed hash-only reputation; it cannot substitute for private native acceptance or release quarantine.

## Backup and restore operator guide

The [runner](../scripts/recovery/runner.mjs) is an explicit server/operator tool, not a browser export or scheduled Netlify job. It requires Node 22+, installed project dependencies and compatible native PostgreSQL utilities. Use a direct/session database connection permitting all required schemas, role export and sequence reads. Pooler transaction connections and incomplete managed-role privileges are not accepted as complete evidence. Any native warning/failure rejects acceptance.

Copy [config.example.json](../scripts/recovery/config.example.json) to a private configuration outside the repository. The example UUID is fictional. Set actual source/workspace/custody references and absolute paths. Configure libpq service/password files, verified TLS and the [operator environment](../scripts/recovery/.env.example); the Node process does not automatically load that file. Native subprocesses receive an allowlist of libpq/path variables and never receive the recovery/R2/Supabase secrets. Keep keys, password/service files and credentials outside the encrypted bundle in separate recoverable custody.

The destination must actually be off-site (for example a mounted separately administered encrypted backup volume), not merely a directory named “offsite.” `offsiteConfirmed` and isolation/drain acknowledgements are operator attestations; software cannot verify physical separation, network ACLs or an account's storage entitlement. Protect files with host ACLs; `0600/0700` modes alone do not establish Windows ACL isolation.

```sh
node scripts/recovery/runner.mjs capture /private/recovery-config.json
node scripts/recovery/runner.mjs verify /offsite/backup-uuid
node scripts/recovery/runner.mjs restore /offsite/backup-uuid /private/recovery-config.json
node scripts/recovery/runner.mjs unlock /private/recovery-config.json
```

For capture:

- Configure workspace recovery controls with matching `keyRef`/`destinationRef`, RPO 1–168 hours and RTO 1–1440 minutes. These are references, never key values, links or passwords.
- Set `offsiteConfirmed=true`. First capture invokes global lockdown and refuses to snapshot unless `drainConfirmed=true`. Lockdown is project-wide because the native dump and buckets span workspaces.
- Stop private workers/heartbeats, drain already-issued five-minute signed URLs and active leased/native calls, disable hosted app ingress and stop managed Auth/storage writers. Table triggers cannot freeze managed Auth or external object stores. Only after this is actually complete set `drainConfirmed=true` and rerun. Do not infer draining from elapsed script time.
- Capture encrypts database and role streams immediately, bounds each original at the application's 5 MiB limit and enforces retained size/hash/ETag proofs. It inventories every current object, including unreferenced originals. Known oversize legacy originals cause an explicit failure rather than silent exclusion. Historical deleted/replaced versions and external credentials require separate custody.
- The database baseline before/after capture must match: public, Auth, storage, migration/vault and all `ecod*private` table counts/fingerprints; public/private/Auth/storage sequence `last_value`/`is_called`; non-system role flags/configuration and memberships. A change causes failure, with no passing backup report. Only the independently verified complete bundle receives a digest-bound server receipt.
- Failure records safe unavailable evidence when the control service is reachable and matching custody is configured. Partial encrypted files may remain for operator diagnosis; they are not certified backups. The source remains paused on success or failure.

For restore:

- Supply distinct target service/reference, an empty isolated database and a **new** private staging directory. Set `isolatedConfirmed=true` only after removing outbound credentials/network access. Same native database fingerprint, target tables/views/sequences/custom routines/event triggers, modified cipher, wrong key, absent file, incomplete archive or mismatched baseline rejects acceptance before a passing restore receipt.
- All original bytes are decrypted and verified in private staging. Database restores preserve archive ownership/privileges and role definitions/membership; `postgres` is the operator's preprovisioned bootstrap role, not recreated or reconfigured. Global role passwords are excluded and must be separately reprovisioned. Managed platform/bootstrap roles/extensions need a compatible isolated host; the tool does not claim to recreate the entire Supabase platform.
- Native `pg_restore` is transactional and exits on error. Post-restore checks compare table contents, private journals/receipts, Auth, role flags/configuration/memberships and Anthro-ID/private/Auth/storage sequence state. Lockdown must still be true. The source control service receives a receipt for the exact verified backup, a distinct target and measured duration only after these checks; admin acceptance rejects an over-RTO drill.
- Isolated originals stay under their ordinal staged files, mapped to original provider/bucket/key in the **encrypted** manifest. No restored object is written to a live bucket. Hydrate these verified originals into isolated private storage, configure target storage/key references, and run a separate full application promote rehearsal before calling it production recovery. The current drill establishes database and original-byte recovery, not provider-account restoration.
- Private plaintext staging is retained for inspection; clean it under your operator retention policy. Keep target outbound policies paused. Set `operatorResumeConfirmed=true` and use unlock only after review; source/target catalog capabilities must be explicitly reviewed and re-enabled afterwards. Quarantine upload-required flags stay intact; the separate processing suspension clears only on reviewed processing enablement.

Schedule operator runs at a frequency meeting RPO on the approved host. No automatic schedule is installed or claimed. Alerts/monitoring and off-site access are an operator prerequisite. A restore proof is fresh for seven days; backup freshness follows configured RPO. Enabled availability additionally requires current administrator ownership and a nonpaused project. A historical pass never means the target is currently safe to activate.

## Privacy and rollback

These new tables are workspace-level operational configuration/evidence, with no candidate foreign key, candidate identifier, CV text or extracted content. D7/operations candidate-linked categories remain **68/65**; Stage 1's candidate-linked delivery journals remain included. Do not add fictional candidate categories for these controls. Admin notes/references are bounded but remain organization metadata; avoid personal data. Encrypted full backups are external copies of candidate data: apply legal holds, retention/key disposal and reviewed external-copy handling; erasure review does not erase backup files. Recapture candidate access/erasure scopes if underlying candidate sources changed, and disclose applicable backup limitations in the case review.

Rollback: pause/revoke Stage 2 controls and stop private processing/backup workers. Preserve migration, quarantine verdicts, retained object proof and encrypted custody. Unlock only under the operator process; never remove quarantine or overwrite its upload-required helpers to restore availability. Future migrations introducing new application tables must install equivalent lockdown guards before live use.

## Verification record

Local checks cover the complete migration chain; admin/MFA/tenant/service separation; exact retries; native-health expiry/outage/generation/owner checks; all six claims; quarantine completion rejection; bounded evidence pages; global lockdown; private inventory and sequence extraction; real AES-GCM authentication/tamper/key/AAD/bounds; original bytes/ETag and database drift; source/nonempty target rejection; safe operator failures; real React scope changes and retry controls; authenticated OCR HTTP smoke contracts and existing PDF input/tool limits.

Final full regression passed **954 Node tests** in 501.4 seconds, with zero failures/skips. The initial full run passed 953 before the additional private Storage test. Latest Stage 2 focused acceptance checks pass **18 tests**; Python OCR checks pass **5 tests**. Netlify offline packaging passed with **21 functions**, a **68.5 KiB** main entry (100 KiB budget), and no added function/service dependency. ESLint completed with zero errors/warnings; changed JavaScript/config formatting and whitespace checks passed. Desktop/mobile fictional browser checks found no horizontal overflow or console errors; keyboard focus reached the configuration fields. [Desktop fixture](dependent-stage2-desktop-preview.png) · [Mobile fixture](dependent-stage2-mobile-preview.png). Temporary browser files/process were removed.

Native smoke was attempted: private scanner acceptance failed without its host; real OCR reported the missing Linux sandbox; `pg_dump` was unavailable. Local Supabase database lint/advisors could not connect to `127.0.0.1:54322` because Docker/local PostgreSQL is absent. PGlite migration/RLS/sequence tests pass, but real Auth/PostgREST/advisor/native/container/off-site tests remain hosted acceptance gates.

References checked for this implementation: [Supabase backup scope](https://supabase.com/docs/guides/platform/backups), [native pg_dump scope](https://www.postgresql.org/docs/current/app-pgdump.html), [native pg_restore behavior](https://www.postgresql.org/docs/current/app-pgrestore.html), [ClamAV official images](https://docs.clamav.net/manual/Installing/Docker.html), [ClamAV support matrix](https://docs.clamav.net/faq/faq-eol.html), [R2 S3 API capabilities](https://developers.cloudflare.com/r2/api/s3/api/). Supabase database backups do not include Storage object bytes; this runner copies originals separately. A native database dump is not a substitute for exported global roles or external key custody. The existing compose uses the 1.4 LTS family; refresh and inspect the supported patched image, then pin its reviewed digest on the deployment host before native acceptance.
