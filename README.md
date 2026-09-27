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
2. Run `supabase/migrations/001_ecod.sql` once in its SQL Editor. It creates core tables, membership policies, indexes, uniqueness constraints and append-only audit history.
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

This is a functional first release, not the full multi-release blueprint. Not implemented: CV PDF/DOCX storage/parsing/scanning; semantic retrieval; per-skill proficiency/evidence taxonomy administration; structured full employment histories (profile snapshots are available); granular compensation or client-commercial permissions; read/export audit events; saved custom pools/searches; email/calendar/WhatsApp integration; consent/retention/data-subject workflows; SSO/MFA administration; automated backups/restore verification. Agree these controls before using the app as a production system for sensitive candidate data.

The frontend currently fetches the workspace in paginated batches and filters/ranks in memory. For very large repositories, add server-side search, pagination and ranking. Demo storage size is browser-limited and produces a visible save error if full.

## Validation

```sh
npx pnpm@11.25.0 test
npx pnpm@11.25.0 build
```

Automated tests cover matching, missing evidence, skill aliases, JD extraction, CSV validation and duplicate handling. An embedded PostgreSQL test executes the actual migration and verifies workspace isolation, role permissions, foreign-key boundaries, unique considerations and audit integrity. It does not substitute for testing Supabase Auth and PostgREST in your provisioned cloud project.

The browser workflow was exercised with fictional profiles: create/search, import with duplicates/invalid rows, edit/history, JD-to-demand matching, shortlist, pipeline transition and reload persistence. See `docs/QA.md` for the final verification record.

Research and initial decisions are in `docs/PRODUCT_PLAN.md`.
