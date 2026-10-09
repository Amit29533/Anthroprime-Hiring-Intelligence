# Authenticated production smoke test - 9 October 2026

Target: https://incomparable-mooncake-686e27.netlify.app/. The user signed in to the deployed application. All actions below used its actual browser UI and the existing admin account. This is a core workflow smoke test, not exhaustive acceptance of every feature or role.

## Live results

| Workflow | Result |
| --- | --- |
| Upload generated one-page PDF and extract text | Passed; 1,330 characters extracted, name/email, four years and four known skills suggested |
| Review CV evidence before import | Passed; import stayed disabled until review. Removed test notice excerpts, merged related lines, entered dates from the original and confirmed four cited records |
| Candidate creation and identity | Passed; Mira Testcandidate assigned ANTHRO-00001 |
| Edit and label test profile | Passed; location/title/summary/tags saved; source remains CV upload |
| Full reload and Anthro-ID search | Passed; same identity and edited fields loaded from cloud |
| Duplicate PDF import | Passed; duplicate named and import disabled; no second candidate created |
| Shared deterministic indexing/search | Passed after manual indexing; identity display repaired and verified live |
| Unpublished demand creation and matching | Initially failed because stageSet was missing from the database. Passed after migration; match explains unknowns and does not certify readiness |
| Shortlist and pipeline transition | Passed; Identified to Contacted survived reload. Restored to Identified |
| Internal note | Passed; labelled test note retained on candidate |
| Synthetic assessment | Passed; score 50 with explicit no-real-validation notice. Profile remains Assessing |
| Internal interview scheduling and cancellation | Passed; internal synthetic panel recorded, then cancelled; no upcoming fixture remains |
| Repository CSV export | Passed; downloaded CSV contains ANTHRO-00001 and the saved fields, with audited export metadata |
| Report builder | Passed; saved synthetic candidate-count report shows one candidate |
| Original PDF storage | Failed; browser PUT returned Failed to fetch. Extracted text and document metadata retained, stored=false. Not an antivirus pass or a successful original upload |

CV heuristics deliberately produce suggestions. Written month dates needed manual entry and paragraphs became separate excerpts. The user-reviewed result retained source citations. CV review does not establish independent human-confirmed employment, availability or readiness.

## Repairs

- Migration `20261009060419_live_smoke_demand_stages_and_search_identity.sql` adds the missing quoted stageSet array with allowed-stage constraints. Existing RLS remains in force. It also includes anthroNumber/anthroId in shared search results while preserving membership checks, current fingerprints, filters and bounds. Applied and verified on the hosted project; migration history aligned to the CLI-generated version (95 migrations total).
- CV phone parsing now stays on one line and excludes year ranges and ISO calendar dates. Education dates previously produced a false phone suggestion.
- Candidate edit source options now include CV upload.
- Original upload failures now explain endpoint/network/CORS checks without revealing signed URLs; completed imports explicitly warn when an original failed to save. Conditional PUT handling and private scan gates remain intact.

Regression checks: 19 parser, private-upload and migration tests passed; 20 CV review, document signing, normalization and intelligence UI tests passed. Lint, formatting and production build passed. The lazy PDF chunk still produces the existing size warning; main bundle is within its 100 KiB budget.

Hosted security advisers retain the previously documented private deny-table and security-definer categories plus disabled leaked-password protection. This change added no public table grants, removed no RLS policies and introduced no mutable-search-path warning.

## Retained synthetic fixtures

- Candidate: `8f3bfc34-6d6a-49be-ac5c-eac50eae1fca` / ANTHRO-00001, mira.testcandidate.20261009@example.invalid; Synthetic test and Live smoke 2026-10-09 tags.
- Unpublished demand: `47fe35e3-0540-49ac-afd7-339660cccce5`, TEST ONLY - React Developer / Fictional Smoke Test Client.
- Failed original document metadata: `8e8d0a6b-82b0-4153-82c7-b82f245cdc40`; parsed text retained, original not stored.
- Labelled internal note, assessment, cancelled interview, saved report and audited CSV export.

These were retained for inspection. No real candidate was imported, messages were not sent, the demand was not publicly published and no portal grants or provider activations were performed.

## Remaining operating acceptance

R2 credentials are present in Netlify, but that alone does not validate the endpoint, bucket or CORS. The failing browser request needs investigation with authenticated Cloudflare access. Check the exact production origin, PUT/GET/HEAD and Content-Type/If-None-Match against [R2 setup](R2_SETUP.md). A generic fetch failure is not sufficient evidence to identify CORS as the sole cause. Do not mark the original stored or scanned until actual upload and applicable scan acceptance succeed.

Live private scanning/OCR, Google mail/calendar, external AI/enrichment and other providers were not activated or tested with production credentials. This session used one admin login; separate recruiter, assessor, client and candidate sessions were not impersonated.
