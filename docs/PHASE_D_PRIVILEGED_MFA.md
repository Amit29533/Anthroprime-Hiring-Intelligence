# Phase D5: optional administrator MFA

Implemented locally; no hosted migration, activation or deployment has been performed.

Settings lets signed-in cloud users enroll a TOTP authenticator, scan the provider QR code, verify a six digit code and step up an existing session. Factor removal requires an AAL2 session, is disabled in this UI while the workspace requirement is on, and refreshes the session afterwards. Enrollment images and codes stay in component memory without application logging or custom persistent storage. Supabase manages normal session persistence. Workspace switches discard the enrollment view. Interrupted enrollment can leave an unverified provider factor; remove unused factors through provider administration if enrollment limits are reached.

An AAL2 administrator can enable `settings.custom.privilegedMfa` in Settings. Both `auditedDocumentAccess` and `auditedCandidateExports` must already be enabled. Keeping MFA enabled pins these flags. Direct settings updates cannot downgrade an enabled policy from a password-only session. Disabling also requires AAL2; trusted database operators retain a recovery path.

## Covered actions

- Administrator data-subject case creation, reads, review updates and outbound hold application/release.
- Administrator candidate CSV preparation through `api_prepare_candidate_export`.
- Administrator document signing initiation through `api_begin_document_access`.
- MFA policy activation/deactivation and settings changes while the policy is enabled.

The server checks policy at action entry, current membership and the trusted JWT's top-level `aal` claim. Missing assurance means AAL1; user metadata cannot authorize an action. Actions already in progress when the policy is enabled are not retroactively stopped. Existing permissions, outbound holds, quotas and private receipts remain enforced. Recruiter/viewer boundaries are unchanged.

This covers specific actions, not every sign-in or administrative write. Password sign-in still reaches Settings for enrollment/verification. Ordinary reads, audit metadata pages, other report/backup exports, unrelated administration, SSO and automated recovery are outside this slice. Older browsers can retain data already read; deploy matching clients and reload before activation.

Document signing checks assurance at initiation. Previously issued URLs remain usable until expiry; the service completion RPC does not re-check user MFA. JWT assurance does not provide instantaneous revocation. Factor removal refreshes this browser's session, without guaranteeing revocation of every earlier session or URL.

## Deployment and recovery

1. Back up and apply the complete migration chain through `20261006160353_privileged_mfa.sql`, then deploy matching frontend/functions. No new function, API key or SMS service is needed; enable TOTP in Supabase Auth. The migration is repeatable. Earlier migrations can replace wrappers, so apply D5 last.
2. Enroll/verify administrators before enabling. Arrange a second administrator and a trusted project operator recovery procedure. This implementation does not provide recovery codes or an email bypass.
3. Enable and verify D1 document access and D2 candidate exports first. Verify the authenticator in Settings, then select **Require administrator MFA**. Activation defaults off.
4. In hosted staging, check real enrollment, invalid/expired codes, password-only denial, AAL2 success, session refresh, factor removal, role/workspace boundaries, concurrent policy changes, direct Storage denial and Netlify downloads. Run hosted security/performance advisors; local tests do not replace provider acceptance.
5. Roll back while preserving database guards and case/receipt history. An AAL2 admin can disable the requirement. If all factors are lost, a trusted database operator can disable the flag following identity recovery. Never distribute the service-role key or add browser recovery bypasses.

## Verification

All 729 Node tests passed. Final lock-order adjustments passed two focused MFA/hold migration tests; both MFA UI tests passed, including a later failed-challenge check. Database checks cover repeated migration, opt-out compatibility, trusted/forged claims, case/hold/export/download gates, settings prerequisites/downgrade denial, recruiter compatibility and private function denial. UI checks cover provider challenge/verification, clearing enrollment material and policy controls after AAL2. ESLint, changed-file formatting and whitespace checks passed. Netlify's offline build packaged all 11 functions and met the 100 KiB entry budget (64.8 KiB). Hosted Auth/advisors acceptance remains; no local database service is available for Supabase advisors.

Implementation follows the [Supabase TOTP guide](https://supabase.com/docs/guides/auth/auth-mfa/totp) and [MFA assurance documentation](https://supabase.com/docs/guides/auth/auth-mfa). No live authenticator challenge has been performed.
