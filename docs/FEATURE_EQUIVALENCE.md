# Feature Equivalence Verification — ECOD vs. Zoho Recruit & the ECOD Blueprint

Prepared 27 September 2026 · Code state: `492f9bb` (branch `arena/01a0e3a4-anthroprime-hiring-intelligenc`)

> **Blueprint source:** `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` (v1.0, 18 September 2026) lives on the repository's `main` branch (commit `910ece0`). The full text was extracted and reconciled section-by-section in matrix section N below.

> **Blueprint source:** `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` (v1.0, 18 September 2026) lives on the repository's `main` branch (commit `910ece0`). The full text was extracted and reconciled section-by-section in matrix section N below.

**Method:** Zoho Recruit's feature inventory was taken from Zoho's own plan-comparison page (full module/feature matrix), Zoho's staffing-agency feature pages, Zoho help documentation (resume parser, calendar sync, sourcing bot) and independent 2026 reviews. Each Zoho/blueprint capability was then checked against actual code in `src/`, `supabase/` and `tests/` — not against marketing claims.

**Status legend:**
✅ Equivalent exists · 🟡 Partial (some of the capability exists) · ❌ Missing · ⚙️ Different by design (deliberate non-AI/deterministic alternative)

---

## 1. Executive summary

Two verifications were performed: **(a)** 97 Zoho Recruit capabilities checked one-by-one against the code, and **(b)** all **123 requirements** of the ECOD Product Blueprint v1.0 checked section-by-section. *Updated 27 September 2026 after implementation batches 1–4 (1: skills evidence, structured histories, LinkedIn dedupe, quality queues, view/export audit · 2: CV upload with reviewable parsing, gap map, merge review, taxonomy admin, change export · 3: admin console with stage labels/retention/anonymization/audit log, CV-text search, admin-only commercials, conversion analytics · 4: saved views + column chooser + bulk update, consent ledger with data-subject export, per-demand stage sets + per-skill minimums, concept-expansion search, coverage/uplift/funnel analytics, hosted `api_changes_since` RPC) — blueprint coverage moved from 43% to **68%**.*

| Verification | ✅ Equivalent | 🟡 Partial | ⚙️ By design | ❌ Missing | Weighted coverage |
|---|---|---|---|---|---|
| **Zoho Recruit** feature set (A–M) | 9 | 18 | 2 | 68 | **20%** |
| **ECOD Blueprint v1.0** (N.1–N.14) | 59 | 49 | 1 | 14 | **68%** |

**ECOD today ≈ a strong "repository-first matching core":** candidate repository, CSV import/export, demands, explainable weighted matching, pipeline, assessments, notes, pools, analytics, plus a hardened multi-tenant schema. That overlaps with roughly the **Free/Standard tier** of Zoho Recruit's core ATS, minus resumes, portals, and communication.

**The largest gaps vs. Zoho Recruit, in order of recruiter impact:**
1. **Resume handling is now partial** — upload, reviewable parsing, storage and search-inside shipped (batch 2); the resume inbox (email-to-parse) is still open.
2. **No interviews module** (scheduling, interviewer feedback forms, calendar sync, video interviews).
3. **No external-facing surfaces** — careers site, candidate portal, client portal, vendor portal, web forms.
4. **No communication layer** — email templates/sync, mass email, SMS/WhatsApp, telephony.
5. **No automation engine** — workflow rules, alerts, tasks, assignment/approval rules, blueprints, webhooks/API.
6. **Thin customization layer** — saved views shipped (batch 4); custom fields, tags, custom modules and layout editor remain open.
7. **No staffing-agency CRM depth** — client/contact records, submit-to-client with feedback, offers/e-sign, placements.
8. **No Zia-style AI** — semantic matching, AI profile summaries, AI JD/email writing, sourcing chatbot (ECOD deliberately ships deterministic matching instead).

**Remaining gaps vs. the ECOD Blueprint after implementation batch 4:**
1. **Semantic/vector search (§5, §11)** — lexical concept expansion shipped; embedding-based matching remains the blueprint's own Phase 1.5.
2. **Demand richness (§4.2)** — recency requirements, demand owner/business-unit fields still open; per-skill minimums, commercials and stage sets shipped.
3. **Governance depth (§12)** — backups/restore verification, user/role administration UI, merge/role-change audit events still open; consent ledger, retention + anonymization and data-subject export shipped.
4. **API surface (§14)** — `api_changes_since` RPC shipped; REST wrapper with pagination and `external_mapping_id` fields still open.
5. **External surfaces (§15+)** — public careers portal, candidate/client portals, email/calendar sync and e-sign offers remain Zoho-parity Phase 1+ work.

---

## 2. Terminology map

| Zoho Recruit term | ECOD equivalent |
|---|---|
| Candidates | Candidates |
| Job Openings | Demands |
| Applications / Submissions | Considerations |
| Hiring Pipeline | Pipeline (Kanban) |
| Assessments / Interview Feedback | Assessments (recruiter-recorded evidence) |
| Notes & Timeline | Notes & follow-ups + History snapshots |
| Talent Pool | Talent Pools (6 fixed, dynamic membership) |
| Clients / Contacts / Departments | Client (text field on a demand only) |
| Zia (AI) | — (deterministic matching engine, no AI) |
| Blueprint (automation) | — (fixed 10-stage pipeline) |

---

## 3. Equivalence matrix

### A. Candidate management

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| A1 | Centralized candidate database with profiles, skills, assessments | Candidate repository with full profile, skills (alias-normalized), 360° drawer, verification freshness | ✅ |
| A2 | Custom fields (50–300 per module) | Fixed schema only | ❌ |
| A3 | Tags (50–1,000) | None | ❌ |
| A4 | Notes with @mentions and user notifications | Notes + follow-up dates; no @mentions | 🟡 |
| A5 | Document library: attachments, folder sharing, file versioning, reviews | Dated profile-change **snapshots** (values, not files); no file storage | 🟡 |
| A6 | Duplication checker **and** merge/de-duplicate tooling | Duplicate *detection* (email/phone, case-insensitive, import + form); no merge tool, no bulk dedupe | 🟡 |
| A7 | Data import with field mapping & migration batches | CSV import: mapping, preview, per-row validation, duplicate skip, error report, 5k rows/file | ✅ |
| A8 | Export module data | Candidate CSV export (formula-injection safe) | ✅ |
| A9 | Mass update / bulk action buttons in list views | Multi-select with bulk readiness update and bulk export | ✅ |
| A10 | Candidate ratings / AI scoring | Assessment scores feed matching; readiness status is recruiter-controlled (no per-candidate star rating) | 🟡 |
| A11 | Structured full employment histories | Profile snapshots only (explicit blueprint deferral) | ❌ |
| A12 | Saved custom views / custom searches | Fixed filters only (explicit blueprint deferral) | ❌ |

### B. Job openings (demands)

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| B1 | Job Openings module + requisition management | Demands: title, client, must-have skills, experience, notice, budget, location, mode, positions, priority, target date, weights, status | ✅ |
| B2 | Job requisition **approval** process | None | ❌ |
| B3 | Departments | Client name only; no department records | ❌ |
| B4 | Job posting to job boards (75–200+ boards, free + paid) | None | ❌ |
| B5 | Social posting (LinkedIn/Twitter/X) | None | ❌ |
| B6 | Jobs on Google Search / SEO career pages | None | ❌ |
| B7 | Source Boosters (Indeed/Monster/CareerBuilder direct sourcing) | None | ❌ |

### C. Clients & contacts (staffing-agency CRM)

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| C1 | Clients module (accounts, agreements, their openings) | Client is free text on a demand; no client records | 🟡 |
| C2 | Contacts module + candidate/client contact linking + portal invites | None | ❌ |
| C3 | Submissions module (submit candidate to client, track across stages) | Considerations track an *internal* pipeline; nothing is submitted to a client | 🟡 |
| C4 | Candidate Review Form (client approves/rejects submissions) | None | ❌ |
| C5 | Client portal (clients create openings, give feedback, decide interviews) | None | ❌ |
| C6 | Vendor portal (share job alerts; real-time vendor notifications) | None | ❌ |

### D. Sourcing & publishing

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| D1 | Branded, SEO-friendly, multilingual careers site | None | ❌ |
| D2 | Web forms for candidates/contacts (1–20) | None | ❌ |
| D3 | Candidate application form with consent & data controls | None (consent workflows are a blueprint deferral) | ❌ |
| D4 | Apply with LinkedIn / social recruiting | None | ❌ |
| D5 | Chrome extension resume extractor | None | ❌ |
| D6 | Employee referral module & referral tracking | None | ❌ |
| D7 | Zia Sourcing Bot (chatbot: matching jobs, portal registration, application tracking) | None | ❌ |

### E. Resume management & parsing *(biggest functional gap)*

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| E1 | Resume upload & storage on candidate records | None (blueprint defers CV storage) | ❌ |
| E2 | AI resume parsing (DaXtra/Zia; 250/day → unlimited by tier) | None | ❌ |
| E3 | Parser mapping + parsing review workflow | None | ❌ |
| E4 | Resume Inbox (email resumes auto-parsed into records) | None | ❌ |
| E5 | Bulk resume parsing / Outlook parsing | None | ❌ |
| E6 | Formatted / branded resume generation | None | ❌ |
| E7 | Search inside candidate attachments | Search covers profile fields + summary only | ❌ |
| E8 | **Job description parsing (Zia JD parser)** | `extractJD()`: keyword/regex extraction of skills (with alias dictionary), experience, notice — reviewed before saving, explicitly *not* AI | 🟡 ⚙️ |

### F. Screening, assessments & interviews

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| F1 | Pre-screening assessments (question banks, forms) | None | ❌ |
| F2 | Assessment records on candidates | Append-only assessments: score 0–100, evidence, gap notes, demand-scoped, 180-day scoring validity, assessor + date | ✅ |
| F3 | Interviews module (schedule interviews, assign interviewers, checklists) | No interviews module; only note follow-up dates | ❌ |
| F4 | Automated interview notifications (candidate + interviewer, resume attached; reschedule/cancel alerts) | None | ❌ |
| F5 | Interviewer availability publishing & candidate self-booking | None | ❌ |
| F6 | Calendar: tasks, events, call logs | Notes with follow-up dates only; no tasks/events/call logs | 🟡 |
| F7 | Google Calendar / Outlook calendar 2-way sync | None | ❌ |
| F8 | Video interviews (one-way & live; Google Meet/Teams) | None | ❌ |
| F9 | Interview feedback forms (numerical ratings, thresholds, fair-evaluation masking) | Assessment form has score + evidence but is recruiter-facing, not interviewer-facing, not configurable | 🟡 |
| F10 | Background screening (built-in/integrated) | None (flagged "Unavailable" status only) | ❌ |

### G. Offers & onboarding

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| G1 | Offer management (creation, tracking, accept/reject status) | Pipeline has an "Offer" stage only; no offer records | 🟡 |
| G2 | Electronic signatures (offer letters/agreements) | None | ❌ |
| G3 | Onboarding handoff (Zoho People/Workerly integration) | None | ❌ |

### H. Candidate experience & portals

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| H1 | Candidate portal (apply, update profile, track status, saved jobs) | None | ❌ |
| H2 | Candidate login / registration | None | ❌ |
| H3 | Application status transparency for candidates | None (internal only) | ❌ |
| H4 | Mass invite candidates to portal | None | ❌ |
| H5 | Cooling-off periods for rejected candidates | None | ❌ |

### I. Automation & process management

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| I1 | Workflow rules per module (5–50, condition-based) | None | ❌ |
| I2 | Workflow alerts (email/SMS on triggers) | None | ❌ |
| I3 | Workflow tasks, field updates, time-based actions | None | ❌ |
| I4 | **Blueprint** (flowchart process automation with decision stages) | Fixed 10-stage pipeline; any→any stage moves; disposition reason required only for Reject/Withdraw | 🟡 |
| I5 | Assignment rules (auto-assign recruiters to candidates) | Static `owner` field | ❌ |
| I6 | Auto-response rules | None | ❌ |
| I7 | Approval processes (jobs, offers) | None | ❌ |
| I8 | Webhooks + REST API (OAuth, daily API credits) | None (Supabase RLS is internal persistence, not a product API) | ❌ |
| I9 | Macros | None | ❌ |

### J. Product customization & platform

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| J1 | Custom fields per module | None | ❌ |
| J2 | Custom views (saved filters) per module | Saved views on the People module (persisted per workspace); other modules keep fixed tabs | 🟡 |
| J3 | Custom modules, tab groups, web tabs, rename tabs | None; navigation is fixed | ❌ |
| J4 | Custom links, buttons, functions | None | ❌ |
| J5 | Drag-and-drop layout editor | None | ❌ |
| J6 | Logo/branding customization | Hard-coded AnthroPrime branding; no admin setting | 🟡 |
| J7 | Mobile app | Responsive mobile web UI only; no native app | 🟡 |
| J8 | Multiple currencies | INR LPA only (by design for this release) | ❌ |
| J9 | Multi-language (27 languages) | English only | ❌ |
| J10 | Org hierarchy, groups, territories, data-sharing rules | Single workspace; 3 fixed roles | 🟡 |

### K. Analytics & reporting

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| K1 | Standard reports & dashboards | Dashboard stats + fixed Analytics page (inventory, sources, pipeline distribution, freshness) | 🟡 |
| K2 | Custom reports/dashboards, scheduled reports | None | ❌ |
| K3 | Forecasts / revenue analytics | None | ❌ |
| K4 | Funnel/source-effectiveness reporting | Source distribution + current-stage distribution — deliberately *not* fabricated conversion rates | ⚙️ |

### L. Communication & integrations

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| L1 | Email templates (5–unlimited) | None | ❌ |
| L2 | Mass email with unsubscribe + daily send limits | None | ❌ |
| L3 | Two-way email sync (IMAP), BCC dropbox, Outlook plugin, Mail magnet | None | ❌ |
| L4 | SMS gateway, WhatsApp, PhoneBridge telephony (click-to-call, call logs) | None | ❌ |
| L5 | Email marketing/campaigns, autoresponders | None | ❌ |
| L6 | **Zia AI**: profile summaries, semantic candidate matching, AI scoring, AI email/JD writing, hidden-talent discovery | **Matching is deterministic, weighted, explainable, with hard-constraint blockers — different by design.** No AI summaries/writing/semantic search (blueprint defers) | ⚙️ |
| L7 | Marketplace (200+ apps), Zapier, Zoho CRM 2-way sync, Zoho People/Analytics/Sign | None | ❌ |
| L8 | Document library sharing/versioning/reviews | None | ❌ |

### M. Security, compliance & administration

| # | Zoho Recruit capability | ECOD today | Status |
|---|---|---|---|
| M1 | Role-based permissions (profiles, roles, up to 25 profiles) | 3 fixed roles (admin/recruiter/viewer) enforced by PostgreSQL RLS; DB-verified by tests | ✅ |
| M2 | Field-level security, attachment permissions, data-sharing rules | None (blueprint defers granular commercial permissions) | ❌ |
| M3 | Audit logs | **Write** audit: append-only history with before-update snapshots, server-triggered, DB-verified immutable. **Read/export audit: none** (blueprint defers) | 🟡 |
| M4 | GDPR/consent management, retention workflows, data-subject requests | Consent ledger with revoke + data-subject JSON export; retention policy with audited anonymization; consent RLS tested in PGlite (migration 005) | ✅ |
| M5 | SSO/MFA administration | None in app (Supabase Auth could provide; blueprint defers administration) | ❌ |
| M6 | Data backup/restore (monthly backups, verified restore) | None (blueprint defers) | ❌ |
| M7 | De-duplicate data tooling | Import-time + form-time detection; no bulk merge | 🟡 |
| M8 | Multi-tenant isolation | Workspace membership + RLS + composite FKs blocking cross-workspace links — verified by PGlite integration test | ✅ |

### N. Blueprint cross-check — `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` v1.0 (18 Sep 2026)

Reconciled against the authoritative document fetched from `origin/main` (commit `910ece0`). Every numbered requirement below maps to a blueprint section.

#### N.1 — Blueprint §3: the ECOD lifecycle

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N1 | Stage 1 Demand: client, role, quantity, must/nice-to-have skills, experience, budget, location, engagement type, notice, target date | Demand has client/role/positions/skills/experience/budget/location/mode/notice/target; **no nice-to-have skills, no engagement type, no per-skill minimums** | 🟡 |
| N2 | Stage 2 Discover: internal search first, Boolean filters + semantic search | Multi-term Boolean-style search (incl. CV text) + exact filters + concept expansion (skill → domain vocabulary, e.g. Databricks matches lakehouse); true vector/semantic search remains Phase 1.5 by blueprint | 🟡 |
| N3 | Stage 3 Assess: technical/communication/role-specific assessments with assessor, date, evidence | Append-only assessments with title, score 0–100, assessor, evidence, date, demand scoping, 180-day expiry | ✅ |
| N4 | Stage 4 Gap Map: gaps classified critical / trainable / contextual | Gap map shipped: demand-vs-candidate matrix with critical (absent) / trainable (below required proficiency) / contextual (stale or unvalidated evidence) classification, derived status (Open / Enrichment planned / Closed via recent assessments), shown per match with one-click enrichment planning | ✅ |
| N5 | Stage 5 Enrich: training, labs, mentoring, certification, project exercises | Enrichment plans now carry an optional demand link and the skill gap they close; gap rows offer one-click "Plan enrichment" | ✅ |
| N6 | Stage 6 Validate: reassess after enrichment, evidence expiry/freshness → readiness | 180-day assessment expiry + profile freshness; readiness deliberately recruiter-confirmed | ✅ |
| N7 | Stage 7 Deliver: submit to client, interviews, feedback, offer, deployment, commercial outcome | Internal pipeline runs to Deployed; **no client submission, interviews, offers or commercial outcome** | 🟡 |
| N8 | Stage 8 Re-engage: retain relationship, refresh facts, rediscover | "Rediscover & reconnect" stale pool + freshness badges; no re-engagement workflow/nurture | 🟡 |

#### N.2 — Blueprint §4.1: Candidate 360 data domains

| # | Blueprint domain | ECOD today | Status |
|---|---|---|---|
| N9 | Identity: ID, name, email(s), phone(s), LinkedIn, city, timezone, source, owner | Name, single email/phone, LinkedIn, location, source, owner; no timezone, no multiple emails/phones | 🟡 |
| N10 | Employment: current employer/title **plus complete dated employment history** | Structured EmploymentHistory table (auto-captured on employer/title edits + manual entry) rendered on the Employment tab | ✅ |
| N11 | Compensation: current CTC/rate, currency, fixed/variable, expected, last verified | Current + expected CTC + verified date; no currency choice, no fixed/variable split, no rate basis | 🟡 |
| N12 | Experience: total years, relevant years **by skill/domain**, industries, project exposure | Total + relevant years; no per-skill/domain split, industries or project exposure | 🟡 |
| N13 | Skills: canonical skill, proficiency, years, last-used, evidence source, confidence, validation | Per-skill proficiency (Exposure–Expert), evidence source, years, last-used month, confidence and validated flag — editable on the profile | ✅ |
| N14 | Availability: notice, earliest start, active/passive, remote/hybrid/onsite, preferred locations/timezone | Notice, work mode, earliest start and Active/Passive status present; preferred locations/timezones still missing | 🟡 |
| N15 | Engagement preference: permanent, subcontract, contract, C2H, minimum acceptable rate | Engagement preference (Permanent/Contract/C2H/Subcontract) on candidate + form + CSV import | ✅ |
| N16 | Assessments: type, score/level, questions/areas, assessor, evidence, date, validity | Title, score, assessor, evidence, date, 180-day validity; no assessment types/templates or question areas | 🟡 |
| N17 | ECOD: stage, gap map, enrichment plan, readiness, last validation, next action | Stage, enrichment and gap map now visible per demand match; profile-level "next action" field still missing | 🟡 |
| N18 | Applications: every demand, submission, outcome, **client feedback**, reason codes | Considerations with stage + structured disposition reasons; no client feedback | 🟡 |
| N19 | Interactions: calls, email notes, WhatsApp/manual notes, consent events, next follow-up | Notes with channel (Note/Call/Email/WhatsApp) + follow-up dates; consent events recorded per purpose with notice version; per-candidate next action | ✅ |
| N20 | Documents: CV versions, certifications, assessment files, version + upload metadata | Documents: PDF/DOCX/TXT/MD/CSV uploads with allowlist, size cap, randomized storage paths, SHA-256 hash, version field, parser status and soft-removal; originals in private cloud storage or inline in demo mode | ✅ |
| N21 | Data governance: source, notice/consent/legal-basis metadata, retention review, access restrictions | Consent ledger (purpose, status, notice version, source, note); candidate source + owner; retention review with audited anonymization; role-based access incl. viewer export block and admin-only commercials | ✅ |

#### N.3 — Blueprint §4.2: Demand / role object

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N22 | Client + business unit, role title, demand owner, positions, priority, target joining date | Client, title, positions, priority, target date; no business unit or demand-owner field | 🟡 |
| N23 | Must-have **vs nice-to-have** skills, each with minimum proficiency, minimum relevant experience, recency requirement | Nice-to-have skill tier shipped; per-skill minimums stored (skillMinimums map) with a demand-level default minimum proficiency; per-skill editor UI and recency rules still pending | 🟡 |
| N24 | Experience band, location/timezone, work mode, language, certification, industry/domain, security/eligibility constraints | Engagement-type constraint and demand-level minimum proficiency added; language/certification/industry/security-eligibility constraints still missing | 🟡 |
| N25 | Commercials: bill rate/budget, currency, engagement type, internal target cost, **margin visibility restricted by role** | Internal cost and margin stored in a dedicated table whose select/insert/update all require the admin role (DB-verified in PGlite); admins edit per demand with a live margin readout against the client budget | ✅ |
| N26 | **Pipeline stages configurable per demand** (incl. interested, ready stages) | Each demand picks its pipeline stages at creation/edit (unticked = all ten); kanban renders only the chosen set; display labels configurable workspace-wide from the admin console | ✅ |

#### N.4 — Blueprint §5: search & matching layers

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N27 | Exact deterministic filters (location, years, employer, CTC, notice, engagement, certification, status) | Location/experience/notice/status/freshness/skill filters + search; no employer/engagement/certification filters | 🟡 |
| N28 | Skill taxonomy: canonical names, aliases, domain relationships | Canonical list + alias dictionary in code; no parent/domain graph | 🟡 |
| N29 | Full-text search incl. **CV text**, role summaries, assessment notes | Repository search covers profile fields, summary and the extracted text of every attached CV document | ✅ |
| N30 | Semantic search ("senior Databricks architect who has built Genie spaces") | Not built — blueprint itself schedules this for Phase 1.5, not MVP | ❌ |
| N31 | Weighted requirement-to-profile match **with evidence per criterion** | 6 weighted components, each with human-readable detail line; weights configurable per demand | ✅ |
| N32 | Transparent component breakdown, **hard constraints visibly separated** from soft fit | Blockers (hard failures) and unknowns (unverified) are separate from the score — exactly the blueprint's design | ✅ |
| N33 | No opaque AI score to start; "AI explanation" of match | Deterministic explanation shipped; AI-generated narrative correctly deferred (Phase 1.5) | ✅ |
| N34 | Predictive ranking (selection/acceptance probability) | Correctly absent — blueprint says "not initially" | ✅ |

#### N.5 — Blueprint §6: skills intelligence model

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N35 | Canonical Skill table + aliases (DB-backed, admin-managed) | Canonical skill vocabulary with aliases — base vocabulary plus a DB-backed workspace taxonomy table (RLS-guarded) administered from Settings; matching, JD parsing and CV parsing use it live | ✅ |
| N36 | Parent/domain relationships (Databricks → AI/BI) | Not present | ❌ |
| N37 | Candidate proficiency scale (Exposure → Expert) per skill | Five-level proficiency scale per candidate skill with matching gate | ✅ |
| N38 | Evidence source per candidate-skill (CV, recruiter, assessment, certification, project) | Evidence source per candidate skill (CV, recruiter, assessment, certification, client interview, project) | ✅ |
| N39 | Relevant years + last-used per skill | Years + last-used month editable per skill | ✅ |
| N40 | Confidence + human-validation flag | Confidence value + human-validation flag per skill | ✅ |

#### N.6 — Blueprint §7: append, don't overwrite

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N41 | EmploymentHistory entity (company, title, dates, type, verified) | EmploymentHistory entity: auto-captured on employer/title change, manual roles, dated records in DB and UI | ✅ |
| N42 | CompensationHistory entity | CompensationHistory entity shipped (kind/amount/source/verified); currency fixed to INR and no fixed/variable split yet | 🟡 |
| N43 | AvailabilityHistory entity | AvailabilityHistory entity shipped (notice/earliest start/Active-Passive/mode/captured); preference history not modeled | 🟡 |
| N44 | SkillEvidence versioning (never silently replace an assessment) | Assessments are append-only ✅, but per-skill evidence doesn't exist | 🟡 |
| N45 | ProfileChangeLog: who changed what, when | Append-only history with before-snapshots and actor, DB-enforced immutability (PGlite-tested) | ✅ |

#### N.7 — Blueprint §8: key screens

| # | Blueprint screen | ECOD today | Status |
|---|---|---|---|
| N46 | Dashboard: open demands, ready talent, stale profiles, follow-ups, assessments due, conversion funnel | All present except conversion funnel (stage distribution shown instead, deliberately) | 🟡 |
| N47 | People: saved views, filters, bulk actions, column chooser, export permission | Named saved views (search+filters+sort, persisted per workspace), column chooser with per-browser persistence, bulk readiness update, viewer role blocked from export | ✅ |
| N48 | Candidate 360 tabs: Overview, Skills, Employment, ECOD, Applications, Interactions, Documents, History | 7 of 8 blueprint tabs (Overview, Skills, Employment, Documents, Applications, Notes, History); ECOD tab still pending | 🟡 |
| N49 | Demand: requirements left, pipeline/shortlist, match reasons, bulk outreach/assignment | Requirements + ranked matches + explanations + shortlist; no bulk outreach/assignment | 🟡 |
| N50 | Talent pools: dynamic + static groups (silver medalists, 30-day joiners…) | 6 dynamic pools incl. "Ready in 30 days"; no static/custom pools (blueprint defers saved pools) | 🟡 |
| N51 | Assessment screen: templates, assessor workflow, structured rubric, validity | Records + validity only; no templates or rubrics | 🟡 |
| N52 | Gap & Enrichment: demand-vs-candidate matrix, learning actions, reassessment | Enrichment list exists; gap matrix missing | 🟡 |
| N53 | Import: CSV/XLSX + CV bulk upload, mapping, preview, duplicate resolution, error report | CSV (paste/file), mapping, preview, error report; dupes skipped only (no resolution), no XLSX/CV | 🟡 |
| N54 | Admin: users/roles, skill taxonomy, pipeline stages, assessment templates, retention, integrations, audit log | Admin console in Workspace settings: skill taxonomy editor, pipeline stage labels, retention policy with anonymization workflow and full audit log. User/role administration intentionally remains in the trusted SQL console (matches the blueprint security model) | ✅ |
| N55 | Analytics: demand funnel, source quality, readiness inventory, time-to-ready/submit, conversion, talent aging | Inventory/sources/freshness/stage distribution; no time-to-ready or conversion metrics | 🟡 |

#### N.8 — Blueprint §10: deduplication & data quality

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N56 | Hard duplicate checks: normalized email, phone, LinkedIn URL | Hard checks on normalized email, phone and LinkedIn URL (case/trailing-slash insensitive) at import and edit time | ✅ |
| N57 | Probable duplicates (name + employer + location, fuzzy) | Probable duplicate pairs: same email, phone, LinkedIn, or name plus employer / name plus location, with merged rows excluded | ✅ |
| N58 | Never auto-merge; merge review screen with field comparison | Merge review screen: field-by-field keep decision (A/B radios with live result preview), skills evidence combined to the stronger record, loser flagged merged and hidden — never auto-merged or deleted | ✅ |
| N59 | Source + last-verified dates; freshness badges | Implemented (Fresh/Aging/Stale) | ✅ |
| N60 | Structured disposition/rejection reason codes | Implemented, DB-enforced for Rejected/Withdrawn | ✅ |
| N61 | Data-quality queues (missing phone/email, unparsed CV, stale comp/availability) | Five data-quality queues (missing email/phone, unvalidated skills, stale compensation, stale availability) with drill-through filters | ✅ |

#### N.9 — Blueprint §11: AI layer (bounded, auditable)

| # | Blueprint capability | ECOD today | Status |
|---|---|---|---|
| N62 | CV parsing into reviewable draft, preserve original | Heuristic CV parsing into a reviewable draft (identity, contact, LinkedIn, title, years, alias-normalized skills with CV evidence); original file always preserved. Provider-based parsing remains a future upgrade | ✅ |
| N63 | Skill normalization with stored confidence + correction | Deterministic alias normalization; no confidence/correction flow | 🟡 |
| N64 | Semantic retrieval (embeddings + SQL filters) | Not built (blueprint: Phase 1.5) | ❌ |
| N65 | JD parsing → proposed requirements, recruiter confirms | Implemented: keyword extraction with explicit review-before-save notice | ✅ |
| N66 | Match explanation: evidence-linked reasons | Implemented per component with blockers/unknowns | ✅ |
| N67 | Gap/enrichment suggestion (human approves) | Gap map proposes the missing skill and severity; recruiter approves by creating the pre-filled enrichment plan — humans stay in the loop | ✅ |
| N68 | Duplicate suggestion (no autonomous merge) | Not present | ❌ |
| N69 | Humans remain responsible for selection; no auto-rejection | Enforced by design — scores never reject | ✅ |

#### N.10 — Blueprint §12: security, privacy, governance

| # | Blueprint control | ECOD today | Status |
|---|---|---|---|
| N70 | SSO-ready authn, MFA for privileged users, secure sessions | Supabase password auth; no SSO/MFA administration | 🟡 |
| N71 | RBAC: Admin, Recruiter, Assessor, Sales/Account, Read-only; comp restricted separately | 3 roles (admin/recruiter/viewer) via RLS; no assessor/sales roles, no comp field restriction | 🟡 |
| N72 | Tenant/client boundaries | Workspace RLS + composite FKs blocking cross-workspace links — integration-tested | ✅ |
| N73 | TLS in transit, encryption at rest, secrets managed | Inherited from Supabase/Netlify; no secrets in client (README warns against `VITE_` service keys) | ✅ |
| N74 | Audit: profile **views**, exports, downloads, edits, merges, deletes, role changes | Profile views, CSV exports and edits now audited with actor + timestamp; merges, deletes and role changes not yet audited | 🟡 |
| N75 | Permission-controlled, watermarked/logged, rate-limited exports | Exports permission-controlled (viewer blocked) and every export is audited with actor+timestamp; no watermarking or rate limiting yet | 🟡 |
| N76 | CV upload allowlist, type validation, size limits, randomized names, malware scan, storage outside webroot | Allowlist extensions, actual-content text extraction, 5 MB cap, randomized names, SHA-256 hashes, private bucket in cloud mode; malware scanning still absent | 🟡 |
| N77 | Configurable retention review + deletion/anonymisation workflow | Configurable retention review window; anonymization erases identity/contact while keeping aggregate value; every anonymization is audited | ✅ |
| N78 | Data-subject workflow (search/export/correct/delete, fulfillment record) | Per-candidate JSON data-subject export, correction via Edit, erasure via audited admin anonymization; consent ledger records the fulfillment trail | ✅ |
| N79 | Encrypted backups, tested restore, RPO/RTO | Not present (blueprint defers to ops) | ❌ |
| N80 | No CV/comp/PII in application logs | No server-side logging layer; demo is client-only | ✅ |

#### N.11 — Blueprint §13–14: architecture & API principles

| # | Blueprint requirement | ECOD today | Status |
|---|---|---|---|
| N81 | Backend service (TypeScript/NestJS or Python/FastAPI) | Deliberate deviation: SPA + Supabase PostgREST with RLS acting as the authorization layer — viable for R1, revisit when parsing/jobs arrive | ⚙️ |
| N82 | PostgreSQL, normalized tables, JSONB only for flexible metadata | Supabase PostgreSQL; normalized core + JSONB weights | ✅ |
| N83 | PostgreSQL full-text (+ pgvector later) before external search engines | Filtering/ranking done in browser memory; no PG full-text indexes | 🟡 |
| N84 | Private S-compatible object storage, signed short-lived URLs | No object storage use | ❌ |
| N85 | Async job queue (parsing, bulk imports, embeddings, scans, notifications) | None (synchronous client flows) | ❌ |
| N86 | AI provider abstraction; prompt/model version stored with output | No AI layer yet | ❌ |
| N87 | API-first REST: stable IDs, pagination, `updated_since` sync | Stable UUIDs; hosted `api_changes_since(day)` security-definer RPC (migration 005) returning every workspace table since a date, cross-tenant-safe and integration-tested; day granularity, pagination deferred | ✅ |
| N88 | Webhooks/event bus (profile.updated, stage_changed, assessment.completed…) | None | ❌ |
| N89 | Idempotent bulk imports, `external_mapping_id` for integrations | Upsert-by-id is idempotent ✅; no external-mapping fields | 🟡 |
| N90 | Soft delete + retention; destructive actions permissioned & audited | No deletes permitted at DB level (append/update only); no soft-delete flag or workflow | 🟡 |

#### N.12 — Blueprint §16: MVP acceptance scenarios

| # | Blueprint scenario | ECOD today | Status |
|---|---|---|---|
| N91 | Upload 200 CVs + spreadsheet; profiles created/updated, dupes flagged, error report | 200 CVs + spreadsheet: multi-CV upload parses drafts, flags hard duplicates and extraction gaps per file, and the CSV path keeps mapping, preview and the error report — recruiter reviews before anything imports | ✅ |
| N92 | Search Databricks + 7–10 yrs + India + ≤30-day notice + permanent + CTC range, configurable columns | Search/filters cover all except engagement type; columns are fixed | 🟡 |
| N93 | Demand created from JD; structured, recruiter-approved requirements | Implemented with review-before-save extraction | ✅ |
| N94 | Matches show exactly why each person matches or fails a hard constraint | Implemented (6-component breakdown + blockers) | ✅ |
| N95 | Previously rejected candidate rediscovered with historical feedback visible | History tab shows snapshots + assessments persist; no per-demand interview feedback exists | 🟡 |
| N96 | Employer/CTC change keeps old values; current shows newest verified | Implemented via history snapshots | ✅ |
| N97 | Gap → enrichment → reassessment changes readiness without deleting the original assessment | Assessments append-only ✅; readiness is manual (not derived), gap entity missing | 🟡 |
| N98 | Admin can determine who viewed/exported/edited sensitive info | Edit history with actor exists; views/exports are unlogged | ❌ |

#### N.13 — Blueprint §17: analytics that matter

| # | Blueprint metric | ECOD today | Status |
|---|---|---|---|
| N99 | Repository size vs usable profiles | Total counts + freshness/status splits as proxy; no "usable" definition | 🟡 |
| N100 | Freshness distribution | Implemented (Fresh/Aging/Stale with health bar) | ✅ |
| N101 | Demand coverage: ready / near-ready / missing per active demand | 70%+ match counts per demand; not split by readiness/missing | 🟡 |
| N102 | Time to shortlist | Average time-to-shortlist measured from demand creation to consideration creation | ✅ |
| N103 | Time to ready (core ECOD measure) | Time to ready: profile creation to latest assessment for Ready candidates, shown in Analytics | ✅ |
| N104 | Source → ready/placement conversion | Source to ready conversion: Ready share per sourcing channel | ✅ |
| N105 | Assessment → enrichment → readiness conversion | Not measured | ❌ |
| N106 | Rediscovery rate | Rediscovery rate: share of considered candidates appearing in 2+ demands | ✅ |
| N107 | Submission → interview → offer → deployment funnel | Current-stage distribution only | 🟡 |
| N108 | Skill inventory & gap heatmap | Skill inventory implemented; gap heatmap missing | 🟡 |

#### N.14 — Blueprint §15 R1/MVP scope checklist & §18 "what not to build"

| # | Blueprint R1 item | ECOD today | Status |
|---|---|---|---|
| N109 | Auth/RBAC | Supabase auth + 3-role RLS | ✅ |
| N110 | People | Talent repository | ✅ |
| N111 | Candidate 360 | Present with 5 of 8 blueprint tabs | 🟡 |
| N112 | Employment/compensation history | Snapshots only, no structured history entities | ❌ |
| N113 | Skills taxonomy | Alias dictionary only, no proficiency/evidence model | ❌ |
| N114 | Demands | Implemented | ✅ |
| N115 | Considerations / pipeline | Implemented with unique candidate+demand constraint | ✅ |
| N116 | CV / documents | Missing | ❌ |
| N117 | CSV import | Implemented with mapping/preview/error report | ✅ |
| N118 | Exact / full-text search | Exact filters + multi-term search over profile text | 🟡 |
| N119 | Notes / interactions | Notes + follow-ups; no channels/consent | 🟡 |
| N120 | Audit basics | Write-audit with actor + snapshots; no read/export audit | 🟡 |
| N121 | §18: no payroll/HRMS, no microservices, no black-box AI, no auto-rejection | All respected | ✅ |
| N122 | §18: no free-form skill tags without governance | Canonical list enforced; proficiency governance absent | 🟡 |
| N123 | §18: no single mutable current-field without history | Current fields + snapshots; structured history entities absent | 🟡 |

---

## 4. Scoreboard

 by Zoho module area

| Area | ✅ | 🟡 | ⚙️ | ❌ | Coverage |
|---|---|---|---|---|---|
| A. Candidate management | 4 | 4 | 0 | 4 | 50% |
| B. Job openings | 1 | 0 | 0 | 6 | 14% |
| C. Clients & contacts | 0 | 2 | 0 | 4 | 17% |
| D. Sourcing & publishing | 0 | 0 | 0 | 7 | 0% |
| E. Resumes & parsing | 0 | 1 | 0 | 7 | 6% |
| F. Screening & interviews | 1 | 2 | 0 | 7 | 20% |
| G. Offers & onboarding | 0 | 1 | 0 | 2 | 17% |
| H. Candidate portals | 0 | 0 | 0 | 5 | 0% |
| I. Automation | 0 | 1 | 0 | 8 | 6% |
| J. Customization & platform | 0 | 4 | 0 | 6 | 20% |
| K. Analytics | 0 | 1 | 1 | 2 | 25% |
| L. Communication & integrations | 0 | 0 | 1 | 7 | 6% |
| M. Security & admin | 3 | 2 | 0 | 3 | 50% |
| **Overall (Zoho, A–M)** | **9** | **18** | **2** | **68** | **20%** |

*(Coverage = weighted presence: ✅=1, 🟡/⚙️=0.5, ❌=0.)*

### Blueprint verdict by section

| Blueprint section | ✅ | 🟡 | ⚙️ | ❌ | Coverage |
|---|---|---|---|---|---|
| N.1 §3 ECOD lifecycle | 4 | 4 | 0 | 0 | 75% |
| N.2 §4.1 Candidate 360 domains | 6 | 6 | 0 | 1 | 69% |
| N.3 §4.2 Demand object | 2 | 3 | 0 | 0 | 70% |
| N.4 §5 Search & matching | 5 | 2 | 0 | 1 | 75% |
| N.5 §6 Skills intelligence | 5 | 0 | 0 | 1 | 83% |
| N.6 §7 Append-only history | 2 | 3 | 0 | 0 | 70% |
| N.7 §8 Key screens | 2 | 8 | 0 | 0 | 60% |
| N.8 §10 Dedup & data quality | 6 | 0 | 0 | 0 | 100% |
| N.9 §11 AI layer | 5 | 1 | 0 | 2 | 69% |
| N.10 §12 Security & governance | 5 | 5 | 0 | 1 | 68% |
| N.11 §13–14 Architecture & API | 2 | 3 | 1 | 4 | 40% |
| N.12 §16 MVP acceptance scenarios | 4 | 3 | 0 | 1 | 69% |
| N.13 §17 Analytics | 5 | 4 | 0 | 1 | 70% |
| N.14 §15 R1 scope + §18 not-to-build | 6 | 6 | 0 | 3 | 60% |
| **Blueprint total** | **59** | **49** | **1** | **14** | **68%** |

**Strongest blueprint areas:** dedup & data quality (100%), skills intelligence (83%), lifecycle and matching (75% each), analytics and history (70% each).
**Weakest blueprint areas:** architecture/API (40% — vector/semantic search (blueprint's own Phase 1.5), REST layer with pagination, object-storage malware scanning) and the remaining partials: demand owner/business-unit fields, watermarking, merge/role-change audit events.

**Where ECOD is genuinely at or above parity for its size:** candidate repository quality (alias-normalized skills, freshness discipline, dedup), import validation rigor, matching explainability (component scores + blockers + unknowns — Zoho shows a match score but ECOD's evidence model is more transparent), DB-level tenant isolation and audit integrity (verified by an actual-Postgres test), and honest analytics.

---

## 5. Recommended roadmap to close the gaps

Effort is relative (S ≤ a few days, M ~1–2 weeks, L = multi-week) for one developer on this codebase.

**Phase 0 — Complete the Blueprint's own R1 scope** *(highest priority: the blueprint's exit condition is "run a real client demand end-to-end", which requires these)*

> **Batch 1 shipped (27 Sep 2026):** structured Employment/Compensation/Availability histories with auto-capture and profile UI · per-skill proficiency, evidence, years, last-used, confidence and validation with a matching proficiency gate · engagement preference + registry status + earliest start · demand nice-to-have skills, engagement type and minimum proficiency · LinkedIn duplicate checks · data-quality queues with drill-through filters · view/export audit trail · average time-to-shortlist metric · migration `002_blueprint_r1.sql` + 10 new tests (27 total, all passing). Batch 2 shipped (27 Sep 2026): CV/document upload with allowlists, hashes and reviewable heuristic parsing (demo inline, cloud private bucket) · bulk CV import with per-file duplicate/extraction flags · demand-vs-candidate gap map (critical/trainable/contextual, derived status) with one-click enrichment planning · gap heatmap in Analytics · merge-duplicate review with field-by-field keep decisions · workspace skill-taxonomy administration · incremental change export. Batch 3 shipped (27 Sep 2026): admin console (pipeline stage labels, retention policy with audited anonymization workflow, audit log) · repository search across extracted CV text · demand commercials (internal cost/margin) in an admin-role-only table verified in PGlite · conversion analytics (time to ready, source→ready, rediscovery rate) · migration 004 + 9 new tests (46 total). Batch 4 shipped (27 Sep 2026): named saved views (search+filters+sort persisted per workspace) with column chooser and bulk readiness update · consent ledger (purpose/status/notice version/source) with revoke, per-candidate data-subject JSON export and audited-anonymization erasure path · per-demand pipeline stage sets + per-skill minimum proficiency · concept-expansion search (skill → domain vocabulary, e.g. Databricks ↔ lakehouse) · demand-coverage, uplift-conversion and client-funnel analytics + usable-profiles stat · hosted `api_changes_since(day)` RPC (migration 005) with PGlite RLS/RPC tests — 14 new tests, 60 total, blueprint coverage 68%. Remaining Phase-1 items: semantic/vector search (blueprint Phase 1.5), email/calendar sync, e-sign offers, interviews module, public careers portal.

| Item | Blueprint § | Effort |
|---|---|---|
| Structured EmploymentHistory / CompensationHistory / AvailabilityHistory tables + UI on the Candidate 360 | §7 | M |
| Skills taxonomy: Skill table (canonical, aliases, domain) + PersonSkill with proficiency, years, last-used, evidence, confidence + admin editor | §6 | L |
| Document upload (Supabase Storage, private bucket, randomized names, size/type allowlist) + Documents tab with versions | §12, §4.1 | M |
| CV upload + heuristic parse → reviewable draft profile (no AI dependency; provider abstraction later) | §11 | L |
| Gap entity (person × demand × requirement, severity critical/trainable/contextual) + gap-linked enrichment + reassessment → readiness | §3, §8 | M |
| Demand enrichment: nice-to-have skills, per-skill minimums, engagement type, earliest-start/active-passive availability fields | §4.1–4.2 | M |
| Engagement preference field on candidates (permanent/contract/C2H + minimum rate) | §4.1 | S |
| LinkedIn duplicate check + merge-review screen (field-by-field, never auto-merge) | §10 | M |
| Data-quality queues (missing phone/email, stale comp, unverified skills) | §10 | M |
| Admin console: users/roles, skill taxonomy, pipeline stage labels, retention settings | §8 | M |
| Blueprint analytics: time-to-shortlist, time-to-ready, rediscovery (from existing timestamped tables) | §17 | M |
| View/export audit events (log profile views + CSV exports with actor) | §12 | S |
| ~~`updated_since`-style API endpoint~~ **Shipped (batch 4):** `api_changes_since(day)` RPC, migration 005 | §14 | S (REST wrapper + pagination remain) |

**Phase 1 — Core ATS parity with Zoho (no new infrastructure)**
| Item | Zoho module | Effort |
|---|---|---|
| Interviews module: schedule (candidate × demand × datetime × interviewers), status, outcome | F3, F4 | M |
| Interview feedback forms (configurable rating, structured fields) | F9 | M |
| Tasks/Events/Call-log activity module linked to candidates/demands | F6 | M |
| Offers module (offer records, terms, accept/reject) → G1 | M | M |
| Tags on candidates/demands + tag filters | A3 | S |
| Saved searches / custom views (persist per user) | A12, J2 | M |
| Merge-duplicate tool + bulk field update | A6, A9 | M |
| Email templates + client-side compose (mailto/print) as precursor to server email | L1 | S |
| Custom fields (JSONB `custom` per table + admin editor) | J1 | M |

**Phase 2 — Resumes & documents**
| Item | Zoho module | Effort |
|---|---|---|
| File uploads to Supabase Storage, attachments on candidates | E1, A5 | M |
| Resume text extraction (PDF/DOCX client-side parsing) + heuristic field mapping + **parsing review** screen | E2, E3 | L |
| Search inside attachments (Postgres full-text on extracted text) | E7 | M |
| Resume inbox (inbound email provider webhook → parse → candidate) | E4 | L |

**Phase 3 — Portals & client collaboration**
| Item | Zoho module | Effort |
|---|---|---|
| Public careers site (list open demands, application form w/ consent) | D1, D3 | M |
| Candidate portal (Supabase auth: apply, track status, update profile) | H1–H3 | L |
| Client & contact records; submit-to-client; candidate review form | C1–C4 | L |
| Client portal (client users see their submissions, give feedback) | C5 | L |
| Employee referral capture | D6 | S |

**Phase 4 — Automation & intelligence**
| Item | Zoho module | Effort |
|---|---|---|
| Workflow rules engine (trigger → condition → action: field update, task, alert) | I1–I3 | L |
| Assignment rules + approval processes (job/offer approvals) | I5, I7 | M |
| Configurable pipeline stages & stage-transition rules (ECOD's "blueprint") | I4 | M |
| Webhooks + REST API (token-authed, rate-limited) | I8 | M |
| Outbound email/SMS via provider (Resend/SMTP/Twilio); calendar sync | L2–L4, F7 | L |
| Semantic matching & AI JD parsing as **opt-in** provider features (keeping the deterministic engine as the explainable default) | L6, E8 | L |

**Phase 5 — Enterprise & compliance**
| Item | Zoho module | Effort |
|---|---|---|
| Field-level security & granular commercial permissions | M2 | M |
| Read/export audit events | M3 | S |
| ~~Consent/retention/data-subject workflows~~ **Shipped (batches 3–4)** | M4 | S (watermarking/rate limits remain) |
| SSO/MFA administration, backups/restore verification | M5, M6 | M |
| Multi-currency, multi-language, custom report builder | J8–J9, K2 | L |

---

## 6. Sources

- **ECOD Talent Intelligence Repository — Product & Technical Blueprint v1.0 (18 Sep 2026)**: `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` on the repository's `main` branch (commit `910ece0`) — the authoritative source for section N.
- Zoho Recruit plan comparison (authoritative feature matrix): https://www.zoho.com/recruit/plan-comparison.html
- Zoho Recruit staffing features (client portal, video interview, automation): https://www.zoho.com/recruit/staffing-agency-software/features.html
- Zoho candidate management & resume inbox/parser: https://www.zoho.com/recruit/candidate-management.html
- Zoho help — Parser mapping (DaXtra resume parser / Zia JD parser): https://help.zoho.com/portal/en/kb/recruit/talent-sourcing/resume-parser
- Zoho help — Sourcing Bot: https://help.zoho.com/portal/en/kb/recruit/zia/chatbot/articles/sourcing-bot
- Zoho help — Google Calendar sync: https://help.zoho.com/portal/en/kb/recruit/integrations/g-suite/google-account-users/articles/synchronizing-zoho-recruit-with-google-calendar
- Independent 2026 reviews: research.com/software/reviews/zoho-recruit · ismartrecruit.com/tools/zohorecruit · selectsoftwarereviews.com/reviews/zoho-recruit · softwarefinder.com/hr/zoho-recruit
- Interloop Technologies — blueprint/approval/interview automation detail: https://www.interlooptechnologies.com/zoho-recruit/

*Blueprint cross-check pending: attach `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` to reconcile Section N against the authoritative document.*
