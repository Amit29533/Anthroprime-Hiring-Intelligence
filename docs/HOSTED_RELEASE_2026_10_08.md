# Hosted release verification

8 October 2026. Site: https://incomparable-mooncake-686e27.netlify.app/. Supabase project: `ysbinakvfdrzcdldaiyu`.

Netlify originally published `main@afadaba` from 3 October, while the audited work was on `codex/technical-improvements@0c87512`. The user merged pull request 10. Netlify then successfully published `main@d349035` in 39 seconds. Auto publishing from main remains enabled; no production-branch change was needed.

The hosted database initially recorded 38 baseline migrations and lacked the completion and enterprise APIs. Applied the 55 pending source migrations in filename order through the completion milestone. Retained an application-row/public-function snapshot locally before the upgrade; this is not a full native disaster-recovery backup and excludes Auth credentials and object bytes. The database contained zero candidate records before the upgrade. Archived redundant connector migration receipts before normalizing history to the repository versions.

Hosted security advisors identified two mutable helper search paths. Added and applied `20261008160434_hosted_helper_search_paths.sql`, pinning `demand_requisition_terms(public.demands)` and `skill_evidence_weight(text)` to an empty search path without changing behavior or grants. The hosted database now records exactly 94 canonical migrations. Rechecked both helper outputs and confirmed that their mutable-search-path warnings disappeared.

Live function probing found an additional runtime mismatch: eight nonscheduled diagnostic, OAuth and callback functions exported Lambda-style handlers as defaults. Netlify consequently invoked its modern API and rejected their object responses with HTTP 502. Those functions now export the named `handler` used by Netlify's [Lambda compatibility API](https://docs.netlify.com/build/functions/lambda-compatibility/). Scheduled workers already return web Responses and retain their default exports. New regressions exercise the actual deployed entrypoints, including method rejection and unauthenticated/callback-verification failures, rather than testing only factories.

## Checks performed

- Staff, careers, client and candidate-portal HTML returned HTTP 200. Every directly referenced application JS/CSS asset returned HTTP 200 with the appropriate MIME type. All entry points include the appearance bootstrap. The client entry now loads its separate client bundle.
- Staff and client sign-in screens, enterprise SSO disclosure and candidate-portal sign-in render. No credentials were entered and no production candidate record was created or modified.
- The workspace-scoped careers page successfully returned the empty published-role state. Share `/careers.html?ws=4160c839-984d-4c53-9703-1cf004eb2c49`; an unscoped fresh browser intentionally requires a workspace identifier.
- A read-only SQL check under the existing administrator's authenticated role and AAL1 claims returned valid empty repository and completion-context responses. This is a database permission check, not end-to-end authentication acceptance. Anonymous execution of the completion RPC is denied.
- All public tables have RLS enabled. No private application table grants direct SELECT to anonymous or authenticated roles.
- Candidate-portal mobile layout was checked at 390 × 844; document width equals the 375-pixel available viewport. Staff desktop theme switching worked and was restored after verification.
- All 27 focused role-matrix, requisition and skill-model tests passed after adding the helper migration. The earlier full audit passed 1,063 Node and five OCR tests; that full run preceded this small migration follow-up.
- All 55 endpoint, Google Workspace, controlled-workflow and sandbox checks passed after the deployment-export fix, including 18 new entrypoint regression checks.
- ESLint, repository formatting and offline Netlify packaging passed after the export fix; all 28 functions were packaged.

One initial staff-page console observation reported a MutationObserver error. It did not recur after reload and did not prevent rendering. No application source instantiates that observer; the built shared bundle includes Vite's document-based modulepreload observer. The origin of that one observation was not established, so this report does not claim an entirely error-free browser session. Client, careers and candidate-portal observations reported no console warnings or errors.

## Remaining acceptance and security configuration

Authenticated browser journeys require the user's sign-in and were not performed. Actual provider delivery, SSO entitlement/configuration, original-file upload and native recovery acceptance remain separately gated. No provider was activated and campaigns remain test-only.

Hosted advisors retain informational notices for deliberately inaccessible private tables with RLS and no direct policies. They also retain warnings for role-gated SECURITY DEFINER RPCs and disabled leaked-password protection. These are not resolved by granting table access or weakening permission gates. The current SQL role matrix and explicit private-table checks provide boundary evidence, not a substitute for reviewing each exposed RPC or configuring Auth protections.

Advisor references: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous definer RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
