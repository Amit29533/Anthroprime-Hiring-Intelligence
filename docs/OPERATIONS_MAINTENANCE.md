# Automatic indexing and integration administration

Implemented locally on 3 October 2026. Apply **039_operations.sql** after migrations through 037 and deploy the updated frontend plus `index-worker`. The optional **038_pgvector_index.sql** in `supabase/optional` may be applied before or after 039; there is no required core 038 migration. Keep RLS enabled. This change has not been pushed or deployed.

## Automatic private search indexing

Migration 039 backfills missing/outdated local vectors into a durable queue. Candidate creation, changes to the professional projection and merge-state changes update that queue. Name/contact-only edits do not require reindexing. Merging a candidate removes its queued job and stored vectors; search already excludes merged candidates.

The scheduled Netlify worker runs once per minute, claims at most 20 jobs and uses four concurrent database completions. This is a configured batch limit, not a measured production throughput guarantee. It uses the same deterministic `local-v1` feature-hashing implementation as the browser. Professional projections move only between your Supabase database and Netlify function; **no AI provider is called**. Existing server-only Supabase URL and service role credentials are required; there are no new credentials.

Claims have two-minute leases. A crashed worker can be reclaimed with a new lease; stale completions cannot overwrite a newer profile. Candidate/queue lock order matches normal profile updates. Vector writes and queue completion commit in one transaction. Failed completions retry with exponential delays and become terminal after five attempts. Workspace admins can see indexed/pending/processing/failed counts, the first 25 failed candidates and retry failed jobs in **Workspace settings → Automatic search indexing**. Manual shared-index refresh remains available.

Migration reruns preserve unchanged live leases. Index rows/queue content are not available to browser table reads. Service-only RPCs process the queue; the admin health RPC exposes counts and bounded failure metadata. Actual multi-session lock contention, scheduler cadence and batch throughput still require hosted acceptance testing.

The worker also marks AI requests left pending for over ten minutes as failed, covering a function that died before recording provider failure. Reserved request quotas are not refunded. Existing reviewed/completed artifacts are unaffected. This cleanup depends on the scheduled worker being deployed and running.

## External mapping reconciliation

Editors can use **Workspace settings → External candidate mappings** to filter by exact source and page through 25 mappings at a time. Each row shows source/external ID, current candidate and mapping version; merged links are identified. Select an active replacement candidate and explicitly click **Reconcile candidate link** to move that external ID.

Reconciliation changes the link only: it does not copy, merge or overwrite candidate fields. It accepts the displayed mapping version, increments it, and records the previous candidate ID and new version in metadata history. A competing edit produces a conflict requiring refresh; stale integrations cannot continue using the previous mapping version. Cross-workspace and merged replacement targets are rejected. Viewers cannot use the mapping RPCs. The original latest-100 mapping RPC remains compatible.

Offset pagination uses a stable source/external-ID order. It is not a snapshot under concurrent insertions; refresh the filtered result after reconciliation/imports. Dedicated machine-account credentials and automated conflict-resolution policies remain future work.

## Webhook key rotation

1. Pause the subscription in workspace settings.
2. Wait for any active delivery leases to finish/expire. The server rejects rotation while a lease is active.
3. Enter a new random 32–256-character signing secret and click **Rotate signing key**. The input clears after a successful save. Secrets are never returned by listing APIs or written into audit snapshots.
4. Install the same new secret in your receiver, then enable the subscription again.

Claims lock both the subscription and delivery rows, serializing claim activity with pause/rotation. Queued events retain their IDs and are signed with the current key when claimed. Completed deliveries are not replayed. There is no grace-period dual-key validation; the receiver must be updated before resuming. Secret storage remains in protected database columns; separate application-key encryption and broader retention controls remain pending.

## API additions

- `worker_claim_index(p_limit=20)` / `worker_finish_index(p_workspace,p_candidate,p_lease,p_vector=null,p_failed=false)`: service role only.
- `api_index_health(p_retry_failed=false)`: workspace admin only; counts, bounded failure metadata and explicit failed-job retry.
- `api_mapping_page(p_source='',p_offset=0)`: editor-only; `{rows,total}`, 25 rows, no cross-workspace joins.
- `api_reconcile_mapping(p_source,p_external_id,p_version,p_candidate)`: editor-only, optimistic version check, active same-workspace target.
- `api_rotate_webhook(p_id,p_secret)`: admin-only, paused/drained subscription required.

No outbound email, calendar/mailbox OAuth connector, AI bulk indexing, client portal or retention-based candidate deletion is introduced by this slice.
