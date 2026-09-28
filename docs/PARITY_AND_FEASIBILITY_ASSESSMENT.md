# ECOD Talent Intelligence — Independent Parity & Feasibility Assessment

_Prepared 28 September 2026 · branch `arena/01a0e64f-anthroprime-hiring-intelligenc` (base `80cee22`)_
_Updated after batches 16–21 (clients & contacts, user administration, requisition approval & departments, careers SEO, custom reports, skills model), 22 (branded client profiles), 23 (Excel import), 24 (referrals) and Phases A–D of the day-to-day plan (cross-entity search and work queue, bulk operations, interview calendar and candidate self-booking, assignment rules): **541 tests passing, Zoho parity ~52%, blueprint ~84%.** Batch 21 closed the §6 overstatement identified in §4 of this document._

This is a **fresh, code-first read** of the project: what actually exists, how much of Zoho Recruit
and of `ECOD_Talent_Intelligence_Repository_Product_Blueprint.docx` v1.0 is really done, and — the
part the existing docs do not answer — **what it will physically take to build the next features
given the architecture you have chosen**.

It complements `docs/FEATURE_EQUIVALENCE.md` (the feature-by-feature matrix) rather than repeating
it. Where I disagree with that document I say so explicitly in §4.

---

## 1. What the codebase actually is

| Aspect              | Reality in the repo                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Shape               | A **client-only React 19 SPA** (Vite), ~14,300 lines in `src/`, three HTML entry points: app, `careers.html`, `portal.html` |
| Backend             | **None of your own.** Supabase is the entire backend: Postgres + RLS + `security definer` RPCs + Auth + Storage |
| Server-side code    | **Zero.** No `supabase/functions/`, no API service, no worker, no cron                                     |
| Database            | 19 migrations, ~24 tables, all workspace-scoped with RLS; 12 RPCs (`api_changes_since/page`, `api_public_*`, `api_portal_*`) |
| Persistence modes   | Dual: `localStorage` demo seed (no env vars) **or** Supabase cloud (`VITE_SUPABASE_URL` + anon key)         |
| Tests               | 191 tests, **all passing** (`pnpm test`, ~100 s) — Node test runner + PGlite (embedded Postgres) for migrations/RLS + jsdom/Testing-Library user-flow suites |
| Lint/format         | ESLint + Prettier configured and clean                                                                      |
| Deploy              | Netlify static hosting (`netlify.toml`, `_headers`, `_redirects`)                                          |

**Verdict on engineering quality: genuinely good for this stage.** Migration-level RLS tests with a
real embedded Postgres, multi-workspace isolation regression tests, and honest documentation of
limitations are well above what a project this age usually has. I found no inflated claims in the
feature docs about things that don't exist — the code backs them up.

---

## 2. Feature parity — my read

### 2.1 Against the ECOD Blueprint

The blueprint's own **§15 R1/MVP checklist is complete**, and R1.5 and much of R2 are shipped too.
I re-checked each blueprint section against source rather than against the matrix, and land close to
the existing doc's **~81%**, with two downgrades (see §4):

| Blueprint section              | My read | Comment                                                                                        |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| §3 ECOD lifecycle (8 stages)   | ~90%    | All 8 stages exist as real screens; Re-engage is passive (no nurture automation)                |
| §4.1 Candidate 360             | ~80%    | All domains present; documents/interactions lighter than spec                                   |
| §4.2 Demand object             | ~80%    | Configurable stages, per-skill minimums, commercials in admin-only table — strong               |
| §5 Search & matching           | ~80%    | Filters + full-text + TF-IDF semantic + **transparent 6-component match breakdown** — the best part of the product |
| §6 Skills intelligence         | **~70%** (doc says 100%) | Canonical names, aliases, domains, evidence, freshness all work — but stored as `text[]` + JSONB, not `Skill`/`PersonSkill`/`SkillEvidence` tables (§9) |
| §7 Append-don't-overwrite      | ~70%    | Employment/compensation/availability histories are real; skill-evidence versioning is not       |
| §8 Key screens                 | ~60%    | Client and vendor portals absent                                                                |
| §10 Dedupe & data quality      | ~95%    | Hard + probable checks, confidence reasons, human-approved merge, quality queues — excellent    |
| §11 AI layer                   | ~60% ⚙️ | **Deliberately non-AI.** Deterministic TF-IDF/keyword extraction stands in for parsing, semantic retrieval and explanations. Honest and auditable — but it is not the blueprint's AI layer |
| §12 Security & governance      | ~65%    | RLS, audit, consent ledger, upload magic-byte sniffing are real; **no malware scan, no SSO/MFA admin, no server-enforced export control, no tested backup/restore** |
| §13–14 Architecture & API      | **~40%** | This is the real gap — see §3                                                                  |
| §16 Acceptance scenarios       | ~88%    | 7 of 8 demonstrable today                                                                       |
| §17 Analytics                  | ~90%    | Honest, computed-from-records metrics; time-to-submit and cohort conversion missing             |

### 2.2 Against Zoho Recruit

**~41% weighted** in the existing matrix is, if anything, slightly generous — many rows scored 🟡
are 🟡 because a *draft/handoff* exists (mailto links, `.ics` files) rather than a working
integration. My practical framing:

| You are **at or ahead of Zoho** on | You are **structurally behind Zoho** on |
| ----------------------------------- | ---------------------------------------- |
| Explainable matching (component scores, hard-constraint blockers, evidence prompts — Zoho shows an opaque Zia score) | Communications: email send/receive, resume inbox, mass mail, SMS/WhatsApp, telephony |
| Skill evidence + freshness discipline | Client & vendor CRM: client/contact records, client login portal, placements, invoicing |
| Dedupe rigor and human-approved merge | Sourcing & distribution: job boards, social posting, referrals, sourcing extensions |
| Import validation and error reporting | Server-side automation: workflow engine, alerts, approval/assignment rules, webhooks |
| Audit/tenant isolation proven by tests | Customization depth: custom modules, layout editor, custom reports |
| Honest analytics (no fabricated rates) | AI (Zia): summaries, scoring, chatbot, JD generation |

**Bottom line: you have built a very credible "talent intelligence core" — roughly the 40% of an ATS
that is hardest to get right — and almost none of the "surface area" 60% (comms, portals for
clients, integrations, automation execution).** That is the correct order to build in.

---

## 3. Feasibility of the next features — the architecture is the constraint

Everything below follows from one fact: **there is no server.** Three specific ceilings:

### Ceiling 1 — Whole-database-into-the-browser loading

`src/repository.js › loadData()` pages **every row of all 24 tables** into memory at sign-in, and
all search, matching, TF-IDF and analytics run client-side. This is elegant at demo scale and
**will fail somewhere around 10k–25k candidates** (initial load time, memory, TF-IDF cost). Any
serious "repository" ambition hits this first.

### Ceiling 2 — Nothing can happen when nobody has a tab open

No queue, no cron, no webhook receiver. So these are **not implementable as designed**, at any
effort level, without new infrastructure:

- server-side email delivery and resume-inbox ingestion
- scheduled nurture / freshness reminders / retention purge
- webhooks and event bus (`profile.updated`, `candidate.ready`, …)
- malware scanning of uploads
- two-way calendar sync
- async CV parsing at volume
- server-executed workflow rules (today's rules only fire in an open browser session)

### Ceiling 3 — No API key surface

The anon key is public by design, so no third party can integrate without either Supabase user
credentials or a service you don't have.

### The unlock

**One decision removes most of the above: add a small server.** Two viable routes:

| Option                                                               | Effort  | What it unlocks                                                                   | Trade-off                                     |
| -------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| **A. Supabase Edge Functions + pg_cron + Storage triggers**          | ~1 week | Email send, webhooks, scheduled jobs, malware scan hook, API keys — 80% of the ceiling, zero new vendors, no rewrite | Deno functions, cold starts, modest limits    |
| **B. Separate backend service (FastAPI/NestJS per blueprint §13)**   | 3–6 wks | Everything, plus server-side search/pagination and a proper REST API              | Real rewrite of the data path; operational cost |

**My recommendation: do A now.** It is additive, keeps the SPA, and defers B until scale or an
enterprise customer forces it. The blueprint's §13 backend is the right end-state, not the next step.

### Feasibility table for the likely next features

Effort assumes one developer. "Blocked" = needs the server decision above first.

| # | Feature                                                | Effort | Feasible today?                  | Notes                                                                 |
| - | ------------------------------------------------------ | ------ | -------------------------------- | --------------------------------------------------------------------- |
| 1 | ~~**Client & contact records**~~ **✅ shipped (batch 16)** | M | Done | Accounts, contacts, per-customer rollups, demand/submission links. The client *login portal* remains |
| 2 | **Server-side email (invites, offers, alerts)**         | M      | ⚠️ Blocked → trivial after A      | Edge Function + Resend/SES; replaces every `mailto:` handoff          |
| 3 | **Server-side workflow execution + alerts**             | M      | ⚠️ Blocked → S after A            | Rules engine already exists in `src/automation.js`; port evaluation into a function + `pg_cron` |
| 4 | **pgvector semantic index**                             | S–M    | ✅ Yes (Supabase ships pgvector) | Needs an embedding call → really needs A for background embedding. TF-IDF is a fine stopgap |
| 5 | **Server-side search & pagination (fix Ceiling 1)**     | M–L    | ✅ Yes, Postgres FTS + RPCs       | Do this *before* your first real 20k-profile migration, not after     |
| 6 | **Real REST API + API keys + webhooks**                 | L      | ⚠️ Blocked → M after A            | `api_changes_since/page` already defines the contract; wrap it        |
| 7 | **Malware scanning + tested encrypted backups**         | S–M    | ⚠️ Blocked                        | Compliance blocker for production PII — treat as go-live gating       |
| 8 | ~~**User & role admin UI**~~ **✅ shipped (batch 17)**   | S–M    | Done | Invite/role/remove with a database-enforced last-admin guard and full audit. SSO/MFA *enrolment* is still Supabase Auth configuration |
| 9 | **AI layer (CV/JD parsing, match explanations)**        | M      | ⚠️ Blocked (keys can't ship in a SPA) | After A: provider abstraction in an Edge Function, per blueprint §11/§20 |
| 10| **Normalized Skill/PersonSkill/SkillEvidence tables**   | M      | ✅ Yes                            | Migration + backfill from `skills[]`/`skillsDetail`; unblocks skill analytics at scale and real evidence versioning |
| 11| **Job-board / social distribution, referrals**          | L      | ⚠️ Mostly blocked                 | Each board is an integration; low ROI until #1 and #2 exist           |
| 12| **Custom modules / layout editor / custom reports**     | L      | ✅ Yes but expensive              | Classic Zoho parity work with low ECOD differentiation — defer        |

---

## 4. Where I disagree with the existing docs

1. **§6 Skills intelligence is not 100%.** Behaviour is there; the *data model* isn't. Skills live in
   `candidates.skills text[]` + `candidates."skillsDetail" jsonb` (migration 002), not the
   `Skill`/`PersonSkill`/`SkillEvidence` tables the blueprint's §9 asks for. Consequences are real:
   no per-evidence row-level versioning (which §7 requires), no cross-candidate skill-inventory
   query without loading every candidate, and no referential integrity on the taxonomy.
2. **"Workflow automation rules" reads as more than it is.** They execute only in an open browser
   session of a signed-in user. That is a UI convenience, not automation; it should be labelled as
   such for buyers.
3. **Hosted deployment remains unverified.** Every RLS/RPC test runs in PGlite. Auth, Storage signed
   URLs, and PostgREST behaviour on a real Supabase project have not been exercised. The docs say
   this, but it deserves to be the **#1 risk**, not item 1 of a roadmap table — you cannot claim any
   of the security posture until a provisioned project is tested with real accounts.
4. **41% Zoho parity understates the product and overstates the gap that matters.** Many missing
   rows (custom modules, multi-currency, native mobile) are irrelevant to ECOD's thesis. A more
   useful number: **you have ~85% of what a 10-recruiter staffing desk uses daily, minus
   communications and client collaboration.**

---

## 5. Recommended sequence

**Phase 0 — De-risk (1–2 weeks, do before any new feature)**

1. Provision a real Supabase project; run all 19 migrations; test Auth, RLS, Storage signed URLs and
   every RPC with three real accounts (admin/recruiter/viewer) and two workspaces.
2. Prove backup + restore with RPO/RTO written down.
3. Load-test `loadData()` with 25k synthetic candidates and record where it breaks.

**Phase 1 — The server decision (1 week)**
Add Supabase Edge Functions + `pg_cron` + a Storage trigger. Ship one function end-to-end (send an
interview invite) to prove the path.

**Phase 2 — Commercial value (4–6 weeks)**
~~Clients/contacts (#1)~~ ✅ and ~~user administration (#8)~~ ✅ are done. Remaining: server-side
email (#2) → server-side workflows + alerts (#3) → the client *login* portal. This is what turns a
repository into something a client-facing staffing business runs on.

**Phase 3 — Scale & intelligence (4–8 weeks)**
Server-side search/pagination (#5) → normalized skills tables (#10) → pgvector (#4) → bounded AI
parsing/explanations (#9).

**Phase 4 — Integration surface (as demanded by customers)**
REST API + webhooks (#6), job boards (#11), SSO (#8 can move earlier if an enterprise buyer asks).

**Explicitly defer:** custom modules/layout editor, multi-currency/language, native mobile,
predictive ranking (blueprint §5 says "not initially" and §18 says don't build black-box ranking).

---

## 6. Two honest strategic notes

- **The non-AI stance is a feature, but name it.** Deterministic TF-IDF and keyword extraction are
  auditable and cheap, and blueprint §18 explicitly forbids black-box ranking. But buyers comparing
  you to Zoho Zia will ask. Position it as "explainable matching, AI-assisted extraction coming as a
  reviewable draft" — which is exactly what §11 prescribes.
- **Ship a production deployment before shipping more features.** 191 green tests against an
  embedded Postgres is excellent evidence of *design*; it is no evidence of *operation*. The largest
  single reduction in project risk available to you right now costs about a week and adds no
  features at all.
