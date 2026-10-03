# Robustness review — 3 October 2026

This review covers the current local working tree, including the pending UI refresh. Changes have not been committed, pushed, or deployed by this review.

## Confirmed problems fixed

| Problem | Correction | Regression coverage |
| --- | --- | --- |
| Closing overlapping dialogs out of order could unlock scrolling too early and leave scrolling permanently disabled afterward. | Share a reference-counted scroll lock per document and restore the original style when the final dialog closes. | Open two dialogs, close the first, then close the second; verify both intermediate and final overflow values. |
| A backup could omit a table declared in its manifest and silently restore an empty table. Unsupported versions and mismatched row counts were also accepted. | Validate versions, manifests, row shapes, and declared counts before restoring. Continue accepting older manifests that predate newer tables. | Missing table, unsupported version, truncated count, and old-manifest compatibility tests. |
| Backup restore reported success when a storage callback returned `false`. | Stop at the first failed table and report that earlier tables may already have been restored. | Failed callback stops later writes; thrown errors propagate; successful restore counts remain correct. |
| Browser automation reported success after an action failed to save. | Stop subsequent actions, retain the successfully saved original record, and report partial automation. Do not write a successful automation audit event. | Cloud-mode UI integration test injects a failed task write and checks the saved candidate, warning, and absence of a success audit event. |
| An indexing storage exception aborted unrelated claimed jobs and could expose underlying diagnostic text. | Handle thrown and returned storage errors per job, attempt retry bookkeeping, finish the remaining batch, and surface a sanitized error if completion cannot be recorded. | Ten-job failure isolation, transport-error retry, stale retry handling, and existing four-job concurrency checks. |

## Verification

- Full automated suite: **634 passed, 0 failed, 0 skipped**, completed in approximately 313 seconds. See `artifacts/robustness-final-tests.log` for the final result.
- ESLint: passed without errors or warnings after removing an unused import.
- Production build and bundle budget: passed; main entry is approximately 63 KiB against a 100 KiB budget.
- Formatting: all changed JavaScript, JSX, and CSS files passed the scoped Prettier check. Project-wide formatting has pre-existing issues outside this change.
- Git whitespace validation: passed.
- Dependency audits: no known vulnerabilities reported in either the production-only audit or the complete audit including development dependencies at review time.
- Local browser smoke check: demand dialog opened and closed, body scroll locking restored correctly, no document horizontal overflow, and no browser console errors during that check.

## Limits and remaining operational concerns

This is not a guarantee that every production behavior is bug-free. Automated cloud interactions use controlled mocks and database migration tests; this review did not submit real candidate data, change live Supabase settings, or exercise live R2 uploads and external providers.

Restore remains a merge across separate table saves, rather than one database transaction. Earlier successful writes are retained if a later table fails; the UI now states this accurately. A transaction-based server restore would require a separate server feature and role/constraint review.

The PDF parsing engine still generates Vite's large-chunk advisory (approximately 618 kB before gzip). It is loaded separately, and the enforced main-entry budget passes. Existing asynchronous UI tests emit some React `act` and duplicate mocked auth-client notices; passing results should not be interpreted as eliminating those test-harness warnings.

The user's local `supabase/PROVISION_WORKSPACE.sql` customization was preserved.
