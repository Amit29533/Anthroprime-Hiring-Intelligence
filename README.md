# ECOD Talent Intelligence

A Netlify-ready recruiting workspace inspired by Zoho Recruit's repository-to-demand flow and the supplied ECOD product blueprint. People remain independent of applications, so candidate history stays useful across roles.

## Start locally

Requires Node.js 22+ and pnpm 11.25.0.

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev
```

Open the URL shown by Vite. Without database configuration, the app opens with **fictional sample data** and saves edits in that browser's local storage. This mode is a product demo, not a shared production database. Demo changes survive refreshes but not clearing browser storage and do not sync to other devices. Demo data is never automatically uploaded to Supabase.

## What works

- Dashboard with live demand coverage, pipeline counts, follow-ups and freshness.
- Candidate creation/editing, contact and compensation fields, skill normalization and dated profile-change snapshots.
- Skills evidence model: per-skill proficiency (Exposure–Expert), evidence source, years, confidence and recruiter validation; matching respects demand minimum proficiency and per-skill minimums, and reports nice-to-have coverage without scoring it.
- Structured employment, compensation and availability histories: automatic snapshots when employer, CTC, notice, earliest start or registry status change, plus manual role entry on the candidate profile.
- Candidate engagement preference (Permanent/Contract/C2H/Subcontract), registry status (Active/Passive), earliest start date, and demand engagement-type constraints with explicit mismatch flags.
- Data-quality queues (missing email/phone, unvalidated skills, stale compensation/availability) and blueprint velocity metrics (average time to shortlist).
- CV and document uploads (PDF/DOCX/TXT/MD/CSV up to 5 MB) with allowlist validation, randomized storage names, SHA-256 hashes and best-effort text extraction; DOCX inflation is capped at 1 MiB and malformed/oversized documents fall back to manual review. Cloud mode stores originals in a private Supabase Storage bucket, demo mode keeps small files in the browser.
- CV bulk import: drop multiple CVs, review each parsed draft (name, contact, title, years, skills with CV evidence), skip flagged duplicates, import profiles with their originals attached.
- Demand-vs-candidate gap map with critical/trainable/contextual classification, derived status (Open / Enrichment planned / Closed via recent assessments) and one-click enrichment planning; skill gap heatmap across open demands in Analytics.
- Merge-duplicate review in Workspace settings: probable pairs (email, phone, LinkedIn, name plus employer/location), field-by-field keep decisions, skills evidence combined to the stronger record, duplicate hidden (flagged, never auto-deleted), child records re-pointed.
- Workspace skill-taxonomy administration (Settings → Skill taxonomy): add canonical skills with aliases and domains; matching, JD extraction and CV parsing immediately use the extended vocabulary.
- Incremental change export (changes since a date) — the same shape a future `updated_since` API returns.
- Admin console in Workspace settings: rename pipeline stage labels workspace-wide, set the retention review window with an audited anonymization workflow, and review the full audit log (views, exports, merges, anonymizations).
- Repository search reaches into extracted CV text, so phrases from an uploaded resume surface the right profile.
- Demand commercials (internal target cost and margin) live in an admin-role-only table — recruiters and viewers never receive them from the API.
- Saved views: name any combination of search, filters and sort and re-apply it later (persisted per workspace); column chooser with per-browser persistence; bulk readiness update from the repository list.
- Consent ledger per candidate (purpose, granted/revoked, notice version, source, note) with one-click revoke, a per-candidate JSON data-subject export, and erasure via the audited admin anonymization — consent table protected by workspace RLS (migration 005).
- Per-demand pipeline configuration: tick which pipeline stages a demand uses (kanban renders only those) and set a minimum proficiency per must-have skill, on top of the demand-wide minimum.
- Concept-expansion search: skills automatically expand to their domain vocabulary (Databricks also matches lakehouse / data platform), over profile text and extracted CV text.
- Demand-coverage analytics (deployment-ready / near-ready / unfilled per open demand), client funnel (Submitted → Interview → Offer → Deployed), ECOD uplift conversion and a usable-profiles headline stat.
- `api_changes_since(day)` RPC (migration 005): a hosted, security-definer endpoint returning every workspace table changed since a date — cross-tenant-safe, revoked from anon, verified in an embedded PostgreSQL test.
- Interviews module: schedule panels (candidate × demand × round × mode × datetime × interviewers), reschedule, cancel and no-show handling, per-interview structured feedback (admin-configurable criteria, 1–5 ratings with live overall, a workspace feedback bar and Strong hire → No hire recommendations), interview-outcome analytics, and interview invite drafts from admin-editable email templates with placeholders (mailto compose; no server sending).
- Tags on candidates and demands with a repository tag filter; tags persist inside saved views.
- Offers module: offer records (candidate × demand, role, location, annual package, joining date) with a Draft → Sent → Accepted/Rejected/Withdrawn lifecycle, acceptance-rate stats, offer email drafts from templates, and offer visibility on the candidate profile and demand brief.
- Tasks checklist on Activities: add tasks with due dates, link them to candidates and demands, close them out with due/overdue badges.
- Admin-defined custom fields (text, number, date, select) for candidates and demands — stored as JSONB on each record, editable on forms and shown on profiles and demand briefs.
- Evidence-backed skills (blueprint §6/§7): canonical skill records with domains and aliases, a per-person skill row, and an **append-only** evidence trail behind every claim. The database revokes UPDATE and DELETE on evidence, so an assessment can never be silently replaced — you correct the record by adding a better observation. Current proficiency, confidence and validation are *derived* by a database trigger from the strongest recent evidence, so a fresh self-declared claim cannot outrank last month's assessment. Claims older than a year are flagged stale, and Analytics carries a skill inventory plus a queue of claims needing a human. Existing `skills`/`skillsDetail` data is back-filled, not discarded, and both columns stay in place so matching and imports are unaffected (migration 025).
- Bulk actions on the repository: select rows and assign an owner, add or remove a tag, set readiness, or shortlist to a demand in one go. Every action is **previewed before it runs** — you see which records will change, what each change is, and a grouped count of what will be skipped and why ("12 already tagged"), so a bulk operation can never quietly no-op on half your selection. Edits to existing records can be undone in one click. Shortlisting creates pipeline entries and is deliberately not undoable, because this product never deletes pipeline history.
- Cross-workspace search, work queue and notifications: the top-bar box searches candidates, demands, clients, contacts, referrals, notes and skills at once, ranked so the obvious answer is first, and takes you straight to the record — commercial figures are never indexed, so a recruiter cannot discover a budget by typing a number. The bell counts only what is actionable today (overdue tasks, work due, interviews today, requisitions awaiting *your* approval, referrals not yet contacted) and shows no badge at all when the desk is clear. The dashboard opens with **Your work today**. Ownership is a text field in this release, so "assigned to me" is a name match — when nothing matches your name the screen says so, rather than showing an empty queue that reads as "no work".
- Referrals (**Referrals** in the sidebar): track who referred whom, for which role, through to hire and reward state. Employees who do not use the ATS can refer from the careers page. A referred person is a third party who never applied, so they are held as a referral and **never** silently become a candidate — converting is a deliberate action that records the consent basis alongside the new profile. Duplicate referrals are accepted without telling the submitter that the person is already in your pipeline. Reward state is tracked, never calculated or paid. Hire rates are withheld until at least three referrals have resolved (migration 026).
- Excel import: upload an `.xlsx` workbook directly — no "export as CSV first". It enters the same mapping, preview, duplicate-resolution and error-report flow as a CSV. Dates come through as real dates rather than Excel serial numbers, blank cells keep their column alignment, repeated headers are disambiguated, and the error report points at the spreadsheet row numbers you can see. First worksheet only (the screen tells you when a workbook has more), and legacy binary `.xls` is not supported — save it as `.xlsx`.
- Client-ready candidate profiles: from a candidate's profile, generate a branded document to send to a client. Consent-gated — no profile-sharing consent, no document. Contact details and the current employer are withheld unless you explicitly reveal them, anonymisation replaces the name with initials and hides the current employer with it, and compensation is admin-only and off by default (current CTC is never included at all). What is not verified is printed as not verified. The preview is the document: downloads are byte-for-byte what you reviewed, and every export is audited with the list of what was disclosed. Set your agency name, colour and confidentiality footer in **Workspace settings → Client document branding**. PDF is via the browser's print dialog; no DOCX is generated.
- Custom reports (**Reports** in the sidebar): build a question over candidates, demands, submissions, interviews, offers, pipeline entries or clients — typed filters, grouping (including month rollup and multi-value skills), six measures, chart and table — then save it for the team or export an audited CSV. Only a report *definition* is stored, never results, so a saved report is never stale. Reports render through **your** permissions, not the author's: a recruiter opening an admin's compensation report is refused rather than shown the number, and a filter on a field you cannot see is dropped and declared. A measure with no values reads "No data", never 0. Scheduled/emailed reports are not included — there is no server-side scheduler, and a schedule that only runs while a browser tab is open would be a false promise (migration 024).
- Search-visible careers pages: every published role gets its own permalink and schema.org `JobPosting` markup (posting date, expiry, employment type, remote flag, direct-apply), the listing page publishes an `ItemList`, and canonical/robots/Open Graph tags are managed per view. **Workspace settings → Careers page & search visibility** shows the live URL and generates a `sitemap.xml` for the roles you are actually publishing. Two caveats worth knowing: the markup is injected by JavaScript, which Google renders but indexes more slowly than prerendered HTML; and `addressCountry` is a single constant in `src/jobPosting.js` (`DEFAULT_COUNTRY`, currently `IN`) because a bare city name cannot imply a country — change it once when deploying elsewhere. Salary is deliberately never emitted, since a wrong figure in a search result is worse than none (migration 023).
- Requisition approval & departments: reusable department records with per-department demand and headcount rollups, and an opt-in approval workflow on every demand (Draft → Pending approval → Approved/Rejected). Approval is admin-only, stamped by the database from the signed-in session, and bound to a snapshot of the material terms — changing the headcount, budget, seniority, client, department or location withdraws the approval and pulls the role off the careers page, while cosmetic edits do not. Turn it on in **Workspace settings → Departments & requisitions**; until then nothing changes (migration 022).
- Users & roles administration: see everyone with access, invite a colleague by email with a role, change roles in place and remove access — all from Workspace settings. Memberships are never writable from the browser: each action is a security-definer RPC that re-checks administrator rights in the database, a sign-up trigger redeems pending invitations, the last administrator cannot be demoted or removed, and every invitation, revocation, acceptance, role change and removal is written to the audit log (migration 021).
- Client accounts & contacts: an account record per customer (industry, location, owner, status, tier, payment terms) with contacts (primary and decision-maker flags), a portfolio list, and a detail page that rolls up every demand, submission, interview, offer and placement for that customer. Demands link to an account; client names inherited from before the accounts existed still match by name and can be adopted in one click. Submissions can be addressed to a recorded contact and prefill the account's primary. Percentages appear only where a real denominator exists, and admin-only commercial figures are never part of the rollup.
- Client submission packs (Stage 7 Deliver): compile an honest, client-ready pack from verified facts — skills with evidence, assessments, interview outcomes, expected CTC — that never includes current CTC, contact details or internal commercials, is gated on the profile-sharing consent ledger, logs a submission trail per demand, and drafts the submission email.
- Demand owner and business-unit fields on every demand, shown on the brief and in forms.
- Semantic retrieval (Phase 1.5, in-browser): a "Relevance (semantic)" sort ranks the repository by TF-IDF cosine similarity over profile and CV text, and every profile shows the most similar talent in your repository — computed locally, no external embedding vendor.
- Public careers portal (`/careers.html`, separate lightweight bundle): only explicitly published, still-open roles appear. The anonymous listing RPC is workspace-scoped and returns a curated field projection; anonymous table reads are revoked. Applications land in the Activities triage queue, and the database requires contact consent plus a currently published role before accepting an application. Each applicant receives a private status code; email alone cannot reveal application status (migrations 009, 018 and 019). Set the careers URL to `/careers.html?ws=<workspace-id>` and publish roles from each demand form.
- One-way calendar export: any interview, or the whole schedule, as an RFC 5545 `.ics` file that opens natively in Google/Outlook/Apple Calendar.
- Offer-letter generation: a formatted letter rendered from the offer record's own terms (package from the record, explicit placeholders for missing data) with download and email-draft handoff — signing stays in your e-sign workflow.
- Workspace backup & restore: a complete JSON snapshot of every table with a merge-by-id restore that never applies deletions.
- Upload hardening: beyond the extension allowlist, file magic bytes (%PDF, PK) are sniffed so a type-spoofed upload is rejected before parsing (migration 010).
- Paginated sync API: `api_changes_page(day, page_block, page_size)` with deterministic id-ordered feeds and a `next` flag — see `docs/api.md`.
- Workflow automation rules: admin-defined condition-based rules (candidate/demand/offer/interview triggers) that create tasks, add notes, tag candidates and set next actions — every application audited, examples seeded.
- Candidate application-status lookup on the careers page: a workspace-scoped anonymous RPC returns only role, status and date when the applicant supplies both their email and the private per-application code shown after submission (migration 019). Email alone reveals no status.
- One-way calendar import: upload an external `.ics` and map its events to candidates as scheduled interviews.
- Resume-inbox groundwork: paste a forwarded application email into the CV importer and get the same reviewable parsed draft.
- Candidate portal (`/portal.html`): email+password sign-in linked to the candidate record by email; a curated view of applications, interviews, offers and consents; self-service availability updates and consent withdrawal — every change audited (migration 012).
- Offer approvals: a settings-gated `Pending approval` state recruiters submit and admins release.
- Cooling-off guardrail: an explicit confirmation before re-submitting a candidate a client rejected inside the configurable window.
- Document templates: admin-managed merge-field letter templates (`{{Candidate.name}}`-style tokens with a click-to-insert field catalog) — generate letters from any profile or offer, with download and mail-client handoff.
- Candidate dossier export: a printable, self-contained HTML dossier of the full record with an audited provenance stamp (open in a browser and print to PDF).
- Natural-language semantic search: queries like "senior Databricks architect who has built Genie spaces" parse into visible criteria chips (skills, aliases, skill domains, seniority, notice, work mode, phrases, exclusions) and filter the repository - deterministic and auditable, no black box.
- Skill domains: admin-assigned domains override the base vocabulary; profiles group skills by domain and domain queries expand to member skills.
- Duplicate suggestions with confidence (high/medium + reason) - a human still approves every merge.
- Documents open through short-lived signed URLs in cloud mode.
- Client decisions on submissions: record Pending / Shortlisted / Rejected / Hired plus feedback per submission, visible on the demand.
- Governance close-outs: merges, submissions, application decisions and offer/feedback updates are audited; candidate CSV exports are stamped with export time and source on every row; demands carry `externalId` mapping fields; the API contract is documented in `docs/api.md`.
- Conversion analytics: time to ready, source-to-ready conversion and rediscovery rate, computed only from records that exist.
- View/export audit trail: profile opens and CSV exports are recorded with actor and timestamp and shown in Workspace settings.
- Repository search (all terms, quoted phrases, exclusions using `-word`), readiness/freshness/location/skill/experience/notice filters, sorting, selection and CSV export.
- CSV file upload or paste, field mapping, preview, email/phone duplicate checks and downloadable row-error report. Invalid and duplicate rows are skipped; existing records are never silently merged.
- Demands created manually or from reviewable **keyword extraction** of a JD. Set mandatory skills, relevant experience, notice, budget, location, mode, target and matching weights.
- Ranked matches with six component scores, skill gaps, budget/availability/location failures and evidence-verification prompts. Scores never automatically reject anyone.
- Candidate/demand considerations, shortlisting, stage changes and structured rejection/withdrawal reasons.
- Candidate notes and follow-ups, append-only assessment records through the UI, enrichment plans and dynamic talent pools.
- Live inventory/source/freshness/pipeline analytics. Pipeline counts are current distributions, not fabricated conversion rates.
- Optional Supabase password sign-in, workspace membership, shared PostgreSQL persistence, database audit snapshots, tenant isolation and admin/recruiter/viewer database policies.

## Deploy on Netlify

### Demo deployment

1. Put this source project in a Git repository and import it into Netlify.
2. Netlify reads `netlify.toml`: build command `pnpm run build`, publish directory `dist`, Node 22.
3. Leave both Supabase environment variables unset for the clearly labeled local demo.

Alternatively, build locally and upload the contents of `dist` using Netlify's manual deploy interface. Run `npx pnpm@11.25.0 release` to produce `releases/ecod-netlify-demo.zip` (it builds the demo and zips `dist`, including the `_redirects` and `_headers` files); extract it and upload the extracted folder. The archive is a build artifact and is gitignored, so it is generated rather than checked in. The included `_redirects` and `_headers` configure navigation and response headers for manual deploys too.

### Shared team deployment

Static hosting does not itself store team records. Configure a separate Supabase project:

1. Create a new Supabase project in your chosen region.
2. Apply every migration in ascending numeric order, through `026_referrals.sql`; do not skip a file.
   Every migration is safe to re-run: re-applying the whole chain in order is a no-op, so if you are unsure
   which files you have already run, run them all again rather than guessing.
   - `001_ecod.sql` — core tables, workspace membership, RLS, constraints and append-only history.
   - `002_blueprint_r1.sql` — skill evidence, candidate preferences, structured employment/compensation/availability history and audit events.
   - `003_documents_taxonomy.sql` — document metadata/storage policies, workspace taxonomy and gap-map fields.
   - `004_admin_settings.sql` — workspace settings and admin-only demand commercials.
   - `005_consents_sync.sql` — consent ledger, candidate preferences, note channels and `api_changes_since`.
   - `006_interviews.sql` — interviews and related candidate/demand fields.
   - `007_offers_tasks_custom.sql` — offers, tasks and custom fields.
   - `008_submissions_demand_fields.sql` — client submissions and demand ownership fields.
   - `009_careers_portal.sql` — anonymous application RPC, public open-role listing and member-only triage.
   - `010_sync_pagination.sql` — deterministic incremental feed and paginated `api_changes_page`.
   - `011_automation_portal.sql` — workspace automation rules and public application-status lookup.
   - `012_candidate_portal.sql` — curated candidate portal, whitelisted self-service RPCs and `Pending approval` offer status.
   - `013_offer_approvals.sql` — offer approval stamps and the initial send gate.
   - `014_offer_approval_integrity.sql` — admin-only approvals bound to a server-generated snapshot of exact offer terms.
   - `015_sync_offer_approval_fields.sql` — includes approval-only offer changes and approval metadata in both sync RPCs.
   - `016_portal_clearable_preferences.sql` — makes blank portal preferences clear to SQL `NULL` and validates notice/availability values server-side.
   - `017_complete_incremental_feed.sql` — makes the change feed cover every workspace table, tracks auxiliary updates, paginates across all tables, and permits consideration-stage automation rules.
   - `018_public_careers_isolation.sql` — revokes anonymous demand-table reads, adds explicit per-role publication, scopes public listings to a workspace and safe columns, and enforces consent/open-role checks on applications.
   - `019_private_application_status.sql` — replaces email-only status lookup with a private per-application code and returns that code only to the applicant on successful apply.
   - `020_clients_contacts.sql` — client account and contact records, demand/submission links and their incremental-sync coverage.
   - `021_user_administration.sql` — workspace invitations, admin-only membership RPCs with a last-administrator guard, and an `auth.users` sign-up trigger that redeems invitations. Run this file as the `postgres` role (the Supabase SQL editor does), because it creates a trigger on `auth.users`.
   - `022_requisitions_departments.sql` — department records, the demand→department link, and the opt-in requisition approval gate with its server-side stamps and term snapshot.
   - `023_careers_seo.sql` — adds the posting and expiry dates to the anonymous careers listing so the public page can emit valid Google Jobs structured data.
   - `024_saved_reports.sql` — saved custom report definitions, shared per workspace and carried by the sync feed.
   - `025_skills_model.sql` — canonical skills, per-person skills and append-only skill evidence, with a one-time back-fill from the previous `skills`/`skillsDetail` fields.
   - `026_referrals.sql` — referral records and the write-only anonymous referral RPC for the careers page.
     Also create a **private** Storage bucket named `documents` (Storage → New bucket).
3. Create the first user in Supabase Authentication. The app intentionally has no public sign-up flow.
4. Edit the placeholder email in `supabase/PROVISION_WORKSPACE.sql`, then execute it to create the workspace and its first administrator. After that, add colleagues from **Workspace settings → Users & roles** rather than in SQL: invite an address, and access is granted the moment that person signs in or signs up. Each account belongs to one workspace in this release, and the database refuses any change that would leave the workspace without an administrator.
5. Retrieve the workspace UUID in the SQL Editor with `select w.id from public.workspaces w join public.memberships m on m.workspace_id=w.id join auth.users u on u.id=m.user_id where u.email='YOUR_ADMIN_EMAIL' and m.role='admin';`, then share the careers page as `/careers.html?ws=<workspace-uuid>`. Roles are private by default—including pre-existing roles after migration 018—and become visible only when a recruiter checks **Publish this role on the public careers page** on the demand form. Applications submitted before migration 019 get database codes that were not shown to applicants; handle their status requests through a verified channel.
6. Set these **build-time** variables in Netlify:

   ```text
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
   ```

   Use the public key only. Never put a service-role or secret key in a `VITE_` variable; those values are embedded in browser assets. RLS protects records.

7. Rebuild and deploy. The app now requires sign-in and opens an empty shared repository. Import your data deliberately after verifying your deployment's access controls. Changing environment variables requires a new build; it does not change an already-built demo zip.
8. Sign in with two team accounts to verify shared writes; sign out and verify records are unavailable. Use the refresh control in Workspace settings to fetch changes from other users. This release does not provide realtime collaboration or conflict resolution; concurrent edits use last-write-wins.

For local cloud testing, copy `.env.example` to `.env.local`, populate both variables and restart Vite. Local `.env` files are ignored by Git.

## Matching model

Default weights: required skills 35%, relevant experience 20%, recent assessment 20%, notice 10%, budget 10%, location/work mode 5%. Each demand can change these weights, which must sum to 100.

Skill coverage uses canonical names and a small alias dictionary. Experience is the profile's recruiter-entered relevant experience, not a per-skill inference. Assessment evidence is scoped to this demand or general readiness and expires from scoring after 180 days. The latest relevant assessment supplies readiness. Unavailable candidates are flagged; missing or stale evidence remains visible. Unknown compensation, relevant experience and notice earn zero in those components. A high numerical score does not erase a hard-constraint failure.

The target start date is stored for planning; the current availability score compares notice days with the demand's maximum notice, not a calculated joining-date promise. Amounts are INR lakhs per annum in this first release. Work-mode/location matching is exact and does not infer willingness to relocate. All persisted data is human-entered or explicitly imported; JD extraction uses a deterministic keyword/alias parser, **not an LLM**.

## Security and scope boundaries

The cloud schema denies anonymous access, enforces workspace membership, uses composite foreign keys to block cross-workspace links, blocks viewer writes and records before-update snapshots in server-generated history. Administrators and recruiters have the same data-editing privileges; workspace/role administration is performed through the trusted SQL console. Viewer accounts can see the same fields, including compensation, but cannot save changes. The cloud UI hides or disables editing, restore and data-export actions for viewers, and refuses writes while a role is unresolved; PostgreSQL RLS remains the enforcement boundary.

This is a functional first release, not the full multi-release blueprint. Not implemented: a hosted embedding index (the in-browser TF-IDF ranker covers Phase 1.5 retrieval locally); a mailbox-based resume inbox (email-to-parse; forwarding an email into the importer is supported); server-sent interview notifications and calendar/video synchronization (email drafts and one-way `.ics` import/export are available); e-signature execution and onboarding handoff; calendar views/sync; client and vendor login portals (candidate self-service and public careers portals are available); WhatsApp/SMS and mass communication; custom fields beyond candidates and demands; user/role administration UI; fair-evaluation masking; watermarking and rate-limited exports; SSO/MFA administration; automatic retention enforcement; automated backups/restore verification. Agree these controls before using the app as a production system for sensitive candidate data.

The frontend currently fetches the workspace in paginated batches and filters/ranks in memory. For very large repositories, add server-side search, pagination and ranking. Demo storage size is browser-limited and produces a visible save error if full.

## Validation

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 test       # node:test + PGlite + real React/jsdom user journeys
npx pnpm@11.25.0 lint       # ESLint across src/ and tests/
npx pnpm@11.25.0 format:check # Prettier verification across source and tests
npx pnpm@11.25.0 build      # Vite production bundle
```

The current suite has **191 passing tests**. It covers the matching and validation core, CSV/CV parsing, duplicate handling, history, consent, submissions, offers, workflow rules, analytics, document processing, backup/restore and templates; it also drives the real React shell through candidate/demand journeys, public careers and candidate portals, interviews and offers, CSV import, automation, assessments, enrichment plans, talent pools and workspace settings. Cloud-configured UI tests verify that viewers can inspect records while mutation, restore and export controls are hidden or disabled. Cloud-mode careers tests exercise the scoped listing, application and private-code status RPC payloads against the mocked Supabase HTTP boundary; another cloud journey confirms that a `23505` import conflict reloads the workspace and reclassifies the row. UI tests assert the records actually persisted, not only that a page rendered.

Migration-specific PGlite integration tests apply the SQL chain through migration 025 and verify workspace isolation, role permissions, foreign-key boundaries, audit/history, candidate portal whitelisting and clearable preferences, offer approval identity/term integrity, complete approval-aware incremental sync, public careers tenant isolation, field projection, consent/role eligibility, private status-token enforcement, client-account integrity and cascade behaviour, membership administration (admin-only RPCs, the last-administrator guard, invitation redemption at sign-up and the membership audit trail), requisition approval (admin-only decisions, server-generated stamps, term-snapshot invalidation and the opt-in publish gate), the anonymous careers projection after it was widened for structured data, saved reports (tenant scoping, editor-only delete, unique names and the absence of any result cache), and the skills model (append-only evidence, trigger-derived proficiency and the legacy back-fill run against real pre-migration rows). This exercises PostgreSQL behavior locally; it does not substitute for testing Supabase Auth, Storage and PostgREST against your provisioned cloud project.

The browser workflow was exercised with fictional profiles: create/search, import duplicates and invalid rows, edit/history, JD-to-demand matching, shortlist, pipeline transition and reload persistence. See `docs/QA.md` for the verification record.

Research and initial decisions are in `docs/PRODUCT_PLAN.md`.
