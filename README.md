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
- CV and document uploads (PDF/DOCX/TXT/MD/CSV up to 5 MB) with allowlist validation, randomized storage names, SHA-256 hashes and best-effort text extraction; cloud mode stores originals in a private Supabase Storage bucket, demo mode keeps small files in the browser.
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
- Client submission packs (Stage 7 Deliver): compile an honest, client-ready pack from verified facts — skills with evidence, assessments, interview outcomes, expected CTC — that never includes current CTC, contact details or internal commercials, is gated on the profile-sharing consent ledger, logs a submission trail per demand, and drafts the submission email.
- Demand owner and business-unit fields on every demand, shown on the brief and in forms.
- Semantic retrieval (Phase 1.5, in-browser): a "Relevance (semantic)" sort ranks the repository by TF-IDF cosine similarity over profile and CV text, and every profile shows the most similar talent in your repository — computed locally, no external embedding vendor.
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

Alternatively, build locally and upload the contents of `dist` using Netlify's manual deploy interface. The supplied `releases/ecod-netlify-demo.zip` contains the built demo; extract it and upload the extracted folder. The included `_redirects` and `_headers` configure navigation and response headers for manual deploys too.

### Shared team deployment

Static hosting does not itself store team records. Configure a separate Supabase project:

1. Create a new Supabase project in your chosen region.
2. Run `supabase/migrations/001_ecod.sql` once in its SQL Editor, then `002_blueprint_r1.sql`, `003_documents_taxonomy.sql`, `004_admin_settings.sql`, `005_consents_sync.sql`, `006_interviews.sql`, `007_offers_tasks_custom.sql` and `008_submissions_demand_fields.sql`. Migration 001 creates core tables, membership policies, indexes, uniqueness constraints and append-only audit history; 002 adds skill-detail/engagement fields, structured history tables and the view/export audit trail; 003 adds CV/document metadata, workspace taxonomy extensions and gap-map linkage columns; 004 adds workspace settings and the admin-only demand commercials table; 005 adds the consent ledger (RLS-protected), candidate preference fields (timezone, preferred locations, next action, external ID), note channels and the `api_changes_since` sync RPC; 006 adds the interviews table (RLS-protected, audit-trailed), tags on candidates and demands, and interviews in the sync payload; 007 adds the offers and tasks tables (RLS-protected, audit-trailed) and per-record JSONB custom fields for candidates and demands; 008 adds the client-submissions table (RLS-protected, audit-trailed) and demand owner/business-unit columns. Also create a **private** Storage bucket named `documents` (Storage → New bucket).
3. Create the first user in Supabase Authentication. The app intentionally has no public sign-up flow.
4. Edit the placeholder email in `supabase/PROVISION_WORKSPACE.sql`, then execute it to create the workspace and its first administrator. The same file shows how to add colleagues. Each account belongs to one workspace in this release.
5. Set these **build-time** variables in Netlify:

   ```text
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
   ```

   Use the public key only. Never put a service-role or secret key in a `VITE_` variable; those values are embedded in browser assets. RLS protects records.

6. Rebuild and deploy. The app now requires sign-in and opens an empty shared repository. Import your data deliberately after verifying your deployment's access controls. Changing environment variables requires a new build; it does not change an already-built demo zip.
7. Sign in with two team accounts to verify shared writes; sign out and verify records are unavailable. Use the refresh control in Workspace settings to fetch changes from other users. This release does not provide realtime collaboration or conflict resolution; concurrent edits use last-write-wins.

For local cloud testing, copy `.env.example` to `.env.local`, populate both variables and restart Vite. Local `.env` files are ignored by Git.

## Matching model

Default weights: required skills 35%, relevant experience 20%, recent assessment 20%, notice 10%, budget 10%, location/work mode 5%. Each demand can change these weights, which must sum to 100.

Skill coverage uses canonical names and a small alias dictionary. Experience is the profile's recruiter-entered relevant experience, not a per-skill inference. Assessment evidence is scoped to this demand or general readiness and expires from scoring after 180 days. The latest relevant assessment supplies readiness. Unavailable candidates are flagged; missing or stale evidence remains visible. Unknown compensation, relevant experience and notice earn zero in those components. A high numerical score does not erase a hard-constraint failure.

The target start date is stored for planning; the current availability score compares notice days with the demand's maximum notice, not a calculated joining-date promise. Amounts are INR lakhs per annum in this first release. Work-mode/location matching is exact and does not infer willingness to relocate. All persisted data is human-entered or explicitly imported; JD extraction is keyword-based, **not an LLM or semantic search**.

## Security and scope boundaries

The cloud schema denies anonymous access, enforces workspace membership, uses composite foreign keys to block cross-workspace links, blocks viewer writes and records before-update snapshots in server-generated history. Administrators and recruiters have the same data-editing privileges; workspace/role administration is performed through the trusted SQL console. Viewer accounts can see the same fields, including compensation, but cannot save changes. The UI currently exposes editing controls to viewers; the database denies those writes.

This is a functional first release, not the full multi-release blueprint. Not implemented: a hosted embedding index (the in-browser TF-IDF ranker covers Phase 1.5 retrieval locally); resume inbox (email-to-parse); automated interview notifications (server-sent email) and calendar/video integration; e-sign offer letters and onboarding handoff; calendar views/sync; public careers site, candidate/client portals; WhatsApp/SMS and mass communication; e-sign offers; custom fields per module; user/role administration UI; fair-evaluation masking; watermarking and rate-limited exports; SSO/MFA administration; automated backups/restore verification. Agree these controls before using the app as a production system for sensitive candidate data.

The frontend currently fetches the workspace in paginated batches and filters/ranks in memory. For very large repositories, add server-side search, pagination and ranking. Demo storage size is browser-limited and produces a visible save error if full.

## Validation

```sh
npx pnpm@11.25.0 test
npx pnpm@11.25.0 build
```

Automated tests (79) cover matching, missing evidence, skill aliases and workspace taxonomy extensions, proficiency gating, nice-to-have coverage, engagement constraints, history capture, data-quality queues, CV parsing and file allowlists, DOCX text extraction, duplicate pairs and merge previews, gap-map classification, incremental change exports, stage labels, retention and anonymization, conversion metrics, commercial margins, JD extraction, CSV validation and duplicate handling, concept expansion, demand coverage/uplift/funnel analytics, consent normalization, per-demand stage sets, interview feedback scoring, template substitution, offer lifecycle summaries, task defaults, custom-field round-trips, submission-pack consent gating and internal-data exclusion, and TF-IDF semantic ranking — plus a server-render smoke suite that renders every page and profile tab so a broken import or missing identifier fails CI instead of the browser. Embedded PostgreSQL tests execute migrations 001–008 and verify workspace isolation, role permissions, foreign-key boundaries, unique considerations, audit integrity, consent RLS and the changes-since RPC. They do not substitute for testing Supabase Auth and PostgREST in your provisioned cloud project.

The browser workflow was exercised with fictional profiles: create/search, import with duplicates/invalid rows, edit/history, JD-to-demand matching, shortlist, pipeline transition and reload persistence. See `docs/QA.md` for the final verification record.

Research and initial decisions are in `docs/PRODUCT_PLAN.md`.
