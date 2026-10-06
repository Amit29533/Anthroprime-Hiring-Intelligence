# Phase E1: internal interview preparation reminders

Implemented locally, disabled by default. No hosted migration, activation, external message or deployment has been performed.

When enabled for a workspace, the scheduled Netlify worker creates a shared Notes & Tasks preparation task for each Scheduled interview starting within the next 60 minutes. The persisted interview is the durable schedule, so an open browser is unnecessary. Existing upcoming interviews are included automatically when they enter the window; elapsed interviews are skipped after an outage. UTC timestamps appear in task titles and determine checklist due dates; the admin receipt view uses browser-local time. Tasks have no automatic individual assignee.

Task creation and its private receipt commit atomically. Interview row locks, `SKIP LOCKED` and a unique active receipt prevent retries or overlapping workers from duplicating tasks. Each invocation considers at most 20 eligible interviews; the database supports limits 1–50. Failed task creation rolls back that item, records a generic SQLSTATE without candidate/error text, and retries with 1/2/4/8 minute delays. After five failures an administrator can explicitly retry an interview that is still Scheduled and in the future. Other items in a batch can proceed. Host throughput and concurrent invocation still require staging acceptance.

Rescheduling, candidate/demand relinking, round/mode/panel changes, cancellation, completion, no-show or deletion cancel the active receipt and mark its linked task done in the same source transaction. A new future schedule may create a replacement task. Notes/feedback-only edits preserve the receipt. Completing a checklist task manually does not create another reminder for the same interview. Pausing stops new task issuance, preserves existing tasks/receipts and continues invalidation on interview changes. Re-enabling processes interviews still in the future; it does not replay elapsed interviews.

This is an internal preparation checklist, not delivery to candidates or interviewers. No email, SMS, calendar invitation, provider credential, delivery/bounce callback or consent-based external send is involved. Workspace members see tasks through existing task permissions. Application acknowledgements, candidate reminders, freshness campaigns and communication outbox/provider integration remain Phase E work. Pending/failed receipts for elapsed interviews remain review evidence and cannot issue a task; retention cleanup is separate work.

## Controls and API

Settings → **Internal interview reminders** shows enable/pause, the global worker heartbeat, paged receipts and explicit retry for failed future interviews. Refresh the workspace to load tasks into Notes & Tasks. The heartbeat indicates a successful database batch, not proof every workspace interview has been processed or that external delivery occurred.

Private schema tables store workspace policy, reminder receipts and worker health. All have RLS with no browser table access. The permission-checked public RPCs are:

| RPC | Caller | Contract |
| --- | --- | --- |
| `api_interview_reminders(p_offset integer=0)` | Workspace admin | Enabled flag, last successful global batch, total and 50 receipt rows; offset 0–10000. |
| `api_set_interview_reminders(p_enabled boolean)` | Workspace admin | Enable or pause; returns authoritative enabled state. Repeating the same choice is safe. |
| `api_retry_interview_reminder(p_id uuid)` | Workspace admin | Retry a failed own-workspace receipt for a still-future Scheduled interview. |
| `worker_run_interview_reminders(p_limit integer=20)` | Service role | Atomic bounded batch; returns `created` and `retriedOrFailed`. |

Admin RPCs use the existing membership/MFA guard. If D5 is active, verify the authenticator in Settings first. Recruiters, viewers and anonymous users cannot configure/retry/read private receipts or invoke the worker. Existing task permissions still apply. No caller-supplied actor, schedule or candidate projection is trusted for task issuance.

## Deployment and rollback

1. Back up and apply all migrations through `20261006161504_internal_interview_reminders.sql` in filename order, then deploy frontend/Netlify functions together. Migration replay is safe. No data or policy is activated by the migration.
2. The new `interview-reminder-worker` uses the existing `SUPABASE_URL` (or `VITE_SUPABASE_URL`) and server-only `SUPABASE_SERVICE_ROLE_KEY`. Its Supabase client limits fetches to 15 seconds. There is no new provider, package or secret.
3. Deploy as a Netlify Git build with functions. Static drag-and-drop alone cannot execute server reminders. The worker's minute schedule runs on published deployments; previews/branch deploys need a manual provider invocation. Verify the function is marked Scheduled and inspect logs before enabling.
4. In staging, enable a test workspace and verify due/future/past interviews, duplicate/replayed/concurrent invocations, rescheduling versus task creation, paused workspaces, failure recovery, cross-workspace permissions, MFA and actual task synchronization. Check the worker heartbeat after closing the browser. Run hosted database advisors and monitor backlog/latency against Netlify's execution limits.
5. Pause first for rollback; preserve receipts/history and existing tasks. Rolling back the frontend does not disable the scheduled worker, so pause through the current UI/RPC before reverting. Database operators can disable the private policy in an emergency. Do not delete receipts to make a retry: that can create duplicates.

Scheduling follows [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/); browser RPC integration follows [Supabase database functions](https://supabase.com/docs/guides/database/functions). Platform quotas/usage still apply.

## Verification

Four focused migration, worker and UI tests passed for repeated migration, atomic/replay-safe task creation, time window/pause, reschedule/cancel, tenant/admin/MFA denial, worker privileges, five-attempt recovery, cross-workspace failure isolation, redacted errors and paged controls. The full run exercised 734 tests: 731 passed and three older migration fixtures failed because they omit `service_role`. The migration now grants service execution conditionally; all three affected fixtures plus the reminder migration passed on rerun. A final timestamp/index review also passed the reminder migration check. The complete suite was not rerun after that narrow grant fix. ESLint, changed-file formatting, whitespace and Netlify offline build passed; all 12 functions were packaged, the reminder minute schedule appeared in the manifest and the entry bundle met its 100 KiB budget (64.8 KiB). No hosted scheduler, real concurrency or database advisor acceptance has been performed.
