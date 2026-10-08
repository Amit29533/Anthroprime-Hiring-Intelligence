# Phase 5: recruiter worklist foundation

First slice implemented locally on 7 October 2026, using the existing React/Vite, Netlify and Supabase stack. Phase 5 remains in progress in [the five-phase plan](CURRENT_STACK_BUILD_PHASES.md). No new service, live communication transport or destructive privacy operation is introduced.

## Using the worklist

The shared cloud **Repository overview** includes a recruiter worklist without switching to the full-workspace workflow layout. Choose Tasks, Follow-ups, Interviews or Client feedback, an upcoming horizon of 1–30 days, and pending or completed/handled records. Past deadlines and undated tasks remain visible. All client feedback remains available regardless of horizon. Dates and overdue counts use UTC; interview rows represent scheduled interviews only, not completed interviews or SLA breaches.

Each page contains at most 25 records. Queue totals cover all matching records rather than just the visible page. The supported maximum offset is 10,000; this is bounded interactive browsing, not an export. A candidate button opens the existing profile workflow. Follow-ups and interviews are updated there using existing forms. The legacy full-workspace Activities screen remains available separately.

Workspace members can remember their own queue/horizon. These are personal display settings, scoped to actor and workspace; they do not change worker reminders or communication suppression. Existing notification/reminder preferences remain separate. Demo mode retains its existing activities workflow.

Administrators and recruiters can complete/reopen tasks and mark/reopen client feedback as internally handled. Viewers can read and save their own display settings but cannot decide work. Handling client feedback does not modify its original content, candidate stage, client decision, assessment or interview schedule and does not send a message.

## Consistency and access

Three authenticated RPCs expose bounded reads, preferences and actions: `api_recruiter_worklist`, `api_worklist_preferences`, `api_worklist_action`. They recheck current workspace membership; actions additionally require an editor. External client accounts and anonymous users cannot read the worklist. Private tables and internal row helpers have no browser access. Projections omit complete candidate/contact/compensation/document/history objects; titles are limited to 200 characters. Titles still contain recruiter-entered text and must be treated as internal information.

Actions require a version fingerprint and an actor/workspace-bound operation UUID. The database serializes retries, locks the target record, checks its current version and records the result. Changed task fields or feedback handling state require a refresh and a new decision. Exact retries return their original receipt without repeating the write; altered requests using the same operation are rejected. Membership removal also denies a replay.

The UI retains failed intents. **Retry exact worklist action** works even after refreshing removes a task that was committed before its response was lost. **Clear failed action and refresh** discards the local retry and permits a new reviewed decision; it does not undo a committed change. Switching workspaces resets the worklist. Offset pagination may shift during concurrent queue changes; refresh after a decision, and use an approved export workflow for complete extraction.

## Activation and privacy

Apply all migrations in filename order through `20261007114511_recruiter_worklist.sql` before deploying this frontend. It follows the Phase 4 privacy migration and requires those earlier tables/functions. No additional Netlify function, environment variable, provider account or API key is needed.

D7 erasure inventory now has **38 categories**, including candidate-linked worklist receipts. Recapture old checklists because scope/fingerprints change. D6 still covers its existing 18 reviewed direct-record categories and explicitly excludes worklist decision receipts; review those separately where relevant and regenerate previously prepared packages after the scope-notice change. Personal display preferences are operational account records and require separate account retention assessment. No erasure is performed by this slice.

Local migration/UI checks cover page boundaries versus global totals, future/undated work, role/tenant isolation, personal preferences, stale updates, feedback handling/reopening without changing original feedback, replay after lost acknowledgement, access removal, invalid filters/responses, and privacy inventory inclusion. Migration reapplication is checked. Hosted security/performance advisors, real concurrent-session tests, representative workload checks and staging acceptance remain required before activation. Embedded PostgreSQL tests do not establish hosted concurrency or performance guarantees.

## Remaining Phase 5 slices

- SLA policies and notification preferences, candidate self-update review, redeployment prompts and feedback surveys.
- Template previews, durable intents, segmentation and suppression using a test transport; external sends stay disabled.
- Further health/recovery and representative-volume acceptance, building on existing worker/admin panels.
- Retention-policy controls, coverage review, erasure dry runs/batches and explicit fulfillment evidence, with destructive execution disabled pending approved policy, authorization and recovery assurance.

Work is committed locally only. See the five-phase plan for verification results; hosted activation and GitHub publication are separate actions.

Verification: 799 Node regression tests and four OCR tests passed, as did lint, changed-file formatting and documentation links. Offline Netlify packaging included all 17 existing functions, and the final frontend build stayed within its 100 KiB main-entry budget at 65.4 KiB. Local Supabase advisors could not connect to `127.0.0.1:54322`; hosted advisor acceptance remains pending.
