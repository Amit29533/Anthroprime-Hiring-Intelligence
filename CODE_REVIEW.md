# Code Review — ECOD Talent Intelligence (AnthroPrime)

Review date: 27 September 2026 · Branch: `arena/01a0e3a4-anthroprime-hiring-intelligenc` · HEAD: `492f9bb`

---

## 1. What this project is

**ECOD Talent Intelligence** is a recruiting workspace web app (branded "AnthroPrime") inspired by Zoho Recruit's repository-to-demand flow. Its core idea: candidates are stored as **people independent of any job application**, so a profile stays reusable across every client demand ("demand" = open job requirement).

Main capabilities:

| Area | What it does |
|---|---|
| Dashboard | Open-demand coverage, 70%+ match counts, pipeline funnel, follow-ups ("On your radar"), repository freshness health |
| Talent repository | Candidate CRUD, skill normalization via alias dictionary, dated verification ("freshness"), multi-term search (quoted phrases, `AND`, `-exclusions`), filters, sorting, selection, CSV export |
| CSV import | File upload or paste → column mapping → preview with per-row validation, email/phone duplicate detection (case/whitespace-insensitive), downloadable error report; dupes/invalid rows are skipped, never merged |
| Demands | Manual creation or **keyword extraction** from a pasted JD (regex/alias based — explicitly *not* AI), mandatory skills, experience/notice/budget/location/mode, configurable matching weights (must sum to 100) |
| Matching | Deterministic 6-component weighted score (skills 35%, experience 20%, assessment readiness 20%, notice 10%, budget 10%, location/mode 5%) with per-component explanation, hard-constraint "blockers", and "unknowns to verify". Scores never auto-reject |
| Pipeline | Kanban across 10 stages with structured Rejected/Withdrawn disposition reasons (reason enforced by a DB CHECK too) |
| Assessments / Enrichment / Pools / Analytics | Append-only assessment evidence (180-day validity in scoring), enrichment plans, 6 dynamic talent pools, live distribution analytics (no fabricated conversion rates) |
| Cloud mode | Optional Supabase Auth + PostgreSQL: workspace membership, RLS tenant isolation, append-only audit history via triggers, admin/recruiter/viewer roles. Falls back to a browser-local **demo mode** with fictional seed data |

## 2. Architecture

```
React 19 + Vite 6 SPA (no router — state-driven page switching in App.jsx)
│
├── src/domain.js      Pure business logic: matching engine, JD extraction, search,
│                      validation, dedup, skill aliases. Framework-free → fully unit-testable.
├── src/import.js      CSV parsing (PapaParse) + import preview validation. Pure.
├── src/seed.js        Fictional demo dataset (18 candidates, 4 demands, …).
├── src/repository.js  Data adapter: Supabase (cloud) OR localStorage (demo).
│                      `cloud` flag decided at build time from VITE_SUPABASE_* env vars.
├── src/App.jsx        Shell: auth session, navigation, global save pipeline, modals, toasts.
├── Dashboard/Candidates/Demands/Workflows.jsx  Feature screens.
├── src/ui.jsx         Small shared primitives (Modal on native <dialog>, Badge, Field…).
├── supabase/migrations/001_ecod.sql  Full schema: tables, CHECKs, composite FKs
│                      (workspace_id,id), unique indexes, RLS policies, audit trigger.
└── tests/             node:test suites: domain/import (16 tests) + PGlite integration (1 test).
```

**Notable design decisions (all good):**
- Business logic lives in pure modules (`domain.js`, `import.js`) with zero React/DOM dependencies (only `crypto.randomUUID`), which is why the test suite is meaningful.
- One repository adapter with two backends; demo data **never** auto-uploads to Supabase.
- The DB is the real enforcement layer: RLS, CHECK constraints, composite foreign keys blocking cross-workspace links, append-only `history` via a `security definer` trigger, unique indexes on `lower(trim(email))` and normalized phone. The frontend is treated as untrusted and the docs say so.

## 3. Test results (executed in this sandbox)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ clean, ~4.5 s |
| `pnpm test` (`node --test`) | ✅ **all 17 test functions pass** (16 domain/import + 1 PostgreSQL integration) |
| `pnpm build` (`vite build`) | ✅ succeeds — 340 KB app + 227 KB supabase chunk, ~104 KB gzip total |
| Dev server boot + module transform | ✅ HTTP 200, JSX compiles, app serves |

What the tests actually cover (they're substantive, not smoke tests):
- Skill alias normalization without double-counting, full match-score breakdown, hard-constraint failures despite >90 score, unknown values scoring 0, stale (180-day) and other-demand assessments excluded, JD extraction including the "Java ≠ JavaScript" word-boundary case, case-insensitive duplicate detection, search syntax (phrases/conjunction/exclusions), numeric validation, quoted-CSV parsing, malformed-CSV errors, 200-row import uniqueness.
- The integration test runs the **real SQL migration in PGlite** and verifies: audit snapshots on update, case-insensitive email uniqueness, unique candidate/demand consideration, cross-workspace row isolation, cross-workspace FK rejection, viewer write denial, membership-edit denial, immutable history, anonymous access denial.

⚠️ Small reporting quirk: the TAP summary prints `# tests 16 / # pass 16` while 17 `ok` lines are emitted (the PGlite file-level aggregation undercounts). Cosmetic only.

**Coverage gaps:** no tests for React components (no @testing-library), no E2E, no linter config (ESLint/Prettier), no CI pipeline config. The untested layer is exactly the one with the most code (JSX).

## 4. Code quality assessment

**Strengths**
- Clean layering: pure logic / data adapter / UI. The matching engine is deterministic, explainable, and honest about unknowns — rare discipline.
- Product honesty: README/QA docs carefully delineate what is verified vs. not (e.g., "JD extraction is keyword-based, not an LLM"; "pipeline counts are distributions, not conversion rates"). The SECURITY scope section is unusually candid.
- Security posture is strong for this class of app: strict CSP + security headers (`netlify.toml` and `public/_headers`), no service keys in the client, RLS with `search_path=''` on security-definer functions (prevents hijacking), CSV export uses `escapeFormulae` (blocks formula injection), LinkedIn URLs validated against `https://(www.)?linkedin.com/`, React-escaped rendering throughout (no `dangerouslySetInnerHTML`).
- Accessibility touches: skip link, aria-labels, native `<dialog>` with focus handling, `role="alert"`/`role="status"`.
- Concurrency guard in `App.save` (`saving` ref) prevents double-submit races.

**Weaknesses**
1. **Extreme compression style** — entire components on one physical line (`App.jsx` is 48 "lines" / 10.7 KB). This defeats diff tooling, code review, grep, and IDE debugging. It's the single biggest maintainability risk.
2. **No linter/formatter** — dead imports (below) would have been caught instantly by ESLint.
3. **Dead code** — `resetDemo()` (repository.js) is never used; `searchCandidate()` (domain.js) is tested but the app doesn't call it (see Bug 2); unused imports: `ArrowUpDown, BriefcaseBusiness, CalendarDays, Clock, FileText, SKILLS, STAGES, matchCandidate` in Candidates.jsx and `useMemo, SKILLS` in Workflows.jsx.
4. **Search logic duplicated** between `domain.searchCandidate` and an inline copy in `Candidates.jsx` — and the two have diverged (Bug 2).
5. **Bundle**: `@supabase/supabase-js` (227 KB min) is statically imported even in demo mode where it's never used; a dynamic `import()` inside the `cloud` branch would cut ~40% of the bundle for the demo.
6. Cloud `saveRows` re-fetches the full history (`limit(1000)`) on **every** save; audit rows beyond the newest 1000 silently disappear from the UI (they remain in the DB).
7. `extractJD` builds ~40 regexes per invocation and `Dashboard`/`Demands` run `matchCandidate` per candidate per demand on every render — fine at current scale (README acknowledges the large-repo limitation), but memoization would be cheap.

## 5. Bugs and issues found

### Medium

**B1. `today()` is UTC — breaks "today" for the app's target timezone (IST).**
`domain.js`: `today = () => new Date().toISOString().slice(0, 10)` returns the **UTC** date. The app is explicitly India-focused (₹ LPA, en-IN locales). Between 00:00–05:30 IST the UTC date is still "yesterday", so:
- The "Last verified" field has `max={today()}` — a recruiter working just after local midnight **cannot select the actual current date**; the browser blocks submission as invalid.
- Follow-up badges ("due today"), `followUp <= today()` comparisons, freshness/`age()` boundaries, and `created`/`verified` stamps are all off by one day in that window.
Fix: compute the local date (e.g., `new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)`) or use `en-CA` formatting of the local date.

**B2. The shipped search is not the tested search — and it drops a field.**
`searchCandidate()` in `domain.js` (the version covered by tests) searches `name,title,company,location,email,summary,skills`. But `Candidates.jsx` re-implements the identical parser inline with `[c.name,c.email,c.title,c.company,c.location,...c.skills]` — **`summary` is missing**, so the professional summary is unsearchable from the repository page, and the tested function is dead code. Verified by probe: a candidate whose summary contains "kafka" is found by `searchCandidate` but not by the app's filter. Fix: call `searchCandidate(c, query)` inside the memo (and delete the inline copy).

**B3. Disposition reasons are silently wiped by stage moves.**
`App.jsx` `move()` saves `{...application, stage, updated: today(), reason: ''}`. Moving a consideration that was **Rejected/Withdrawn** (with a structured reason) to any other stage erases the recorded disposition reason with no confirmation. The DB only requires a reason when *entering* Rejected/Withdrawn, so the loss is silent.

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
- RLS design is genuinely solid: membership-scoped policies, composite FKs preventing cross-tenant references, `search_path=''` on security-definer functions, anon fully revoked, history insert-only via trigger, viewer writes denied at DB level (README honestly notes the UI still shows viewers edit controls — a UX debt, not a vulnerability).
- CSP has no `unsafe-eval`/`unsafe-inline` for scripts; `connect-src` limited to self + `*.supabase.co` (a Supabase custom domain would need updating).
- Demo mode keeps all data in `localStorage`; nothing crosses the network.

## 6. Recommendations (priority order)

1. Fix `today()` timezone (B1) — small change, real user impact for IST users.
2. Replace the inline search copy with `searchCandidate()` (B2) — fixes a blind spot and removes divergence.
3. Preserve `reason` on stage moves, or require explicit confirmation when clearing it (B3).
4. Epsilon-compare the weights sum (B4).
5. Add ESLint + Prettier; expand components to normal multi-line formatting — the codebase is small enough to reformat now, and painful to do later.
6. Lazy-load the Supabase client for the demo bundle; add a Settings "Reset demo data" button wired to the existing `resetDemo()`.
7. Add component-level tests (React Testing Library) for `CandidateForm`, `ImportModal` and `matchCandidate` consumers — the pure-logic core is well tested, the UI layer is not tested at all.
8. Align import validation caps with the form caps (B5), and guard the Pipeline stage select for non-open demands (B8).
9. Remove or ship the referenced `releases/ecod-netlify-demo.zip` (B9).

## 7. Verdict

A deliberately scoped, honestly documented first release with **unusually strong separation of logic, real database-level security, and a meaningful test suite that all passes**. The main risks are stylistic (one-line mega-components, no linter) rather than functional, plus a handful of small date/validation bugs — the UTC `today()` (B1) being the one most likely to bite real users in India. Nothing found blocks shipping the demo; the cloud path is well protected by the schema even though the browser layer is untested end-to-end against Supabase (as the QA doc itself states).
