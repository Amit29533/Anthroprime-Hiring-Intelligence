# Feature Equivalence Verification — ECOD vs. Zoho Recruit & the ECOD Blueprint

Prepared 27 September 2026 · Code state: `492f9bb` (branch `arena/01a0e3a4-anthroprime-hiring-intelligenc`)

> **⚠️ About the blueprint file:** `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` is **not present in this repository** (never committed, not in the working tree). This analysis reconstructs the blueprint's scope from the two places the repo references it: the README's *"Not implemented"* list and `docs/PRODUCT_PLAN.md` (*"Subsequent releases"*). **Please attach the .docx to the chat** and this matrix will be reconciled against the authoritative document.

**Method:** Zoho Recruit's feature inventory was taken from Zoho's own plan-comparison page (full module/feature matrix), Zoho's staffing-agency feature pages, Zoho help documentation (resume parser, calendar sync, sourcing bot) and independent 2026 reviews. Each Zoho/blueprint capability was then checked against actual code in `src/`, `supabase/` and `tests/` — not against marketing claims.

**Status legend:**
✅ Equivalent exists · 🟡 Partial (some of the capability exists) · ❌ Missing · ⚙️ Different by design (deliberate non-AI/deterministic alternative)

---

## 1. Executive summary

108 Zoho Recruit capabilities were checked one-by-one against the code. Verdicts:

| Verdict | Count | Share |
|---|---|---|
| ✅ Equivalent exists | 7 | 6% |
| 🟡 Partial | 18 | 17% |
| ⚙️ Different by design | 2 | 2% |
| ❌ Missing | 81 | 75% |
| **Weighted coverage** | | **16%** |

**ECOD today ≈ a strong "repository-first matching core":** candidate repository, CSV import/export, demands, explainable weighted matching, pipeline, assessments, notes, pools, analytics, plus a hardened multi-tenant schema. That overlaps with roughly the **Free/Standard tier** of Zoho Recruit's core ATS, minus resumes, portals, and communication.

**The largest gaps vs. Zoho Recruit, in order of recruiter impact:**
1. **No resume/CV handling at all** (upload, parse, store, search-inside, resume inbox, bulk parse).
2. **No interviews module** (scheduling, interviewer feedback forms, calendar sync, video interviews).
3. **No external-facing surfaces** — careers site, candidate portal, client portal, vendor portal, web forms.
4. **No communication layer** — email templates/sync, mass email, SMS/WhatsApp, telephony.
5. **No automation engine** — workflow rules, alerts, tasks, assignment/approval rules, blueprints, webhooks/API.
6. **No customization layer** — custom fields, custom views, tags, custom modules, layout editor.
7. **No staffing-agency CRM depth** — client/contact records, submit-to-client with feedback, offers/e-sign, placements.
8. **No Zia-style AI** — semantic matching, AI profile summaries, AI JD/email writing, sourcing chatbot (ECOD deliberately ships deterministic matching instead).

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
| A9 | Mass update / bulk action buttons in list views | Multi-select + bulk export only; no mass field updates | 🟡 |
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
| J2 | Custom views (saved filters) per module | None | ❌ |
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
| M4 | GDPR/consent management, retention workflows, data-subject requests | None (blueprint defers) | ❌ |
| M5 | SSO/MFA administration | None in app (Supabase Auth could provide; blueprint defers administration) | ❌ |
| M6 | Data backup/restore (monthly backups, verified restore) | None (blueprint defers) | ❌ |
| M7 | De-duplicate data tooling | Import-time + form-time detection; no bulk merge | 🟡 |
| M8 | Multi-tenant isolation | Workspace membership + RLS + composite FKs blocking cross-workspace links — verified by PGlite integration test | ✅ |

### N. Blueprint-specific items (README "Not implemented" / PRODUCT_PLAN "Subsequent releases")

| # | Blueprint item | Status | Where covered above |
|---|---|---|---|
| N1 | CV PDF/DOCX storage, parsing, scanning | ❌ Missing | E1–E7 |
| N2 | Semantic retrieval | ❌ Missing | L6 |
| N3 | Per-skill proficiency/evidence taxonomy administration | ❌ Missing — skills are flat canonical strings | A1 |
| N4 | Structured full employment histories | ❌ Missing — profile snapshots exist instead | A11 |
| N5 | Granular compensation / client-commercial permissions | ❌ Missing | M2 |
| N6 | Read/export audit events | ❌ Missing — write audit exists | M3 |
| N7 | Saved custom pools/searches | ❌ Missing — 6 fixed dynamic pools exist | A12 |
| N8 | Email/calendar/WhatsApp integration | ❌ Missing | L3–L4, F7 |
| N9 | Consent/retention/data-subject workflows | ❌ Missing | M4 |
| N10 | SSO/MFA administration | ❌ Missing | M5 |
| N11 | Automated backups/restore verification | ❌ Missing | M6 |

---

## 4. Scoreboard by Zoho module area

| Area | ✅ | 🟡 | ⚙️ | ❌ | Coverage |
|---|---|---|---|---|---|
| A. Candidate management | 3 | 5 | 0 | 4 | 46% |
| B. Job openings | 1 | 0 | 0 | 6 | 14% |
| C. Clients & contacts | 0 | 2 | 0 | 4 | 17% |
| D. Sourcing & publishing | 0 | 0 | 0 | 7 | 0% |
| E. Resumes & parsing | 0 | 1 | 0 | 7 | 6% |
| F. Screening & interviews | 1 | 2 | 0 | 7 | 20% |
| G. Offers & onboarding | 0 | 1 | 0 | 2 | 17% |
| H. Candidate portals | 0 | 0 | 0 | 5 | 0% |
| I. Automation | 0 | 1 | 0 | 8 | 6% |
| J. Customization & platform | 0 | 3 | 0 | 7 | 15% |
| K. Analytics | 0 | 1 | 1 | 2 | 25% |
| L. Communication & integrations | 0 | 0 | 1 | 7 | 6% |
| M. Security & admin | 2 | 2 | 0 | 4 | 38% |
| N. Blueprint-specific items | 0 | 0 | 0 | 11 | 0% |
| **Overall** | **7** | **18** | **2** | **81** | **16%** |

*(Coverage = weighted presence: ✅=1, 🟡/⚙️=0.5, ❌=0.)*

**Where ECOD is genuinely at or above parity for its size:** candidate repository quality (alias-normalized skills, freshness discipline, dedup), import validation rigor, matching explainability (component scores + blockers + unknowns — Zoho shows a match score but ECOD's evidence model is more transparent), DB-level tenant isolation and audit integrity (verified by an actual-Postgres test), and honest analytics.

---

## 5. Recommended roadmap to close the gaps

Effort is relative (S ≤ a few days, M ~1–2 weeks, L = multi-week) for one developer on this codebase.

**Phase 1 — Core ATS parity (no new infrastructure)**
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
| Consent/retention/data-subject workflows | M4 | M |
| SSO/MFA administration, backups/restore verification | M5, M6 | M |
| Multi-currency, multi-language, custom report builder | J8–J9, K2 | L |

---

## 6. Sources

- Zoho Recruit plan comparison (authoritative feature matrix): https://www.zoho.com/recruit/plan-comparison.html
- Zoho Recruit staffing features (client portal, video interview, automation): https://www.zoho.com/recruit/staffing-agency-software/features.html
- Zoho candidate management & resume inbox/parser: https://www.zoho.com/recruit/candidate-management.html
- Zoho help — Parser mapping (DaXtra resume parser / Zia JD parser): https://help.zoho.com/portal/en/kb/recruit/talent-sourcing/resume-parser
- Zoho help — Sourcing Bot: https://help.zoho.com/portal/en/kb/recruit/zia/chatbot/articles/sourcing-bot
- Zoho help — Google Calendar sync: https://help.zoho.com/portal/en/kb/recruit/integrations/g-suite/google-account-users/articles/synchronizing-zoho-recruit-with-google-calendar
- Independent 2026 reviews: research.com/software/reviews/zoho-recruit · ismartrecruit.com/tools/zohorecruit · selectsoftwarereviews.com/reviews/zoho-recruit · softwarefinder.com/hr/zoho-recruit
- Interloop Technologies — blueprint/approval/interview automation detail: https://www.interlooptechnologies.com/zoho-recruit/

*Blueprint cross-check pending: attach `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` to reconcile Section N against the authoritative document.*
