# ECOD public API contract (v1, hosted RPCs)

The workspace exposes hosted PostgreSQL functions (Supabase RPC endpoints). Workspace-data RPCs are security-definer and workspace-scoped; public careers RPCs are deliberately narrow. PGlite migration suites exercise the SQL through migrations 001–033 (`tests/migration*.test.js`). Authenticate with the caller's Supabase JWT where required.

## `POST /rest/v1/rpc/api_changes_since` — incremental sync (§14 `updated_since`)

Returns every workspace record created or changed on/after `day`, for the caller's
workspace only. Cross-tenant safe; `anon` is denied.

| Param | Type   | Notes                                                                                                                |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `day` | `date` | Defaults to `current_date - 30`. Rows are matched by `created`/`updated`/`date`/`submittedOn` etc., day granularity. |

Response `jsonb` includes `since` and one array for each repository table, including `candidates`, `demands`, `considerations`, `assessments`, `notes`, `enrichment`, histories, `auditEvents`, `documents` metadata, `taxonomy`, `demandCommercials`, `settings`, `consents`, `interviews`, `offers`, `tasks`, `submissions`, `publicApplications`, `workflowRules`, `placements`, `placementCommercials`, `assessmentTemplates`, `talentPools` and `poolMembers`. Each array is ordered by its table id and each row omits `workspace_id`. Internal demand and placement commercials are returned only to workspace admins; other members receive empty commercial arrays.

Errors: `{ "error": "no workspace membership" }` when the caller has no membership; HTTP
403-class permission error for `anon`.

Feed ordering is deterministic: every table is returned ordered by its primary key, so a
sync client can resume from the last seen id without ambiguity.

Client example:

```js
const { data, error } = await supabase.rpc('api_changes_since', { day: '2026-09-01' });
```

## `POST /rest/v1/rpc/api_public_open_roles` — public careers listing (`anon`)

Returns a curated list for one workspace only. Direct anonymous `SELECT` on `public.demands`
is revoked, so this RPC is the only public role-read path. It returns `id`, `title`, `client`,
`location`, `mode`, `engagementType`, `positions`, `description` and `skills`—never budget,
matching weights, internal tags or the workspace id. Only `Open` demands with
`careersVisible=true` are returned. That flag defaults to false; a recruiter explicitly publishes
an individual role from its demand form. The careers page reads the workspace from its `?ws=` URL
parameter (or a previously stored value).

| Param         | Type   | Notes                                                                                    |
| ------------- | ------ | ---------------------------------------------------------------------------------------- |
| `p_workspace` | `uuid` | Workspace to list; results are filtered by this id inside the security-definer function. |

```js
const { data, error } = await supabase.rpc('api_public_open_roles', { p_workspace: workspaceId });
```

## `POST /rest/v1/rpc/api_public_apply` — careers-page applications (public, `anon`)

Creates a `publicApplications` row for triage in the workspace's Activities page. The workspace
UUID is public configuration on the careers URL (`/careers.html?ws=<workspace-id>`); public
listings still expose only explicitly published roles through the scoped RPC above.

| Param     | Type    | Notes                                                                                                                                                                                                                                                                                |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ws`      | `uuid`  | Target workspace. Must exist, otherwise `unknown workspace`.                                                                                                                                                                                                                         |
| `payload` | `jsonb` | `{ name*, email*, phone?, linkedin?, message?, demandId*, consentContact*, consentSharing? }` — name/email required; email format validated; contact consent must be `true`; `demandId` must identify an open, explicitly published role in `ws`. Sharing consent defaults to false. |

The database repeats the consent and role checks for direct RPC callers; browser-side validation
is not the security boundary. On success it returns `{ applicationId, statusToken }`. The private
`statusToken` is a randomly generated UUID; show it only to the applicant and keep it with their
application email. It is not included in the status response. The row lands with `status='pending'`;
only workspace members can read or triage it (RLS: workspace read, `can_edit` triage).

## `POST /rest/v1/rpc/api_public_application_status` — public status check (`anon`)

Returns only `ref`, `role`, `location`, `status` and `submittedOn` when the workspace, exact
email and private per-application code all match. Email alone reveals no application status. The
code is returned once by `api_public_apply`; users must keep it with their application email.
Applications submitted before migration 019 receive a code in the database but did not receive
it on submission, so they cannot use this self-service check unless a recruiter shares the code
through a verified channel.

| Param            | Type   | Notes                                              |
| ---------------- | ------ | -------------------------------------------------- |
| `p_workspace`    | `uuid` | Workspace whose application queue is searched.     |
| `p_email`        | `text` | Compared case-insensitively after trimming.        |
| `p_status_token` | `uuid` | Private code returned by the successful apply RPC. |

```js
const { data, error } = await supabase.rpc('api_public_application_status', {
  p_workspace: workspaceId,
  p_email: 'you@example.com',
  p_status_token: privateStatusCode,
});
```

## Mapping fields

Candidates (`externalId`) and demands (`externalId`) carry free-text external mapping ids
so external systems can keep their own keys alongside ECOD UUIDs.

## `POST /rest/v1/rpc/api_changes_page` — paginated sync

Same payload shape as `api_changes_since`, but each table is capped per block and the
response carries a `next` flag:

| Param        | Type   | Default             | Notes                                                                |
| ------------ | ------ | ------------------- | -------------------------------------------------------------------- |
| `day`        | `date` | `current_date - 30` | Same window semantics as above.                                      |
| `page_block` | `int`  | `0`                 | 0-based block index; block `n` skips `n × page_size` rows per table. |
| `page_size`  | `int`  | `200`               | Rows per table per block (min 1).                                    |

Response adds `{ since, block, size, next, …table feeds }`. `next` is `true` while any table
still has more rows in the window — including auxiliary tables without history triggers; keep
calling with `page_block + 1` until it is `false`.
`anon` is denied.

## Placements and commercial outcomes (migration 029)

`placements` records the operational deployment lifecycle against a candidate, demand and client. The database requires that the selected demand belongs to the same client, prevents overlapping live records for the same candidate/demand pair, validates the date range and keeps the record tenant-scoped. Recruiters and administrators may insert and update placement facts; deletion is not granted.

`placementCommercials` stores at most one commercial record per placement: bill rate, cost rate, currency, billing basis, billed amount and collected amount. Only administrators can read or write this table. Both tables are audited and included in incremental sync; non-admin callers receive an empty `placementCommercials` array.

```js
let block = 0,
  out = [];
for (;;) {
  const { data } = await supabase.rpc('api_changes_page', {
    day: '2026-09-01',
    page_block: block,
    page_size: 200,
  });
  out.push(data);
  if (!data.next) break;
  block++;
}
```

## `POST /rest/v1/rpc/api_portal_overview` — candidate portal (authenticated)

For a signed-in candidate (Supabase Auth email matching their profile email), returns the
curated self view: `{ profile, applications, submissions, interviews, offers, consents }`.
The projection deliberately omits internal notes, owner/source metadata and the internal
current-CTC figure. Unlinked accounts get `{ error: 'no candidate profile is linked…' }`.

## `POST /rest/v1/rpc/api_portal_update` — candidate self-service (authenticated)

Whitelisted availability self-service: `notice`, `earliestStart`, `activeStatus`, `mode`,
`engagement`, `preferredLocations`, `expected`. Omitted keys preserve their current values;
explicit `null`/blank values clear nullable preferences. Notice must be a whole number from
0 to 365, active status is `Active` or `Passive`, and work mode must be a supported value.
Everything else is recruiter-owned. Every call writes an audit row attributed to `Candidate (portal)`.

## `POST /rest/v1/rpc/api_portal_revoke_consent` — consent withdrawal (authenticated)

Revokes one of the signed-in candidate's own consents by id. Cross-candidate ids are
ignored by the `where` clause.

## Not yet provided (honest scope)

Write endpoints beyond the public apply, per-table REST resources, and cursor-based
pagination. The RPCs above are the stable contract those will wrap.

## Client accounts (migration 020)

`api_changes_since` and `api_changes_page` both carry two additional tables:

| Table            | Key fields                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `clients`        | `id`, `name`, `industry`, `location`, `website`, `owner`, `status`, `tier`, `paymentTerms`, `tags`, `created`, `updated` |
| `clientContacts` | `id`, `clientId`, `name`, `title`, `email`, `phone`, `isPrimary`, `decisionMaker`, `created`, `updated`                  |

Two existing tables gained a nullable link column that also travels in the feed: `demands.clientId`
and `submissions.contactId`. Both are `ON DELETE SET NULL` restricted to the link column, so
deleting an account clears the reference without affecting the demand or submission record.
`clients.name` is unique per workspace, case- and whitespace-insensitively, and at most one contact
per account may have `isPrimary = true`.

## Membership administration (migration 021)

These RPCs are **not** part of the sync feed. They administer access and are admin-only except
where noted. Each returns a JSON object and reports refusals as `{ "error": "..." }` rather than
raising, so a client can surface the database's own wording.

| RPC                                   | Who may call | Returns                                                                                              |
| ------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `api_workspace_members()`             | any member   | `{ workspace, isAdmin, adminCount, members[] }` — `userId`, `email`, `role`, `isSelf` only           |
| `api_workspace_invites()`             | admin        | pending invitations for the caller's workspace                                                       |
| `api_invite_member(p_email, p_role)`  | admin        | creates or updates a pending invitation; grants access at once if the address already has an account |
| `api_revoke_invite(p_id)`             | admin        | deletes a pending invitation                                                                         |
| `api_set_member_role(p_user, p_role)` | admin        | changes a role; refuses to demote the last administrator                                             |
| `api_remove_member(p_user)`           | admin        | revokes access; refuses to remove the last administrator                                             |

`public."workspaceInvites"` has no table grants at all — the RPCs are the only route in or out, and
`memberships` remains unwritable from `authenticated` as it has been since migration 001. A trigger
on `auth.users` (`claim_workspace_invite`) redeems a pending invitation at sign-up, which is why no
service-role key is needed in the browser. Every mutation writes an `auditEvents` row with
`entityType = 'membership'`.

## Multiple workspaces (migration 031)

Workspace selection is server-side state used by `current_workspace()`, so every existing RLS policy,
sync RPC and private-document request follows the same active workspace. Membership and role checks are
repeated inside each security-definer operation.

| RPC                                | Who may call       | Returns                                                                 |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `api_my_workspaces()`              | authenticated user | active workspace plus every workspace membership and its role           |
| `api_switch_workspace(p_workspace)`| workspace member   | selects an existing membership; refuses workspaces the caller cannot use |
| `api_create_workspace(p_name)`     | authenticated user | creates an isolated workspace, makes the caller admin and selects it     |

`memberships` uses `(user_id, workspace_id)` as its primary key. The selected workspace is held in
`userWorkspacePreferences`, which has no direct client grants. Existing single-workspace accounts are
back-filled automatically when the migration runs.

## Departments and requisition approval (migration 022)

`departments` joins both sync RPCs as an ordinary workspace table. The `demands` projection is
`d.*`, so these new columns travel automatically:

| Column                      | Meaning                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `departmentId`              | nullable link to `departments`; `ON DELETE SET NULL` on that column only      |
| `approvalStatus`            | `Draft` \| `Pending approval` \| `Approved` \| `Rejected`                     |
| `approvedBy` / `approvedAt` | set by the database from the signed-in session — never accepted from a client |
| `approvedTerms`             | server-generated snapshot of the terms that were approved                     |
| `approvalNote`              | reviewer's comment, or the automatic withdrawal reason                        |
| `submittedForApprovalAt`    | when approval was requested                                                   |

Writes go through the ordinary `demands` table, not an RPC; the `demands_requisition_gate` trigger
enforces the rules. Setting `approvalStatus` to `Approved` or `Rejected` as a non-admin raises
`Only a workspace admin can approve or reject a requisition`. Publishing an unapproved role while
`settings.custom->>'requisitionApprovals'` is true raises `This workspace requires requisition
approval before a role can be published`.

## Saved reports (migration 024)

`reports` joins both sync RPCs as an ordinary workspace table.

| Column   | Meaning                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `entity` | which record type the report is about                                          |
| `config` | jsonb definition: `{ filters[], groupBy, measure, measureField, sort, limit }` |
| `shared` | reports are workspace-wide by default                                          |
| `owner`  | who authored it, for attribution only — not an access control                  |

The table stores a **definition only**. There is no column in which a result could be cached, so
a report always reflects the repository as it is now. Access control is not in this table: a
report is evaluated client-side against rows the reader's own RLS already allowed them to load,
and `src/reports.js` additionally withholds admin-only fields from non-admin readers. `owner`
therefore grants nothing — do not treat it as a permission.

## Skills model (migration 025)

Three tables join both sync RPCs: `skills`, `personSkills`, `skillEvidence`.

| Table           | Writable?                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skills`        | insert/update by editors; delete revoked                                                                                                                           |
| `personSkills`  | insert/update by editors; delete revoked. **Derived** — a trigger overwrites proficiency, confidence, validation, evidenceCount and lastEvidence from the evidence |
| `skillEvidence` | **insert only.** UPDATE and DELETE are revoked from `authenticated`, like `history`                                                                                |

`public.skill_evidence_weight(text)` defines what each evidence type is worth (Assessment 100 →
Self-declared 10); `src/skills.js` mirrors it and a test fails if the two drift. Writing to
`personSkills` directly is permitted but pointless: the next evidence row recomputes it. Treat the
evidence as the source of truth and the person-skill as a cache the database maintains.
## Repository structures (migration 032)

`assessmentTemplates` stores a name, description, rubric, validityDays (1–730), version and archived flag. Each rubric has unique criterion IDs, positive weights totaling 100 and positive maximum scores. Workspace members can read templates; only admins can create or update them. The database assigns versions when rubric, name, description or validity changes.

An assessment may reference `templateId` and provide `rubricScores`, keyed by criterion ID. On insert, PostgreSQL validates every score and derives the weighted score, `templateSnapshot` and `validUntil`. Callers cannot replace the stored evidence or rubric version later. Archived templates cannot be used for new assessments. Existing evidence remains readable after template edits or archiving. Matching excludes expired assessments.

`talentPools` holds named curated pools. `poolMembers` links a pool and candidate within the same workspace, with one row per pair and an `active` flag. Editors create/update pools and activate/deactivate memberships; viewers can read them. Archiving retains all records and prevents new active membership. Both tables and templates participate in audit and incremental sync. Removing a membership does not delete a candidate.

The report builder supports `placements`. Operational fields are available to readers. Currency, billing basis, rates, margin, billed, collected and outstanding amounts require admin access and are projected from `placementCommercials`; internal notes are excluded. Amount aggregations require a single currency; rate aggregations also require a single billing basis.

Backup exports include all three new tables, and old backups remain readable. Cloud restore uses normal validated writes: inserting templated evidence recalculates its snapshot from the restored current template, and archived templates reject new evidence. Historical assessment snapshot fidelity therefore still requires a dedicated trusted restore procedure; the browser merge restore is not a historical recovery mechanism.

## Client documents and repository filters (migration 033)

`documents.clientId` references a client in the same workspace. A document cannot have both a client and candidate owner. All client documents are admin-only for reads, inserts and updates; candidate document permissions remain as before. Existing document history snapshots containing a client link are also admin-only. Ownership and storage location cannot be reassigned after upload. R2 client paths must begin with `<workspace>/clients/<client>/`. Upload signing accepts exactly one `clientId` or `candidateId`; client uploads require an admin and an RLS-visible client. Download signing continues to resolve an RLS-visible, unarchived record. Both sync feeds include `clientId` and omit client documents for non-admins.

`POST /rest/v1/rpc/api_filter_candidates` accepts `p_employer` (literal case-insensitive substring, up to 120 characters), `p_engagement` (empty, Permanent, Contract, C2H or Subcontract), `p_max_expected` (optional nonnegative compensation ceiling; admin-only), `p_limit` (1–1000) and `p_offset` (nonnegative). It returns `{ids, limit, offset}` ordered by candidate ID. It excludes merged profiles, unknown compensation when a ceiling is supplied and every other workspace. It is unavailable to anonymous callers; a member without a workspace receives `{error: "no workspace membership"}`. No candidate or commercial fields are returned.

The UI fetches all matching ID pages before applying existing local text/semantic/queue filters. This does not replace the current full-workspace initial load or provide server-side text/semantic search. Cancellation suppresses stale responses when filters change; failures are shown instead of falling back silently. Saved views retain structured filters; non-admin readers clear saved compensation criteria.

Cloud setup requires migration 033 and the existing Netlify/R2 configuration. Demo attachments are capped at 1 MB so the original can be stored inline; cloud uploads retain the 5 MB allowlist limit. Attachments are scanned by content signature, not antivirus. No live service provisioning or deployment is performed by this implementation.
# Custom fields — migration 034

Admin configuration is stored under `settings[id=workspace].custom.customFields`, keyed by `candidates`, `demands`, `clients` or `clientContacts`. Each definition has a stable `name`, `type` (`text`, `number`, `date`, `select`), optional `options` for choices and optional boolean `archived`. Limit: 40 definitions per module; names 1–60 characters; choice arrays 1–50 unique strings of up to 100 characters.

Values live in each record's `custom` JSON object. Fields are optional: absent, null and empty string remain empty. Numbers must be JSON numbers; dates must be valid ISO calendar dates; select values must match a configured choice. Active text values are limited to 2000 characters and the complete custom object to 100000 bytes in PostgreSQL. Unknown legacy keys are retained. Archiving hides a field from forms and keeps recorded values available for display/restoration. Existing definitions cannot be removed/retyped or have their choice sets changed through the database; use a new field and archive the old one.

Settings definitions inherit admin-only writes; values inherit each record's workspace/RBAC rules. Custom fields are member-visible and must not be used to bypass restricted compensation/commercial tables. The existing `clients`/`clientContacts` full-row incremental projection includes the new values, and record changes retain historical snapshots.

### PDF extraction (Phase 2, local implementation)

`extractDocumentText(buffer, ext)` returns `{ text, status, warning }`. Text PDFs use a lazy PDF.js worker with self-hosted fonts and CMaps; limits are 50 pages, 40,000 characters and 20 seconds. Originals are copied before transfer so hashes and storage remain valid. Unreadable, scanned, password-protected and limited PDFs return `manual` with no partial text, while their originals may still be saved using existing private document storage. No OCR or new network endpoint is provided. Candidate drafts remain human-reviewed; the import save rechecks current-repository and in-batch duplicates. Existing `parserStatus` values and document schema are unchanged.

## Phase 3 execution RPCs (migration 035)

- `api_server_execution_status()` → boolean: active workspace mode; authenticated only. Cloud saves query this before invoking client rules. Missing migration falls back to browser mode; other failures block rule-bearing saves.
- `api_set_server_execution(p_enabled boolean)` → void: admin-only workspace enable/pause; default false.
- `api_execution_jobs(p_status text = "", p_offset integer = 0)` → `{ enabled, jobs, total }`: admin-only, 25 summaries per page; status may be pending/completed/failed or empty. Captured actions are excluded.
- `api_retry_execution_job(p_id uuid)` → void: active-workspace admin only; failed jobs only. Restores pending with the currently enabled rule’s actions, original event date and links. Completed jobs cannot replay.
- `worker_run_execution_jobs(p_limit integer = 20)` → `{ completed, retriedOrFailed }`: service role only, limit 1–50. Claims use locked rows in enqueue order; actions and completion are atomic. No external delivery is performed.

The queue table is deliberately excluded from normal repository TABLES and public/incremental record feeds; admin operations use the dedicated API. Existing tasks/notes/profile effects enter normal history and sync; job lifecycle audit summaries exclude action payloads. See [deployment and failure behavior](PHASE3_SERVER_EXECUTION.md).

## Phase 4/5 RPCs and functions (036/037, optional 038)

`integration-candidate` is a POST-only editor endpoint with bearer auth, bounded allowlisted candidate JSON, an `Idempotency-Key` header and `version` on updates. `api_integrate_candidate` returns candidateId/version/replayed atomically with its receipt; `api_external_mappings(p_source='')` returns the most recent 100 mappings. UI edits advance mapping versions; conflicts return HTTP 409.

`api_webhook_admin(p_operation, p_id, p_name, p_url, p_secret, p_enabled)` is admin-only. Operations: list/create/toggle/retry. Create defaults to paused; output excludes secrets and payloads. Retry accepts only failed deliveries on enabled subscriptions. `worker_claim_webhooks` and `worker_finish_webhook` are service-role-only leased queue operations; the scheduled worker uses two deliveries per batch.

`api_index_candidates(p_offset=0)` returns 20 editor-visible professional projections/fingerprints. `api_index_candidate(p_id,p_fingerprint,p_vector)` stores a valid current 384-dimensional local vector. `api_hosted_search(p_vector,p_namespace='local-v1',p_location='',p_status='',p_min_experience=0)` returns at most 20 active-workspace, unmerged, current-projection matches; filters run in PostgreSQL. Optional 038 replaces array cosine search with pgvector while preserving the API and security predicates.

`api_intelligence_settings(p_operation='get',p_enabled=false,p_daily_limit=20)` returns enabled/dailyLimit/usedToday. Save is admin-only; get is workspace-member-visible. `api_intelligence_reserve(p_kind,p_id)` is editor-only, requires explicit AI activation and atomically enforces daily quota. The POST-only `intelligence` function calls the configured provider using the safe projection (or the user's query), then finalizes through service-only `worker_intelligence_complete`. Kinds are embedding/draft/query. Query searches only the matching provider/model namespace; it currently has no structured filters.

`api_intelligence_drafts(p_candidate=null)` returns up to 50 editor-visible draft summaries and review metadata. `api_review_intelligence(p_id,p_approve,p_content='')` accepts only a current draft; approvals require current source and edited content within 5000 characters. Approval/rejection records reviewer identity; original generated content stays protected in the database. It does not update candidate profiles. New provider/configuration/outbox tables are excluded from bulk workspace backup and sync: dedicated APIs and database-owner backups are required. See [security, signatures and deployment](PHASE4_5_INTEGRATIONS_INTELLIGENCE.md).

## Operations RPCs (migration 039)

The private scheduled `index-worker` uses service-only `worker_claim_index(p_limit=20)` and `worker_finish_index(p_workspace,p_candidate,p_lease,p_vector=null,p_failed=false)` to compute local vectors and atomically finish queued profile updates. Claims are leased and obsolete completions return false. Admin-only `api_index_health(p_retry_failed=false)` returns indexed/pending/processing/failed counts and at most 25 failed candidate summaries. The queue is excluded from regular workspace reads/backups; database-owner backups are required.

Editor-only `api_mapping_page(p_source='',p_offset=0)` returns `{rows,total}` with 25 stable-order external mappings. `api_reconcile_mapping(p_source,p_external_id,p_version,p_candidate)` changes a link to an active candidate in the same workspace, advances its version and records metadata history. It never copies candidate fields. `api_rotate_webhook(p_id,p_secret)` requires an admin, a paused subscription and no active delivery leases. Claims lock subscriptions as well as deliveries to serialize pause/rotation with worker claims. See [operations contract](OPERATIONS_MAINTENANCE.md).
