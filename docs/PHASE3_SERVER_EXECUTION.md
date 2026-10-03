# Phase 3 — Server execution foundation

## Delivered first slice

Migration 035 adds workspace-controlled server execution, PostgreSQL assignment triggers, durable workflow jobs, atomic database processing, admin job filters and replay controls, and a scheduled Netlify worker. Candidate/demand creation receives the same assignment regardless of whether it comes from the UI or an authorized API. Workflow triggers cover candidate/demand status, consideration stage, offer status and interview recommendation using the existing rule definitions.

Normal execution captures rule actions when a change commits. Later edits to a rule do not alter already queued work. Failed jobs may be explicitly retried with the rule's current actions after the administrator fixes it; completed jobs cannot be replayed. The original candidate/demand links and event date remain attached to retries. Disabling or deleting a rule blocks manual retry until it is restored/enabled.

The queue is a normal PostgreSQL table, rather than requiring another extension/service. `FOR UPDATE SKIP LOCKED` claims a bounded batch inside the same transaction as the actions and completion. A worker crash rolls back the claim and effects together. Each job has its own exception block: failed actions leave no partial task/note/tag/next-action changes. Automatic retries use 60, 120, 240 and 480-second delays, then the fifth failure becomes terminal. These guarantees cover database actions only; they do not promise exactly-once delivery to an external email provider.

Existing owned records are never reassigned. Assignment runs only on INSERT, uses the existing rule ordering and preserves explicit ownership. No existing records are backfilled. Workflow-generated candidate tag/next-action updates preserve current fields rather than restoring an old profile snapshot. Queued work pauses while server execution is disabled; legacy browser automation remains available in that mode.

## Deploy and activate

1. Deploy the new frontend and `execution-worker` function to Netlify. Leave server execution disabled while deploying. Reload old browser tabs before activation; old builds do not understand server execution and can otherwise apply duplicate client actions.
2. Apply migration **035_server_execution.sql** after 001–034. It is rerunnable and defaults every workspace to browser execution. This slice does not change `PROVISION_WORKSPACE.sql`.
3. Add **SUPABASE_SERVICE_ROLE_KEY** to Netlify's Functions environment alongside `SUPABASE_URL`. This is the Supabase server secret/service-role credential, never a `VITE_` variable and never committed. The scheduled worker uses it across workspaces. Frontend requests keep using the public key and the user's session.
4. Redeploy so Functions receive the environment changes. Confirm the scheduled function appears in Netlify. Netlify schedules run on the published production deployment, not the Vite development server or deploy previews.
5. In Workspace settings → Background workflows, enable server execution for the chosen workspace. Only its administrator can enable, pause or retry jobs. Switch modes during a quiet period with no saves in flight; the frontend checks the authoritative mode before each rule-bearing save, but a mode change and an already-started save are separate requests.
6. Create a harmless rule and test candidate in your test workspace. Check the assignment immediately, then refresh the queue after a scheduled tick and reload the repository to see workflow-created tasks/notes. Verify one action, one completed job, and no extra actions on subsequent ticks. Failed jobs show a sanitized SQLSTATE; inspect the relevant rule and record links, correct them, then retry.

The worker processes at most 20 due jobs per tick. The callable database batch supports 1–50 and only the service role can execute it through the API. Its request deadline is 15 seconds. A successful HTTP response means the database batch completed, not that all pending jobs were processed. If configuration/migrations are absent, the worker fails rather than pretending the queue ran. Check Netlify function logs and the queue's pending timestamps for operational health. Queue records are not automatically deleted in this slice; include retention and growth monitoring in operations.

## Permissions and audit

Authenticated clients cannot insert/update/delete queue rows or run the worker RPC. Only active-workspace admins can read the queue or call administration RPCs. Recruiters/viewers cannot inspect captured payloads; the admin list returns summaries rather than actions. History records queue lifecycle summaries without payloads; task/note/profile changes use their existing audit and incremental feeds. Full queue payloads are not exported by general repository sync/backups.

## Remaining Phase 3 work

- Outbound email provider integration and durable, provider-aware delivery idempotency.
- Interview invitation and application acknowledgement send flows with reviewed content.
- Scheduled report generation/delivery and time-based workflow conditions.
- Deployment verification with your actual Supabase/Netlify configuration, concurrent worker tests against hosted PostgreSQL, throughput measurement and retention/monitoring operations.

The first slice is implemented and tested locally. It has not been pushed, migrated on the hosted database, or deployed by this task. No real email is sent by the worker.

## References

[Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/) explain production-only schedules and invocation behavior. [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html) documents `FOR UPDATE SKIP LOCKED`. [Supabase Queues](https://supabase.com/docs/guides/queues) is a possible future extension-backed queue; this slice uses ordinary PostgreSQL transactions so the existing migration test environment can verify the full action lifecycle.
