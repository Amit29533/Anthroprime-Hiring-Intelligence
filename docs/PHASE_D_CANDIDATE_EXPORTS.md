# Phase D2: audited candidate CSV preparation

Implemented locally on 6 October 2026. The opt-in workspace JSON boolean is `settings.custom.auditedCandidateExports=true`, default off. This covers candidate CSV buttons in the repository and Workspace settings, using authenticated Supabase RPCs. No new Netlify function, paid provider or server secret is required.

## Export behavior

The browser sends only candidate IDs. PostgreSQL checks current workspace membership and allows administrators/recruiters; viewers and anonymous callers are denied. The membership row is locked for the preparation transaction so a concurrent role change cannot change its authorized projection midway through preparation. Every selected ID must identify an active, unmerged candidate in that workspace; missing, foreign or merged selections fail together without partial results.

The server fetches current values and projects an explicit CSV field list: Anthro-ID, name/contact details, role/employer/location, experience, notice, skills, status, source, work mode and verification date. Only administrator exports include current/expected compensation. No document bytes, extracted CV text, notes, assessments, custom fields, owner history or client commercial data are included.

Selections are limited to 1–500 distinct IDs, with a maximum projected JSON payload of 1 MiB. Larger selections fail rather than silently truncating. Export the current filter/selection in smaller batches. Settings exports exclude merged records; they do not become a background full-database export.

Each user/workspace gets six preparations per 60-second window, starting with the first accepted request. PostgreSQL serializes the quota across sessions. Invalid selections and failed transactions do not consume quota. Rate-limited requests return no rows and a retry interval. Repeated denials aggregate in a counter with one throttled receipt per window. This is a resetting window, not a sliding-window limit.

Preparation and its private receipt commit in the same transaction. Receipts record the server actor/time, row count, selected IDs, projection, schema version and SHA-256 of the projected JSON snapshot. They contain no candidate content or contact values. Browser roles cannot read/write receipt tables. The administrator page excludes selected candidate IDs and contact values, exposing only receipt metadata. The SHA-256 covers the JSON snapshot, not the CSV byte stream; this is not a digitally signed CSV.

The client creates the CSV only after a valid server response. Each row carries the receipt ID, server actor/time, schema version and snapshot SHA-256. Formula-like cell values are escaped. A lost response consumes a preparation and may leave a receipt even when no file was saved. Retrying prepares fresh data and creates another receipt. `prepared` certifies database preparation, not download completion or delivery to a third party.

## Administrator review

**Workspace settings → Candidate CSV export audit** pages 50 server receipts for the last day or week. It totals prepared rows and rate-limit windows, and shows a review prompt when the selected period includes at least 1,000 prepared rows or any quota window. Repeated candidates count again. This fixed review threshold is not automated anomaly detection or an external alert. Review purpose and actor context before concluding that activity was inappropriate.

## Deployment and acceptance

1. Back up and apply every migration in filename order through `20261006151139_audited_candidate_exports.sql`, after the D1 migration. The D2 migration is repeatable and adds private tables, indexes and explicitly granted member/admin RPCs.
2. Deploy the frontend. Keep the new flag off initially. The new frontend queries `api_candidate_export_mode` before cloud candidate CSV exports; a missing migration or unavailable configuration fails closed rather than falling back.
3. Enable the JSON boolean in staging. Verify two workspaces and admin/recruiter/viewer roles, refreshed server values, compensation omission, direct RPC boundaries, merged/missing records, mixed-tenant selections, 500-ID and payload caps, simultaneous requests, quota/reset, delayed/lost responses, CSV formula escaping and receipt paging/volume prompts.
4. Run hosted Supabase security/performance advisors and representative load checks before limited production activation. The offline Netlify build packages the unchanged set of functions; the export endpoint runs in PostgreSQL.
5. Roll back by turning the flag off. Existing browser CSV behavior returns; preserve private receipts/schema. This restores compatibility and removes this slice's app export enforcement for that workspace.

Direct callers of `api_prepare_candidate_export` always receive its permission checks, quotas and receipts, regardless of the UI opt-in flag.

## Scope and remaining work

This slice governs these two CSV flows. Members can still read permitted records and copy or serialize data already accessible to them; it does not prevent all data extraction. Legacy mode retains browser-generated CSVs and its existing compensation behavior. Reports, dossiers, letters, data-subject exports, backups, historical snapshots and profile reads still need separate server projection/audit paths. Broader role redesign, SSO/MFA, session revocation, retention cleanup and data-subject fulfillment remain pending. Receipt retention needs an approved policy; counters use one row per user/workspace but preparation receipts accumulate.

Current implementation follows Supabase's [database function security guidance](https://supabase.com/docs/guides/database/functions). Security-definer RPCs use empty search paths, explicit tenant/role checks and revoked default execution; private tables also enable RLS. No hosted migration or deployment was performed.

## Verification

All 720 Node tests passed. New tests cover repeated migration, fresh database rows, server provenance, role projections, private receipt access, anonymous/viewer denial, two-workspace isolation, quota aggregation/reset, payload rollback, formula escaping and admin paging/volume review. Existing candidate export and viewer workflows also passed.

ESLint, changed-file Prettier and tracked whitespace checks passed. Netlify CLI's offline production build packaged all 11 functions; the frontend passed its entry bundle budget. Local security/performance advisors could not connect to `127.0.0.1:54322`. Hosted advisors, concurrent-load checks and staging acceptance remain required. No production migration, flag activation or deployment was performed.
