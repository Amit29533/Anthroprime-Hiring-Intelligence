# ECOD public API contract (v1, hosted RPCs)

The workspace ships two hosted PostgreSQL functions (Supabase RPC endpoints). Both are
security-definer, workspace-scoped and integration-tested against real Postgres
(`tests/migration00*.test.js`). Authenticate with the caller's Supabase JWT.

## `POST /rest/v1/rpc/api_changes_since` — incremental sync (§14 `updated_since`)

Returns every workspace record created or changed on/after `day`, for the caller's
workspace only. Cross-tenant safe; `anon` is denied.

| Param | Type | Notes |
|---|---|---|
| `day` | `date` | Defaults to `current_date - 30`. Rows are matched by `created`/`updated`/`date`/`submittedOn` etc., day granularity. |

Response `jsonb`: `{ since, candidates, demands, considerations, assessments, notes,
documents (metadata only), interviews, offers, tasks, submissions, publicApplications,
history }` — each an array of row objects with `workspace_id` stripped.

Errors: `{ "error": "no workspace membership" }` when the caller has no membership; HTTP
403-class permission error for `anon`.

Feed ordering is deterministic: every table is returned ordered by its primary key, so a
sync client can resume from the last seen id without ambiguity.

Client example:

```js
const { data, error } = await supabase.rpc('api_changes_since', { day: '2026-09-01' });
```

## `POST /rest/v1/rpc/api_public_apply` — careers-page applications (public, `anon`)

Creates a `publicApplications` row for triage in the workspace's Activities page. The
workspace id is public configuration (single-tenant deployments bake it into the page;
multi-tenant front-ends resolve it per careers-site host).

| Param | Type | Notes |
|---|---|---|
| `ws` | `uuid` | Target workspace. Must exist, otherwise `unknown workspace`. |
| `payload` | `jsonb` | `{ name*, email*, phone?, linkedin?, message?, demandId?, consentContact?, consentSharing? }` — `name`/`email` required, email format validated. |

Returns the new application `uuid`. The row lands with `status='pending'`; only
workspace members can read or triage it (RLS: workspace read, `can_edit` triage).

## Mapping fields

Candidates (`externalId`) and demands (`externalId`) carry free-text external mapping ids
so external systems can keep their own keys alongside ECOD UUIDs.

## `POST /rest/v1/rpc/api_changes_page` — paginated sync

Same payload shape as `api_changes_since`, but each table is capped per block and the
response carries a `next` flag:

| Param | Type | Default | Notes |
|---|---|---|---|
| `day` | `date` | `current_date - 30` | Same window semantics as above. |
| `page_block` | `int` | `0` | 0-based block index; block `n` skips `n × page_size` rows per table. |
| `page_size` | `int` | `200` | Rows per table per block (min 1). |

Response adds `{ since, block, size, next, …12 feeds }`. `next` is `true` while any table
still has more rows in the window — keep calling with `page_block + 1` until it is `false`.
`anon` is denied.

```js
let block = 0, out = [];
for (;;) {
  const { data } = await supabase.rpc('api_changes_page', { day: '2026-09-01', page_block: block, page_size: 200 });
  out.push(data); if (!data.next) break; block++;
}
```

## `POST /rest/v1/rpc/api_public_application_status` — candidate status lookup (public, `anon`)

Careers-page "Check your application status". Returns minimal, non-sensitive fields for
every application whose email exactly matches (case- and whitespace-insensitive), newest
first: `[{ ref, role, location, status, submittedOn }]` — `ref` is the first 8 characters
of the application id, `status` is `pending` / `accepted` / `dismissed`. No contact
details, messages or consent answers are returned. Unknown emails get `[]`.

```js
const { data } = await supabase.rpc('api_public_application_status', { p_email: 'you@example.com' });
```

> Honest scope: the email acts as a bare capability check. A token sent to the applicant
> (or a real candidate account) would be the proper gate — that needs a server.

## `POST /rest/v1/rpc/api_portal_overview` — candidate portal (authenticated)

For a signed-in candidate (Supabase Auth email matching their profile email), returns the
curated self view: `{ profile, applications, submissions, interviews, offers, consents }`.
The projection deliberately omits internal notes, owner/source metadata and the internal
current-CTC figure. Unlinked accounts get `{ error: 'no candidate profile is linked…' }`.

## `POST /rest/v1/rpc/api_portal_update` — candidate self-service (authenticated)

Whitelisted availability self-service: `notice`, `earliestStart`, `activeStatus`, `mode`,
`engagement`, `preferredLocations`, `expected`. Everything else is recruiter-owned. Every
call writes an audit row attributed to `Candidate (portal)`.

## `POST /rest/v1/rpc/api_portal_revoke_consent` — consent withdrawal (authenticated)

Revokes one of the signed-in candidate's own consents by id. Cross-candidate ids are
ignored by the `where` clause.

## Not yet provided (honest scope)

Write endpoints beyond the public apply, per-table REST resources, and cursor-based
pagination. The RPCs above are the stable contract those will wrap.
