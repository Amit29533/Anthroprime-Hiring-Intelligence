# Verification record

27 September 2026 — ECOD first release.

## Automated checks

- Production build: Vite React bundle, local assets and Netlify configuration.
- Domain/import tests: skill aliases; scoring breakdown; hard failures despite high scores; unknown information; old/unrelated assessments; JD skill boundaries; duplicate detection; search syntax; numeric validation; malformed CSV; mixed valid/invalid/duplicate import; 200-row import; unavailable candidates and phone validation.
- Actual PostgreSQL migration executed in PGlite. Verified successful writes, historical snapshots, case-insensitive email uniqueness, candidate/demand uniqueness, cross-workspace row isolation, cross-workspace foreign-key rejection, denied anonymous access, denied viewer writes, denied membership changes and immutable audit records for authenticated application roles.

## Browser journeys

Verified through the running interface using fictional data:

1. Search `Databricks Azure` returned six initial matching profiles.
2. Created Maya Shah, then found the profile through repository search.
3. Created an Orion Labs data-engineering demand from a JD. Reviewed extracted skills and requirements, then generated ranked matches.
4. Expanded Maya's six-component match explanation: 80% with missing assessment evidence explicitly identified.
5. Shortlisted Maya into that demand; moved Identified → Contacted; reloaded and verified the saved stage.
6. Imported one valid CSV row, skipped a case-insensitive duplicate and rejected an invalid email. Reviewed the preview before import.
7. Edited the imported profile's expected CTC; verified the update and previous-profile history.
8. Recorded an assessment for Maya; match score changed from 80% to 98%, while profile readiness remained recruiter-controlled.
9. Corrected and rechecked target-date persistence after finding a date-input event issue.
10. Checked desktop (1440px) and mobile (390px) layouts. Main pages fit the viewport; repository tables and pipelines intentionally scroll within their own containers. Mobile navigation opens and closes correctly.

## Limits of verification

No Netlify account or Supabase project was connected or provisioned in this task. Hosted Auth/PostgREST, cloud end-to-end operation, team concurrency, production load, backup recovery and external integrations are therefore not verified. The cloud schema's authorization rules were tested locally with PostgreSQL roles. The Netlify artifact is a demo build until rebuilt with database configuration.

Sample records added during browser verification are fictional and exist only in the local preview's browser storage, not in the source seed data or deployable archive.
