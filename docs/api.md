# ECOD public API contract (v1, hosted RPCs)

The workspace exposes hosted PostgreSQL functions (Supabase RPC endpoints). Workspace-data RPCs are security-definer and workspace-scoped; public careers RPCs are deliberately narrow. PGlite migration suites exercise the SQL through migrations 001–019 (`tests/migration*.test.js`). Authenticate with the caller's Supabase JWT where required.

## `POST /rest/v1/rpc/api_changes_since` — incremental sync (§14 `updated_since`)

Returns every workspace record created or changed on/after `day`, for the caller's
workspace only. Cross-tenant safe; `anon` is denied.

| Param | Type   | Notes                                                                                                                |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `day` | `date` | Defaults to `current_date - 30`. Rows are matched by `created`/`updated`/`date`/`submittedOn` etc., day granularity. |

Response `jsonb` includes `since` and one array for each repository table: `candidates`, `demands`, `considerations`, `assessments`, `notes`, `enrichment`, `history`, `employmentHistory`, `compensationHistory`, `availabilityHistory`, `auditEvents`, `documents` (metadata only; no file bytes, storage paths or extracted CV text), `taxonomy`, `demandCommercials`, `settings`, `consents`, `interviews`, `offers`, `tasks`, `submissions`, `publicApplications` and `workflowRules`. Each array is ordered by its table id and each row omits `workspace_id`. Internal demand commercials are returned only to workspace admins; other members receive an empty `demandCommercials` array.

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

Response adds `{ since, block, size, next, …22 feeds }`. `next` is `true` while any table
still has more rows in the window — including auxiliary tables without history triggers; keep
calling with `page_block + 1` until it is `false`.
`anon` is denied.

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
