# Deploy Anthroprime on Netlify

Phase 4 adds [client collaboration and scoped integration foundations](PHASE_N4_CLIENTS_AND_INTEGRATIONS.md). Apply every migration through `20261007095813_phase4_privacy_scope.sql` before deploying the UI. The source build includes `/client.html` and packages 17 functions, including `machine-api` and `approved-job-feed`. Machine writes use existing server Supabase credentials; make existing public Supabase URL/anon-key variables available to Functions as well as Builds for the public feed. Provision client Auth accounts without internal workspace membership, grant scoped access from Client detail, and share the portal link manually. Recapture erasure checklists and regenerate reviewed access packages after the privacy changes. Hosted Auth, permissions, concurrency and advisor acceptance remains pending.

Phase N3.2 adds [sealed candidate scorecards](PHASE_N3_CANDIDATE_SCORECARDS.md). Apply every migration through `20261007092050_candidate_scorecards.sql` before deploying the UI. No new service, function or credential is required; offline packaging passes with 15 functions and a 65.2 KiB main entry. Recapture erasure checklists and regenerate reviewed access snapshots/packages after the source and scope-notice updates. Hosted migration/concurrency/advisor acceptance remains pending.

Existing-stack Phase 3 adds [assessment-backed readiness review](PHASE_N3_READINESS_JOURNAL.md). Apply all migrations through `20261007085457_candidate_readiness_journal.sql` before deploying its UI. No function, service or credential is added; the offline build packages 15 functions. Recapture erasure checklists and regenerate previously prepared access packages after the scope updates. Hosted authority, expiry and concurrent-write acceptance remains pending.

Existing-stack Phase 2 adds [candidate contacts and confirmation](PHASE_N2_CANDIDATE_CONTACTS.md). Apply all migrations through `20261007083715_candidate_contacts_verification.sql` before deploying its UI. No new service, function or credential is required; offline packaging passes with 15 functions and a 65.1 KiB main entry. Recapture existing erasure checklists and regenerate previously prepared access packages after migration. Hosted permission/advisor acceptance remains pending.

Existing-stack Phase 1 adds [personal repository views and bounded owner/next-action edits](PHASE_N1_REPOSITORY_VIEWS_AND_QUICK_EDIT.md). Apply all migrations through `20261007080659_repository_views_and_quick_edit.sql` before enabling its UI. It adds no function, service or credential; the existing paged workspace flag remains authoritative for routing. Follow the newer migration endpoint rather than stopping at E2 below.

E2 [internal freshness reviews](PHASE_E_FRESHNESS_REVIEWS.md) adds the hourly `freshness-review-worker` using existing server Supabase credentials. Apply migrations through `20261007072845_internal_freshness_reviews.sql` before activation; the latest offline build packages 15 functions. Workspaces remain disabled by default.

D7 [erasure scope review](PHASE_D_ERASURE_SCOPE.md) adds database/frontend governance with no new function or credentials. Its original build packaged 14 functions; its migration is `20261007071142_reviewed_erasure_scope.sql`.

D6 adds [reviewed access packages](PHASE_D_REVIEWED_ACCESS_PACKAGES.md) and the hourly `subject-access-cleanup` scheduled function using the existing server-only Supabase credentials. Its original offline build packaged 14 functions. Apply the migration before using access review; verify expiry cleanup and authenticated staging acceptance before production.

The optional [LinkedIn candidate lookup](LINKEDIN_CANDIDATE_IMPORT.md) adds `linkedin-candidate` as an authenticated function, with server-only provider configuration and a database workspace/quota gate. Its original offline build packaged 13 functions. Pasted-profile extraction works without provider credentials; direct ID lookup requires them. Deploy its migration before activating the workspace option.

E1 addition: [internal interview reminder tasks](PHASE_E_INTERNAL_REMINDERS.md) use the minute-scheduled `interview-reminder-worker` with the existing server-only Supabase configuration. Its original offline build packaged 12 functions. Enable reminders only after migration/frontend/functions and authenticated staging checks are complete; no email provider is needed for internal tasks.

The Vite app, authenticated APIs and scheduled JavaScript jobs deploy together on Netlify. Supabase stores team data/authentication; Cloudflare R2 stores private originals. Optional private ClamAV and OCR run on a separate Linux Docker host. Those services cannot be deployed by uploading this project's static assets to Netlify. The app can deploy with their workspace flags off.

Stage 1 adds six database migrations and frontend workflows, with no new function or environment variable. Its [activation and acceptance checklist](STAGE_1_COMPLETION_CHECKLIST.md#activation-and-hosted-acceptance) includes field/role projections, assignments, reviewed merges and hosted concurrency/recovery gates. Apply the complete chain before serving the updated frontend.

## Git deployment

1. Import this repository into Netlify. Use the repository root as the base directory, `pnpm run build` as the build command, `dist` as the publish directory and `netlify/functions` as the functions directory. `netlify.toml` already declares these settings, Node 24 and the PDF worker's required assets. `package.json` pins pnpm; commit `pnpm-lock.yaml` and `pnpm-workspace.yaml` with the source. The workspace uses a hoisted dependency layout so dynamically launched PDF workers are packaged without build-machine symlinks.
2. For a shared team deployment, apply **every** file in `supabase/migrations` in ascending filename order through `20261007141611_stage1_fact_quality.sql`, using the Supabase CLI or SQL editor as appropriate. Back up an existing database first. Older migrations redefine worker functions; always apply the newest files last. Do not stop at the historical README baseline of migration 033.
3. Create the administrator account and workspace using the existing provisioning instructions. Set Supabase Auth's Site URL to your production HTTPS origin and allow the required login/reset redirect URLs. Use a separate database/bucket for deploy previews if you test writes there.
4. Configure Netlify environment variables using the table below. Keep production credentials restricted to the production context. Do not expose production server secrets to untrusted pull-request builds.
5. Create a private R2 bucket and configure CORS for your exact app origin as described below. Deploy the source through Git so Netlify builds both frontend and functions.
6. Verify sign-in, a candidate's Anthro-ID, save/reload, candidate upload/open, client agreement admin restrictions and viewer upload refusal. Check each scheduled function's logs and next-run time. Run hosted Supabase advisors and permission checks before enabling optional features.

| Variable                                                 | Scope               | Purpose                                                                           |
| -------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                                      | Builds and Functions | Public project URL; also used by public job feed                                   |
| `VITE_SUPABASE_ANON_KEY`                                 | Builds and Functions | Public anon/publishable key and public job feed; never service role                |
| `SUPABASE_URL`                                           | Functions           | Same project's URL                                                                |
| `SUPABASE_ANON_KEY`                                      | Functions           | Same project's public key for authenticated APIs                                  |
| `SUPABASE_SERVICE_ROLE_KEY`                              | Functions           | Private scheduled job access and optional audited document signing                |
| `R2_ACCOUNT_ID`                                          | Functions           | Bucket account                                                                    |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`               | Functions           | Private credentials restricted to the bucket                                      |
| `R2_BUCKET_NAME`                                         | Functions           | Private originals bucket; defaults to `anthroprime-documents`                     |
| `VIRUSTOTAL_API_KEY`, `VIRUSTOTAL_USAGE_TIER`            | Functions, optional | Hash reputation only; set tier `commercial` only with suitable account permission |
| `OPENAI_API_KEY`, `AI_EMBEDDING_MODEL`, `AI_DRAFT_MODEL` | Functions, optional | Existing opt-in intelligence; configure only when used                            |

Changing `VITE_` variables requires a rebuild. Never put R2, service-role, VirusTotal or AI secrets in a `VITE_` variable. The example environment file contains placeholders only. Demo deployments leave both browser Supabase variables unset; server jobs need credentials only when their cloud features are used, and will log configuration failures without them.

## R2 and browser policy

Use [R2 setup](R2_SETUP.md) with allowed origins set to the actual Netlify/custom domain. Allow `PUT`, `GET` and `HEAD`; allow `Content-Type` and `If-None-Match` headers. Preserve conditional PUT signing and keep public bucket access disabled. The checked-in browser policy permits HTTPS requests to R2's S3 endpoint `*.r2.cloudflarestorage.com`, Supabase and the app's own APIs. CORS and the Content Security Policy must both permit an upload. If you use a custom Supabase domain, add that exact HTTPS/WSS origin to `public/_headers` and rebuild.

## Optional private document processing

For reviewed outbound recruiting holds, follow [Phase D4 rollout](PHASE_D_OUTBOUND_HOLDS.md). Verify audited candidate CSV exports first; active holds prevent disabling that flag. Holds require no additional Netlify function or secret and do not pause all processing.

For administrator request-case tracking, follow [Phase D3 rollout](PHASE_D_SUBJECT_REQUESTS.md). It requires the new database migration and frontend, with no additional Netlify function/secret. Include private case/event tables in database backups; browser JSON exports do not contain them.

For opt-in candidate CSV projections, quotas and receipts, follow [Phase D2 rollout](PHASE_D_CANDIDATE_EXPORTS.md). Keep `settings.custom.auditedCandidateExports` off until its migration and staging permissions pass. This endpoint requires no service-role key; it authorizes the signed-in user inside PostgreSQL.

For optional document auditing, follow [Phase D1 rollout](PHASE_D_DOCUMENT_ACCESS.md). Keep `settings.custom.auditedDocumentAccess` off until the migration, private Supabase bucket, restrictive Storage policy and server signing credentials pass staging acceptance. This flag is separate from scan/OCR activation.

Keep `settings.custom.durableCvImports`, `privateDocuments` and `ocrDocuments` off until their private service acceptance passes. The default existing upload paths remain usable with those flags off; that does not certify legacy documents as malware-free. Enabling private document mode without a running scanner will leave new originals quarantined.

Follow [C2/C3 deployment and acceptance](PHASE_C_ATTACHMENTS_AND_OCR.md) for the separate scanner/OCR host. It connects to Supabase/R2 directly; it requires no public webhook or open scanner port on Netlify. OCR-enabled workspaces are processed by that host; Netlify's scheduled CV worker processes text extraction for other enabled workspaces after a clean scan. VirusTotal hash reputation cannot replace the private scan gate.

Netlify scheduled functions have a [30-second execution limit](https://docs.netlify.com/build/functions/scheduled-functions/). The Netlify CV handler bounds database requests to two seconds each, object fetching to five seconds and isolated parsing to twelve seconds; failures remain reviewable/retryable through database leases. The private OCR worker retains its longer dedicated leases. Actual cold-start latency, platform packaging and representative files still require acceptance on Netlify.

## Local verification and deployment modes

```sh
pnpm install --frozen-lockfile
pnpm run build
npx netlify-cli build --offline
```

The last command builds the app and packages all functions without publishing a site or requiring a linked Netlify account. Linux Netlify builds install the appropriate Linux optional native PDF dependency; a Windows-built function archive is not a Linux runtime acceptance result.

Local verification on 6 October 2026: Netlify CLI's offline production build passed and packaged all 11 functions, including the PDF thread runner and its parsing dependencies. The final archive contains no symlinks; after extracting it, real TXT and PDF thread parsing both passed. The frozen lockfile install, nine focused CV/attachment/OCR tests, changed-worker lint/format checks and frontend bundle budget passed. All five scheduled jobs were recognized in the generated function manifest. This is packaging verification, not a hosted deployment or Linux runtime acceptance.

For local API testing, configure `.env.local` and run `npx netlify-cli dev`. Plain `pnpm dev` serves the frontend only. Git deploys or Netlify CLI source builds are required for cloud APIs. Drag-and-drop of `dist` or the demo release zip deploys static files only and does not package these functions.

Scheduled jobs run automatically only for published production deploys; previews can be checked with the Functions page's **Run now** action. Do not enable production queue-processing flags before migrations, function credentials and workers are ready. No hosted migration, Netlify publication or live provider-key validation is performed by the local build commands above.
