# Integrity and bug-fix review — 6 October 2026

This pass checks the current local project, including the previously implemented phases. Existing work and the workspace provisioning SQL customization are preserved. No deployment or database migration is performed.

## Fixes

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| A demo candidate save using an old snapshot could undo another candidate's newer changes and erase newer notes and audit history. | Read and normalize the latest persisted workspace inside the candidate save lock, then apply the requested rows. | A test reproduces the loss before the fix and verifies both newer candidate edits, the note and all three audit events survive. Existing Anthro-ID allocation tests also pass. |
| An older repository reload could replace data after a workspace switch or a newer reload. | Guard successful responses, errors and loading state with request sequence, session user and workspace identity. Invalidate pending reloads when workspace or account context resets. | A UI test holds the original workspace's response, switches through the already-open workspace menu and releases the old response after the new candidate is visible. The new workspace remains visible. |
| A LinkedIn import retry could reject its own committed candidate as a duplicate after a lost save response. | Exclude the import draft's stable candidate ID from the canonical profile duplicate check. Other candidates remain subject to duplicate checks. | The UI regression exposes the committed row before retrying and confirms the same identity is saved successfully. The separate duplicate-profile rejection test passes. |
| The development dependency graph included vulnerable `source-map-js` 1.2.1. | Update only that transitive package to patched 1.2.2 in the lockfile. | Full dependency audit and Netlify build are rerun after the update. See [the reviewed advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). |
| Parallel module loads could each initialize a Vite server before the first startup completed. These servers shared caches and caused cache-rename failures and disconnected module transports. | Share one pending server-startup promise and give each Node test worker a separate cache directory, also isolated from production builds. | A dedicated regression verifies 18 concurrent startup calls return the same server. The application and workspace suites and then the complete suite are rerun. |

## Verification

- Complete Node suite: all 744 tests passed, zero failures or skips (302.6 seconds), after the final harness fix.
- Python private OCR safety suite: all 4 tests passed.
- ESLint, formatting of changed JavaScript files and Git whitespace checks pass.
- Netlify offline production build bundles all 13 functions and passes the entry-bundle budget (65.0 KiB against 100 KiB).
- Production and development dependency audits: zero reported known vulnerabilities across 417 dependencies after the patch.

The Node suite includes UI workflows, identity allocation and merging, imports, database migrations, tenant isolation, permissions, document access and scanning controls, MFA, subject requests, background jobs and reminder behavior. Database tests use the project's embedded PostgreSQL test fixtures.

The initial full run failed during Vite cache renames; isolating caches alone exposed the simultaneous startup race. Both causes were corrected, the focused 30-test harness/application/workspace run passed, and the final complete run passed. These earlier failures are retained here as diagnostic history rather than omitted from the review.

## Acceptance limits

Local verification does not establish the state of a hosted Supabase database or prove deployed RLS, secrets, schedules and storage policies match this checkout. Authenticated hosted acceptance, real VirusTotal/provider requests and actual ClamAV/OCR services remain deployment checks. The OCR tests verify bounds, arguments and cleanup using controlled tool responses. Same-record concurrent edits retain the existing last-save-wins behavior; the demo fix preserves newer unrelated records rather than introducing field-level conflict resolution.
