# UI functionality and appearance audit

Reviewed 30 September 2026.

The project is a React/Vite recruitment workspace with separate careers and candidate portal entry points, browser-local demo persistence, and Supabase-backed team workspaces. The review covered the shell, shared controls, feature routes, persistence helpers, public portals, and the existing workflow and database test suites.

## Findings fixed

| Trigger | Previous behavior | Updated behavior |
| --- | --- | --- |
| Complete a task in Activities | The dashboard queue checked `status`, although persisted tasks use `done`; completed tasks could remain overdue. | The queue excludes `done` tasks and retains compatibility with legacy `status: Done` records. |
| Dashboard personal-work counts | Overdue, due-today, interviews, demands, and candidates buttons opened unrestricted lists. | Buttons carry the IDs behind their counts into the destination. A visible filter banner provides a Show all action. |
| Search a candidate note | The candidate opened on Overview. | The candidate opens on Notes & follow-ups. |
| Search a skill | Search discarded the selected skill and opened Settings. | The candidate repository opens with the selected skill applied and an explicit clear action. |
| Search a referral | The general referral list opened without locating the record. | Editors open the selected referral; viewers get a filtered list with existing read-only controls. |
| Escape with zero search results | The early return for an empty result list prevented dismissal. | Escape closes the result panel before result-count checks. |
| Scheduled interview ages beyond the Upcoming window | It vanished from Upcoming while being excluded from History. | Every interview excluded from Upcoming is retained in History. |
| Load candidate/interview features in a different order | Shared download helpers in Candidates created a Candidates → Interviews → Candidates cycle, causing module initialization errors under the Vite test loader. | Helpers live in `downloads.js`; workflow, reporting, presentation and requisition screens import them directly. Existing candidate-module exports remain compatible. |
| Read a date-only task deadline outside UTC | ISO date-only parsing could assign it to the wrong local calendar day. | Date-only deadlines use local midnight, consistent with the queue's local day boundaries. |
| Personal ownership does not match | The dashboard claimed it showed the whole desk while displaying a personal queue. | The explanation accurately describes the empty personal queue and how ownership populates it. |

## Appearance

- Shared Light, Dark and Auto controls across the workspace, sign-in page, careers page and candidate portal.
- Saved browser preference, system appearance changes in Auto, and cross-tab preference updates.
- A component-level dark palette for tables, forms, dialogs, cards, charts, calendars and public portal controls.
- Refined cards, depth, sidebar accents, gradient backgrounds and decorative concentric rings around the matching graphic.
- Subtle floating graphics, entry animations and hover feedback, disabled when reduced motion is requested.
- Responsive controls; the mobile theme switch retains its accessible label while hiding its text.

## Verification scope

The existing suites exercise candidate create/edit/import/export, skill evidence, search, bulk actions, demands and matching, pipeline moves, clients and placements, referrals, assessments, task workflows, interviews and offers, reports, permissions, workspace switching, public applications, portals and database migrations. Added regressions cover persisted themes, dashboard queue navigation and clearing, completed-task exclusion, note-search navigation and empty-search dismissal.

Browser inspection checked the mobile dark appearance and desktop layout bounds. Production build, bundle budget, lint and regression results are recorded in `artifacts/` for this run.

The complete suite passed **561 tests, with zero failures** (`artifacts/final-full-tests.log`). The focused theme/navigation/work-queue run passed **47 tests** (`artifacts/final-navigation-tests.log`). The production entry remained below its 100 KiB budget. Lint passed. A broader formatting check found existing formatting issues in unrelated source files; those files were not reformatted as part of this functionality review.

Live production Supabase, object-storage credentials, real email delivery and external calendar integrations were not exercised; verification uses the project's local fixtures, UI harness and database migration tests. No deployment was performed. The pre-existing edit to `supabase/PROVISION_WORKSPACE.sql` was preserved.
