# Phase 4: client collaboration and integration foundations

Implemented locally on 7 October 2026 on the existing React/Vite, Netlify and Supabase stack. This completes the locally buildable Phase 4 scope in [the five-phase plan](CURRENT_STACK_BUILD_PHASES.md). It does not complete Phases 1–3, activate a hosted deployment, or certify the entire product blueprint.

## Feature coverage

| Capability | Implementation |
| --- | --- |
| Client and demand access | Separate private memberships; manually provision an existing Auth account without internal workspace membership, grant access from Client detail, and share `/client.html` manually. Grants expire after 30 days, can be renewed, and can be revoked. Active client access prevents accidentally adding internal workspace membership. |
| Approved submission versions | Recruiters prepare a safe immutable snapshot; administrators review it and record approval evidence. Only current approved versions reach clients. Approving a replacement revokes earlier approved versions. Editors can revoke sharing. |
| Consent, holds and changes | Current profile-sharing consent and an unrestricted candidate are required. Candidate, submission, demand, consent and linked offer changes invalidate the source fingerprint. A stale draft cannot be approved. Existing server-owned outbound holds and offer approval/change controls remain authoritative. |
| Structured client feedback | Append-only actor-stamped comments, optional 1–5 ratings, Shortlisted/Rejected/Hold decisions, and proposed interview times. Requests remain recruiter actions; they do not book a calendar or modify internal assessment scores or hiring pipeline automatically. |
| Feedback aging | A seven-day requested-response deadline and elapsed days appear in internal review. Recent feedback also appears when its version is on another page. |
| Account progress and commercials | Clients see approved demand status, positions, target dates and active placement counts for their scope. Existing internal commercial permissions remain separate. Contacts, compensation, internal cost/margin and commercial tables are absent from client responses. No client pricing quote is invented. |
| Approved job feed | A bounded public Netlify JSON feed contains only Open, careers-visible, Approved demands whose public content matches the administrator-reviewed publication fingerprint. Editing description/skills or other public fields removes the role from this feed until administrator republication. Closure, visibility removal or withdrawn approval also unpublishes it. It omits budget and client/contact data. |
| Source attribution | Feed links include a source parameter; careers applications retain it, recruiters see it, and a newly created candidate preserves it. Existing candidate identity/source is preserved when accepting an application into that identity. Source strings are bounded and validated; they are declared attribution, not proof of origin. |
| Machine credentials | Administrators issue credentials scoped to candidate writes, demand writes, event/mapping reads or approved-job reads. Workspace/source binding, 1–90-day expiry, owner-membership revalidation, revocation and minimum-scope controls are enforced in PostgreSQL. Only a SHA-256 digest is stored. |
| Versioned writes and mappings | Candidate and demand create/update operations require an operation UUID. Exact retries return their original result; changed intent fails. Existing mappings require the current version, including after human edits. Machine writes cannot author approvals, readiness or holds. |
| Incremental feeds | Bounded metadata events for candidate, demand, consideration, offer, placement and client-review changes use decimal-string sequence cursors. Source-bound mappings expose current UUID/version metadata for reconciliation. No candidate field values or contact details appear in event feeds. |
| Signed event recovery | Client feedback joins the existing signed webhook outbox. Existing leases, retries, receiver-event deduplication and failed-delivery controls remain in place. Administrators can record receiver reconciliation evidence; recording evidence does not mark a remote delivery successful. |

## Operating the client review workflow

1. Provision the client's Auth identity using the existing Supabase administrator tools and a password the client can use. Avoid outstanding internal workspace invitations for that email. No automatic email service is required or activated.
2. In **Client detail → Client collaboration**, enter its Auth UUID and optionally a demand UUID. Empty demand scope covers that client's demands; it never grants another client's access. Grant/renew access and manually share the portal link.
3. Record current profile-sharing consent and create a submission against a linked client demand. Select that submission and prepare a version.
4. Review the displayed candidate facts, Anthro-ID, role and skills. As an administrator, enter 10–2,000 characters of approval evidence and approve the version. Recorded profile status/verification are not validated demand-specific readiness; earlier Phase 3 work remains incomplete.
5. The client signs in to `/client.html`, reviews the shortlist and sends feedback. Internal review shows the original version, notes, decision/rating and interview request. The recruiter confirms and schedules subsequent work using existing workflows.
6. Refresh after an edit or revocation. A previously downloaded browser snapshot cannot be recalled; subsequent reads and writes recheck access and source validity. Sign-out clears the portal view, and switching clients clears the prior shortlist and its drafts.

Portal responses deliberately omit original files, unrestricted Candidate 360, contact details, notes, raw assessment evidence and all compensation/commercial figures. Demand progress is separately limited to approved demands. The read ledger records actor/client/time and the returned pack UUIDs, without copying the candidate fields again.

## Machine API contract

Use **Workspace settings → Machine API and approved job feed** to issue/revoke credentials and inspect demand mappings, change cursor and failed webhook reconciliation. The existing integrations panel retains candidate mappings and webhook retry/signing controls. Save the secret at issuance; it is never persisted in browser storage by this panel. If the issuance acknowledgement is lost, retry the same operation; a replay returns no secret. Revoke that issued UUID and issue a new credential.

Send `Authorization: Bearer <issued machine credential>` to `/.netlify/functions/machine-api`. The server hashes the credential and calls a service-only dispatcher. Anonymous and ordinary authenticated database roles cannot execute it, even with a known hash. The API checks the issuing administrator still belongs to the credential's original workspace as an administrator, regardless of their currently selected workspace.

| Action | Method and scope | Request / response |
| --- | --- | --- |
| `candidate` | POST, `candidate:write` | JSON `{externalId, version, body}`. Candidate allowlisted fields only. Response `{candidateId, version, replayed}`. |
| `demand` | POST, `demand:write` | Same envelope. A linked client in the credential workspace is required. Response `{demandId, version, replayed}`. Material edits withdraw stale requisition approval. |
| `events` | GET, `events:read` | `after=<decimal cursor>`; returns up to 100 metadata events and `more`. Save the last processed `cursor` as a string, after processing the complete page. |
| `mappings` | GET, `events:read` | `offset=0,100,…`; returns up to 100 source-bound mappings and `more`, including a retired candidate's merge target where applicable. Refresh versions after a conflict rather than overwriting a newer human edit. |
| `jobs` | GET, `jobs:read` | `offset=0,50,…`; returns the same approved projection as the public feed, bound to the credential workspace. |

POST requires a UUID `Idempotency-Key` header. Omit `version` or use zero for a new external record; use the current mapping version for updates. For example, a candidate body can be `{"name":"Example Candidate","email":"example@example.org","skills":["Python"]}`. Existing contact-identity constraints and primary/alternate duplicate guards also apply. Demand creation requires title/clientId/skills/minExperience/maxNotice/budget/location/mode/positions/priority/target; approval fields are unsupported. The credential's source names its mapping namespace.

Successful calls are limited to 60 per credential per minute; failed database transactions roll back usage increments. The database caps active credentials at 20 per workspace. Gateway bodies are capped at 40,000 bytes; write entity payloads at 30,000 bytes. Conflicts return HTTP 409, denied/revoked/expired scopes 403, malformed credentials 401 and throttling 429. Consumers must retain their own operation IDs and source data and deduplicate events. This metadata feed is not an unrestricted export API.

Event insertion serializes by workspace before allocating its sequence, so another committed event from that workspace cannot cause an older pending event to be skipped. Cursor gaps are normal. This is an application change ledger, not a database logical-replication or backup service. Hosted concurrent-write and representative-volume acceptance remains required.

Public feed: `/.netlify/functions/approved-job-feed?ws=<workspace UUID>&offset=0&source=Community%20board`. Pages contain at most 50 jobs. Returned `applyUrl` paths point to the current site's careers page; consumers resolve them against the site's HTTPS origin. Labels accept 1–100 ASCII letters/digits/spaces/periods/underscores/hyphens. Anonymous feed responses are not cached. Nothing posts to a third-party board or activates LinkedIn, email, calendar or e-signing.

## Migration, privacy and hosted activation

Apply every migration in filename order through `20261007095813_phase4_privacy_scope.sql`, including the preceding client-review and machine-API migrations, before deploying these interfaces. Vite builds `/client.html` alongside main/careers/candidate portal. Netlify source builds package the two additional functions; static-only drag-and-drop cannot deploy them.

An administrator must review and republish existing Approved roles for this new feed: save careers visibility off, then on. A new approval of a careers-visible role also captures publication approval. The server-owned fingerprint cannot be supplied by browser/machine writes, and recruiter visibility toggles cannot approve feed publication. Requisition approval deliberately keeps its existing material-term rules; the additional public-content check is separate. Existing careers publishing options remain unchanged.

Machine API uses existing server-only `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. The public feed uses the existing public URL/anon key; make those variables available to Functions as well as Builds. No new service, provider account or secret type is introduced. Keep service credentials out of `VITE_` variables. Optional privileged MFA also applies to client grants/approvals and machine credential management when already enabled in the workspace.

D7 inventory now includes **37 categories**, adding client packs/feedback/read history/receipts and machine events/receipts. New reads/writes change its fingerprints; recapture and reconcile older erasure checklists. The new metadata/feedback is private and excluded from unrestricted browser exports. Credentials, client memberships and demand mappings are operational records; assess account retention separately. Existing webhook/provider tables and external copies still require explicit manual coverage. No erasure is performed here.

D6 retains its 18 reviewed direct-record categories. Its scope notice explicitly excludes client version/feedback/read history and machine operation metadata, alongside earlier exclusions. Review those separately when applicable. Regenerate previously prepared access snapshots/packages after the notice change; do not describe a package as complete legal fulfillment.

Hosted acceptance must check two clients, different demands of one client, two workspaces, expiry/revocation, changed consent/holds/source terms, stale draft approvals, actor-bound retries, owner removal, API mapping conflicts, feed removal, signed retry/deduplication and actual Auth/Netlify execution. Run hosted Supabase advisors and backup/restore acceptance. Local PGlite does not prove live PostgREST, JWT/MFA configuration, database concurrency or Netlify runtime behavior.

## Verification

All 793 Node regression tests passed, followed by 34 migration-chain checks on the final publication/identity protections. Four OCR tests, lint, changed-file formatting, documentation links, offline Netlify packaging (17 functions) and the final frontend build passed; main entry is 65.4 KiB. Local Supabase advisors could not connect to `127.0.0.1:54322`.

Focused migration, UI and endpoint checks cover client/demand/tenant isolation, expired and revoked access, omission of private fields, immutable versions, consent/hold/edit/offer invalidation, actor-bound response receipts, grant boundaries, token hashing/one-time issuance, revoked/expired/owner-removed keys, scope restrictions, fixed-workspace writes, optimistic versions, replay conflicts, string cursors, mappings, throttling, public-content approval/spoofing/republication, end-to-end attributed application acceptance and reconciliation permissions.

Live client onboarding/pilot acceptance, automatic invitations, partner connectors and e-signing remain activation or external dependencies. Earlier incomplete phases and Phase 5 remain separately tracked.
