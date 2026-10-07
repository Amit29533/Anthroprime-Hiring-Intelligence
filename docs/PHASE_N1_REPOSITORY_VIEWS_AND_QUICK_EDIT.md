# Existing-stack Phase 1: saved views and bounded quick editing

Implemented locally on 7 October 2026. Part of [five current-stack build phases](CURRENT_STACK_BUILD_PHASES.md). This is the first slice, not completion of the whole Phase 1 backlog.

## User-visible behavior

In an opt-in paged workspace, Talent repository now offers **My saved views** with create/apply/delete/refresh. Views are personal to the signed-in account and active workspace, persisted in the database, with up to 50 views and unique case-insensitive names per account/workspace. Save captures the currently entered filters. Applying a view resets pagination and performs a bounded query without expanding the complete workspace. Shared legacy settings views remain available in the existing full-workspace route; they are not migrated or overwritten.

New filters: maximum total experience and exact tag, alongside the existing minimum experience, notice, engagement/mode/location/skill/employer and admin-only expected-compensation limits. Sorts: name ascending, most recently verified, most experience and shortest notice. Numeric unknowns sort last; ties use case-folded name and UUID. Search retains profile/original CV full-text and retired Anthro-ID resolution. Pages remain capped at 50 and omit contacts, compensation and extracted originals.

Candidate 360 exposes **Edit owner & next action** to editors, loading only this candidate's quick-edit context. Save changes only those two fields. It preserves verification dates, identity, compensation, employment and other facts; the existing database trigger records history. A stale token blocks a different update; the UI keeps the draft and offers explicit reload/cancel. Repeating an already-satisfied update returns current context without writing another history event. This is desired-state replay behavior, not a general operation-receipt API.

## Database and authorization

Migration: `20261007080659_repository_views_and_quick_edit.sql`, generated with the Supabase CLI. Apply it after all preceding migrations, including internal freshness reviews.

- Views live in a separate `ecod_repository_private` schema, with RLS and no direct table grants to browser roles. The narrowly granted private helper binds every operation to `auth.uid()` and the current workspace. Its public wrapper is a security-invoker function. View writes lock the actor's membership row to serialize quota checks; save IDs are replay-safe for the same actor/name/filters, and conflicting reuse fails. Delete is scoped and safely repeatable.
- Existing Admin/Recruiter/Viewer accounts can keep personal views. Saving compensation filters requires current administrator access. After an admin downgrade, financial filter values are omitted from that account's returned view and the view is marked restricted; the UI refuses to apply it rather than silently broadening its results.
- Page queries and quick-edit RPCs use security invoker and existing RLS. Quick edits require current editor access, bound workspace/candidate lookup, an unmerged candidate, valid field lengths and a whole-row conflict fingerprint. The fingerprint detects changes; it is not an authorization credential. Anonymous execution is revoked.
- All saved filter keys/types/lengths/ranges and sort choices are validated. Cursors bind the complete applied filter object and include the selected sort value plus name/UUID. Concurrent edits can move records between live pages; refresh from page one for a new traversal. This is not a frozen export snapshot.
- Workspace changes remount paged candidates to clear account/workspace view state. Late read responses are ignored; quick-edit and saved-view mutation results are ignored after unmount. Save retries reuse the same client operation ID while the intent is unchanged.

## Deployment and rollback

No new npm package, Netlify function, provider credential or worker service is required. Keep the existing `settings.custom.pagedRepository` flag and deployment architecture. Back up, apply migrations in order, then deploy the frontend. Verify personal views across reloads/workspaces, every sort with ties/nulls, compensation role downgrade, stale quick edits, editor/viewer denial and history in hosted Auth/PostgREST staging.

For rollback, revert the frontend and leave additive private storage/API changes in place. Do not reapply the earlier paged-repository migration last: it would replace the newer page function and remove the new filter/sort behavior. Personal views are private account records and need inclusion in backup/retention inventories; candidate-specific text inside arbitrary saved queries is not automatically attached to a subject-request inventory.

## Verification boundaries

All **770 Node tests** and **four OCR tests** passed. Five final focused checks also passed after expanding same-account workspace-switch coverage. Lint and changed-file formatting passed. Netlify's offline production build packaged the existing **15 functions** without bundler warnings; the main entry is **65.1 KiB**, below its 100 KiB budget.

Meaningful checks cover tenant/actor and same-account workspace isolation, direct table/anonymous/viewer denial, role downgrade, personal-view quota/ID replay, all four cursor orders with null/tied values, experience bounds, audit/no-op replay, failed-draft retention and avoiding full-workspace expansion.

Repository-wide default formatting checks reported existing Windows CRLF differences; a line-ending-tolerant run reduced the remaining warning to the unchanged `tests/migration030.test.js`. This slice does not reformat unrelated files. All modified/new source and test files pass the configured formatter.

See the [new RPC contract](API_REPOSITORY_VIEWS_AND_QUICK_EDIT.md) for parameters and response semantics.

Supabase local advisors could not connect to `127.0.0.1:54322`; hosted advisors and PostgREST/Auth acceptance remain required. No hosted migrations, production flags or live candidate records were changed.
