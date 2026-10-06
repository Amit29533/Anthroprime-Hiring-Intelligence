# Phase B3 — Paged repository reads

Implemented locally on 6 October 2026. This is an opt-in read mode for cloud startup, candidate browsing and Candidate 360. It does not migrate every workflow to bounded reads. Full matching, semantic ranking, saved views, bulk actions, reports, exports and editing retain their existing complete-snapshot behavior.

## What changes

Enable `settings.custom.pagedRepository` for a staging workspace and reload the app. Startup then reads only the active workspace's settings/taxonomy rows. It does not download candidates, documents, notes, workflow records or entire history tables. The overview obtains actual workspace totals from a read-only RPC, rather than counting an incomplete client cache. Navigation badges, notifications and cross-entity global search are suppressed until their full source snapshot is loaded; they never display misleading zero counts from partial data.

The repository fetches up to 50 candidate summaries per request. It sorts by case-folded name using a fixed collation, then UUID, and uses a cursor rather than increasing candidate offsets. Tied names paginate deterministically. Previous-page cursors are retained in the browser; changing filters resets the cursor. These are live reads, not a frozen export snapshot: concurrent renames can move records between pages. Refresh from the first page for a new traversal.

Search supports PostgreSQL full-text word/phrase queries and minus exclusions over profile/skill text and original CV text. Combined queries evaluate the profile and its accessible originals together; an excluded term in a CV cannot be bypassed by a profile-only match. Exact compact Anthro-ID, legacy UUID-format Anthro-ID and UUID lookup resolve retired merge identities. Retained CV and historical/evidence links follow their surviving candidate.

Structured filters cover status, work mode, exact location/skill, employer substring, engagement, minimum experience, maximum notice and admin-only maximum expected compensation. Summary pages contain no document text or contact/compensation fields. Unknown numeric values do not qualify for numeric limits. Full semantic/domain parsing, alternative sorts, saved views and exports remain in **More filters & bulk actions**.

Candidate 360 fetches one profile when opened, then only the selected section. Notes, documents, employment/compensation/availability history, assessments, training/enrichment, skills/evidence, pipeline, interviews, offers, placements, consent and history are each paged at 50 records. Document responses omit extracted text and inline binary data. Opening an original reuses the existing authorized signed-download flow; private paths are metadata, not public download links. No extraction or antivirus behavior changes here.

## Compatibility and access

- All read RPCs use `SECURITY INVOKER`, explicit active-workspace predicates and existing table RLS. Anonymous execution is revoked. Viewers can read within their workspace; compensation filtering requires an administrator. No service key is used by the browser.
- Cursor filters must match the current request, limits are capped server-side, and profile sections use a fixed table allowlist with bound identifiers/data. Missing or cross-workspace candidate IDs return an error.
- **Edit, match & manage candidate**, **More filters & bulk actions**, other workflow navigation and record creation load the complete workspace before exposing existing functionality. Full-snapshot load failure keeps actions unavailable. Repository save/delete helpers reject partial snapshots as an additional guard.
- After expansion, the session stays in the established full workspace mode. Reloading the app or switching workspace reapplies that workspace's flag. A legacy-mode data refresh continues loading the complete snapshot. Demo behavior is unchanged.
- Pending page/section responses are ignored after filter changes, navigation, modal closure or component unmount. Workspace changes clear the previous view. The existing session/membership source remains authoritative.

## Staging deployment

1. Apply `20261006092243_paged_repository.sql` after all preceding migrations, including the compact Anthro-ID and Phase B import migrations. It adds read functions and indexes; it does not alter candidate identities or create a new allocation sequence.
2. Deploy frontend and migration together. No additional Netlify function, API key, paid service or npm dependency is needed.
3. Set the existing `settings` row with `id='workspace'` → `custom.pagedRepository` to boolean `true`, preserving other settings. Leave it off until staging acceptance passes. This is a rollout flag, not an authorization boundary; RPC access always depends on membership/RLS.
4. Check candidate/document search and cursor query plans against representative volumes. The migration builds ordinary indexes in a transaction; schedule index creation appropriately for an existing large database. Complex CV searches combine accessible text and need real latency/volume measurements; the presence of GIN indexes is not a performance guarantee.
5. Verify startup request counts, totals, two workspaces and all roles; pages with tied names, retired IDs/CVs, missing contacts/unknown numeric values, stale requests and original downloads. Verify full matching/report/export/edit workflows expand first. Run hosted advisors and measure database latency, payload sizes, browser memory and concurrency before promotion.
6. Roll back by turning the flag off and reloading the app. Retain additive functions/indexes and import evidence. The existing full workspace view resumes without deleting data.

## Verification and remaining work

Local SQL tests exercise real migrations, replay, RLS/role boundaries, 120 candidate records with tied names, structured/text/negative searches, combined profile/CV terms, cursor traversal, retired identity/history, read section paging, input validation and document metadata projections. The real cloud-configured React App test confirms startup makes no candidate/document REST reads, then explicitly loads complete tables for legacy workflows. Separate UI tests exercise page cursors, filter resets, section reads and authorized original-opening errors.

This is not production deployment or completion of all Phase B acceptance criteria. Paged versions of matching, work queues, reports, cross-entity search, exports and mutations remain future work; they still load the full workspace when used. Representative hosted scale testing, the 200-real-CV import evaluation and Phase C's private scan/quarantine gate remain pending.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [PostgreSQL text search](https://www.postgresql.org/docs/current/functions-textsearch.html).

Full regression: **687 passed, 0 failed**, recorded in `artifacts/phase-b3-tests.log`. Focused SQL/App/UI checks passed again for the final merge-read and navigation changes. Lint, formatting and the production frontend build pass; the main bundle is **64.7 KiB / 100 KiB**. No hosted migration, deployment or representative scale benchmark was performed.
