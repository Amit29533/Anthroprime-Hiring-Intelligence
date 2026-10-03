# Deep code analysis and refactoring — 3 October 2026

## Scope

Reviewed the application shell, repository adapter, normalization, automation, importing, duplicate merging, authentication helpers, background workers, deployment configuration, existing tests, and project-wide function complexity. This is a local code review and refactoring pass; it does not claim authenticated production acceptance or a new feature-parity score. Existing UI and robustness changes were preserved, as was the user's workspace provisioning SQL customization.

## Architecture assessment

The project has a useful separation between framework-free business rules, repository access, React screens, and database enforcement. Supabase RLS, protected RPCs, composite relationships, and migration tests provide the security boundary; UI role checks supplement it. Private document access stays behind authenticated Netlify endpoints. Signed webhooks validate and pin public DNS addresses and reject redirects. Scheduled workers use database queues and leases.

The weakest maintenance boundary is the UI orchestration layer. `App.jsx` handles authentication, workspace context, navigation, dialogs, save behavior, and automation. `Workflows.jsx` formerly combined candidate import, login, assessments, activities, pools, analytics, settings, and administration. Splitting these responsibilities is preferable to introducing another application framework or replacing the established database boundary.

## Refactoring delivered

| Area | Change | Why it matters |
| --- | --- | --- |
| Login | Moved to `src/Login.jsx`; the app loads it directly. Existing `Workflows.jsx` exports remain compatible. | Authentication no longer depends on downloading the entire workflow/settings implementation. |
| Candidate import | Moved to `src/ImportCandidates.jsx` with its own dependencies and direct lazy entry. | CSV, XLSX, CV, and email-text import remain together without coupling them to administration. |
| Browser automation | Extracted `src/automationPlan.js`. It produces ordered persistence batches from a snapshot using candidate/demand maps. | Planning can be tested independently of React. Repeated rules now combine updates without duplicate tags. Persistence failure handling remains in the shell. |
| Normalization | Extracted per-table handlers into `src/rowDefaults.js`; normalization owns copied records and report configuration. | Defaults no longer modify caller-owned records. Frozen inputs work across all 37 tables. |
| Workspace preferences | Separated preference activation from row defaults; backup inspection opts out of activation. | Reading a backup no longer changes the active workspace's taxonomy or stage labels before restoration. Normal repository loading preserves its prior activation behavior. |
| Duplicate merge | Extracted `mergeCandidateRecords` into `src/dedupe.js`, with sequential related-record writes and explicit failures. | A failed related-record transfer no longer proceeds to hide the duplicate or announce success. The review stays open for recovery. |
| Async audit handling | Audit completion merges only the returned event into the latest snapshot and checks identity/workspace context. | A delayed audit response no longer replaces newer candidate state or applies after a context change. |

`Workflows.jsx` is reduced from 3,427 lines at Git HEAD to 2,735 lines; the responsibilities moved into focused modules rather than being removed. `schema.js` is reduced from 299 lines to approximately 65 lines of schema/orchestration code. This pass deliberately retains existing screen exports and data contracts.

## Verification evidence

- Behavioral comparison against the prior Git version: seed normalization and minimal records across all 37 tables produce equivalent normalized output.
- Frozen-input tests verify defaults, nested report configuration ownership, and normalization idempotency.
- Automation tests verify ordered tasks, due dates, deduplicated tags, unchanged-field behavior, and input preservation.
- Merge tests verify collisions, save order, exceptions, failure stopping, preserved input, and the actual Settings failure UI.
- Cloud UI regression deliberately delays an audit response while a newer candidate is saved; the newer candidate remains visible.
- Existing targeted workflow/cloud/merge tests passed before the final full regression run.
- ESLint, changed-file formatting, production build, and main-entry budget are verified separately in the local artifact logs. The build produces distinct login and import chunks; the login chunk is approximately 2 kB before gzip, import approximately 19 kB, and the workflow chunk approximately 95 kB. The main entry remains approximately 63 KiB against a 100 KiB budget.
- Full automated regression suite: **643 passed, 0 failed, 0 skipped**, approximately 304 seconds (`artifacts/refactor-verified-tests.log`). Final audit-race regression also passed independently. Final ESLint, scoped Prettier, production build, and bundle budget checks passed after the audit change.

## Remaining technical priorities

1. **Continue splitting orchestration.** Move workspace/auth lifecycle and feature rendering out of `App.jsx`, then extract Settings and large candidate-profile tabs. A diagnostic ESLint scan found 30 functions above cyclomatic complexity 25 before the normalization split. The extracted schema orchestration and table-default handlers no longer exceed that threshold; complex screens and report/matching functions remain. This diagnostic threshold is not a new lint failure policy.
2. **Transactional merging/restoration.** These operations still consist of separate saves. Earlier writes can remain after a failure. A protected server transaction should define collision handling, privacy/consent behavior, and transfers across newer candidate-linked tables before replacing the current contract. This pass stops erroneous continuation but does not claim atomicity or expand the merge relationship set silently.
3. **Repository scale.** Initial cloud loading and several screen filters still rely on a broadly loaded workspace snapshot. Expand server-side pagination/filtering and avoid loading document text for every list view; validate with realistic candidate/document volumes.
4. **Async context consistency.** Audit completion now has a context guard. Consolidate the remaining load/reload/switch paths around a shared generation or cancellation contract and add deliberately out-of-order workspace tests before a larger hook extraction.
5. **Operations and delivery acceptance.** Validate real R2 upload/download, provider callbacks, deployment configuration, recoverability, worker failure handling, and load against a staging workspace. Mocked cloud tests and embedded database tests cannot establish all hosted behavior.
6. **Formatting and test harness cleanup.** Project-wide formatting has existing differences outside this pass. Some async UI tests emit React `act` and mocked auth-client notices. Address these independently rather than mixing a repository-wide style rewrite into functional refactoring. The separately loaded PDF engine still produces the large-chunk advisory.

## Blueprint feature coverage

The historical 123-item blueprint matrix estimated 83% weighted coverage by counting partial requirements as half complete. Later implementation phases improved server execution, integration APIs, webhooks, and hosted intelligence, but the latest product audit explicitly does not rescore that matrix. Refactoring improves implementation quality and does not itself add blueprint features. A current percentage requires a fresh requirement-by-requirement assessment that distinguishes implementation, provider setup, and production acceptance. The old 83% should not be presented as a verified current deployment-completion percentage.
