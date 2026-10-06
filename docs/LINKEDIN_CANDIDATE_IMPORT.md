# Candidate import through LinkedIn ID

Implemented locally; no deployment, provider key, live paid lookup or hosted migration has been performed.

Open **Candidates → Import → Import from LinkedIn**. The option accepts a public member profile URL, public handle (such as `priya-sharma`) or a numeric LinkedIn ID. It offers two paths:

- **Extract pasted LinkedIn profile:** enter a profile URL/handle and paste profile text. This runs locally without a provider account. Numeric IDs need a provider lookup because pasted text alone cannot establish the ID-to-profile relationship. Heuristic extraction suggests name, email, phone, title, skills and a short summary; company/location can be filled in during review.
- **Look up LinkedIn ID:** use the server-side People Data Labs Person Enrichment adapter after configuration and workspace activation. It requests only name, work email, mobile phone, current title/company, location, skills and LinkedIn URL/ID. Numeric IDs use the provider's `lid` parameter; URLs/handles use `profile`. No arbitrary URL is fetched and the application does not scrape LinkedIn or use a LinkedIn session cookie.

Results are editable drafts. Provider responses must score at least 6/10, report matching the requested input and return the same normalized URL (or exact numeric ID with a valid public profile URL). These checks reduce mismatches; they are not proof of accuracy. A recruiter must review identity, contact and profile information and explicitly confirm before saving. An email or phone is required by the existing candidate model; add it manually if the provider/profile text does not contain one.

The normal candidate persistence path assigns the compact Anthro-ID. Unknown experience, notice, availability and compensation remain blank. Candidates start Assessing; skills are not marked validated. The existing `verified` date records this review date, not independent verification by LinkedIn. A `custom.linkedinImport` note records provider, lookup time, optional score, URL and review time; this is editable import metadata, not an authoritative server audit receipt. Raw provider responses and full pasted text are not persisted. Existing candidate/profile permissions, change history and candidate save automation still apply.

Duplicate checks use email, phone and canonical LinkedIn URLs against the candidate data loaded by the import workflow. Tracking parameters and host variants are normalized. A duplicate must be opened for update rather than silently overwritten. Repeating a failed save reuses the draft candidate ID. These UI checks do not impose a new database-wide LinkedIn uniqueness constraint, and concurrent independent imports remain subject to existing candidate integrity controls.

## Automatic lookup configuration

1. Apply the complete migration chain through `20261006163129_linkedin_candidate_enrichment.sql`, then deploy frontend and Netlify functions together. The migration is repeatable and defaults lookup off. Static drag-and-drop cannot provide authenticated provider lookup; local pasted-text extraction still works.
2. Configure server-only Netlify environment variables:

   ```text
   LINKEDIN_ENRICHMENT_ENABLED=true
   PEOPLEDATALABS_API_KEY=<your provider key>
   ```

   Use the existing Supabase URL/anon-key configuration for authenticated API access. Never prefix the provider key with `VITE_` or put it in the frontend. No additional npm dependency is needed.
3. Use a People Data Labs account/plan permitted to return the requested fields for your recruitment use. Credits, coverage and field availability depend on the account. The application does not assume a free quota or guarantee email/phone availability. The pasted-text path requires no enrichment provider credits.
4. In the import dialog, a workspace administrator selects **Enable workspace LinkedIn lookup**. The database stores `settings.custom.linkedinEnrichment=true`. If administrator MFA is active, verify the authenticator first. Recruiters can use enabled lookup; viewers/anonymous users cannot. Neither the migration nor a configured key automatically activates workspaces.
5. Lookup transmits the entered profile URL or numeric ID to People Data Labs. The UI states this before use. No CV bytes, internal candidate notes, database history or additional candidate fields are sent. Each workspace has a locked reservation counter capped at 20 attempts per UTC day, shared across editors; failures and no-match attempts consume reservations. This application cap is separate from provider billing/quotas. Browser users cannot edit counters. Retries can use another provider credit; there is no automatic provider retry or paid-response cache.

## API and rollout checks

`POST /.netlify/functions/linkedin-candidate` accepts authenticated `status` or `lookup` actions. `lookup` accepts `{ action: "lookup", profile: "priya-sharma" }` (also a URL or numeric ID). It validates current membership, role, configured provider, workspace activation and a database quota reservation before calling the fixed provider endpoint. It returns a minimized draft, not a saved candidate. Provider errors/keys are not logged or echoed. Redirects are rejected and provider fetches time out after ten seconds.

The permission-checked database RPCs are `api_linkedin_import_status`, `api_set_linkedin_import(p_enabled boolean)` and `api_reserve_linkedin_lookup`. Configuration is admin-only; reservations require an editor and apply D5 assurance checks to administrators where enabled. Policy is checked at entry; disabling lookup does not cancel requests already underway. The quota table is private with RLS and no browser table access.

In hosted staging, verify a representative licensed test profile, no-match/missing-contact responses, numeric ID agreement, quota/plan errors, roles in two workspaces, MFA and normal Anthro-ID assignment. Run hosted database advisors and concurrent reservation checks. The fixture tests use fictional data and mock provider responses; no real API key or account was used. Disable the workspace option before rolling back and retain existing candidates/import notes and quota records.

Direct extraction of arbitrary profiles through LinkedIn's own API needs approved access and applicable member permissions; a public handle is not a partner API Person ID. See [LinkedIn Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api), [People Data Labs input parameters](https://docs.peopledatalabs.com/docs/input-parameters-person-enrichment-api) and [provider response contract](https://docs.peopledatalabs.com/docs/output-response-person-enrichment-api). LinkedIn's [profile PDF option](https://www.linkedin.com/help/linkedin/answer/a541960) can also feed the existing CV upload flow where available.

## Verification

All 740 full-suite tests passed. Seven focused parser/provider/endpoint/UI/database checks also passed for the final numeric-ID support, including URL restrictions, ID matching, weak/mismatched response refusal, workspace quota/role/MFA checks, duplicate detection, explicit review and stable retry identity. ESLint, changed-file formatting, whitespace and the final Netlify offline build passed. All 13 functions were packaged, including `linkedin-candidate`; the entry bundle stayed within its 100 KiB budget at 64.8 KiB. No local database service is available for Supabase advisors. Live provider/hosted advisor and concurrency acceptance remain pending.
