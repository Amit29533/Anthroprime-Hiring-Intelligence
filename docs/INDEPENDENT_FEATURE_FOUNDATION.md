# Independent feature foundations

Started 8 October 2026, baseline `ad3b7eb`. This is the next build foundation after the [Independent Featureset Completion milestone](INDEPENDENT_FEATURESET_COMPLETION_MILESTONE.md). That milestone completed five defined continuation stages; it did not complete the original broader roadmap.

Working interpretation: independent features are capabilities that use the existing React/Vite, Netlify, Supabase and configured private storage without introducing another service. The modules share identity and security infrastructure. Making them separate products would require an additional tenancy, packaging and provisioning design; that is not implied by this foundation.

Status: architecture and acceptance contracts prepared. The new capabilities below are **planned**, not shipped. Existing workflows remain the baseline; no deployment, migration, provider activation or GitHub push accompanies this document.

## Shared boundaries

| Concern | Foundation contract |
| --- | --- |
| Identity | Candidate UUID is the relational identity; `ANTHRO-12345` is the compact display identifier. Resolve current roots and retained aliases through existing reviewed identity logic. Never create a second candidate merely to attach a new feature. |
| Access | Server checks current workspace membership, role and applicable assignment on every operation. Reuse financial/commercial projections and privileged MFA. Filter counts, search suggestions, exports and evidence must obey the same access boundaries as detail reads. |
| Evidence | Assertions, confirmed facts and demand-specific validated readiness remain distinct. Search/analytics must describe which state they use. Do not convert a profile status, similarity score or candidate response into certification. |
| Read contracts | Use validated filters, bounded pages, deterministic tie-breakers and a cursor bound to the selected filters/sort. Invalid, archived or unauthorized criteria produce explicit errors instead of silently broadening results. |
| Write contracts | Use explicit reviewed payloads, source/version checks and actor-bound operation receipts. Freeze failed acknowledgements for exact retry. Read-refresh failure after a successful write must not offer to repeat that write. |
| Lifecycle | Check holds, merged/retired identities and current source at the relevant boundaries. Keep governance review available where allowed; do not transfer outbound work automatically to a merged survivor. |
| UI | Make features reachable in both applicable repository modes. Candidate and client links carry UUIDs. Reset component state on account/workspace/role/entity changes and suppress old-scope responses. |
| Long work | Reuse bounded durable-job patterns for larger exports or batches. Declare selection, partial failures, cancellation behavior, retry limits and evidence expiry. A browser page is never an implicit whole-repository selection. |
| Privacy | For any new candidate-linked table, update the formal D7 inventory and relevant dry-run source inventory; decide D6 disclosure scope explicitly. Update source invalidation, merge behavior and full backup requirements in the same change. |
| Deployment | CLI-generated additive migrations, full-chain regression checks and frontend/function compatibility. Local completion and hosted acceptance are separate statuses. Commit locally; production activation is a separate task. |

## Next build tracks

| Order | Independent module | Existing foundation to reuse | What remains to build | Completion gate |
| --- | --- | --- | --- | --- |
| 1 | Advanced repository filters | `PagedRepository.jsx`, personal views, `repository_validate_filters`, custom-field definitions | Versioned typed filter contract; supported custom-field predicates; definition/archival handling; compatible saved views and stable cursors | Combined queries stay paged; unknown values and restricted fields behave explicitly; saved views survive supported changes; both routes and negative authorization scenarios pass |
| 2 | Data-quality resolution | Quality queues, duplicate decisions, durable imports, taxonomy | Human disposition ledger for import/taxonomy findings; reasons, source/version, assignment and reopen rules | Resolution does not imply source correction; corrected imports preserve identity/history; stale decisions and duplicate writes are rejected; inventories include new evidence |
| 3 | Bounded discovery | Candidate projections, typed demand constraints, readiness journal and existing matching | Demand-weighted paged matching and permission-projected cross-entity search, with source/coverage explanations | No full-workspace expansion; eligibility is separate from similarity; private fields cannot influence an unauthorized searchable projection; merge/expiry/paging scenarios pass |
| 4 | Reporting and reuse analytics | Readiness report, lifecycle analytics, selected report jobs, custom-field definitions | Bounded custom-field reporting, demand-weighted skill/gap summaries and explicitly defined reuse cohorts | Population/denominator/unknowns are disclosed; exports are audited and source checked; no unsupported funnel/conversion claims; quotas and representative volume checks pass |
| 5 | Recruiter action ownership and experience | Recruiter/SLA/feedback worklists, assignments and durable receipts | Clear assignment/reassignment rules, task handoffs, richer scoped queue filters and keyboard/mobile interaction | Competing updates have explicit conflict behavior; revoked access fails server-side; handoffs preserve history; role, retry, navigation and manual browser checks pass |

These tracks share contracts but should be delivered as reviewable vertical slices. None requires a new live email, calendar, AI or scanning provider. External delivery, mailbox/calendar synchronization, SSO and actual destructive erasure retain their documented dependencies and do not become “independent” by adding a settings form.

## First slice: advanced filter contract

The current paged path already supports ordinary candidate fields, saved personal views and four server sorts. The full-workspace structured-filter helper is a separate implementation. Before adding custom-field predicates, define and test one explicit contract rather than letting the two paths diverge further.

1. Inventory all current filter keys and semantics, including zero versus unknown, experience range, notice days, location/employer matching and financial permission restrictions. Preserve compatibility with existing saved views.
2. Define a versioned filter document with an allowlist of supported fields and operators, explicit numeric/date/choice types, AND semantics for the initial slice, and hard limits on criteria and payload size. Final server limits must be chosen and tested before activation.
3. Reference custom fields by their stable definition identity and version, not a mutable display label. Define behavior for archived/changed definitions and missing candidate values. Reject malformed or unsupported filters without running an unrestricted query.
4. Keep compensation filters behind administrator authorization and declared units/currency. Do not silently combine unlike currencies or expose financial membership through staff counts. Continue using the current protected server projections.
5. Implement server validation and indexed query predicates before enabling UI controls. Generate an additive migration with the Supabase CLI; inspect plans and select indexes from measured predicates rather than guessing.
6. Wire saved views, filter editing, result counts and cursor invalidation together. Loading a saved view must explain obsolete criteria and preserve the user's definition for correction. Changing filters or sort starts from page one.
7. Verify end to end with existing and new migration, permission and DOM tests: empty/unknown values, zero notice, contradictory ranges, unauthorized criteria, archived definitions, literal search text, malformed payloads, saved-view compatibility and duplicate/tied sort values.

Initial exit: a recruiter can combine supported professional/custom-field criteria, save the view, reopen it and page results without downloading all candidates or private histories. Administrative financial criteria remain separately authorized. Hosted performance and real-browser acceptance remain explicit follow-up gates.

## Verification and evidence per module

Record the module contract, routes, public API names, private tables/helpers, role matrix, source invalidation and migration dependency in one checklist. Include meaningful database and UI scenarios, not only tests that mirror the implementation. Run applicable focused tests first, then the complete regression suite when shared identity/access/migration behavior changes. Package the final frontend and existing Netlify functions together.

For hosted activation, repeat real Auth/PostgREST authorization, independent-session concurrency, realistic query plans/volume, private object access where relevant and recovery tests. Local PGlite/JSDOM results do not replace those checks. Use disposable fixtures and never put credentials or real candidate data into committed evidence.

## Implementation starting points

- [Paged repository UI](../src/PagedRepository.jsx) and [RPC adapter](../src/pagedRepository.js).
- [Existing full-workspace filter semantics](../src/repositoryFilters.js) and [filter regression tests](../tests/repository-filters.test.js).
- [Personal views and filter validation migration](../supabase/migrations/20261007080659_repository_views_and_quick_edit.sql).
- [Shared independent work queues](../src/IndependentWorkHub.jsx).
- [Original roadmap](FIVE_STAGE_PRODUCT_ROADMAP_2026_10_07.md), [dependency classification](NETLIFY_FEATURE_SPLIT_2026_10_07.md) and [current milestone evidence](INDEPENDENT_FEATURESET_COMPLETION_MILESTONE.md).
