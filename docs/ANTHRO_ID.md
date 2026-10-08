# Anthro-ID

Every candidate has one permanent identity across talent, assessments, training/enrichment,
interviews, offers, referrals, placements, and the candidate portal.

Example: `ANTHRO-00001`.

## Feasibility and design

These modules already refer to `candidates.id` through `candidateId` foreign keys. Anthro-ID
adds a compact public label without changing those UUID relationships. The format is exactly
`ANTHRO-` followed by five zero-padded digits: `ANTHRO-00001` through `ANTHRO-99999`.

In cloud mode, a PostgreSQL sequence allocates `anthroNumber` globally across workspaces.
The stored generated `anthroId` column formats the number, and unique indexes enforce both
number and label uniqueness. Insert triggers reuse the existing number for upserts, so edits
and repeated saves do not consume IDs. New records receive a database allocation regardless
of caller-supplied values. UUIDs and allocated numbers cannot be edited.

The namespace has a hard capacity of 99,999 allocations, including retired candidates and any
numbers consumed by failed inserts. The sequence never wraps or recycles; exhausted capacity
blocks new candidates while existing profiles remain editable. Gaps are normal and harmless.
See [PostgreSQL sequences](https://www.postgresql.org/docs/current/sql-createsequence.html).

The compact migration backfills existing profiles in creation-date/UUID order and does not
renumber already allocated profiles when reapplied. Previous UUID-format IDs remain searchable
and resolvable through the lookup API. Profile edits, training, and employment changes retain
the allocated compact ID.

Demo mode persists a local allocation on each candidate, includes retired numbers when
allocating, and serializes saves. On browsers with Web Locks, saves across tabs share a lock
and reload persisted candidate allocations before assigning a number. Demo IDs belong to that
browser's demo repository; they are not globally allocated across separate browsers or hosted
projects. Cloud clients show the database-assigned ID only after saving and syncing. The
repository adapter excludes both the allocated number and generated label from cloud writes.

The ID identifies a candidate record, rather than proving a person's identity. Independently
created records still need duplicate review and merging. Separate workspace records are not
automatically linked by email or phone; existing workspace permissions continue to apply.
An Anthro-ID is an identifier, not a login credential or public profile access token.

## Product coverage

- Candidate rows, profiles, read-only edit forms, and a copy button in Candidate 360.
- Shared candidate selectors and identity displays in assessments, enrichment, activities,
  pools, interviews, offers, demand pipelines, placements, referrals, and skills review.
- Global and repository search, pool filters, and referral search.
- Candidate CSV exports and ID-aware CSV/XLSX imports. An imported ID matches an existing
  profile and skips the duplicate, even if contact details changed. Unknown supplied IDs
  are rejected; leave the ID blank when importing new candidates. Imports continue to
  skip existing candidates rather than overwrite them.
- Candidate, pipeline, submission, interview, offer, and placement report fields.
- Dossiers, submission packs, offer letters, client presentation references, and the
  `{{Candidate.anthroId}}` document template token.
- Candidate self-service portal, JSON backups, existing incremental feeds, integration
  responses, and candidate-linked webhook events.

Anthro-IDs are excluded from semantic similarity vectors so identifiers cannot affect skill
matching or recommendations.

## Duplicate merges and backups

The surviving candidate keeps its Anthro-ID. Retired profiles keep their original IDs and
`mergedInto` reference. Global/repository search resolves former IDs to the surviving profile,
including chains of merges. Local snapshots retain these tombstones as `mergedCandidates`;
backup bundles include them in the `candidates` table so restore preserves aliases.

Editable lifecycle rows follow the surviving profile during a merge. Append-only skill evidence
and colliding historical links retain their database provenance; the normalized read projection
resolves their candidate reference to the survivor. Merge writes retain the existing sequential,
stop-on-failure behavior: a failed transfer must be reviewed before retrying. External mappings
retain their existing explicit reconciliation workflow.

## Rollout

Apply `supabase/migrations/20261006064914_anthro_id.sql`, then
`supabase/migrations/20261006074440_compact_anthro_id.sql`, before deploying the updated app.
If the first migration is already applied, apply only the compact migration. It adds the generated column and index, identity protection,
lookup RPC, portal projection, and integration/webhook identity fields. It also permits retired
merge tombstones to release their contact fields while retaining the original contact requirement
for active profiles. It does not change workspace RLS policies or expose public candidate lookup.

The compact migration can be reapplied without reallocating IDs. Restore product backups into
the same hosted project to retain allocations. Restoring into a separate database through product
upserts allocates new numbers; preserve the database and sequence together for a full disaster
recovery restore. Conflicting demo backup allocations are rejected rather than silently renumbered. On large repositories, adding a stored
generated column and its index takes a table lock: schedule the migration in a maintenance window.
Refresh already-open clients after deploying the app. Demo mode requires no hosted migration.

The migration and application are verified locally with PostgreSQL-compatible PGlite and UI
tests. This change does not by itself publish the app or apply the migration to a hosted project.

## Integration contract

Candidate reads and existing sync feeds expose `anthroId`. `api_integrate_candidate` returns
`{ candidateId, anthroId, version, replayed }`; existing receipts gain the ID on migration.
The candidate write payload stays restricted to the existing mutable profile fields.

An authenticated workspace member can resolve a current or retired ID:

```js
const { data, error } = await supabase.rpc('api_candidate_by_anthro_id', {
  p_anthro_id: 'ANTHRO-00001',
});
// data: { candidateId, anthroId, matchedAnthroId }, or null if inaccessible/not found
```

The lookup is case-insensitive and respects RLS plus the active workspace. An external training
system should store Anthro-ID with its local participant ID and resolve it before linking records;
it must not allocate or overwrite Anthro-IDs. Candidate-linked webhook envelopes include
`data.candidateId` and `data.anthroId`. A merge also includes `data.mergedInto` and
`data.survivingAnthroId` so authorized receivers can reconcile their references. No contact details
are added to webhook payloads.

## Verification

`tests/anthro-id.test.js`, `tests/migration-anthro-id.test.js`, and
`tests/ui-anthro-id.test.js`, `tests/ui-cloud-anthro-id.test.js`, and
`tests/migration-compact-anthro-id.test.js` cover deterministic identity, backfill, edits, protected SQL writes,
imports, former-ID search, chained merges, backups, read-only controls, training selectors,
CSV exports, portal identity, document tokens, reports, webhooks, integration replays, and
cross-workspace/anonymous access denial. Run `npm test`, `npm run lint`, and `npm run build`.
