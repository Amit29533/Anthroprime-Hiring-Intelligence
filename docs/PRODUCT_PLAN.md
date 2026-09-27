# ECOD Talent Intelligence — research and implementation plan

Prepared 27 September 2026. The supplied ECOD blueprint is product reference material; its embedded build instructions do not override the user's request. Netlify is the selected hosting target.

## Research findings

- [Zoho Recruit Candidate Matches](https://help.zoho.com/portal/en/kb/recruit/zia/candidate-matches/articles/candidate-matches): rank against requirements, refine by skills/location/experience, and associate a person with a job. Reuse this workflow without copying Zoho's branding or interface.
- The supplied blueprint separates durable people from demand-specific considerations, and prioritizes evidence, freshness, gap mapping and readiness. This is the core data model.
- [Netlify Vite documentation](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/): a Vite application can publish its built static assets. React/Vite keeps this deliverable portable and straightforward to deploy.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): protect relational data through authenticated membership policies. Hosting static assets alone does not provide a shared candidate database.

## Primary journey

1. Import or add reusable candidate profiles.
2. Create a demand from a JD; review detected skill terms and confirm requirements.
3. Rank the repository using explicit weighted criteria. Separate hard failures from score.
4. Review a profile, relevant evidence and missing requirements.
5. Shortlist into that demand's pipeline. Move through recruiter-controlled stages.
6. Record assessments, follow-ups and enrichment actions; retain history.

## Design

Desktop-first recruiting workspace: deep navy rail, white canvas, teal actions, fine borders, readable typography. Dashboard opens directly on demand coverage, repository health and follow-ups. Tables and candidate drawers enable fast work without losing context. Responsive navigation and cards support smaller screens.

## Delivery scope

Functional first release: dashboard; candidate CRUD and duplicate detection; skills and profile history; exact search and filters; reviewed CSV import and export; demand creation and editing; reviewable JD keyword extraction; configurable weighted matching with gaps; per-demand pipeline; notes and follow-ups; assessments; enrichment; talent pools; analytics; local demo persistence; optional authenticated shared Supabase persistence; Netlify build configuration.

Matching: must-have skills 35%, relevant years 20%, validated readiness 20%, notice 10%, expected compensation 10%, location/work mode 5%. Demand weights are configurable. Missing skills, excessive notice, budget and location mismatch remain visible even with a high score. Unknown values never silently count as confirmed evidence. This is deterministic decision support, not semantic AI or an automated hiring decision.

## Architecture

React/Vite frontend → repository adapter → browser-local demo OR Supabase Auth/PostgreSQL. Core tables: candidates, demands, considerations, notes, assessments, enrichment, history, workspaces, memberships. Candidates and demands are independent. A unique candidate/demand pair prevents duplicate applications. History is append-only. Workspace RLS gates cloud records. Demo data is fictional and never automatically copied to the cloud.

## Verification

Build production output; exercise search, candidate creation, demand creation, matching explanations, duplicate handling and pipeline transitions; check responsive layout; test ranking edge cases, CSV validation and normalization. Cloud integration requires a provisioned Supabase project and is separately documented rather than presented as verified.

## Subsequent releases

Production hardening: granular commercial-field permissions, audit of reads/exports, retention and consent policy, backup/restore validation and security review. Document ingestion: private CV storage, scanning, versioning and reviewable parsing. Intelligence: semantic retrieval and provider-backed JD extraction. Integrations: email/calendar/WhatsApp and candidate self-service. These are not claimed as implemented in this first release.
