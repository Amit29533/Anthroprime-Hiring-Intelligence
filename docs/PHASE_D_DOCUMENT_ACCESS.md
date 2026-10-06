# Phase D1: audited document signing

Implemented locally on 6 October 2026, behind `settings.custom.auditedDocumentAccess=true`. The default is off. This slice covers application downloads of R2 and legacy Supabase originals; it adds no paid service or new Netlify function.

## Behavior

- Each enabled workspace member gets 60 signing attempts per 60-second window, starting at the first attempt. PostgreSQL locks a counter per user/workspace, so separate Netlify invocations share the limit. Failed/quarantined attempts consume quota. Excess requests return HTTP 429 with `Retry-After`; repeated denials aggregate in the counter and create one throttled receipt per window. This is a resetting window, not a sliding-window limiter.
- The authenticated RPC checks tenant visibility, archive state and client-document administrator permission, captures document identity and creates a private requested receipt. Only the server service role can finish it as issued or failed. Browser callers cannot certify issuance.
- Before releasing a prepared URL, the server rechecks membership, role, archive state, owner, provider, key, size, hash and required scan proof. Changed records, expired requests and failed receipt writes withhold the URL. R2 scan/ETag checks remain in place. Scan-required legacy Supabase originals need private migration before download.
- A restrictive SELECT policy on `storage.objects` prevents browser direct reads/signing in the documents bucket for enabled workspaces. It also blocks enabled-workspace prefixes and mapped legacy keys when another workspace is active. Existing permissive policies remain necessary; this migration grants no additional object read access. Other buckets retain their existing policies.
- **Workspace settings → Document access audit** exposes administrator-only, tenant-scoped pages of 50 receipts for the last day or week. It shows actor/document IDs, provider, timestamps, outcomes and bounded reason codes; it excludes object keys, hashes, signed URLs, tokens, filenames and content.

`issued` means the server completed authorization and prepared a URL, not that bytes were transferred. `requested` means unfinished; after its 60-second deadline it displays as `abandoned`. `throttled` counts windows, not every denied request. URLs expire after five minutes and can be reused during that time. Previously issued URLs and already downloaded files cannot be revoked by this feature.

## Rollout

1. Back up and apply every migration in filename order through `20261006143746_audited_document_access.sql`. The new migration is repeatable. It installs the Storage policy only if `storage.objects` exists; verify `audited_document_direct_read` is installed before activation.
2. Deploy frontend and Netlify functions together. Configure `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` as server-only function secrets. The download function needs these when auditing is enabled, including for legacy Supabase signing. Never use a `VITE_` prefix for this key. Missing new RPCs fail closed, including R2 requests while the flag is off; deploy the migration first.
3. Keep the Supabase documents bucket private: public buckets bypass authenticated read policy enforcement. Inventory legacy records before activation: server signing requires workspace-UUID-prefixed paths without traversal segments/backslashes. Unscoped Supabase keys and inline originals require deliberate migration/re-upload; this slice does not rewrite them.
4. Enable the JSON boolean in staging. Verify admin/recruiter/viewer boundaries, client documents, two workspaces, direct Storage denial, R2/Supabase downloads, quarantine, archive/role changes during signing, 60-request quota/reset and service/storage outages. Check the actual hosted policy alongside existing Storage policies and run security/performance advisors.
5. Activate limited production workspaces after hosted acceptance. Watch failures, abandoned receipts, quota windows, function duration and receipt growth. Scanner/OCR acceptance remains separate.

Rollback: set `auditedDocumentAccess` false to restore the previous app download paths and direct Storage policy behavior for that workspace. Retain additive schema and receipts. Keep scan-required flags and existing quarantine/hold controls intact. Existing signed URLs retain their expiry.

Supabase service keys bypass Storage RLS, so the server endpoint retains its user-authenticated initial gate and final authorization check. See official [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) and [signed URL permissions](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl).

## Verification and limits

All 716 Node tests passed. New tests exercise the full migration chain and repeated D1 migration with a Storage policy fixture, quota/reset, tenant isolation, service permissions, private receipt projection, changed membership/file metadata and expired requests. Additional client-document, archive and quarantine finalization assertions passed in a focused rerun. Function tests verify URL withholding, service signing, quarantine and malformed gates. React tests verify paging, periods and quota visibility.

ESLint, changed-file Prettier and tracked whitespace checks passed. The repository-wide formatting check reports 89 existing files outside this changed-file check; these were not reformatted. Netlify CLI's offline production build packaged all 11 functions. Local database lint/advisory checks could not connect to `127.0.0.1:54322`; hosted advisors, concurrent-load behavior and authenticated staging acceptance remain required.

This is one Phase D slice. Profile reads, exports, previously loaded text/inline previews and historical snapshots still need broader server audit enforcement. Assessor/sales role projections, SSO/MFA, session revocation and data-subject request fulfillment remain pending. Receipt retention/cleanup needs an approved policy; counters use one row per user/workspace, but allowed-request receipts accumulate. No hosted migration or deployment was performed.
