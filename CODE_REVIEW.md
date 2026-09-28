# Code Review — ECOD Talent Intelligence (AnthroPrime)

Review date: 28 September 2026 · Branch: `arena/01a0e470-anthroprime-hiring-intelligenc` · Baseline commit: `c3072fe`

---

## 1. What this project is

**ECOD Talent Intelligence** is a recruiting workspace web app (branded "AnthroPrime") inspired by Zoho Recruit's repository-to-demand flow. Its core idea: candidates are stored as **people independent of any job application**, so a profile stays reusable across every client demand ("demand" = open job requirement).

Main capabilities:

| Area                                         | What it does                                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                                    | Open-demand coverage, 70%+ match counts, pipeline funnel, follow-ups ("On your radar"), repository freshness health                                                                                                                                      |
| Talent repository                            | Candidate CRUD, skill normalization via alias dictionary, dated verification ("freshness"), multi-term search (quoted phrases, `AND`, `-exclusions`), filters, sorting, selection, CSV export                                                            |
| CSV import                                   | File upload or paste → column mapping → preview with per-row validation, email/phone duplicate detection (case/whitespace-insensitive), downloadable error report; dupes/invalid rows are skipped, never merged                                          |
| Demands                                      | Manual creation or **keyword extraction** from a pasted JD (regex/alias based — explicitly _not_ AI), mandatory skills, experience/notice/budget/location/mode, configurable matching weights (must sum to 100)                                          |
| Matching                                     | Deterministic 6-component weighted score (skills 35%, experience 20%, assessment readiness 20%, notice 10%, budget 10%, location/mode 5%) with per-component explanation, hard-constraint "blockers", and "unknowns to verify". Scores never auto-reject |
| Pipeline                                     | Kanban across 10 stages with structured Rejected/Withdrawn disposition reasons (reason enforced by a DB CHECK too)                                                                                                                                       |
| Assessments / Enrichment / Pools / Analytics | Append-only assessment evidence (180-day validity in scoring), enrichment plans, 6 dynamic talent pools, live distribution analytics (no fabricated conversion rates)                                                                                    |
| Cloud mode                                   | Optional Supabase Auth + PostgreSQL: workspace membership, RLS tenant isolation, append-only audit history via triggers, admin/recruiter/viewer roles. Falls back to a browser-local **demo mode** with fictional seed data                              |

## 2. Architecture

```
React 19 + Vite 6 SPA (no router — state-driven page switching in App.jsx)
│
├── src/domain.js      Pure business logic: matching engine, JD extraction, search,
│                      validation, dedup, skill aliases. Framework-free → fully unit-testable.
├── src/import.js      CSV parsing (PapaParse) + import preview validation. Pure.
├── src/seed.js        Fictional demo dataset (19 candidates, 4 demands, …).
├── src/repository.js  Data adapter: Supabase (cloud) OR localStorage (demo).
│                      `cloud` flag decided at build time from VITE_SUPABASE_* env vars.
├── src/App.jsx        Shell: auth session, navigation, global save pipeline, modals, toasts.
├── Dashboard/Candidates/Demands/Workflows.jsx  Feature screens.
├── src/ui.jsx         Small shared primitives (Modal on native <dialog>, Badge, Field…).
├── supabase/migrations/001_ecod.sql  Full schema: tables, CHECKs, composite FKs
│                      (workspace_id,id), unique indexes, RLS policies, audit trigger.
└── tests/             node:test suites: domain, SQL migrations, user journeys and SSR smoke tests.
```

**Notable design decisions (all good):**

- Business logic lives in pure modules (`domain.js`, `import.js`) with zero React/DOM dependencies (only `crypto.randomUUID`), which is why the test suite is meaningful.
- One repository adapter with two backends; demo data **never** auto-uploads to Supabase.
- The DB is the real enforcement layer: RLS, CHECK constraints, composite foreign keys blocking cross-workspace links, append-only `history` via a `security definer` trigger, unique indexes on `lower(trim(email))` and normalized phone. The frontend is treated as untrusted and the docs say so.

## 3. Verification (current workspace)

| Command                                      | Result                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| `npx pnpm@11.25.0 install --frozen-lockfile` | ✅ succeeds with the committed lockfile                        |
| `npx pnpm@11.25.0 test`                      | ✅ **191 / 191 tests pass** (unit, UI and embedded PostgreSQL) |
| `npx pnpm@11.25.0 lint`                      | ✅ no errors or warnings                                       |
| `npx pnpm@11.25.0 format:check`              | ✅ all configured source and test files are formatted          |
| `npx pnpm@11.25.0 build`                     | ✅ production Vite build succeeds                              |

The suite includes real React/jsdom user journeys and PGlite-backed SQL migration tests. Migrations 001–019 have been exercised in sequence by migration-specific suites. This verifies SQL behavior locally; it does not claim a live Supabase Auth, Storage or PostgREST deployment was provisioned or tested.

## 4. Baseline code quality assessment (before remediation)

**Strengths**

- Clean layering: pure logic / data adapter / UI. The matching engine is deterministic, explainable, and honest about unknowns — rare discipline.
- Product honesty: README/QA docs carefully delineate what is verified vs. not (e.g., "JD extraction is keyword-based, not an LLM"; "pipeline counts are distributions, not conversion rates"). The SECURITY scope section is unusually candid.
- Security posture is strong for this class of app: strict CSP + security headers (`netlify.toml` and `public/_headers`), no service keys in the client, RLS with `search_path=''` on security-definer functions (prevents hijacking), CSV export uses `escapeFormulae` (blocks formula injection), LinkedIn URLs validated against `https://(www.)?linkedin.com/`, React-escaped rendering throughout (no `dangerouslySetInnerHTML`).
- Accessibility touches: skip link, aria-labels, native `<dialog>` with focus handling, `role="alert"`/`role="status"`.
- Concurrency guard in `App.save` (`saving` ref) prevents double-submit races.

**Baseline weaknesses** (functional issues below are resolved; remaining debt is listed in §10)

1. **Extreme compression style** — entire components on one physical line (`App.jsx` is 48 "lines" / 10.7 KB). This defeats diff tooling, code review, grep, and IDE debugging. It's the single biggest maintainability risk.
2. **No linter/formatter** — dead imports (below) would have been caught instantly by ESLint.
3. **Dead code** — `resetDemo()` (repository.js) is never used; `searchCandidate()` (domain.js) is tested but the app doesn't call it (see Bug 2); unused imports: `ArrowUpDown, BriefcaseBusiness, CalendarDays, Clock, FileText, SKILLS, STAGES, matchCandidate` in Candidates.jsx and `useMemo, SKILLS` in Workflows.jsx.
4. **Search logic duplicated** between `domain.searchCandidate` and an inline copy in `Candidates.jsx` — and the two have diverged (Bug 2).
5. **Bundle**: `@supabase/supabase-js` (227 KB min) is statically imported even in demo mode where it's never used; a dynamic `import()` inside the `cloud` branch would cut ~40% of the bundle for the demo.
6. Cloud `saveRows` re-fetches the full history (`limit(1000)`) on **every** save; a bulk write over 1,000 rows can generate more history events than the refresh limit, leaving some of its new events absent from the UI until reload (older in-memory history is retained).
7. `extractJD` builds ~40 regexes per invocation and `Dashboard`/`Demands` run `matchCandidate` per candidate per demand on every render — fine at current scale (README acknowledges the large-repo limitation), but memoization would be cheap.

## 5. Baseline bugs and issues found

These are the findings against baseline commit `c3072fe`; current remediation status is in §8.

### Medium

**B1. `today()` is UTC — breaks "today" for the app's target timezone (IST).**
`domain.js`: `today = () => new Date().toISOString().slice(0, 10)` returns the **UTC** date. The app is explicitly India-focused (₹ LPA, en-IN locales). Between 00:00–05:30 IST the UTC date is still "yesterday", so:

- The "Last verified" field has `max={today()}` — a recruiter working just after local midnight **cannot select the actual current date**; the browser blocks submission as invalid.
- Follow-up badges ("due today"), `followUp <= today()` comparisons, freshness/`age()` boundaries, and `created`/`verified` stamps are all off by one day in that window.
  Fix: compute the local date (e.g., `new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)`) or use `en-CA` formatting of the local date.

**B2. The shipped search is not the tested search — and it drops a field.**
`searchCandidate()` in `domain.js` (the version covered by tests) searches `name,title,company,location,email,summary,skills`. But `Candidates.jsx` re-implements the identical parser inline with `[c.name,c.email,c.title,c.company,c.location,...c.skills]` — **`summary` is missing**, so the professional summary is unsearchable from the repository page, and the tested function is dead code. Verified by probe: a candidate whose summary contains "kafka" is found by `searchCandidate` but not by the app's filter. Fix: call `searchCandidate(c, query)` inside the memo (and delete the inline copy).

**B3. Disposition reasons are silently wiped by stage moves.**
`App.jsx` `move()` saves `{...application, stage, updated: today(), reason: ''}`. Moving a consideration that was **Rejected/Withdrawn** (with a structured reason) to any other stage erases the recorded disposition reason with no confirmation. The DB only requires a reason when _entering_ Rejected/Withdrawn, so the loss is silent.

**B4. Float equality rejects valid matching weights.**
`DemandForm` submit: `Object.values(form.weights).reduce((a,b)=>a+Number(b),0) !== 100`. Probe: weights `33.4/33.3/33.3/0/0/0` sum to `99.99999999999999` in JS → the form refuses to save ("weights must add up to 100%") even though they visually sum to 100 and PostgreSQL `numeric` (used by `valid_weights`) would accept them. Fix: compare with an epsilon or `Math.round(sum*100) !== 10000`.

### Low

**B5. Import validation is weaker than form validation.**
`validateCandidate` enforces only non-negative numbers, but `CandidateForm` additionally caps experience ≤ 60, notice ≤ 365 via input attributes. A CSV row with `experience=9999` or `notice=5000` imports fine, then the DB CHECKs (`>=0` only) accept it too. Inconsistent surfaces → odd data possible via import only.

**B6. No in-app recovery from corrupt/full demo storage.**
`loadData()` does a raw `JSON.parse(localStorage…)`; corrupt data throws a raw `SyntaxError` to the error screen. The app's own message tells users to "clear this site's browser storage", but the only reset helper (`resetDemo`) is dead code and there's no UI button to do it.

**B7. Import re-check race has a hole (cloud mode).**
`importRows` re-runs `previewImport` and proceeds if the count of valid rows is unchanged. An equal-count swap (one row newly duplicated + one previously-broken row) passes the guard; in cloud mode the resulting batch then fails the DB unique index, failing the **entire** import with a raw Postgres error. Single-user demo is unaffected.

**B8. Pipeline allows stage moves on closed/on-hold demands.**
`DemandDetail` correctly disables shortlisting when `d.status !== 'Open'`, but the Pipeline kanban's stage `<select>` has no such guard — inconsistent enforcement.

**B9. README references a file the repo doesn't contain.**
"The supplied `releases/ecod-netlify-demo.zip`…" — `releases/` is gitignored and absent, so anyone cloning the repo can't follow that deploy path. Docs-only issue.

**B10. Minor/cosmetic**

- TAP test-count undercount (above).
- `favicon.svg` ships in `public/` but `index.html` uses the JPEG logo as icon.
- Duplicate header definitions (`netlify.toml` and `public/_headers` carry identical CSP/headers — harmless, but one source of truth would be better).
- Import preview row numbers (`index+2`) drift from true file line numbers when blank lines are skipped.
- Editing a candidate from a profile tab deeper than "Overview" closes and remounts the profile, resetting the active tab.
- `matchCandidate` location match is exact string equality ("Bengaluru" ≠ "Bangalore") — documented, but worth knowing.

### Security notes (no exploitable issue found)

- RLS design is genuinely solid: membership-scoped policies, composite FKs preventing cross-tenant references, `search_path=''` on security-definer functions, anon fully revoked, history insert-only via trigger, and viewer writes denied at DB level. At the baseline, viewers still saw edit controls (a UX debt rather than a bypass); U9 records the current UI and session-transition remediation.
- CSP has no `unsafe-eval`/`unsafe-inline` for scripts; `connect-src` limited to self + `*.supabase.co` (a Supabase custom domain would need updating).
- Demo mode keeps all data in `localStorage`; nothing crosses the network.

## 6. Original recommendations and status

The baseline review's functional recommendations are implemented: B1–B9 are resolved, the broken prop wiring in B10 is fixed, and the UI is now exercised through real component journeys. ESLint is installed and clean. The remaining maintainability and scale recommendations are separated from bug status in §10 rather than presented as unresolved functional blockers.

## 7. Current verdict

The current workspace has **191 passing tests**, clean ESLint and Prettier checks, and a successful production build. The meaningful launch risks found in the baseline review and subsequent user-flow testing are fixed, and the offer approval and candidate self-service rules are checked at the PostgreSQL boundary as well as in the UI. Viewer controls fail closed while cloud role information is unresolved, and account changes clear the prior workspace from the shell before loading the next one. The repository remains a deliberately scoped first release: the hosted Supabase project itself was not provisioned in this sandbox, so its Auth, Storage network behavior and PostgREST integration still require deployment-level verification. Remaining debt is mostly maintainability and operational scope, listed in §10.

---

## 8. Remediation log

All baseline functional findings B1–B9 and B10's broken prop wiring are resolved. The current verification is **191 / 191 tests**, ESLint and Prettier clean, and `pnpm build` successful. The remaining maintainability/operational debts are explicit in §10.

| Ref | Fix                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `domain.js` uses a local `today()` instead of UTC, so IST users no longer see tomorrow's date.                                                                                                                                                                                                                                                                                                               |
| B2  | `Candidates.jsx` search uses the shared `searchCandidate()`; the divergent inline copy is gone.                                                                                                                                                                                                                                                                                                              |
| B3  | `move()` preserves the recorded `reason` when a stage changes.                                                                                                                                                                                                                                                                                                                                               |
| B4  | `weightsSumTo100` compares integer cents (`Math.round(sum*100)===10000`), so 33.4+33.3+33.3 is accepted and 99 is not.                                                                                                                                                                                                                                                                                       |
| B5  | `MAX_EXPERIENCE_YEARS`/`MAX_NOTICE_DAYS` exported from `domain.js`, enforced by `validateCandidate()`, used as the form inputs' `max`, so a CSV row can no longer smuggle in `experience=9999`.                                                                                                                                                                                                              |
| B6  | `resetDemo()` wired to a Settings → "Reset demo data" button, plus a recovery button in the corrupt-store error state.                                                                                                                                                                                                                                                                                       |
| B7  | `ImportModal` rechecks each row's validation/duplicate result, not only the total valid count. Equal-count duplicate swaps now require review; a cloud unique-index conflict refreshes workspace data so the modal can reclassify the conflicting row. The row-swap guard has unit and real-UI coverage, and a cloud-mode UI journey exercises the `23505` recovery through a mocked Supabase HTTP boundary. |
| B8  | Pipeline stage select is disabled with an explanatory message when the demand is not `Open`.                                                                                                                                                                                                                                                                                                                 |
| B9  | `npx pnpm@11.25.0 release` builds and packages `releases/ecod-netlify-demo.zip`; the README now says the archive is generated (it is gitignored), not checked in.                                                                                                                                                                                                                                            |
| B10 | Prop wiring fixed across `Candidates`, `CandidateProfile` and `Analytics`; profile tab continuity and TAP count are now covered. Remaining cosmetic items from the original probe are listed in §10.                                                                                                                                                                                                         |

Also fixed while verifying the above: the `skillList` import crash, three `audit()` arity bugs and
view/export audit-event persistence, the `ScheduleModal` rewrite, `portal.jsx` treating a promise as data, the offer letter's `$` → `₹`,
dossier dates, `automation.js` triggers that referenced fields which do not exist, `merge()`
mutating its props, careers → workspace store wiring, and dedupe's "verified" pick.

## 9. New findings from UI and database testing

Driving the real components and applying the real migrations in PGlite found defects that static review had missed. The fixes below are covered by tests.

**U1 — Controlled inputs used `onInput` instead of `onChange` (10 fields).** React's controlled-input `onChange` is the input event; `onInput` left values stale for change-only input sources. Candidate/demand forms, assessment/enrichment dates and follow-up dates are now wired through `onChange`.

**U2 — Matching-weight inputs had no decimal `step`.** The browser's default `step=1` rejected values like `33.4` before React could submit them, despite the decimal-safe 100% check. Weight controls now use `step="0.1"`.

**U3 — Candidate portal blank numerics became zero.** `Number('  ')` yields `0`, which looked like immediate availability and ₹0 expected CTC. `toNumber()` now trims and maps blank/non-finite values to `null`; portal writes share the recruiter notice ceiling.

**U4 — Offer approval was bypassable in two layers.** Migration 013's first gate trusted any non-null `approvedAt` and did not pin the terms; a direct API caller could self-approve or edit terms while keeping an old stamp. Migration 014 makes approval admin-only, records the authenticated approver and a server-generated snapshot of the exact terms, invalidates that snapshot on edits, and blocks sending stale terms. In the UI, changing a sent offer's terms reopens a draft and clears the old send/decision dates; closed offers are no longer editable.

**U5 — Empty optional form values were invalid SQL date/UUID strings.** Optional interview/offer demand IDs, joining dates, task due dates, application-note follow-ups and manual employment dates were persisted as `''` even though their PostgreSQL columns are UUID/date. The save paths now send `null` for unknown values.

**U6 — Automation could create invalid or impossible actions.** Notes were emitted with `followUp:''` and demand-triggered rules could configure candidate-only note/tag/next-action actions without a candidate ID. Notes now use a real null follow-up and require a candidate; the rule editor disables candidate-only actions for demand triggers, legacy rules with unsupported actions cannot be re-enabled silently, and the seeded demand rule creates a demand-linked task. Migration 017 also aligns the DB trigger-table check with the UI's `considerations.stage` option.

**U7 — Cloud candidate-portal updates could not clear fields.** The old SQL used `COALESCE(new_value, old_value)`, so blank notice/start-date/preferences could be cleared in demo mode but not cloud mode. Migration 016 distinguishes omitted keys from explicit null/empty values, validates notice (0–365), expected CTC, work mode and active status, and aligns the portal's status options with the database. The UI rejects invalid values before either backend is called.

**U8 — The change feed omitted tables and auxiliary updates.** The prior RPCs skipped multiple repository tables, didn't track updates to settings/taxonomy/consents/documents/workflow rules, and only used candidates/history to decide whether a next page existed. Migration 017 adds update timestamps/triggers, includes all 22 workspace repository tables, preserves the admin-only commercials boundary, and bases pagination on all tables. Approval metadata is included by migration 015.

**U9 — Viewer controls and session transitions could expose edit/export affordances.** The cloud UI now hides or disables viewer mutations, backup restore and data exports; the app write callback also rejects roles other than admin/recruiter, and exports use the same fail-closed allowlist. A role resets to read-only on cloud identity changes, and prior data/modals/search state are cleared before loading the next account. The database's RLS remains authoritative. A Vite cloud-mode jsdom suite exercises the viewer-facing controls without claiming live Supabase integration.

**U10 — Settings and release notes described implemented capabilities as missing.** Workspace Settings implied CV parsing/storage, local semantic retrieval, candidate self-service and manual retention review were not shipped, while README scope text said candidate portals were absent. The copy now distinguishes those available local/workspace features from hosted embeddings, automated messaging/sync and other future integrations; the Settings claim is covered by a UI assertion, and `PRODUCT_PLAN.md` is explicitly marked as the historical initial plan.

**U11 — The anonymous careers surface crossed tenant and data boundaries.** Migration 009 granted `anon` table-level `SELECT` on every open demand, exposing all demand columns and rows across workspaces; the browser's `ws` parameter was not used to scope its query. Direct RPC calls could also omit contact consent or apply to a hidden/closed/foreign role. Migration 018 revokes anonymous table reads, adds an explicit `careersVisible` opt-in, and replaces the query with a security-definer RPC scoped by workspace and limited to public listing fields. It also scopes status lookup by workspace. The apply RPC now independently requires contact consent and a currently open, published role in that workspace. Two-workspace PGlite and demand-form/careers-page UI checks cover the boundary.

**U12 — Application status was disclosed to anyone who knew an email address.** The no-account lookup returned pending/accepted/dismissed status on an exact-email match, which is not proof of email ownership and can expose a confidential job search. Migration 019 adds a random per-application status code, returns it to the applicant only on apply, and requires the code together with email and workspace for status lookup. The careers page displays and requests that code; wrong email/code/workspace combinations return no records. Existing applications receive database codes during migration but applicants were not shown them, so README/API docs direct those requests through a verified channel.

### User-flow test suites

| File                             | Coverage                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ui-app.test.js`           | 22 real-shell journeys: navigation, candidate create/validate, saved views, bulk readiness, export, profile tabs, safe DOCX upload fallback, skill evidence, demand creation from pasted JD, explainable matching, pipeline moves, dispositions, locked demands, analytics drill-in, corrupt-store recovery and dossier export. |
| `tests/ui-portals.test.js`       | 8 journeys across careers and candidate self-service: open-role publishing, consent/application validation, applicant → profile → consent ledger → withdrawal, private status-code lookup, curated data projection, preference normalization, clearable fields and notice-cap enforcement.                                      |
| `tests/ui-interviews.test.js`    | 11 journeys: schedule validation, timestamps/panels, optional SQL-null links, feedback, `.ics` exports, no-show handling, offer lifecycle/letters/approval gate, post-send term edits and honest counters.                                                                                                                      |
| `tests/ui-workflows.test.js`     | 20 journeys: CSV import/duplicate-race handling/caps/error reports, automation vocabulary and firing (including demand tasks and legacy-rule gating), paused rules, assessment evidence, enrichment, dynamic pools, settings policy, null-safe employment/task dates, reset and backup.                                         |
| `tests/ui-viewer.test.js`        | 3 cloud-mode read-only journeys across dashboard, repository, candidate profile, demands, pipeline, assessments, interviews and settings.                                                                                                                                                                                       |
| `tests/ui-cloud-import.test.js`  | 1 cloud-mode journey: a mocked Supabase `23505` candidate conflict reloads workspace data and reclassifies the pending CSV row before another save.                                                                                                                                                                             |
| `tests/ui-careers-cloud.test.js` | 1 cloud-mode careers journey: workspace-scoped listing, consented application, private status code delivery and code-gated status RPC through the real Supabase client.                                                                                                                                                         |
| `tests/offers.test.js`           | 6 pure approval-policy tests, including snapshot freshness and term invalidation.                                                                                                                                                                                                                                               |
| `tests/migration014.test.js`     | Admin-only approval and immutable terms-snapshot trigger, direct API bypass attempts and policy-off behavior.                                                                                                                                                                                                                   |
| `tests/migration015.test.js`     | Approval-only offer edits appear in both incremental sync RPCs with the trusted snapshot.                                                                                                                                                                                                                                       |
| `tests/migration016.test.js`     | Cloud portal explicit clears, patch semantics, range checks and recruiter-owned-field protection.                                                                                                                                                                                                                               |
| `tests/migration017.test.js`     | All 22 repository tables in both sync RPCs, admin-only commercials, timestamped auxiliary updates, consideration trigger compatibility and cross-table pagination.                                                                                                                                                              |
| `tests/migration018.test.js`     | Anonymous demand-table denial, workspace-scoped public role projection, explicit publication, contact consent, and open/published/same-workspace application enforcement.                                                                                                                                                       |
| `tests/migration019.test.js`     | Migration backfills unique status codes, anonymous table reads remain denied, and application status requires matching workspace, email and private code.                                                                                                                                                                       |

Supporting helpers: `tests/ui-env.js` (jsdom + download/`URL` capture across both realms),
`tests/ui-harness.js` (Vite SSR module loading, React `mount` and `settle`),
`tests/ui-drivers.js` (user-action helpers such as `navTo`, `press`, `type`, `choose`, `submitVia`,
`rowOf` and `pressIn`).

## 10. Remaining technical and operational debt

These are known limitations, not failing tests or undocumented product claims:

- Prettier and ESLint are configured and clean, and the formatting pass is complete. The feature screens are still large modules; splitting them into smaller domain-aligned components would improve navigation and future maintenance.
- Supabase JS now loads only from the cloud branch via dynamic `import()`. History refreshes now cover at least 1,000 rows, or the full size of the current write when larger; fetching only events for affected entities remains a possible network-efficiency improvement.
- Search/matching are in-memory and exact location matching does not infer aliases such as Bengaluru/Bangalore. This is documented and adequate for the fictional demo-sized repository.
- The earlier favicon, duplicate-header and CSV source-row-label observations are resolved: pages use the SVG favicon, Netlify delegates headers/redirects to `public/`, and import previews preserve physical source row numbers.
- Viewer UI controls are hidden/disabled, app writes and exports use a fail-closed role allowlist, and account changes clear previous workspace state. The database RLS remains the authority; validate these controls against your provisioned project before inviting viewers.
- Uploads enforce a 5 MB compressed-file cap and a 1 MiB DOCX XML inflation cap; malformed or oversized DOCX extraction falls back to manual review. Server-side malware scanning is still required before production. PGlite executes the migrations locally, but no live Supabase project was provisioned here. Verify Auth, Storage signed URLs, RLS and PostgREST with separate real test accounts before production use; retention automation, SSO/MFA, fair-evaluation masking, backup RPO/RTO and communications integrations remain out of scope.
